import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectEncoding, LIMITS } from '@ghostline/kit';
import { ojaConfig } from '../src/app.config.ts';
import { fill, LANGS, slotsOf, type Lang, type MessageKey, type Messages } from '../src/copy.ts';
import { formatN } from '../src/money.ts';
import { agoText } from '../src/when.ts';
import { validName } from '../src/names.ts';
import { genAmount, genName } from './gen.ts';

// {ago} is generated with agoText. {when} and {date} still use fixed phrases (no date formatter exists yet).
const DATE_POOL = ['12 Nov', 'Fri 15 Dec, 08:00', 'today 14:30'];
const genDelta = fc.oneof(
  fc.integer({ min: 0, max: 3 * 86_400_000 * 40 }),
  fc.constantFrom(0, 59_999, 60_000, 3_599_999, 3_600_000, 86_399_999, 86_400_000),
);
const WORD_POOL = ['rice', 'Rice', 'Mile 12', 'Oyingbo', 'Palm oil', '50kg bag', 'paint bucket', 'Bola N4,500, Chidi N8,000'];

const keysOf = (m: Messages): MessageKey[] =>
  (Object.keys(m) as (keyof Messages)[]).filter((k): k is MessageKey => k !== 'needsReview');

const isAmountSlot = (s: string) =>
  /^(amount|balance|credit|total|avg|low|high|price)$/.test(s);
const isNameSlot = (s: string) => /^(name|debtor|supplier)$/.test(s);
const isTimeSlot = (s: string) => /^(ago|when|date)$/.test(s);
const isCountSlot = (s: string) => /^(n|max|extra)$/.test(s);

/** A value for each slot of a template, using the generators. */
function genValues(slots: string[], lang: Lang): fc.Arbitrary<Record<string, string>> {
  const entries = slots.map((slot) => {
    let a: fc.Arbitrary<string>;
    if (isAmountSlot(slot)) a = genAmount.map(formatN);
    // Names are echoed only when valid (GSM-7, plain letters), as the tools do.
    else if (isNameSlot(slot)) a = genName.filter(validName).map((s) => s.trim());
    else if (slot === 'ago') a = genDelta.map((d) => agoText(d, lang));
    else if (isTimeSlot(slot)) a = fc.constantFrom(...DATE_POOL);
    else if (isCountSlot(slot)) a = fc.integer({ min: 0, max: 200 }).map(String);
    else a = fc.constantFrom(...WORD_POOL);
    return a.map((v) => [slot, v] as const);
  });
  return fc.tuple(...entries).map((e) => Object.fromEntries(e));
}

// Feature: oja-ghost, Property 9: Replies are GSM-7 and money is plain
// **Validates: Requirements 12.12, 10.12, 10.13, 8.5**
describe('Property 9: replies are GSM-7 and money is plain', () => {
  for (const lang of LANGS) {
    const messages = ojaConfig.copy[lang];
    for (const key of keysOf(messages)) {
      const template = messages[key];
      it(`${lang}.${key} filled with generated values is GSM-7`, () => {
        const slots = slotsOf(template);
        fc.assert(
          fc.property(genValues(slots, lang), (values) => {
            const text = fill(template, values);
            expect(detectEncoding(text)).toBe('GSM-7');
            expect(text).not.toMatch(/[{}]/);
            expect(text).not.toContain('\u20A6');
          }),
          { numRuns: slots.length === 0 ? 1 : undefined },
        );
      });
    }
  }

  it('both languages have the same keys, and pcm needs review', () => {
    expect(keysOf(ojaConfig.copy.en).sort()).toEqual(keysOf(ojaConfig.copy.pcm).sort());
    expect(ojaConfig.copy.pcm.needsReview).toBe(true);
  });

  it('both languages use the same slots in each template', () => {
    for (const key of keysOf(ojaConfig.copy.en)) {
      const a = slotsOf(ojaConfig.copy.en[key]).sort();
      const b = slotsOf(ojaConfig.copy.pcm[key]).sort();
      expect(b, key).toEqual(a);
    }
  });

  it('USSD templates stay short', () => {
    for (const lang of LANGS) {
      for (const key of keysOf(ojaConfig.copy[lang])) {
        if (key.endsWith('Ussd')) {
          expect(ojaConfig.copy[lang][key].length, `${lang}.${key}`).toBeLessThanOrEqual(90);
        }
      }
    }
  });

  it('formatN matches N, digits and commas', () => {
    fc.assert(
      fc.property(genAmount, (n) => {
        expect(formatN(n)).toMatch(/^N\d{1,3}(,\d{3})*$/);
      }),
    );
  });

  it('static strings are GSM-7 and within limits', () => {
    const pc = ojaConfig.processorCopy;
    expect(Object.keys(pc).sort()).toEqual(
      ['stopped', 'notSubscribed', 'deleted', 'resubscribed', 'unrecognized', 'nothingMore', 'done'].sort(),
    );
    for (const [k, v] of Object.entries(pc)) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(v.length, k).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
      expect(detectEncoding(v), k).toBe('GSM-7');
    }
    const ns = ojaConfig.nextStep;
    expect(ns.length).toBeGreaterThan(0);
    expect(ns.length).toBeLessThanOrEqual(LIMITS.reply.nextStepMaxLength);
    expect(detectEncoding(ns)).toBe('GSM-7');
    for (const s of [ojaConfig.illustrative, ojaConfig.name]) expect(detectEncoding(s)).toBe('GSM-7');
    for (const c of ojaConfig.commodities) {
      for (const l of LANGS) {
        expect(detectEncoding(c.name[l])).toBe('GSM-7');
        expect(detectEncoding(c.unit[l])).toBe('GSM-7');
      }
    }
    for (const m of ojaConfig.markets) expect(detectEncoding(m.name)).toBe('GSM-7');
  });

  it('fill throws on a missing slot, ignores extras and does not re-expand values', () => {
    expect(() => fill('Hi {name}', {})).toThrow(/name/);
    expect(fill('Hi {name}', { name: 'Bola', extra: 'x' })).toBe('Hi Bola');
    expect(fill('Hi {name}', { name: '{name}' })).toBe('Hi {name}');
    expect(() => fill('{toString}', {})).toThrow();
    expect(fill('no slots', {})).toBe('no slots');
  });
});
