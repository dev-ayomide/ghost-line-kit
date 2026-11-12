import fc from 'fast-check';
import { describe, it } from 'vitest';

// Proves the fast-check wiring works. Real properties come from the kit-core spec.
describe('fast-check wiring', () => {
  it('runs a trivial property', () => {
    fc.assert(fc.property(fc.string(), (s) => s.length >= 0));
  });
});
