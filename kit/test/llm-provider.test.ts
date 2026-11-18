import { describe, expect, it } from 'vitest';
import { LlmError } from '../src/agent/llm-provider.js';
import { detectEncoding } from '../src/format/encoding.js';
import { LIMITS } from '../src/limits.js';

describe('LlmError', () => {
  it('does not leak the cause text in its message', () => {
    const err = new LlmError('complete', new Error('secret SDK detail'));
    expect(err.message).toBe('Language model call failed');
    expect(err.message).not.toContain('secret');
    expect(err.operation).toBe('complete');
    expect((err.cause as Error).message).toBe('secret SDK detail');
  });

  it('has a GSM-7 userMessage within the error limit', () => {
    const err = new LlmError('classifyIntent');
    expect(err.userMessage.length).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
    expect(detectEncoding(err.userMessage)).toBe('GSM-7');
  });
});
