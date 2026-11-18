/** Source of time for session logic. Returns epoch milliseconds. */
export interface Clock {
  now(): number;
}

/** Real clock backed by `Date.now()`. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests. Time only moves when told to. */
export class TestClock implements Clock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  /** Move time forward by `ms`. Throws RangeError if `ms` is negative or not finite. */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance(ms) requires a finite, non-negative number; got ${ms}`);
    }
    this.current += ms;
  }

  /** Set the time to `ms`. Throws RangeError if `ms` is not finite. */
  set(ms: number): void {
    if (!Number.isFinite(ms)) {
      throw new RangeError(`set(ms) requires a finite number; got ${ms}`);
    }
    this.current = ms;
  }
}
