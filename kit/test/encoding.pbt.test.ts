import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GSM7_CHARS, detectEncoding } from '../src/format/encoding';

// Feature: kit-core, Property 1: Encoding detection correctness
// **Validates: Requirements 4.1, 4.2, 4.3**

const gsmChars = Array.from(GSM7_CHARS);
const nonGsmChars = ['😀', '👍', '中', '日', '₦', '€', '{', '}', '|', '^', '~', '\\', '[', ']', 'ç', 'ж'];

// Independent oracle: the spec'd alphabet as a plain string, checked with includes().
const ALPHABET =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const oracle = (s: string) => ([...s].every((c) => ALPHABET.includes(c)) ? 'GSM-7' : 'UCS-2');

const gsmString = fc.array(fc.constantFrom(...gsmChars), { maxLength: 200 }).map((a) => a.join(''));

describe('Property 1: Encoding detection correctness', () => {
  it('alphabet has 127 basic characters (128 minus ESC)', () => {
    expect(GSM7_CHARS.size).toBe(127);
  });

  it('empty string is GSM-7', () => {
    expect(detectEncoding('')).toBe('GSM-7');
  });

  it('extension chars and naira force UCS-2', () => {
    for (const c of ['€', '[', ']', '{', '}', '\\', '^', '~', '|', '₦']) {
      expect(detectEncoding(`a${c}b`)).toBe('UCS-2');
    }
  });

  it('strings of only GSM-7 chars are GSM-7', () => {
    fc.assert(fc.property(gsmString, (s) => detectEncoding(s) === 'GSM-7'));
  });

  it('a GSM-7 string with an inserted non-GSM char is UCS-2', () => {
    fc.assert(
      fc.property(gsmString, fc.constantFrom(...nonGsmChars), fc.nat(), (s, bad, n) => {
        const chars = Array.from(s);
        chars.splice(n % (chars.length + 1), 0, bad);
        return detectEncoding(chars.join('')) === 'UCS-2';
      }),
    );
  });

  it('matches the independent oracle on arbitrary input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'grapheme', maxLength: 100 }),
          fc.string({ unit: 'binary', maxLength: 100 }),
          fc.array(fc.constantFrom(...gsmChars, ...nonGsmChars), { maxLength: 100 }).map((a) => a.join('')),
        ),
        (s) => detectEncoding(s) === oracle(s),
      ),
    );
  });
});
