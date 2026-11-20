/**
 * MessageProcessor: the inbound pipeline that turns one InboundMessage into
 * the OutboundMessages to send.
 *
 * Design decisions (see also design.md "Message Processor"):
 *
 * - The processor never sends. The app's HTTP handler sends the returned
 *   messages with a ChannelAdapter (or returns the USSD text), so there is no
 *   adapter in the config.
 * - The processor never throws. Any error becomes ONE generic, safe reply
 *   (`toUserMessage`) and the logger gets only `internalErrorCode(err)`.
 * - STOP, DELETE and START are handled BEFORE rate limiting, so honouring a
 *   user's STOP or DELETE works even for a rate-limited number. They still
 *   count towards the inbound counter (the result of the check is ignored).
 * - User record: `user:<phone>` = `{ subscribed: boolean }`. A number with no
 *   record is "not subscribed yet" only for the STOP check. The first ordinary
 *   message creates `{ subscribed: true }`. Unsubscribed users get no reply
 *   and no agent or model call, except for START and DELETE.
 * - DELETE erases kit-owned data: the user record, the session on all three
 *   channels, the pending-MORE record, and then calls `eraseUserData` so apps
 *   erase their own keys (the Store interface cannot list keys). Rate-limit
 *   counters are kept: they hold only timestamps, and erasing them would let
 *   DELETE reset abuse limits.
 * - Pending MORE: when a reply is truncated, the REMAINING text (the part not
 *   yet sent) is stored under `pending:<phone>`; MORE sends the next chunk.
 * - USSD returns exactly ONE message (the first screen). Further screens are
 *   dropped and logged as USSD_SCREENS_DROPPED. USSD tools should return text
 *   that fits one screen; use `renderMenuScreens` for longer menus.
 * - Outbound limiting is applied to every outbound message, including
 *   acknowledgements. Once a send is refused, that message and the rest are
 *   dropped. Error replies from the catch-all are never dropped.
 * - Next step: an optional static `nextStep` (validated in the constructor) replaces
 *   the default "Reply HELP for options" on replies that continue the conversation.
 *   The user record shape and key live in `subscription.ts` (`isSubscribed`).
 * - Logging: message id, message length, event/error code and the raw phone
 *   number (the logger masks it). Message bodies are never logged.
 */
import type { Agent } from './agent/agent.js';
import { UNRECOGNIZED_INTENT, type Intent } from './agent/intent.js';
import type { ChannelType, InboundMessage, OutboundMessage } from './channels/types.js';
import { internalErrorCode, KitError, toUserMessage } from './errors.js';
import { detectEncoding } from './format/encoding.js';
import { maskPhoneNumber } from './format/phone.js';
import { formatReply } from './format/reply.js';
import { LIMITS } from './limits.js';
import type { SafeLogger } from './logger.js';
import type { RateLimiter } from './rate-limiter.js';
import type { Clock } from './session/clock.js';
import type { SessionStateMachine } from './session/session-state-machine.js';
import type { Store } from './store/store.js';
import { userKey, type UserRecord } from './subscription.js';
import type { TraceEvent, TraceSink } from './trace.js';

export interface ProcessorCopy {
  stopped: string;
  notSubscribed: string;
  deleted: string;
  resubscribed: string;
  unrecognized: string;
  nothingMore: string;
  done: string;
}

export const DEFAULT_PROCESSOR_COPY: Readonly<ProcessorCopy> = Object.freeze({
  stopped: 'You are unsubscribed. Send START to join again.',
  notSubscribed: 'You are not subscribed. Send START to join.',
  deleted: 'Your data is erased. Send START to begin again.',
  resubscribed: 'Welcome back. Send HELP for options.',
  unrecognized: 'Sorry, I did not get that. Send HELP for options.',
  nothingMore: 'Nothing more to send. Send HELP for options.',
  done: 'Done.',
});

