import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits';
import { renderMenuScreens, type MenuOption } from '../src/format/menu';

const FOOTER = ['0 Back', '00 Menu'];
const optionLines = (screen: string) => screen.split('\n').filter((l) => !FOOTER.includes(l));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const toOptions = (labels: string[]): MenuOption[] => labels.map((label, i) => ({ label, value: String(i) }));

// Feature: kit-core, Property 5: Menu screen character limit
// **Validates: Requirements 6.2, 6.4**
describe('Property 5: Menu screen character limit', () => {
  const label = fc.oneof(
    fc.string({ minLength: 1, maxLength: 200 }),
    fc.string({ unit: 'binary', minLength: 1, maxLength: 200 }),
    fc.stringMatching(/^[a-zA-Z0-9 ₦,.+é中😀]{1,200}$/),
  );
  const options = fc.oneof(
    fc.array(label, { minLength: 1, maxLength: 1 }),
    fc.array(label, { minLength: 5, maxLength: 5 }),
    fc.array(label, { minLength: 6, maxLength: 20 }),
  );
  const config = fc.record(
    { // A title that itself looks like "1 x" would be indistinguishable from an option line to this counter.
      title: fc.string({ maxLength: 300 }).filter((t) => !/^[1-9] /.test(norm(t))), backLabel: fc.constantFrom('Back', 'Baya'), menuLabel: fc.constantFrom('Menu', 'Fara') },
    { requiredKeys: [] },
  );

  it('every screen is <= 160 chars with at most 5 options numbered 1..n', () => {
    fc.assert(
      fc.property(options, config, (labels, cfg) => {
        const screens = renderMenuScreens(toOptions(labels), cfg);
        expect(screens.length).toBeGreaterThan(0);
        for (const screen of screens) {
          expect(screen.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
          const nums = screen
            .split('\n')
            .map((l) => /^([1-9]) /.exec(l)?.[1])
            .filter((n): n is string => n !== undefined)
            .map(Number);
          expect(nums.length).toBeGreaterThanOrEqual(1);
          expect(nums.length).toBeLessThanOrEqual(LIMITS.ussd.maxOptionsPerScreen);
          expect(nums).toEqual(nums.map((_, i) => i + 1));
        }
      }),
    );
  });

  it('every option is rendered on some screen (screens consume all options)', () => {
    fc.assert(
      fc.property(options, (labels) => {
        const screens = renderMenuScreens(toOptions(labels));
        const total = screens.reduce((n, s) => n + (s.match(/^[1-9] /gm)?.length ?? 0), 0);
        // A label that itself begins with "N " on its own line is impossible after normalisation.
        expect(total).toBe(labels.length);
      }),
    );
  });
});

// Feature: kit-core, Property 6: No atomic unit split across USSD screens
// **Validates: Requirements 6.3**
describe('Property 6: No atomic unit split across USSD screens', () => {
  const token = fc.oneof(
    fc.stringMatching(/^[a-zA-Z]{1,15}$/),
    fc.stringMatching(/^[0-9]{1,3}(,[0-9]{3}){0,2}$/),
    fc.stringMatching(/^₦[0-9]{1,3}(,[0-9]{3}){0,2}$/),
    fc.stringMatching(/^\+234[0-9]{10}$/),
  );
  const label = fc.array(token, { minLength: 1, maxLength: 40 }).map((t) => t.join(' '));
  const options = fc.array(label, { minLength: 1, maxLength: 15 });

  it('options that fit are whole on exactly one screen; others are cut only at word boundaries', () => {
    fc.assert(
      fc.property(options, (labels) => {
        const screens = renderMenuScreens(toOptions(labels));
        const lines = screens.flatMap(optionLines);
        expect(lines).toHaveLength(labels.length);
        labels.forEach((original, i) => {
          const text = norm(original);
          const rest = lines[i]!.replace(/^[1-9] /, '');
          const fitsAlone = `1 ${text}\n0 Back\n00 Menu`.length <= LIMITS.ussd.screenHardCap;
          if (fitsAlone) {
            expect(rest).toBe(text);
          } else {
            expect(rest.endsWith('...')).toBe(true);
            const kept = rest.slice(0, -3);
            // Whole-word prefix: the next char in the original is a space.
            expect(text.startsWith(kept + ' ')).toBe(true);
          }
        });
      }),
    );
  });

  // Documents the contract for tokens that appear in output: always whole.
  it('every token in the output is a whole token of its source label', () => {
    fc.assert(
      fc.property(options, (labels) => {
        const screens = renderMenuScreens(toOptions(labels));
        const lines = screens.flatMap(optionLines);
        lines.forEach((line, i) => {
          const rest = line.replace(/^[1-9] /, '').replace(/\.\.\.$/, '');
          const tokens = norm(labels[i]!).split(' ');
          const outTokens = rest.split(' ').filter(Boolean);
          expect(outTokens).toEqual(tokens.slice(0, outTokens.length));
        });
      }),
    );
  });

  it('regression example: 5 mid-length options spread over screens without cutting a phone number', () => {
    const labels = Array.from({ length: 5 }, () => 'Call +2348051234567 about ₦1,500 now please');
    const screens = renderMenuScreens(toOptions(labels));
    expect(screens.length).toBeGreaterThan(1);
    for (const s of screens) expect(s).toContain('+2348051234567 about ₦1,500');
  });
});
