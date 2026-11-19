import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits.js';
import { RateLimiter } from '../src/rate-limiter.js';
import { TestClock } from '../src/session/clock.js';
import { MemoryStore } from '../src/store/memory-store.js';

const { windowMs, maxInbound } = LIMITS.rateLimit;

function setup() {
  const clock = new TestClock(1_000_000);
  const limiter = new RateLimiter({ store: new MemoryStore(), clock });
  return { clock, limiter };
}

describe('RateLimiter', () => {
  it('allows max messages, rejects the next', async () => {
    const { limiter } = setup();
    for (let i = 0; i < maxInbound; i++) expect(await limiter.check('+2348012345678', 'inbound')).toBe(true);
    expect(await limiter.check('+2348012345678', 'inbound')).toBe(false);
  });

  it('allows again after exactly windowMs', async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < maxInbound; i++) await limiter.check('+2348012345678', 'inbound');
    clock.advance(windowMs - 1);
    expect(await limiter.check('+2348012345678', 'inbound')).toBe(false);
    clock.advance(1);
    expect(await limiter.check('+2348012345678', 'inbound')).toBe(true);
  });

  it('keeps phone numbers independent', async () => {
    const { limiter } = setup();
    for (let i = 0; i < maxInbound; i++) await limiter.check('+2348012345678', 'inbound');
    expect(await limiter.check('+2348012345678', 'inbound')).toBe(false);
    expect(await limiter.check('+2348099999999', 'inbound')).toBe(true);
  });

  it('counts inbound and outbound separately', async () => {
    const { limiter } = setup();
    for (let i = 0; i < maxInbound; i++) await limiter.check('+2348012345678', 'inbound');
    expect(await limiter.check('+2348012345678', 'inbound')).toBe(false);
    expect(await limiter.check('+2348012345678', 'outbound')).toBe(true);
  });
});
