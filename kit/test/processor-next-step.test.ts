import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT_STEP } from '../src/format/reply.js';
import { makeHarness } from './processor-helpers.js';

describe('MessageProcessor nextStep', () => {
  it('uses the custom next step on an SMS reply', async () => {
    const h = makeHarness({ nextStep: 'Send HELP' });
    const out = await h.processor.process(h.msg('echo hi'));
    const text = out.map((m) => m.text).join('\n');
    expect(text.endsWith('Send HELP')).toBe(true);
    expect(text).not.toContain(DEFAULT_NEXT_STEP);
  });

  it('keeps the default next step when the option is not set', async () => {
    const h = makeHarness();
    const out = await h.processor.process(h.msg('echo hi'));
    expect(out.map((m) => m.text).join('\n').endsWith('Reply HELP for options')).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['41 characters', 'a'.repeat(41)],
    ['non-GSM character', 'Send \u20A6 now'],
  ])('throws for an invalid nextStep (%s)', (_label, value) => {
    expect(() => makeHarness({ nextStep: value })).toThrow(/^Invalid processor nextStep/);
  });

  it('adds no next step to STOP and DELETE acknowledgements', async () => {
    const h = makeHarness({ nextStep: 'Send HELP' });
    await h.processor.process(h.msg('echo hi'));
    const stop = await h.processor.process(h.msg('STOP'));
    const del = await h.processor.process(h.msg('DELETE'));
    for (const out of [stop, del]) {
      expect(out.length).toBeGreaterThan(0);
      expect(out.map((m) => m.text).join('\n')).not.toContain('Send HELP\n');
      expect(out[out.length - 1]!.text.endsWith('\nSend HELP')).toBe(false);
    }
  });
});
