import { describe, expect, it } from 'vitest';
import { LlmError } from '../src/agent/llm-provider.js';
import { detectEncoding } from '../src/format/encoding.js';
import { LIMITS } from '../src/limits.js';
import { DEFAULT_PROCESSOR_COPY } from '../src/processor.js';
import { makeHarness, PHONE } from './processor-helpers.js';

const texts = (out: { text: string }[]) => out.map((m) => m.text);

describe('MessageProcessor', () => {
  it('happy path: classify, tool, format with a next step', async () => {
    const h = makeHarness();
    h.toolOutput.value = 'Rice is 1,500 naira.';
    const out = await h.processor.process(h.msg('echo rice'));
    expect(out).toHaveLength(1);
    expect(out[0]!.to).toBe(PHONE);
    expect(out[0]!.text.startsWith('Rice is 1,500 naira.')).toBe(true);
    expect(out[0]!.text).toContain('HELP');
    expect(await h.store.read(`user:${PHONE}`)).toEqual({ subscribed: true });
  });

  it('uses object.text from the tool output and falls back to done', async () => {
    const h = makeHarness();
    h.toolOutput.value = { text: 'From object.' };
    expect((await h.processor.process(h.msg('echo a')))[0]!.text).toContain('From object.');
    h.toolOutput.value = 42;
    expect((await h.processor.process(h.msg('echo a')))[0]!.text).toContain('Done.');
  });

  it('replies with the unrecognized copy', async () => {
    const h = makeHarness();
    const out = await h.processor.process(h.msg('blah'));
    expect(out[0]!.text).toContain(DEFAULT_PROCESSOR_COPY.unrecognized);
  });

  it('tool validation failure replies with the tool userMessage', async () => {
    const h = makeHarness();
    h.setClassifier(async (m) => ({
      name: 'echo',
      parameters: { word: 'x'.repeat(50) },
      rawMessage: m,
    }));
    const out = await h.processor.process(h.msg('echo'));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('That did not work');
  });

  it('LlmError becomes a safe message with no internal text, and is logged by code only', async () => {
    const h = makeHarness();
    h.setClassifier(async () => {
      throw new LlmError('classifyIntent', new Error('SECRET-SDK-DETAIL arn:aws:bedrock'));
    });
    const out = await h.processor.process(h.msg('echo hi'));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('Service briefly unavailable. Try again in a moment.');
    const json = JSON.stringify(h.logs);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('arn:');
    expect(h.logs).toContainEqual(expect.objectContaining({ level: 'error', error: 'LLM_ERROR' }));
  });

  it('unexpected errors give a generic message', async () => {
    const h = makeHarness();
    h.setClassifier(async () => {
      throw new Error('db password hunter2');
    });
    const out = await h.processor.process(h.msg('echo hi'));
    expect(out[0]!.text).not.toContain('hunter2');
    expect(JSON.stringify(h.logs)).not.toContain('hunter2');
    expect(h.logs).toContainEqual(expect.objectContaining({ error: 'UNEXPECTED' }));
  });

  it('rate limits the 11th inbound in 60 s and allows again after the window', async () => {
    const h = makeHarness();
    for (let i = 0; i < LIMITS.rateLimit.maxInbound; i++) {
      const out = await h.processor.process(h.msg('echo hi'));
      expect(out[0]!.text).toContain('ok');
      h.clock.advance(1000);
    }
    // Outbound counter is also at 10 (one reply each), so the rate-limit notice is dropped.
    h.clock.advance(0);
    const limited = await h.processor.process(h.msg('echo hi'));
    expect(limited.every((m) => !m.text.includes('ok'))).toBe(true);
    expect(h.logs).toContainEqual(expect.objectContaining({ event: 'RATE_LIMITED' }));
    h.clock.advance(LIMITS.rateLimit.windowMs);
    const again = await h.processor.process(h.msg('echo hi'));
    expect(again[0]!.text).toContain('ok');
  });

  it('sends the rate-limit notice when an outbound slot is free', async () => {
    const h = makeHarness();
    for (let i = 0; i < LIMITS.rateLimit.maxInbound; i++) await h.rateLimiter.check(PHONE, 'inbound');
    const out = await h.processor.process(h.msg('echo hi'));
    expect(texts(out)).toEqual(['Too many messages. Wait 1 min and try again.']);
  });

  it('splits a multi-segment SMS reply', async () => {
    const h = makeHarness();
    h.toolOutput.value = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const out = await h.processor.process(h.msg('echo hi'));
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(LIMITS.reply.maxPreferredSegments + 1);
    for (const m of out) expect(m.text.length).toBeLessThanOrEqual(LIMITS.sms.gsm7.concatSegment);
  });

  it('truncates a long reply with Reply MORE and MORE returns the rest', async () => {
    const h = makeHarness();
    const words = Array.from({ length: 150 }, (_, i) => `w${i}`);
    h.toolOutput.value = words.join(' ');
    const first = await h.processor.process(h.msg('echo hi'));
    expect(first[first.length - 1]!.text.endsWith('Reply MORE')).toBe(true);
    const sent = first.map((m) => m.text).join('').replace(/\s*Reply MORE$/, '');
    h.clock.advance(61_000);
    const second = await h.processor.process(h.msg('more'));
    const secondText = second.map((m) => m.text).join('');
    const firstWordSecond = secondText.split(/\s/)[0]!;
    expect(words.join(' ').startsWith(sent)).toBe(true);
    expect(words.join(' ').slice(sent.length).trimStart().startsWith(firstWordSecond)).toBe(true);
  });

  it('MORE with nothing pending replies with the nothing-more copy', async () => {
    const h = makeHarness();
    const out = await h.processor.process(h.msg('MORE'));
    expect(out[0]!.text).toContain(DEFAULT_PROCESSOR_COPY.nothingMore);
  });

  it('USSD returns one message within the hard cap and drops extra screens', async () => {
    const h = makeHarness();
    h.toolOutput.value = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const out = await h.processor.process(h.msg('echo hi', 'ussd'));
    expect(out).toHaveLength(1);
    expect(out[0]!.text.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
    expect(out[0]!.sessionId).toBe('sess-1');
    expect(out[0]!.endSession).toBe(false);
    expect(h.logs).toContainEqual(expect.objectContaining({ event: 'USSD_SCREENS_DROPPED' }));
  });

  it('USSD error replies end the session', async () => {
    const h = makeHarness();
    h.setClassifier(async () => {
      throw new Error('boom');
    });
    const out = await h.processor.process(h.msg('echo hi', 'ussd'));
    expect(out).toHaveLength(1);
    expect(out[0]!.endSession).toBe(true);
  });

  it('an outbound limit stops further segments', async () => {
    const h = makeHarness();
    for (let i = 0; i < LIMITS.rateLimit.maxOutbound - 1; i++) await h.rateLimiter.check(PHONE, 'outbound');
    h.toolOutput.value = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const out = await h.processor.process(h.msg('echo hi'));
    expect(out).toHaveLength(1);
    expect(h.logs).toContainEqual(expect.objectContaining({ event: 'OUTBOUND_LIMITED' }));
  });

  it('the logger never receives message bodies; the phone is raw only in logger input', async () => {
    const h = makeHarness();
    const body = 'echo SENSITIVE-BODY-TEXT';
    h.toolOutput.value = 'REPLY-BODY-TEXT';
    const out = await h.processor.process(h.msg(body));
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain('SENSITIVE-BODY-TEXT');
    expect(logged).not.toContain('REPLY-BODY-TEXT');
    expect(h.logs).toContainEqual(
      expect.objectContaining({ event: 'INBOUND', phoneNumber: PHONE, messageLength: body.length }),
    );
    for (const m of out) expect(m.text).not.toContain(PHONE);
    const err = makeHarness();
    err.setClassifier(async () => {
      throw new Error(`failed for ${PHONE}`);
    });
    const e = await err.processor.process(err.msg('echo hi'));
    expect(e[0]!.text).not.toContain(PHONE);
    expect(detectEncoding(e[0]!.text)).toBe('GSM-7');
  });

  it('ignores unsubscribed users without calling the model', async () => {
    const h = makeHarness();
    let calls = 0;
    h.setClassifier(async (m) => {
      calls++;
      return { name: 'unrecognized', parameters: {}, rawMessage: m };
    });
    await h.processor.process(h.msg('hi'));
    await h.processor.process(h.msg('STOP'));
    const before = calls;
    expect(await h.processor.process(h.msg('hi'))).toEqual([]);
    expect(calls).toBe(before);
    expect(h.logs).toContainEqual(expect.objectContaining({ event: 'IGNORED_UNSUBSCRIBED' }));
  });
});
