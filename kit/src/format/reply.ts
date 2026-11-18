import type { ChannelType } from '../channels/types.js';
import { LIMITS } from '../limits.js';
import { detectEncoding, type Encoding } from './encoding.js';
import { pureSplit, splitByLimit, splitMessage, summarizeSegments } from './split.js';

// The message processor will wrap a ReplyResult into an OutboundMessage.
export interface ReplyOpts {
  channel: ChannelType;
  /** false for STOP / DELETE / session-end acknowledgements: no next step is added. */
  continueConversation: boolean;
  /** App-supplied next-step copy. Trimmed to LIMITS.reply.nextStepMaxLength. */
  nextStep?: string;
}

export interface ReplyResult {
  /** SMS/web segments, or USSD screens. */
  segments: string[];
  encoding: Encoding;
  truncated: boolean;
}

/** Default next step. Apps override it with `opts.nextStep` (copy belongs in app config). */
export const DEFAULT_NEXT_STEP = 'Reply HELP for options';

const SEP = '\n';

/** Trims `step` to at most `max` characters, at a word boundary when possible. */
function fitStep(step: string, max: number): string {
  const s = step.trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  if (/\s/.test(s.charAt(max))) return head.trimEnd();
  const idx = head.search(/\s\S*$/);
  if (idx > 0) return head.slice(0, idx).trimEnd();
  // One long word: cut on a character boundary (never leave half a surrogate pair).
  const last = head.charCodeAt(head.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head).trimEnd();
}

function resolveStep(opts: ReplyOpts): string {
  const max = LIMITS.reply.nextStepMaxLength;
  const custom = opts.nextStep === undefined ? '' : fitStep(opts.nextStep, max);
  return custom.length > 0 ? custom : fitStep(DEFAULT_NEXT_STEP, max);
}

/** Appends `step` whole to the last piece if it fits `limit`, else as a new piece. */
function attach(pieces: string[], step: string, limit: number): string[] {
  const out = pieces.slice();
  const last = out.length - 1;
  if (last >= 0 && out[last]!.length + SEP.length + step.length <= limit) {
    out[last] += SEP + step;
  } else {
    out.push(step);
  }
  return out;
}

function formatSms(content: string, step: string): ReplyResult {
  const base = splitMessage(content);
  if (base.truncated) return { segments: base.segments, encoding: base.encoding, truncated: true };

  // The step may switch the encoding (a non-GSM character), so detect on the full text.
  const encoding = detectEncoding(content + SEP + step);
  const limits = encoding === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2;

  const whole = content.length === 0 ? step : content + SEP + step;
  if (whole.length <= limits.singleSegment) {
    return { segments: [whole], encoding, truncated: false };
  }

  // Multi-segment from here on: the concat limit applies to every segment.
  const segments = attach(splitByLimit(content, limits.concatSegment), step, limits.concatSegment);
  if (segments.length > LIMITS.reply.maxPreferredSegments) {
    const all = pureSplit(content, encoding);
    // Summary keeps a prefix of the content; the step is dropped in favour of "Reply MORE".
    return {
      segments: summarizeSegments(all.length > LIMITS.reply.maxPreferredSegments ? all : segments, encoding),
      encoding,
      truncated: true,
    };
  }
  return { segments, encoding, truncated: false };
}

function formatUssd(content: string, step: string | undefined): ReplyResult {
  const target = LIMITS.ussd.screenSoftTarget;
  let screens = splitByLimit(content, target);
  if (step !== undefined) screens = attach(screens, step, target);
  return {
    segments: screens,
    encoding: detectEncoding(screens.join(SEP)),
    truncated: false,
  };
}

/**
 * Formats a reply for a channel. When the conversation continues, a next step
 * (at most LIMITS.reply.nextStepMaxLength characters) goes on the final segment, or
 * whole in an extra segment if it does not fit. Content is never cut to make room (Req 7.2).
 */
export function formatReply(content: string, opts: ReplyOpts): ReplyResult {
  if (!opts.continueConversation) {
    if (opts.channel === 'ussd') return formatUssd(content, undefined);
    const r = splitMessage(content);
    return { segments: r.segments, encoding: r.encoding, truncated: r.truncated };
  }
  const step = resolveStep(opts);
  return opts.channel === 'ussd' ? formatUssd(content, step) : formatSms(content, step);
}
