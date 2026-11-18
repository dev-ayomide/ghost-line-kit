/**
 * Every channel limit lives here. Do not hard-code these numbers elsewhere.
 */
export const LIMITS = Object.freeze({
  sms: Object.freeze({
    gsm7: Object.freeze({ singleSegment: 160, concatSegment: 153 }),
    ucs2: Object.freeze({ singleSegment: 70, concatSegment: 67 }),
  }),
  ussd: Object.freeze({
    screenHardCap: 160,
    screenSoftTarget: 140,
    sessionTimeoutMs: 180_000,
    maxOptionsPerScreen: 5,
  }),
  reply: Object.freeze({
    maxPreferredSegments: 3,
    nextStepMaxLength: 40,
  }),
  rateLimit: Object.freeze({
    windowMs: 60_000,
    maxInbound: 10,
    maxOutbound: 10,
  }),
} as const);
