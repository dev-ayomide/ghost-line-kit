import { describe, expect, it } from 'vitest';
import { SystemClock, TestClock } from '../src/session/clock.js';

describe('TestClock', () => {
  it('starts at 0 by default and at the given time otherwise', () => {
    expect(new TestClock().now()).toBe(0);
    expect(new TestClock(5000).now()).toBe(5000);
  });

  it('advance moves time forward', () => {
    const c = new TestClock(100);
    c.advance(50);
    c.advance(0);
    expect(c.now()).toBe(150);
  });

  it('set replaces the time, including moving backwards', () => {
    const c = new TestClock(100);
    c.set(10);
    expect(c.now()).toBe(10);
  });

  it('advance throws RangeError on negative or non-finite values', () => {
    const c = new TestClock(100);
    expect(() => c.advance(-1)).toThrow(RangeError);
    expect(() => c.advance(NaN)).toThrow(RangeError);
    expect(() => c.advance(Infinity)).toThrow(RangeError);
    expect(c.now()).toBe(100);
  });

  it('set throws RangeError on non-finite values', () => {
    const c = new TestClock(100);
    expect(() => c.set(NaN)).toThrow(RangeError);
    expect(() => c.set(-Infinity)).toThrow(RangeError);
    expect(c.now()).toBe(100);
  });
});

describe('SystemClock', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now();
    const t = new SystemClock().now();
    const after = Date.now();
    expect(typeof t).toBe('number');
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});
