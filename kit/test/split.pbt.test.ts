import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectEncoding } from '../src/format/encoding';
import { LIMITS } from '../src/limits';
import { pureSplit } from '../src/format/split';

const limitsOf = (text: string) => (detectEncoding(text) === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2);

const wellFormed = (s: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

// ---- generators -----------------------------------------------------------
const GSM_CHARS = [...'abcXYZ019.,:;!?-_@£$ÄÖñ', ' ', ' ', ' ', '\n'];
const MIXED_CHARS = [...GSM_CHARS, '₦', '€', '[', 'ж', '中', '😀', '👍', '😀', ' ', ' ', '\t', '\u00a0'];
const NO_SPACE_CHARS = ['a', 'b', '1', '₦', '😀', '中', '€'];

const chars = (pool: string[], maxLength: number) =>
  fc.array(fc.constantFrom(...pool), { maxLength }).map((a) => a.join(''));

const anyText = fc.oneof(
  { weight: 3, arbitrary: chars(GSM_CHARS, 500) },
  { weight: 3, arbitrary: chars(MIXED_CHARS, 500) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 300 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 200 }) },
  // oversize tokens (no whitespace at all)
  { weight: 2, arbitrary: chars(NO_SPACE_CHARS, 600) },
  // just under / over the single-segment boundary, both encodings
  {
    weight: 3,
    arbitrary: fc
      .tuple(fc.boolean(), fc.integer({ min: -3, max: 3 }), fc.boolean())
      .map(([ucs, delta, spaced]) => {
        const lim = ucs ? LIMITS.sms.ucs2.singleSegment : LIMITS.sms.gsm7.singleSegment;
        const unit = ucs ? 'ж' : 'a';
        const n = lim + delta;
        return spaced ? Array.from({ length: n }, (_, i) => (i % 5 === 4 ? ' ' : unit)).join('') : unit.repeat(n);
      }),
  },
  // emoji straddling the segment boundary (pairs at every offset)
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.integer({ min: 60, max: 70 }), fc.integer({ min: 1, max: 4 }))
      .map(([n, k]) => 'a'.repeat(n) + '😀'.repeat(k) + 'b'.repeat(n)),
  },
);

// Feature: kit-core, Property 2: Segment limit compliance
// **Validates: Requirements 5.1, 5.3**
describe('Property 2: Segment limit compliance', () => {
  it('every segment is within the single/concat limit for the detected encoding', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const lim = limitsOf(text);
        const segs = pureSplit(text, detectEncoding(text));
        const max = segs.length === 1 ? lim.singleSegment : lim.concatSegment;
        return segs.every((s) => s.length <= max);
      }),
      { numRuns: 500 },
    );
  });

  it('text that fits a single segment is returned unchanged; empty gives []', () => {
    expect(pureSplit('', 'GSM-7')).toEqual([]);
    expect(pureSplit('a'.repeat(160), 'GSM-7')).toEqual(['a'.repeat(160)]);
    expect(pureSplit('ж'.repeat(70), 'UCS-2')).toEqual(['ж'.repeat(70)]);
    expect(pureSplit('a'.repeat(161), 'GSM-7').length).toBe(2);
    expect(pureSplit('ж'.repeat(71), 'UCS-2').length).toBe(2);
  });

  it('never splits a surrogate pair', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const segs = pureSplit(text, detectEncoding(text));
        return segs.every((s) => {
          const first = s.charCodeAt(0);
          const last = s.charCodeAt(s.length - 1);
          const startsLow = first >= 0xdc00 && first <= 0xdfff;
          const endsHigh = last >= 0xd800 && last <= 0xdbff;
          // A lone surrogate in the INPUT may legitimately sit at an edge; only judge well-formed input.
          return !wellFormed(text) || (!startsLow && !endsHigh);
        });
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: kit-core, Property 3: Split round-trip
// **Validates: Requirements 5.4**
describe('Property 3: Split round-trip', () => {
  it('concatenating segments yields the original text exactly', () => {
    fc.assert(
      fc.property(anyText, (text) => pureSplit(text, detectEncoding(text)).join('') === text),
      { numRuns: 500 },
    );
  });

  it('round-trips long texts (5+ and 10+ segments) with odd whitespace', () => {
    const long = fc
      .tuple(
        fc.constantFrom('', ' ', '   ', '\n\n'),
        fc.array(fc.constantFrom('a', 'bc', 'x', 'hello', '1,500', '₦200', '😀', 'ж', ' ', '  ', '\n'), {
          minLength: 150,
          maxLength: 400,
        }),
        fc.constantFrom('', ' ', '    '),
      )
      .map(([lead, parts, trail]) => lead + parts.join('') + trail);
    fc.assert(
      fc.property(long, (text) => {
        const segs = pureSplit(text, detectEncoding(text));
        return segs.length >= 5 && segs.join('') === text;
      }),
      { numRuns: 200 },
    );
    const ten = pureSplit('word '.repeat(300), 'GSM-7');
    expect(ten.length).toBeGreaterThanOrEqual(10);
    expect(ten.join('')).toBe('word '.repeat(300));
  });

  it('keeps leading, trailing and consecutive whitespace', () => {
    const t = '   ' + 'ab  cd '.repeat(40) + '   ';
    expect(pureSplit(t, 'GSM-7').join('')).toBe(t);
  });
});

// Feature: kit-core, Property 4: No atomic unit split across segments
// **Validates: Requirements 5.2, 5.5**
const digits = (min: number, max: number) =>
  fc.array(fc.constantFrom(...'0123456789'), { minLength: min, maxLength: max }).map((a) => a.join(''));
const word = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 3, maxLength: 14 }).map((a) => a.join(''));
const ucsWord = fc
  .array(fc.constantFrom('ж', '中', '😀', 'a', 'é', 'k'), { minLength: 3, maxLength: 12 })
  .map((a) => a.join(''));
