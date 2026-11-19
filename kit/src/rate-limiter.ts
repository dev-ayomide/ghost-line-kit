import { LIMITS } from './limits.js';
import type { Clock } from './session/clock.js';
import type { Store } from './store/store.js';

/** Timestamps (epoch ms) of accepted messages, per direction. */
export interface RateLimitState {
  inbound: number[];
  outbound: number[];
}

export interface RateLimitConfig {
  windowMs: number;
  maxInbound: number;
  maxOutbound: number;
}

export type RateDirection = 'inbound' | 'outbound';

/**
 * Pure sliding-window check. A timestamp `t` is inside the window iff
 * `nowMs - t < windowMs` (so a timestamp exactly `windowMs` old has expired).
 * Future timestamps count as inside.
 *
 * Allowed iff in-window count is below `max`. Only allowed attempts are
 * recorded, so a rejected sender cannot extend their own lockout.
 * The other direction is returned unchanged. The input is never mutated.
 */
export function checkRateLimit(
  state: RateLimitState,
  direction: RateDirection,
  nowMs: number,
  limits: { windowMs: number; max: number },
): { allowed: boolean; newState: RateLimitState } {
  const pruned = state[direction].filter((t) => nowMs - t < limits.windowMs);
  const allowed = pruned.length < limits.max;
  const next = allowed ? [...pruned, nowMs] : pruned;
  const other: RateDirection = direction === 'inbound' ? 'outbound' : 'inbound';
  const newState: RateLimitState = {
    inbound: [],
    outbound: [],
  };
  newState[direction] = next;
  newState[other] = [...state[other]];
  return { allowed, newState };
}

function sameList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Per-phone-number rate limiter backed by a `Store`.
 *
 * Note: the read-modify-write is not atomic across concurrent invocations,
 * so a burst of parallel requests can slightly exceed the limit. A DynamoDB
 * conditional write or atomic counter can tighten this later.
 */
export class RateLimiter {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly config: RateLimitConfig;

  constructor(opts: { store: Store; clock: Clock; limits?: RateLimitConfig }) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.config = opts.limits ?? LIMITS.rateLimit;
  }

  /** Resolves true if the message is allowed. Store errors propagate. */
  async check(phoneNumber: string, direction: RateDirection): Promise<boolean> {
    const key = `ratelimit:${phoneNumber}`;
    const state = (await this.store.read<RateLimitState>(key)) ?? { inbound: [], outbound: [] };
    const max = direction === 'inbound' ? this.config.maxInbound : this.config.maxOutbound;
    const { allowed, newState } = checkRateLimit(state, direction, this.clock.now(), {
      windowMs: this.config.windowMs,
      max,
    });
    const changed =
      !sameList(state.inbound, newState.inbound) || !sameList(state.outbound, newState.outbound);
    if (changed) await this.store.write(key, newState);
    return allowed;
  }
}
