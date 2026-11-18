import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseIntent, serializeIntent, type Intent } from '../src/agent/intent.js';

// Feature: kit-core, Property 8: Intent serialization round-trip
// **Validates: Requirements 9.3, 9.4**

// JSON loses the sign of negative zero (JSON.stringify(-0) === "0"), the same
// reason as in the store test. Normalise -0 to 0 so the property compares like
// with like. Only finite doubles are valid in the schema.
const normaliseZero = (n: number): number => (Object.is(n, -0) ? 0 : n);
const numberArb = fc.oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }).map(normaliseZero));
const valueArb = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), numberArb, fc.boolean());
const keyArb = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.constantFrom('__proto__', 'constructor'));

const intentArb: fc.Arbitrary<Intent> = fc.record({
  name: fc.oneof(fc.string(), fc.string({ unit: 'binary' })),
  // Build via entries so a "__proto__" key becomes an own data property.
  parameters: fc
    .array(fc.tuple(keyArb, valueArb), { maxLength: 8 })
    .map((entries) => Object.fromEntries(entries) as Record<string, string | number | boolean>),
  rawMessage: fc.oneof(fc.string(), fc.string({ unit: 'binary' })),
});

const sameIntent = (a: Intent, b: Intent): void => {
  expect(a.name).toBe(b.name);
  expect(a.rawMessage).toBe(b.rawMessage);
  expect(Object.entries(a.parameters)).toEqual(Object.entries(b.parameters));
};

describe('Intent serialization round-trip', () => {
  it('parseIntent(serializeIntent(i)) preserves name, parameters and rawMessage', () => {
    fc.assert(
      fc.property(intentArb, (i) => {
        sameIntent(parseIntent(serializeIntent(i)), i);
      }),
      { numRuns: 200 },
    );
  });

  it('regression: negative zero parameter serialises to 0 (JSON drops the sign)', () => {
    // Found as a modelling issue: -0 cannot round-trip through JSON, so the
    // generator normalises it. The value stays numerically equal.
    const out = parseIntent(serializeIntent({ name: 'n', parameters: { z: -0 }, rawMessage: '' }));
    expect(out.parameters.z).toBe(0);
  });

  it('regression: "__proto__" string parameter round-trips as plain data', () => {
    const i: Intent = {
      name: '',
      parameters: Object.fromEntries([['__proto__', 'x']]) as Record<string, string>,
      rawMessage: '',
    };
    const out = parseIntent(serializeIntent(i));
    sameIntent(out, i);
    expect(Object.getPrototypeOf(out.parameters)).toBe(Object.prototype);
  });
});
