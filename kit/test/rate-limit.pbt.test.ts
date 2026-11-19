import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LIMITS } from '../src/limits.js';
import { checkRateLimit, type RateDirection, type RateLimitState } from '../src/rate-limiter.js';

// Feature: kit-core, Property 10: Rate limit correctness
// **Validates: Requirements 16.1, 16.2, 16.3**

const { windowMs, maxInbound, maxOutbound } = LIMITS.rateLimit;
const maxFor = (d: RateDirection): number => (d === 'inbound' ? maxInbound : maxOutbound);
const dirArb = fc.constantFrom<RateDirection>('inbound', 'outbound');
const nowArb = fc.integer({ min: 10 * windowMs, max: 1_000_000_000 });

// Age relative to now: inside, exactly at the boundary, expired, or in the future.
const ageArb = fc.oneof(
  fc.integer({ min: 0, max: windowMs - 1 }),
  fc.constant(windowMs),
  fc.integer({ min: windowMs, max: 5 * windowMs }),
  fc.integer({ min: -windowMs, max: -1 }),
);
const listArb = (now: number) =>
  fc.array(ageArb, { maxLength: 15 }).map((ages) => ages.map((a) => now - a));
const caseArb = nowArb.chain((now) =>
  fc.record({
    now: fc.constant(now),
    state: fc.record({ inbound: listArb(now), outbound: listArb(now) }),
    dir: dirArb,
  }),
);

const inWindow = (list: number[], now: number): number[] => list.filter((t) => now - t < windowMs);

describe('Property 10: rate limit correctness', () => {
  it('allows iff in-window count < max, and records only allowed attempts', () => {
    fc.assert(
      fc.property(caseArb, ({ now, state, dir }) => {
        const snapshot = JSON.stringify(state);
        const other: RateDirection = dir === 'inbound' ? 'outbound' : 'inbound';
        const max = maxFor(dir);
        const pruned = inWindow(state[dir], now);
        const { allowed, newState } = checkRateLimit(state, dir, now, { windowMs, max });

        expect(allowed).toBe(pruned.length < max);
        if (allowed) {
          expect(newState[dir]).toEqual([...pruned, now]);
        } else {
          expect(newState[dir]).toEqual(pruned);
          expect(newState[dir]).not.toContain(now);
        }
        expect(newState[other]).toEqual(state[other]);
        expect(JSON.stringify(state)).toBe(snapshot);
        if (state[dir].length <= max) expect(newState[dir].length).toBeLessThanOrEqual(max);
        expect(inWindow(newState[dir], now).length).toBeLessThanOrEqual(max);
      }),
      { numRuns: 300 },
    );
  });

  it('allows and keeps only the new timestamp when all prior timestamps expired', () => {
    fc.assert(
      fc.property(
        nowArb,
        dirArb,
        fc.array(fc.integer({ min: windowMs, max: 5 * windowMs }), { maxLength: 15 }),
        (now, dir, ages) => {
          const state: RateLimitState = { inbound: [], outbound: [] };
          state[dir] = ages.map((a) => now - a);
          const { allowed, newState } = checkRateLimit(state, dir, now, { windowMs, max: maxFor(dir) });
          expect(allowed).toBe(true);
          expect(newState[dir]).toEqual([now]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never lets more than max through inside any single window (sliding-window oracle)', () => {
    fc.assert(
      fc.property(
        dirArb,
        fc.array(fc.integer({ min: 0, max: windowMs / 4 }), { minLength: 1, maxLength: 80 }),
        (dir, gaps) => {
          const max = maxFor(dir);
          let state: RateLimitState = { inbound: [], outbound: [] };
          let t = 1_000_000;
          const times: number[] = [];
          const accepted: number[] = [];
          for (const gap of gaps) {
            t += gap;
            times.push(t);
            const r = checkRateLimit(state, dir, t, { windowMs, max });
            state = r.newState;
            if (r.allowed) accepted.push(t);
          }
          // Oracle 1: no window of length windowMs ending at an accepted time holds more than max.
          for (const end of accepted) {
            const n = accepted.filter((a) => a <= end && end - a < windowMs).length;
            expect(n).toBeLessThanOrEqual(max);
          }
          // Oracle 2: every rejection was justified (max already accepted in its window).
          for (const at of times.filter((x) => !accepted.includes(x))) {
            const n = accepted.filter((a) => a < at && at - a < windowMs).length;
            expect(n).toBeGreaterThanOrEqual(max);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
