import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { maskPhoneNumber } from '../src/format/phone.js';

const digit = fc.integer({ min: 0, max: 9 }).map(String);
const sep = fc.constantFrom(' ', '-', '(', ')');

/** Digits interleaved with optional separators, optional '+' prefix. */
const phoneWith = (min: number, max: number) =>
  fc
    .tuple(
      fc.boolean(),
      fc.array(fc.tuple(fc.array(sep, { maxLength: 2 }), digit), { minLength: min, maxLength: max }),
    )
    .map(([plus, parts]) => (plus ? '+' : '') + parts.map(([s, d]) => s.join('') + d).join(''));

const digitsOf = (s: string) => [...s].filter((c) => /\d/.test(c));

function check(input: string, keepHead: number, keepTail: number) {
  const out = maskPhoneNumber(input);
  expect(out.length).toBe(input.length);
  const inD = digitsOf(input).length;
  let k = 0;
  for (let i = 0; i < input.length; i++) {
    if (/\d/.test(input[i]!)) {
      const visible = k < keepHead || k >= inD - keepTail;
      expect(out[i]).toBe(visible ? input[i] : '*');
      k++;
    } else {
      expect(out[i]).toBe(input[i]);
    }
  }
  const full = digitsOf(input).join('');
  if (full.length >= 3) expect(digitsOf(out).join('')).not.toBe(full);
}

// Feature: kit-core, Property 9: Phone number masking
// **Validates: Requirements 14.1, 14.2, 14.3**
describe('Property 9: Phone number masking', () => {
  it('more than 7 digits: keeps first 3 and last 4', () => {
    fc.assert(fc.property(phoneWith(8, 20), (p) => check(p, 3, 4)));
  });
  it('1 to 7 digits: keeps last 2 only', () => {
    fc.assert(fc.property(phoneWith(1, 7), (p) => check(p, 0, 2)));
  });
});

describe('maskPhoneNumber examples', () => {
  it('masks an E.164 number', () => {
    expect(maskPhoneNumber('+2348051234567')).toBe('+234******4567');
  });
  it('8 digits keeps 3 + 4 (one masked)', () => {
    expect(maskPhoneNumber('12345678')).toBe('123*5678');
  });
  it('7 digits keeps last 2', () => {
    expect(maskPhoneNumber('1234567')).toBe('*****67');
  });
  it('empty string stays empty', () => {
    expect(maskPhoneNumber('')).toBe('');
  });
  it('2 or fewer digits unchanged', () => {
    expect(maskPhoneNumber('+12')).toBe('+12');
  });
  it('masks non-ASCII digits', () => {
    expect(maskPhoneNumber('١٢٣٤٥٦٧')).toBe('*****٦٧');
  });
});
