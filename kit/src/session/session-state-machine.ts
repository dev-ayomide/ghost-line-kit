import { LIMITS } from '../limits';
import type { Store } from '../store/store.js';
import type { Clock } from './clock.js';

// TODO(task 6.1): re-point the channel union to `ChannelType` from channels/types.ts.
type SessionChannel = 'sms' | 'ussd' | 'web';

export type SessionStatus = 'active' | 'timed-out' | 'ended';

export interface SessionState<T = unknown> {
  phoneNumber: string;
  channel: SessionChannel;
  conversationState: T;
  lastInboundMs: number;
  status: SessionStatus;
}

/**
 * `inbound` carries phoneNumber and channel because the pure function has no
 * other way to know them when it creates a brand-new session.
 */
export type SessionEvent =
  | { type: 'inbound'; conversationState: unknown; phoneNumber: string; channel: SessionChannel }
  | { type: 'check' }
  | { type: 'end' };

/** Timed out means 180 s or more since the last inbound (inclusive boundary). Backwards time is not timed out. */
function isStale(session: SessionState, nowMs: number, timeoutMs: number): boolean {
  return nowMs - session.lastInboundMs >= timeoutMs;
}

/**
 * Pure session transition. Never mutates its input.
 *
 * - inbound, no session: creates an active session from the event.
 * - inbound, timed-out session (status 'timed-out', or 'active' but stale):
 *   RESUME. Status becomes 'active', lastInboundMs = nowMs, and the
 *   conversationState is exactly the one preserved from the last inbound.
 *   The event's conversationState is ignored on resume.
 * - inbound, fresh active session: takes the event's conversationState.
 * - check: marks a stale session 'timed-out'; otherwise returns it unchanged.
 * - end: returns undefined (record removed). 'ended' is never persisted.
 */
export function sessionTransition(
  current: SessionState | undefined,
  event: SessionEvent,
  nowMs: number,
  timeoutMs: number = LIMITS.ussd.sessionTimeoutMs,
): SessionState | undefined {
  switch (event.type) {
    case 'end':
      return undefined;
    case 'check': {
      if (current === undefined) return undefined;
      if (isStale(current, nowMs, timeoutMs)) return { ...current, status: 'timed-out' };
      return { ...current };
    }
    case 'inbound': {
      if (current === undefined) {
        return {
          phoneNumber: event.phoneNumber,
          channel: event.channel,
          conversationState: event.conversationState,
          lastInboundMs: nowMs,
          status: 'active',
        };
      }
      const resuming = current.status === 'timed-out' || isStale(current, nowMs, timeoutMs);
      return {
        ...current,
        conversationState: resuming ? current.conversationState : event.conversationState,
        lastInboundMs: nowMs,
        status: 'active',
      };
    }
  }
}

export interface SessionStateMachineOptions {
  store: Store;
  clock: Clock;
  /** Inactivity timeout in ms. Defaults to `LIMITS.ussd.sessionTimeoutMs`. */
  timeoutMs?: number;
}

/** Store key for a session. Contains the phone number, so never log it. */
function sessionKey(phoneNumber: string, channel: SessionChannel): string {
  return `session:${channel}:${phoneNumber}`;
}

/**
 * Session lifecycle over a `Store`, using the pure `sessionTransition`.
 *
 * Timeout is lazy: it is evaluated against `clock.now()` on every call, so a
 * session at or past the timeout is never reported as 'active'. Timed-out
 * sessions stay in the store so the next inbound message can resume them.
 * Store errors propagate unchanged; state is written only after the
 * transition has been computed, so a failure never leaves partial state.
 */
export class SessionStateMachine {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly timeoutMs: number;

  constructor(options: SessionStateMachineOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.timeoutMs = options.timeoutMs ?? LIMITS.ussd.sessionTimeoutMs;
  }

  /** Records an inbound message. A timed-out session resumes with its preserved conversation state. */
  async handleInbound<T = unknown>(
    phoneNumber: string,
    channel: SessionChannel,
    conversationState: T,
  ): Promise<SessionState<T>> {
    const key = sessionKey(phoneNumber, channel);
    const current = await this.store.read<SessionState>(key);
    const next = sessionTransition(
      current,
      { type: 'inbound', conversationState, phoneNumber, channel },
      this.clock.now(),
      this.timeoutMs,
    ) as SessionState<T>;
    await this.store.write(key, next);
    return next;
  }

  /** Ends the session and removes its record. */
  async endSession(phoneNumber: string, channel: SessionChannel): Promise<void> {
    const key = sessionKey(phoneNumber, channel);
    sessionTransition(undefined, { type: 'end' }, this.clock.now(), this.timeoutMs);
    await this.store.delete(key);
  }

  /** Returns the session, marking it 'timed-out' (and persisting that) when stale. Undefined if none or ended. */
  async getSession<T = unknown>(
    phoneNumber: string,
    channel: SessionChannel,
  ): Promise<SessionState<T> | undefined> {
    const key = sessionKey(phoneNumber, channel);
    const current = await this.store.read<SessionState>(key);
    const next = sessionTransition(current, { type: 'check' }, this.clock.now(), this.timeoutMs);
    if (next !== undefined && current !== undefined && next.status !== current.status) {
      await this.store.write(key, next);
    }
    return next as SessionState<T> | undefined;
  }
}