export interface ToolContext {
  phoneNumber: string;
  channel: ChannelType;
  conversationState: unknown;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface MessageProcessorConfig {
  store: Store;
  session: SessionStateMachine;
  agent: Agent;
  clock: Clock;
  rateLimiter: RateLimiter;
  logger: SafeLogger;
  copy?: Partial<ProcessorCopy>;
  buildToolCall?: (intent: Intent, ctx: ToolContext) => ToolCall;
  renderOutput?: (output: unknown, ctx: ToolContext) => string;
  eraseUserData?: (phoneNumber: string) => Promise<void>;
  /** Optional observer for trace events. Never receives raw message text. Never affects the result. */
  onTrace?: TraceSink;
  /**
   * Optional next-step text for replies that continue the conversation. One static
   * string per processor. Non-empty, GSM-7, at most LIMITS.reply.nextStepMaxLength.
   * When unset, the kit default (DEFAULT_NEXT_STEP) is used.
   */
  nextStep?: string;
}

const TRACE_TITLE_MAX = 80;
const TRACE_SUMMARY_MAX = 200;

/**
 * Single-line, bounded summary of any value. The sender's number (exact and
 * digits-only form) is replaced with its masked form before the cut.
 */
function redactSummary(value: unknown, senderPhone: string): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (typeof json !== 'string') return '[unserialisable]';
  let out = json;
  const masked = maskPhoneNumber(senderPhone);
  const digits = senderPhone.replace(/\D/g, '');
  if (senderPhone !== '') out = out.split(senderPhone).join(masked);
  if (digits !== '') out = out.split(digits).join(masked);
  return out.slice(0, TRACE_SUMMARY_MAX);
}

interface PendingRecord {
  text: string;
}

const ALL_CHANNELS: readonly ChannelType[] = ['sms', 'ussd', 'web'];
const MORE_SUFFIX_RE = /\s*Reply MORE$/;

const pendingKey = (phone: string): string => `pending:${phone}`;

