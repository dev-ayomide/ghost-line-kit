import { describe, it, expect } from 'vitest';
import { LIMITS } from '../src/limits.js';

describe('LIMITS (Requirements 1.1-1.9)', () => {
  it('has the exact expected values', () => {
    expect(LIMITS).toEqual({
      sms: {
        gsm7: { singleSegment: 160, concatSegment: 153 },
        ucs2: { singleSegment: 70, concatSegment: 67 },
      },
      ussd: {
        screenHardCap: 160,
        screenSoftTarget: 140,
        sessionTimeoutMs: 180_000,
        maxOptionsPerScreen: 5,
      },
      reply: { maxPreferredSegments: 3, nextStepMaxLength: 40 },
      rateLimit: { windowMs: 60_000, maxInbound: 10, maxOutbound: 10 },
    });
  });

  it('is frozen at every level', () => {
    for (const obj of [
      LIMITS,
      LIMITS.sms,
      LIMITS.sms.gsm7,
      LIMITS.sms.ucs2,
      LIMITS.ussd,
      LIMITS.reply,
      LIMITS.rateLimit,
    ]) {
      expect(Object.isFrozen(obj)).toBe(true);
    }
  });
});
