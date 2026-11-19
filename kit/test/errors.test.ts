import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { KitError, toUserMessage, internalErrorCode } from '../src/errors.js';
import { StoreError } from '../src/store/store.js';
import { LlmError } from '../src/agent/llm-provider.js';
import { LIMITS } from '../src/limits.js';
import { detectEncoding } from '../src/format/encoding.js';

const RECOVERY = /\b(Try|Send|Wait|Reply)\b/;
const factories = (): KitError[] => [
  KitError.rateLimited(),
  KitError.unavailable('X_DOWN', 'x failed', new Error('boom')),
  KitError.invalidInput(),
  KitError.generic('oops'),
];
const init = (userMessage: string) => ({ code: 'T', userMessage, internalMessage: 'internal' });

describe('KitError (Requirements 17.1-17.3)', () => {
  it('factory messages are short, GSM-7 and name a recovery action', () => {
    for (const e of factories()) {
      expect(e.userMessage.length).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
      expect(detectEncoding(e.userMessage)).toBe('GSM-7');
      expect(e.userMessage).toMatch(RECOVERY);
    }
  });

  it('keeps internal text out of userMessage and sets Error.message to it', () => {
    const e = KitError.unavailable('X_DOWN', 'secret internal', 'c');
    expect(e.message).toBe('secret internal');
    expect(e.userMessage).not.toContain('secret');
    expect(e.code).toBe('X_DOWN');
    expect(e.cause).toBe('c');
  });

  it.each([
    ['too long', 'Try again. ' + 'a'.repeat(160)],
    ['emoji', 'Oops 😱. Try again.'],
    ['stack text', 'Failed\n    at foo (x.js:1). Try again.'],
    ['Error: prefix', 'Error: bad. Try again.'],
    ['uuid', 'Id 123e4567-e89b-12d3-a456-426614174000. Try again.'],
    ['long hex', 'Id deadbeefdeadbeef00. Try again.'],
    ['arn', 'arn:aws:s3:::b. Try again.'],
    ['no action', 'Something broke.'],
  ])('rejects an invalid userMessage (%s)', (_n, msg) => {
    expect(() => new KitError(init(msg))).toThrow(Error);
    expect(() => new KitError(init(msg))).not.toBeInstanceOf(KitError);
  });
});

describe('toUserMessage / internalErrorCode', () => {
  it('returns the userMessage of a KitError', () => {
    expect(toUserMessage(KitError.rateLimited())).toBe('Too many messages. Wait 1 min and try again.');
    expect(internalErrorCode(KitError.rateLimited())).toBe('RATE_LIMITED');
  });

  it('never leaks text from other thrown values', () => {
    const err = new Error('password=hunter2');
    err.stack = 'Error: password=hunter2\n    at secret.ts:1';
    for (const v of [err, 'token-abc123', null, undefined, { message: 'leak' }]) {
      const out = toUserMessage(v);
      expect(out).not.toMatch(/hunter2|token-abc123|leak|secret/);
      expect(out).toMatch(RECOVERY);
      expect(internalErrorCode(v)).toBe('UNEXPECTED');
    }
  });
});

describe('StoreError and LlmError', () => {
  it('extend KitError with safe user messages', () => {
    const s = new StoreError('write', 'k', new Error('x'));
    const l = new LlmError('complete', new Error('y'));
    for (const e of [s, l]) {
      expect(e).toBeInstanceOf(KitError);
      expect(e).toBeInstanceOf(Error);
      expect(e.userMessage).toBe('Service briefly unavailable. Try again in a moment.');
    }
    expect(s.code).toBe('STORE_ERROR');
    expect(l.code).toBe('LLM_ERROR');
    expect(s.operation).toBe('write');
    expect(s.key).toBe('k');
    expect(l.operation).toBe('complete');
    expect(toUserMessage(s)).toBe(s.userMessage);
  });
});

// Feature: kit-core, Property 13: user-facing errors are always safe
// **Validates: Requirements 17.1, 17.2, 17.3**
describe('Property 13: user-facing errors are always safe', () => {
  it('toUserMessage is short, GSM-7, free of the input text and has a recovery action', () => {
    const thrown = fc.oneof(
      fc.string({ minLength: 4 }),
      fc.tuple(fc.string({ minLength: 4 }), fc.string()).map(([m, st]) => {
        const e = new Error(m);
        e.stack = st;
        return e;
      }),
      fc.record({ message: fc.string({ minLength: 4 }) }),
    );
    fc.assert(
      fc.property(thrown, (v) => {
        const out = toUserMessage(v);
        expect(out.length).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
        expect(detectEncoding(out)).toBe('GSM-7');
        expect(out).toMatch(RECOVERY);
        // Output is a fixed message, so it cannot carry the input text.
        expect(out).toBe(toUserMessage(null));
      }),
    );
  });
});
