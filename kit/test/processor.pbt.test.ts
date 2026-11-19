// Feature: kit-core, Property 15: every outbound message fits its channel limits
// Validates: Requirements 5.3, 6.2, 17.1
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectEncoding } from '../src/format/encoding.js';
import { LIMITS } from '../src/limits.js';
import { makeHarness } from './processor-helpers.js';

const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);

const word = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.constantFrom('\u20A61,500', '$3.14', '+2348051234567', '1,000,000', 'rice', '\u{1F47B}', '\u00E9'),
);
const toolOutput = fc.oneof(
  fc.string({ maxLength: 800 }),
  fc.array(word, { maxLength: 150 }).map((w) => w.join(' ')),
);

function fits(text: string, channel: 'sms' | 'web' | 'ussd'): boolean {
  if (channel === 'ussd') return text.length <= LIMITS.ussd.screenHardCap;
  const l = detectEncoding(text) === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2;
  // Single-segment text may use the single limit; any message is bounded by the larger one.
  return text.length <= l.singleSegment;
}

describe('processor output limits', () => {
  it('every outbound message fits its channel limits and hides internals', async () => {
    await fc.assert(
      fc.asyncProperty(toolOutput, fc.constantFrom('sms' as const, 'web' as const, 'ussd' as const), async (output, channel) => {
        const h = makeHarness();
        h.toolOutput.value = output;
        const out = await h.processor.process(h.msg('echo hi', channel));
        const multi = out.length > 1;
        for (const m of out) {
          if (channel === 'ussd') expect(fits(m.text, channel)).toBe(true);
          else if (multi) {
            const l = detectEncoding(m.text) === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2;
            expect(m.text.length).toBeLessThanOrEqual(l.concatSegment);
          } else expect(fits(m.text, channel)).toBe(true);
        }
        if (channel === 'ussd') expect(out.length).toBeLessThanOrEqual(1);
        else expect(out.length).toBeLessThanOrEqual(LIMITS.reply.maxPreferredSegments + 1);
        const all = JSON.stringify(out);
        expect(all).not.toContain('classifyIntent');
        expect(all).not.toContain('phoneNumber');
      }),
      { numRuns },
    );
  });
});