const number = fc.oneof(
  fc.constantFrom('1,500', '12,000', '3.14', '100,000.50'),
  fc.tuple(digits(1, 3), digits(3, 3)).map(([a, b]) => `${a},${b}`),
  fc.tuple(digits(1, 3), digits(2, 2)).map(([a, b]) => `${a}.${b}`),
);
const phone = digits(10, 13).map((d) => `+234${d}`);
const currency = number.map((n) => `₦${n}`);

const gsmTokens = fc.array(fc.oneof(word, number, phone), { minLength: 45, maxLength: 120 });
const ucsTokens = fc
  .tuple(fc.array(fc.oneof(word, ucsWord, number, currency, phone), { minLength: 20, maxLength: 120 }))
  .map(([a]) => ['₦1,500', ...a]); // guarantees UCS-2

const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);

function checkAtomic(tokens: string[]): boolean {
  const text = tokens.join(' ');
  const enc = detectEncoding(text);
  const limit = limitsOf(text).concatSegment;
  if (tokens.some((t) => t.length > limit)) return true; // outside the property's domain
  const segs = pureSplit(text, enc);
  if (segs.join('') !== text) return false;

  // segment spans over the original text
  const spans: Array<[number, number]> = [];
  let off = 0;
  for (const s of segs) {
    spans.push([off, off + s.length]);
    off += s.length;
  }
  // no boundary between two adjacent non-whitespace characters
  for (const [, end] of spans.slice(0, -1)) {
    if (!isWs(text[end - 1]) && !isWs(text[end])) return false;
  }
  // every token lies whole inside exactly one segment
  let pos = 0;
  for (const t of tokens) {
    const start = pos;
    const stop = pos + t.length;
    const holders = spans.filter(([s, e]) => s <= start && stop <= e);
    if (holders.length !== 1) return false;
    pos = stop + 1;
  }
  return true;
}

describe('Property 4: No atomic unit split across segments', () => {
  it('GSM-7 token texts: boundaries never fall inside a token', () => {
    fc.assert(
      fc.property(gsmTokens, (tokens) => {
        const text = tokens.join(' ');
        return detectEncoding(text) === 'GSM-7' && pureSplit(text, 'GSM-7').length > 1 && checkAtomic(tokens);
      }),
      { numRuns: 300 },
    );
  });

  it('UCS-2 token texts: boundaries never fall inside a token', () => {
    fc.assert(
      fc.property(ucsTokens, (tokens) => {
        const text = tokens.join(' ');
        return detectEncoding(text) === 'UCS-2' && pureSplit(text, 'UCS-2').length > 1 && checkAtomic(tokens);
      }),
      { numRuns: 300 },
    );
  });
});

// ---- Req 5.6: oversize unit is hard-split, never lost --------------------
describe('oversize unit (Req 5.6)', () => {
  it('hard-splits a unit longer than the concat limit and keeps all of it', () => {
    const big = 'x'.repeat(400);
    const segs = pureSplit(`hi ${big} bye`, 'GSM-7');
    expect(segs.join('')).toBe(`hi ${big} bye`);
    expect(segs.every((s) => s.length <= LIMITS.sms.gsm7.concatSegment)).toBe(true);
    const emoji = '😀'.repeat(100);
    const segs2 = pureSplit(emoji, 'UCS-2');
    expect(segs2.join('')).toBe(emoji);
    expect(segs2.every((s) => s.length <= LIMITS.sms.ucs2.concatSegment && s.length % 2 === 0)).toBe(true);
  });
});
