import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits.js';
import { DEFAULT_NEXT_STEP, formatReply, type ReplyOpts } from '../src/format/reply.js';

const sms = (over: Partial<ReplyOpts> = {}): ReplyOpts => ({
  channel: 'sms',
  continueConversation: true,
  ...over,
});

const limitsFor = (enc: 'GSM-7' | 'UCS-2') => (enc === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2);

/** Words of length 5 separated by single spaces, total length n (n % 6 === 5). */
const words = (n: number, w = 'abcde'): string => Array(Math.ceil((n + 1) / 6)).fill(w).join(' ').slice(0, n);

describe('formatReply', () => {
  it('appends the next step to the final segment (Req 7.1)', () => {
    const r = formatReply('Your balance is N1,500.', sms());
    expect(r.segments).toEqual([`Your balance is N1,500.\n${DEFAULT_NEXT_STEP}`]);
    expect(r.truncated).toBe(false);
    expect(r.encoding).toBe('GSM-7');
    expect(r.segments[0]!.length).toBeLessThanOrEqual(LIMITS.sms.gsm7.singleSegment);
  });

  it('uses a custom nextStep', () => {
    const r = formatReply('Saved.', sms({ nextStep: 'Reply 1 to confirm' }));
    expect(r.segments).toEqual(['Saved.\nReply 1 to confirm']);
  });

  it('re-splits with the concat limit when the step pushes a 1-segment message past 160', () => {
    const content = words(150);
    const r = formatReply(content, sms({ nextStep: 'Reply 1 to confirm' }));
    expect(r.segments.length).toBeGreaterThan(1);
    for (const s of r.segments) expect(s.length).toBeLessThanOrEqual(LIMITS.sms.gsm7.concatSegment);
    expect(r.segments.at(-1)!.endsWith('Reply 1 to confirm')).toBe(true);
  });

  it('puts the step whole in an additional segment when it would overflow, keeping all content (Req 7.2)', () => {
    const step = 'Reply 1 to confirm';
    const content = words(299); // two nearly full segments (150 + 149)
    const r = formatReply(content, sms({ nextStep: step }));
    expect(r.truncated).toBe(false);
    expect(r.segments.at(-1)).toBe(step);
    expect(r.segments.slice(0, -1).join('')).toBe(content);
    for (const s of r.segments) expect(s.length).toBeLessThanOrEqual(LIMITS.sms.gsm7.concatSegment);
  });

  it('keeps UCS-2 segments within 67 and the step whole', () => {
    const step = 'Reply 1 to confirm';
    const content = words(130, 'ab€de');
    const r = formatReply(content, sms({ nextStep: step }));
    expect(r.encoding).toBe('UCS-2');
    expect(r.truncated).toBe(false);
    for (const s of r.segments) expect(s.length).toBeLessThanOrEqual(LIMITS.sms.ucs2.concatSegment);
    expect(r.segments.at(-1)!.endsWith(step)).toBe(true);
    expect(r.segments.join('').replace(step, '').replace(/\n/g, '').length).toBeGreaterThan(0);
  });

  it('switches to UCS-2 when only the step has a non-GSM character', () => {
    const r = formatReply('Done.', sms({ nextStep: 'Reply 1 ✓' }));
    expect(r.encoding).toBe('UCS-2');
    expect(r.segments.every((s) => s.length <= limitsFor(r.encoding).singleSegment)).toBe(true);
  });

  it('adds no next step when continueConversation is false', () => {
    const r = formatReply('You are unsubscribed.', sms({ continueConversation: false, nextStep: 'Reply 1' }));
    expect(r.segments).toEqual(['You are unsubscribed.']);
    const u = formatReply('Bye.', { channel: 'ussd', continueConversation: false });
    expect(u.segments).toEqual(['Bye.']);
  });

  it('returns truncated replies with Reply MORE and no second step', () => {
    const content = words(1000);
    const r = formatReply(content, sms());
    expect(r.truncated).toBe(true);
    expect(r.segments.length).toBeLessThanOrEqual(LIMITS.reply.maxPreferredSegments);
    expect(r.segments.at(-1)!.endsWith('Reply MORE')).toBe(true);
    expect(r.segments.join('')).not.toContain(DEFAULT_NEXT_STEP);
  });

  it('falls back to Reply MORE when the extra step segment would exceed 3 segments', () => {
    const content = words(LIMITS.sms.gsm7.concatSegment * 3 - 1);
    const r = formatReply(content, sms());
    expect(r.truncated).toBe(true);
    expect(r.segments.length).toBeLessThanOrEqual(LIMITS.reply.maxPreferredSegments);
    expect(r.segments.at(-1)!.endsWith('Reply MORE')).toBe(true);
  });

  it('trims a custom nextStep over 40 chars at a word boundary', () => {
    const long = 'Reply 1 to confirm your order or reply 2 to cancel it now';
    const r = formatReply('Ok.', sms({ nextStep: long }));
    const step = r.segments[0]!.split('\n')[1]!;
    expect(step.length).toBeLessThanOrEqual(LIMITS.reply.nextStepMaxLength);
    expect(long.startsWith(step)).toBe(true);
    expect(long.charAt(step.length)).toBe(' ');
  });

  it('works the same for the web channel', () => {
    const r = formatReply('Hello.', { channel: 'web', continueConversation: true });
    expect(r.segments).toEqual([`Hello.\n${DEFAULT_NEXT_STEP}`]);
  });

  describe('USSD', () => {
    it('adds the step to the single screen', () => {
      const r = formatReply('Pick a shop.', { channel: 'ussd', continueConversation: true });
      expect(r.segments).toEqual([`Pick a shop.\n${DEFAULT_NEXT_STEP}`]);
    });

    it('keeps every screen within the hard cap, with the step present and words whole', () => {
      const content = words(500, 'N1,500.00');
      const r = formatReply(content, { channel: 'ussd', continueConversation: true });
      expect(r.segments.length).toBeGreaterThan(1);
      for (const s of r.segments) expect(s.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
      for (const s of r.segments.slice(0, -1)) expect(s.length).toBeLessThanOrEqual(LIMITS.ussd.screenSoftTarget);
      expect(r.segments.at(-1)!.endsWith(DEFAULT_NEXT_STEP)).toBe(true);
      const tokens = r.segments.join(' ').split(/\s+/);
      for (const t of tokens) expect(['N1,500.00', 'Reply', 'HELP', 'for', 'options']).toContain(t);
    });

    it('puts the step in an additional screen when the last screen is full', () => {
      const content = words(LIMITS.ussd.screenSoftTarget - 5);
      const r = formatReply(content, { channel: 'ussd', continueConversation: true });
      expect(r.segments).toEqual([content, DEFAULT_NEXT_STEP]);
    });
  });
});