function resolveCopy(overrides: Partial<ProcessorCopy> | undefined): ProcessorCopy {
  const copy: ProcessorCopy = { ...DEFAULT_PROCESSOR_COPY };
  for (const key of Object.keys(DEFAULT_PROCESSOR_COPY) as (keyof ProcessorCopy)[]) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Invalid processor copy "${key}": must be a non-empty string`);
    }
    if (value.length > LIMITS.reply.errorMaxLength) {
      throw new Error(`Invalid processor copy "${key}": too long`);
    }
    if (detectEncoding(value) !== 'GSM-7') {
      throw new Error(`Invalid processor copy "${key}": must be GSM-7`);
    }
    copy[key] = value;
  }
  return copy;
}

function validateNextStep(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid processor nextStep: must be a non-empty string');
  }
  if (value.length > LIMITS.reply.nextStepMaxLength) {
    throw new Error('Invalid processor nextStep: too long');
  }
  if (detectEncoding(value) !== 'GSM-7') {
    throw new Error('Invalid processor nextStep: must be GSM-7');
  }
  return value;
}

function defaultBuildToolCall(intent: Intent, ctx: ToolContext): ToolCall {
  return { name: intent.name, input: { ...intent.parameters, phoneNumber: ctx.phoneNumber } };
}

interface Rendered {
  messages: OutboundMessage[];
  /** Remaining text for MORE, when the reply was truncated. */
  remaining?: string;
  droppedScreens: number;
}

export class MessageProcessor {
  private readonly store: Store;
  private readonly session: SessionStateMachine;
  private readonly agent: Agent;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: SafeLogger;
  private readonly copy: ProcessorCopy;
  private readonly buildToolCall: (intent: Intent, ctx: ToolContext) => ToolCall;
  private readonly renderOutput: (output: unknown, ctx: ToolContext) => string;
  private readonly eraseUserData?: (phoneNumber: string) => Promise<void>;
  private readonly clock: Clock;
  private readonly onTrace?: TraceSink;
  private readonly nextStep?: string;

  constructor(config: MessageProcessorConfig) {
    this.nextStep = validateNextStep(config.nextStep);
    this.clock = config.clock;
    this.onTrace = config.onTrace;
    this.store = config.store;
    this.session = config.session;
    this.agent = config.agent;
    this.rateLimiter = config.rateLimiter;
    this.logger = config.logger;
    this.copy = resolveCopy(config.copy);
    this.buildToolCall = config.buildToolCall ?? defaultBuildToolCall;
    this.renderOutput = config.renderOutput ?? ((o) => this.defaultRender(o));
    this.eraseUserData = config.eraseUserData;
  }

  /** Processes one inbound message. Never throws. */
  async process(inbound: InboundMessage): Promise<OutboundMessage[]> {
    const messageId = inbound.messageId ?? `in-${inbound.timestamp}`;
    try {
      return await this.run(inbound, messageId);
    } catch (err) {
      return this.failure(inbound, messageId, err);
    }
  }

  private failure(inbound: InboundMessage, messageId: string, err: unknown): OutboundMessage[] {
    try {
      this.logger.error({
        error: internalErrorCode(err),
        messageId,
        phoneNumber: inbound.from,
        messageLength: inbound.text.length,
      });
    } catch {
      // Logging must never break message handling.
    }
    try {
      return this.render(toUserMessage(err), inbound, false).messages;
    } catch {
      return [{ to: inbound.from, text: toUserMessage(KitError.generic('render failed')) }];
    }
  }

  private log(inbound: InboundMessage, messageId: string, event: string): void {
    this.logger.info({
      event,
      messageId,
      phoneNumber: inbound.from,
      messageLength: inbound.text.length,
    });
  }

  /** Builds and delivers one trace event. Does nothing without a sink. Never throws. */
  private emit(
    messageId: string,
    event: Omit<TraceEvent, 'messageId' | 'at'>,
  ): void {
    const sink = this.onTrace;
    if (sink === undefined) return;
    try {
      sink({
        ...event,
        messageId,
        at: this.clock.now(),
        title: event.title.slice(0, TRACE_TITLE_MAX),
      });
    } catch {
      // A faulty sink must never change message handling.
    }
  }

  private async run(inbound: InboundMessage, messageId: string): Promise<OutboundMessage[]> {
    const phone = inbound.from;
    const channel = inbound.channel;
    const keyword = inbound.text.trim().toUpperCase();
    this.log(inbound, messageId, 'INBOUND');

    // STOP / DELETE / START come before rate limiting (they still count).
    if (keyword === 'STOP' || keyword === 'DELETE' || keyword === 'START') {
      await this.rateLimiter.check(phone, 'inbound');
      const reply = await this.handleKeyword(keyword, inbound, messageId);
      this.emit(messageId, { type: 'reasoning', title: `Keyword ${keyword} handled` });
      return this.finish(inbound, messageId, this.render(reply, inbound, false));
    }

    const user = await this.store.read<UserRecord>(userKey(phone));
    if (user !== undefined && user.subscribed === false) {
      this.log(inbound, messageId, 'IGNORED_UNSUBSCRIBED');
      return [];
    }

    if (!(await this.rateLimiter.check(phone, 'inbound'))) {
      this.log(inbound, messageId, 'RATE_LIMITED');
      this.emit(messageId, { type: 'reasoning', title: 'Rate limit reached' });
      return this.finish(
        inbound,
        messageId,
        this.render(toUserMessage(KitError.rateLimited()), inbound, false),
      );
    }

    if (user === undefined) await this.store.write<UserRecord>(userKey(phone), { subscribed: true });

    if (keyword === 'MORE') {
      this.emit(messageId, { type: 'reasoning', title: 'Sending the rest of a long reply' });
      const pending = await this.store.read<PendingRecord>(pendingKey(phone));
      if (pending === undefined || typeof pending.text !== 'string' || pending.text === '') {
        await this.store.delete(pendingKey(phone));
        return this.finish(inbound, messageId, this.render(this.copy.nothingMore, inbound, true));
      }
      return this.finish(inbound, messageId, this.render(pending.text, inbound, true));
    }

    const existing = await this.session.getSession(phone, channel);
    const s = await this.session.handleInbound(phone, channel, existing?.conversationState ?? {});
    const ctx: ToolContext = { phoneNumber: phone, channel, conversationState: s.conversationState };

    const intent = await this.agent.classify(inbound.text);
    const unrecognized = intent.name === UNRECOGNIZED_INTENT;
    if (this.onTrace !== undefined) {
      this.emit(messageId, {
        type: 'reasoning',
        title: unrecognized
          ? 'Not understood, asking the user to try HELP'
          : `Understood as "${intent.name}"`,
        summary: redactSummary(intent.parameters, phone),
      });
    }
    let text: string;
    if (unrecognized) {
      text = this.copy.unrecognized;
    } else {
      const call = this.buildToolCall(intent, ctx);
      if (this.onTrace !== undefined) {
        this.emit(messageId, {
          type: 'tool_call',
          title: `Calling ${call.name}`,
          tool: call.name,
          summary: redactSummary(call.input, phone),
        });
      }
      const startedAt = this.clock.now();
      const result = await this.agent.invokeTool(call.name, call.input);
      if (this.onTrace !== undefined) {
        this.emit(messageId, {
          type: 'tool_result',
          title: result.ok ? `${call.name} finished` : `${call.name} failed`,
          tool: call.name,
          ok: result.ok,
          durationMs: this.clock.now() - startedAt,
          summary: result.ok ? redactSummary(result.output, phone) : redactSummary(result.userMessage, phone),
        });
      }
      text = result.ok ? this.renderOutput(result.output, ctx) : result.userMessage;
    }
    if (typeof text !== 'string' || text.trim() === '') text = this.copy.done;
    return this.finish(inbound, messageId, this.render(text, inbound, true));
  }

  private async handleKeyword(
    keyword: 'STOP' | 'DELETE' | 'START',
    inbound: InboundMessage,
    messageId: string,
  ): Promise<string> {
    const phone = inbound.from;
    if (keyword === 'STOP') {
      const user = await this.store.read<UserRecord>(userKey(phone));
      if (user === undefined || user.subscribed !== true) {
        this.log(inbound, messageId, 'STOP_NOT_SUBSCRIBED');
        return this.copy.notSubscribed;
      }
      await this.store.write<UserRecord>(userKey(phone), { subscribed: false });
      await this.session.endSession(phone, inbound.channel);
      this.log(inbound, messageId, 'STOP');
      return this.copy.stopped;
    }
    if (keyword === 'DELETE') {
      await this.store.delete(userKey(phone));
      for (const ch of ALL_CHANNELS) await this.session.endSession(phone, ch);
      await this.store.delete(pendingKey(phone));
      if (this.eraseUserData) await this.eraseUserData(phone);
      this.log(inbound, messageId, 'DELETE');
      return this.copy.deleted;
    }
    await this.store.write<UserRecord>(userKey(phone), { subscribed: true });
    this.log(inbound, messageId, 'START');
    return this.copy.resubscribed;
  }

  private defaultRender(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output !== null && typeof output === 'object') {
      const t = (output as { text?: unknown }).text;
      if (typeof t === 'string') return t;
    }
    return this.copy.done;
  }

  /** Formats text for the inbound channel. Pure apart from computing the MORE remainder. */
  private render(text: string, inbound: InboundMessage, continueConversation: boolean): Rendered {
    const { from: phone, channel } = inbound;
    const reply = formatReply(
      text,
      this.nextStep === undefined
        ? { channel, continueConversation }
        : { channel, continueConversation, nextStep: this.nextStep },
    );
    if (channel === 'ussd') {
      const first = reply.segments[0] ?? '';
      return {
        messages: [{ to: phone, text: first, sessionId: inbound.sessionId, endSession: !continueConversation }],
        droppedScreens: Math.max(0, reply.segments.length - 1),
      };
    }
    const messages: OutboundMessage[] = reply.segments.map((seg) => ({
      to: phone,
      text: seg,
      sessionId: inbound.sessionId,
    }));
    if (!reply.truncated) return { messages, droppedScreens: 0 };
    return { messages, remaining: remainingAfter(text, reply.segments), droppedScreens: 0 };
  }

  /** Updates the pending-MORE record, logs, and applies the outbound limit. */
  private async finish(
    inbound: InboundMessage,
    messageId: string,
    rendered: Rendered,
  ): Promise<OutboundMessage[]> {
    const phone = inbound.from;
    if (rendered.droppedScreens > 0) this.log(inbound, messageId, 'USSD_SCREENS_DROPPED');

    if (rendered.remaining !== undefined && rendered.remaining !== '') {
      await this.store.write<PendingRecord>(pendingKey(phone), { text: rendered.remaining });
    } else {
      await this.store.delete(pendingKey(phone));
    }

    const sent: OutboundMessage[] = [];
    for (const msg of rendered.messages) {
      if (!(await this.rateLimiter.check(phone, 'outbound'))) {
        this.log(inbound, messageId, 'OUTBOUND_LIMITED');
        break;
      }
      sent.push(msg);
    }
    this.log(inbound, messageId, 'REPLIED');
    return sent;
  }
}

/** The part of `original` that the truncated segments did not send. */
function remainingAfter(original: string, segments: string[]): string {
  const last = segments.length - 1;
  const sent = segments
    .map((seg, i) => (i === last ? seg.replace(MORE_SUFFIX_RE, '') : seg))
    .join('');
  let n = 0;
  while (n < sent.length && n < original.length && sent[n] === original[n]) n++;
  // Never split a surrogate pair at the cut.
  if (n > 0 && n < original.length) {
    const c = original.charCodeAt(n - 1);
    if (c >= 0xd800 && c <= 0xdbff) n--;
  }
  return original.slice(n).trimStart();
}
