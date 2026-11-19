import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { composeKeys, formatUssd, parseUssd, type HandsetKey } from '../src/keypad/compose.ts';
import { keyForChar, keyFromKeyboardEvent } from '../src/keypad/keymap.ts';

const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);

const charKey = fc.constantFrom<HandsetKey>('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#');
const anyKey = fc.oneof({ weight: 3, arbitrary: charKey }, { weight: 1, arbitrary: fc.constant<HandsetKey>('clear') });
const maxLen = fc.integer({ min: 0, max: 40 });

/** Independent reference model: an array with push (ignored when full) and pop. */
function model(keys: readonly HandsetKey[], max: number): string {
  const buf: string[] = [];
  for (const k of keys) {
    if (k === 'clear') buf.pop();
    else if (buf.length < max) buf.push(k);
  }
  return buf.join('');
}

// Feature: phantom-handset, Property C1: press order, cut at maxLen
describe('C1: keys without clear', () => {
  it('returns the key characters in press order, cut at maxLen', () => {
    fc.assert(
      fc.property(fc.array(charKey, { maxLength: 80 }), maxLen, (keys, max) => {
        expect(composeKeys(keys, max)).toBe(keys.join('').slice(0, max));
      }),
      { numRuns },
    );
  });
});

// Feature: phantom-handset, Property C2: matches the reference model
describe('C2: keys mixed with clear', () => {
  it('equals the reference model', () => {
    fc.assert(
      fc.property(fc.array(anyKey, { maxLength: 100 }), maxLen, (keys, max) => {
        const out = composeKeys(keys, max);
        expect(out).toBe(model(keys, max));
        expect(out.length).toBeLessThanOrEqual(max);
      }),
      { numRuns },
    );
  });

  it('clear on an empty buffer stays empty', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), maxLen, (n, max) => {
        expect(composeKeys(Array<HandsetKey>(n).fill('clear'), max)).toBe('');
      }),
      { numRuns },
    );
  });
});

const digits = fc.stringMatching(/^[0-9]{1,6}$/);
const ussdCode = fc
  .tuple(digits, fc.array(digits, { maxLength: 4 }))
  .map(([service, ext]) => `*${[service, ...ext].join('*')}#`);

const viaChar = (code: string) => [...code].map((c) => keyForChar(c) as HandsetKey);
const viaEvent = (code: string) => [...code].map((c) => keyFromKeyboardEvent({ key: c }) as HandsetKey);

// Feature: phantom-handset, Property C3: USSD round trip
describe('C3: USSD codes', () => {
  it('round-trips through keyForChar and keyFromKeyboardEvent then composeKeys', () => {
    fc.assert(
      fc.property(ussdCode, (code) => {
        const keysA = viaChar(code);
        const keysB = viaEvent(code);
        expect(keysA.every((k) => k !== undefined)).toBe(true);
        expect(keysB.every((k) => k !== undefined)).toBe(true);
        expect(composeKeys(keysA, code.length)).toBe(code);
        expect(composeKeys(keysB, code.length)).toBe(code);
        expect(composeKeys(keysA, 40)).toBe(code);
      }),
      { numRuns },
    );
  });

  it('formatUssd(parseUssd(code)) === code', () => {
    fc.assert(
      fc.property(ussdCode, (code) => {
        const parsed = parseUssd(code);
        expect(parsed).toBeDefined();
        expect(formatUssd(parsed!)).toBe(code);
      }),
      { numRuns },
    );
  });

  it('parseUssd returns undefined for strings that are not USSD codes', () => {
    const bad = fc.oneof(
      ussdCode.map((c) => c.slice(0, -1)), // missing '#'
      ussdCode.map((c) => c.slice(1)), // missing leading '*'
      ussdCode.map((c) => `${c}#`), // extra '#'
      ussdCode.map((c) => `${c.slice(0, -1)}a#`), // letter inside
      ussdCode.map((c) => `${c.slice(0, -1)}*#`), // empty trailing group
      fc.stringMatching(/^[a-z ]{0,8}$/),
    );
    fc.assert(
      fc.property(bad, (s) => {
        expect(parseUssd(s)).toBeUndefined();
      }),
      { numRuns },
    );
  });
});

describe('composer examples', () => {
  it('Backspace maps to clear', () => {
    expect(keyFromKeyboardEvent({ key: 'Backspace' })).toBe('clear');
  });

  it('unknown keys give undefined', () => {
    for (const key of ['a', 'Enter', 'Shift', 'F1', ' ', '', '10', 'Delete']) {
      expect(keyFromKeyboardEvent({ key })).toBeUndefined();
    }
  });

  it('numpad-style digit events behave like digit-row events', () => {
    // Both report e.key as the digit; only e.code differs, and the mapper ignores code.
    for (const d of '0123456789') {
      const row = { key: d, code: `Digit${d}` };
      const pad = { key: d, code: `Numpad${d}` };
      expect(keyFromKeyboardEvent(pad)).toBe(keyFromKeyboardEvent(row));
      expect(keyFromKeyboardEvent(pad)).toBe(d);
    }
  });

  it('rejects empty extension groups', () => {
    expect(parseUssd('*1**2#')).toBeUndefined();
    expect(parseUssd('')).toBeUndefined();
    expect(parseUssd('*123')).toBeUndefined();
  });
});
