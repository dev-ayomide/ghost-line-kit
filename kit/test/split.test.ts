import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits.js';
import { detectEncoding } from '../src/format/encoding.js';
import { pureSplit, splitMessage } from '../src/format/split.js';

const SUFFIX = ' Reply MORE';

/** Builds text of `n` words, each `w` long, separated by one space. */
const words = (n: number, w: number, ch: string) => Array.from({ length: n }, () => ch.repeat(w)).join(' ');

const cases = [
  { name: 'GSM-7', ch: 'a', enc: 'GSM-7', limit: LIMITS.sms.gsm7.concatSegment, w: 8 },
  { name: 'UCS-2', ch: 'ж', enc: 'UCS-2', limit: LIMITS.sms.ucs2.concatSegment, w: 6 },
] as const;

describe.each(cases)('splitMessage summary step ($name)', ({ ch, enc, limit, w }) => {
  // Req 5.8(a)
  it('exactly 3 segments: no summary, not truncated, no "Reply MORE"', () => {
    const text = words(Math.floor((limit * 3) / (w + 1)) - 1, w, ch);
    const r = splitMessage(text);
    expect(r.encoding).toBe(enc);
    expect(r.segmentCount).toBe(3);
    expect(r.truncated).toBe(false);
    expect(r.segments.join('')).toBe(text);
    expect(r.segments.join('')).not.toContain('Reply MORE');
  });

  // Req 5.8(b)
  it('4 segments: truncated, at most 3 segments, ends with " Reply MORE", prefix of original', () => {
    const text = words(Math.ceil((limit * 3) / (w + 1)) + 10, w, ch);
    const r = splitMessage(text);
    expect(r.truncated).toBe(true);
    expect(r.segmentCount).toBeLessThanOrEqual(3);
    expect(r.segments).toHaveLength(r.segmentCount);
    const last = r.segments[r.segments.length - 1]!;
    expect(last.endsWith(SUFFIX)).toBe(true);
    const kept = r.segments.join('').slice(0, -SUFFIX.length);
    expect(text.startsWith(kept)).toBe(true);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toBe(kept.trimEnd());
    expect(r.segments.every((s) => s.length <= limit)).toBe(true);
    // cut falls on a word boundary
    expect(/\s/.test(text.charAt(kept.length))).toBe(true);
  });
});

/** Exactly `n` characters: single-space-separated words of at most 8 chars, no leading or trailing space. */
const fillWords = (n: number): string => {
  let out = '';
  while (out.length < n) out += (out ? ' ' : '') + 'a'.repeat(Math.min(7, n - out.length - (out ? 1 : 0)));
  return out.endsWith(' ') ? out.slice(0, -1) + 'a' : out;
};

const boundaryCases = [
  { name: 'GSM-7', amount: '£1,500', enc: 'GSM-7', limit: LIMITS.sms.gsm7.concatSegment },
  { name: 'UCS-2', amount: '₦1,500', enc: 'UCS-2', limit: LIMITS.sms.ucs2.concatSegment },
] as const;

describe.each(boundaryCases)('currency amount at the truncation boundary ($name)', ({ amount, enc, limit }) => {
  const room = limit - SUFFIX.length;
  const seg = `${fillWords(limit - 6)} `; // whole words, length limit - 5, so the next 7-char word starts a new segment
  /** Segment 3 starts with filler, then the amount starts at index `start`. A 12-char word then forces a 4th segment. */
  const build = (start: number) =>
    `${seg}${seg}${fillWords(start - 1)} ${amount} ${'b'.repeat(12)} ${fillWords(40)}`;

  it(`drops an amount that straddles the suffix budget (Req 5.8c, ${enc})`, () => {
    const text = build(room - 3); // amount spans room-3 .. room+3, so it crosses the cut at `room`
    expect(detectEncoding(text)).toBe(enc);
    const parts = pureSplit(text, enc);
    expect(parts.length).toBeGreaterThan(3); // (i)
    expect(parts[2]).toContain(amount); // (ii)
    expect(parts[2]!.indexOf(amount)).toBeLessThan(room);
    expect(parts[2]!.indexOf(amount) + amount.length).toBeGreaterThan(room);
    expect(parts[2]!.trimEnd().length + SUFFIX.length).toBeGreaterThan(limit); // (iii)

    const r = splitMessage(text);
    expect(r.truncated).toBe(true);
    const last = r.segments[r.segments.length - 1]!;
    expect(last.endsWith(SUFFIX)).toBe(true);
    expect(last.length).toBeLessThanOrEqual(limit);
    const kept = r.segments.join('').slice(0, -SUFFIX.length);
    expect(text.startsWith(kept)).toBe(true);
    expect(kept).not.toContain(amount);
    for (let k = 1; k < amount.length; k += 1) expect(kept.endsWith(amount.slice(0, k))).toBe(false);
  });

  it(`keeps an amount that fits just inside the budget whole (Req 5.8c, ${enc})`, () => {
    const text = build(room - amount.length); // amount ends exactly at `room`
    expect(detectEncoding(text)).toBe(enc);
    const parts = pureSplit(text, enc);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts[2]!.trimEnd().endsWith(amount)).toBe(true);
    expect(parts[2]!.trimEnd().length + SUFFIX.length).toBeLessThanOrEqual(limit);

    const r = splitMessage(text);
    expect(r.truncated).toBe(true);
    const last = r.segments[r.segments.length - 1]!;
    expect(last.endsWith(SUFFIX)).toBe(true);
    expect(last.length).toBeLessThanOrEqual(limit);
    const kept = r.segments.join('').slice(0, -SUFFIX.length);
    expect(text.startsWith(kept)).toBe(true);
    expect(kept.endsWith(amount)).toBe(true);
  });
});

describe('splitMessage edge cases', () => {
  it('empty text gives no segments and is not truncated', () => {
    expect(splitMessage('')).toEqual({ segments: [], truncated: false, encoding: 'GSM-7', segmentCount: 0 });
  });

  // Req 5.6 (also covered in split.pbt.test.ts): oversize unit hard-split, and summary still fits.
  it('a single unit longer than the segment limit is hard-split, summary stays within limits', () => {
    const r = splitMessage('x'.repeat(1000));
    expect(r.truncated).toBe(true);
    expect(r.segmentCount).toBe(3);
    expect(r.segments.every((s) => s.length <= LIMITS.sms.gsm7.concatSegment)).toBe(true);
    expect(r.segments[2]!.endsWith(SUFFIX)).toBe(true);
    const emoji = '😀'.repeat(200);
    const e = splitMessage(emoji);
    expect(e.segments.every((s) => s.length <= LIMITS.sms.ucs2.concatSegment)).toBe(true);
    expect(e.segments.join('').replace(/ Reply MORE$/, '')).toSatisfy((k: string) => emoji.startsWith(k));
    expect(e.segments.join('')).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
