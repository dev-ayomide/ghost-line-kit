import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAmount, formatN } from '../src/money.ts';
import { normaliseName, validName } from '../src/names.ts';
import { genAmount, genName, MAX_AMOUNT, NAME_POOL } from './gen.ts';

// Feature: oja-ghost, Property 5: Amount round trip and validity
// **Validates: Requirements 12.5, 12.7**
describe('Property 5: amount parsing', () => {
  it('parseAmount(formatN(n)) and parseAmount(String(n)) return n', () => {
    fc.assert(
      fc.property(genAmount, (n) => {
        expect(parseAmount(formatN(n), MAX_AMOUNT)).toBe(n);
        expect(parseAmount(String(n), MAX_AMOUNT)).toBe(n);
        expect(parseAmount(`N${n}`, MAX_AMOUNT)).toBe(n);
        expect(parseAmount(`\u20A6${formatN(n).slice(1)}`, MAX_AMOUNT)).toBe(n);
      }),
    );
  });

  it('round trips the bounds 1 and max', () => {
    for (const n of [1, MAX_AMOUNT]) {
      expect(parseAmount(formatN(n), MAX_AMOUNT)).toBe(n);
    }
    expect(parseAmount(String(MAX_AMOUNT + 1), MAX_AMOUNT)).toBeUndefined();
    expect(parseAmount('0', MAX_AMOUNT)).toBeUndefined();
  });

  it('a defined result is an integer in [1, max]', () => {
    const amountish = fc.stringMatching(/^[nN]?(ngn)?[0-9,.kK\u20A6 -]{0,14}$/);
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 20 }), amountish), (s) => {
        const r = parseAmount(s, MAX_AMOUNT);
        if (r !== undefined) {
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(1);
          expect(r).toBeLessThanOrEqual(MAX_AMOUNT);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('formatN output is N then digits and commas only', () => {
    fc.assert(
      fc.property(genAmount, (n) => {
        expect(formatN(n)).toMatch(/^N\d{1,3}(,\d{3})*$/);
      }),
    );
  });

  it('accepts the documented forms', () => {
    expect(parseAmount('68k', MAX_AMOUNT)).toBe(68_000);
    expect(parseAmount('1.5k', MAX_AMOUNT)).toBe(1500);
    expect(parseAmount('NGN 4,500'.replace(' ', ''), MAX_AMOUNT)).toBe(4500);
    expect(parseAmount('n68,000', MAX_AMOUNT)).toBe(68_000);
  });

  it('rejects malformed input', () => {
    for (const s of ['4,50', '1,2345', '1.5', '4500.00', '-5', '0', '0k', '', ' ', 'k', '1.55k', '12 000', 'abc', '1,000,00']) {
      expect(parseAmount(s, MAX_AMOUNT), s).toBeUndefined();
    }
  });
});

describe('normaliseName and validName', () => {
  it('is idempotent for any string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 30 }), fc.string({ unit: 'binary', maxLength: 30 }), genName), (s) => {
        const once = normaliseName(s);
        expect(normaliseName(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  // Known edge case (found by reasoning, not by fast-check; the code was written to handle it).
  // Lowercasing a dotted capital I (U+0130) creates a combining dot, which a second pass
  // would remove, so a single pass is not idempotent. normaliseName repeats until stable.
  it('regression: dotted capital I is idempotent', () => {
    const once = normaliseName('\u0130');
    expect(normaliseName(once)).toBe(once);
  });

  it('ignores case, accents and extra spaces', () => {
    fc.assert(
      fc.property(genName, genName, (a, b) => {
        const same = normaliseName(a) === normaliseName(b);
        const baseA = a.trim().replace(/\s+/g, ' ');
        const baseB = b.trim().replace(/\s+/g, ' ');
        const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
        expect(same).toBe(plain(baseA) === plain(baseB));
      }),
    );
    expect(normaliseName('Bola')).toBe(normaliseName(' b\u00F3la  '));
    expect(normaliseName('BOLA')).toBe(normaliseName('bola'));
    expect(normaliseName('Mama   Ife')).toBe(normaliseName('mama ife'));
  });

  it('validName follows the rules', () => {
    expect(validName('Bola')).toBe(true);
    expect(validName(' Mama Ife ')).toBe(true);
    expect(validName("O'Neil-Jr.")).toBe(true);
    expect(validName('')).toBe(false);
    expect(validName('   ')).toBe(false);
    expect(validName('a'.repeat(21))).toBe(false);
    expect(validName('a'.repeat(20))).toBe(true);
    expect(validName('Bola!')).toBe(false);
    expect(validName('b\u00F3la')).toBe(false); // not GSM-7
    expect(validName('\u{1F600}')).toBe(false);
    expect(NAME_POOL.length).toBeGreaterThan(0);
  });
});
