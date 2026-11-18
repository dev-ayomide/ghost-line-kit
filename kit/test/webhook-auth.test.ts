import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { verifyWebhookSecret, WEBHOOK_SECRET_PARAM } from '../src/channels/webhook-auth.js';

describe('verifyWebhookSecret', () => {
  it('uses "secret" as the query parameter name', () => {
    expect(WEBHOOK_SECRET_PARAM).toBe('secret');
  });
  it('accepts a matching secret', () => {
    expect(verifyWebhookSecret('abc123', 'abc123')).toBe(true);
  });
  it('rejects a mismatch', () => {
    expect(verifyWebhookSecret('abc124', 'abc123')).toBe(false);
  });
  it('rejects different lengths without throwing', () => {
    expect(verifyWebhookSecret('abc', 'abc123')).toBe(false);
    expect(verifyWebhookSecret('abc123456', 'abc123')).toBe(false);
  });
  it('rejects an empty provided secret', () => {
    expect(verifyWebhookSecret('', 'abc123')).toBe(false);
  });
  it('rejects an undefined provided secret', () => {
    expect(verifyWebhookSecret(undefined, 'abc123')).toBe(false);
  });
  it('fails closed when the expected secret is not configured', () => {
    expect(verifyWebhookSecret('abc', undefined)).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
    expect(verifyWebhookSecret(undefined, undefined)).toBe(false);
  });
});

// Feature: kit-core: webhook auth
describe('webhook auth properties', () => {
  // **Validates: Requirements 2.3**
  it('accepts equal non-empty secrets and rejects any different pair', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (s, t) => {
        if (s !== '') expect(verifyWebhookSecret(s, s)).toBe(true);
        if (s !== t) expect(verifyWebhookSecret(s, t)).toBe(false);
      }),
    );
  });
});
