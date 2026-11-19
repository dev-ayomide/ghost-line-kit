import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paginate } from '../src/lcd/paginate.ts';

// numRuns comes from FC_NUM_RUNS via vitest.setup.ts (fc.configureGlobal).

const cps = (s: string): string[] => Array.from(s);
const isWs = (c: string): boolean => /\s/u.test(c);
const nonWs = (s: string): string[] => cps(s).filter((c) => !isWs(c));

/** Independent oracle: whole tokens up to `cols`, otherwise consecutive `cols`-sized chunks. */
function expectedTokens(input: string, cols: number): string[] {
  const out: string[] = [];
  for (const token of input.split(/\s+/u)) {
    if (token === '') continue;
    const chars = cps(token);
    if (chars.length <= cols) {
      out.push(token);
    } else {
      for (let i = 0; i < chars.length; i += cols) out.push(chars.slice(i, i + cols).join(''));
    }
  }
  return out;
}

const readBackTokens = (pages: { lines: string[] }[]): string[] =>
  pages.flatMap((p) => p.lines.flatMap((l) => l.split(' ').filter((t) => t !== '')));

// Generators
const word = fc.stringMatching(/^[A-Za-z]{1,12}$/);
const amount = fc.nat({ max: 100_000_000 }).map((n) => '₦' + n.toLocaleString('en-US'));
const decimal = fc.double({ min: 0, max: 1e6, noNaN: true }).map((n) => n.toFixed(2));
const phone = fc.stringMatching(/^[0-9]{10}$/).map((d) => '+234' + d);
const longToken = fc.stringMatching(/^[A-Za-z0-9]{41,90}$/);
const astral = fc.oneof(
  fc.string({ unit: 'binary', minLength: 1, maxLength: 20 }),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 20 }),
  fc.constantFrom('😀😀😀😀', '👻🎃', '𝒳𝒴𝒵'),
);
const token = fc.oneof(word, amount, decimal, phone, longToken, astral);
const separator = fc.oneof(
  fc.constantFrom(' ', '\t', '\n', '\r\n', '\u00a0', '\u2003'),
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\u00a0'), { minLength: 1, maxLength: 6 })
    .map((a) => a.join('')),
);
const input = fc
  .tuple(separator, fc.array(fc.tuple(token, separator), { maxLength: 30 }))
  .map(([lead, parts]) => lead + parts.map(([t, s]) => t + s).join(''));
const anyInput = fc.oneof(input, fc.string({ unit: 'binary', maxLength: 200 }), fc.constant(''));
const size = fc.record({
  rows: fc.integer({ min: 1, max: 12 }),
  cols: fc.oneof(fc.constant(1), fc.integer({ min: 1, max: 40 })),
});

describe('paginate properties', () => {
  it('P1: non-whitespace code points are preserved in order', () => {
    fc.assert(
      fc.property(anyInput, size, (text, sz) => {
        const pages = paginate(text, sz);
        const got = pages.flatMap((p) => p.lines.flatMap((l) => nonWs(l)));
        expect(got).toEqual(nonWs(text));
      }),
    );
  });

  it('P2: tokens read back equal the oracle (no short token is split)', () => {
    fc.assert(
      fc.property(anyInput, size, (text, sz) => {
        expect(readBackTokens(paginate(text, sz))).toEqual(expectedTokens(text, sz.cols));
      }),
    );
  });

  it('P3: line width, page height and no blank pages', () => {
    fc.assert(
      fc.property(anyInput, size, (text, sz) => {
        const pages = paginate(text, sz);
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) {
          expect(page.lines.length).toBeLessThanOrEqual(sz.rows);
          for (const line of page.lines) {
            expect(cps(line).length).toBeLessThanOrEqual(sz.cols);
            expect(line).toBe(line.replace(/^\s+|\s+$/gu, ''));
          }
        }
        if (nonWs(text).length === 0) {
          expect(pages).toEqual([{ lines: [] }]);
        } else {
          for (const page of pages) {
            expect(page.lines.some((l) => nonWs(l).length > 0)).toBe(true);
          }
        }
      }),
    );
  });

  it('P4: same input gives deep-equal pages', () => {
    fc.assert(
      fc.property(anyInput, size, (text, sz) => {
        expect(paginate(text, { ...sz })).toEqual(paginate(text, { ...sz }));
      }),
    );
  });
});

describe('paginate examples', () => {
  it('throws RangeError for rows or cols below 1', () => {
    expect(() => paginate('hi', { rows: 0, cols: 16 })).toThrow(RangeError);
    expect(() => paginate('hi', { rows: 6, cols: 0 })).toThrow(RangeError);
    expect(() => paginate('hi', { rows: -1, cols: -1 })).toThrow(RangeError);
  });

  it('keeps an amount whole and splits a too-long token', () => {
    expect(paginate('Pay ₦1,500 now', { rows: 6, cols: 8 })).toEqual([
      { lines: ['Pay', '₦1,500', 'now'] },
    ]);
    expect(paginate('abcdefg', { rows: 2, cols: 3 })).toEqual([{ lines: ['abc', 'def'] }, { lines: ['g'] }]);
  });
});
