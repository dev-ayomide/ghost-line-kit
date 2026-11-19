import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROCESSOR_COPY } from '../src/processor.js';
import { LIMITS } from '../src/limits.js';
import { makeHarness, PHONE } from './processor-helpers.js';

describe('STOP / DELETE / START', () => {
  it('STOP unsubscribes, confirms, ends the session, and later messages get no reply', async () => {
    const h = makeHarness();
    await h.processor.process(h.msg('echo hi'));
    expect(await h.session.getSession(PHONE, 'sms')).toBeDefined();
    const out = await h.processor.process(h.msg(' stop '));
    expect(out.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.stopped]);
    expect(await h.store.read(`user:${PHONE}`)).toEqual({ subscribed: false });
    expect(await h.session.getSession(PHONE, 'sms')).toBeUndefined();
    expect(await h.processor.process(h.msg('echo hi'))).toEqual([]);
  });

  it('STOP when not subscribed sends the not-subscribed message', async () => {
    const h = makeHarness();
    const out = await h.processor.process(h.msg('STOP'));
    expect(out.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.notSubscribed]);
    await h.processor.process(h.msg('echo hi'));
    await h.processor.process(h.msg('STOP'));
    const again = await h.processor.process(h.msg('STOP'));
    expect(again.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.notSubscribed]);
  });

  it('DELETE erases the user record, all sessions and pending data, calls eraseUserData, confirms', async () => {
    const erase = vi.fn(async () => {});
    const h = makeHarness({ eraseUserData: erase });
    await h.processor.process(h.msg('echo hi', 'sms'));
    await h.processor.process(h.msg('echo hi', 'web'));
    await h.session.handleInbound(PHONE, 'ussd', {});
    await h.store.write(`pending:${PHONE}`, { text: 'rest' });
    const out = await h.processor.process(h.msg('DELETE'));
    expect(out.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.deleted]);
    expect(await h.store.read(`user:${PHONE}`)).toBeUndefined();
    expect(await h.store.read(`pending:${PHONE}`)).toBeUndefined();
    for (const ch of ['sms', 'ussd', 'web'] as const) {
      expect(await h.session.getSession(PHONE, ch)).toBeUndefined();
    }
    expect(erase).toHaveBeenCalledExactlyOnceWith(PHONE);
    expect(await h.store.read(`ratelimit:${PHONE}`)).toBeDefined();
  });

  it('START resubscribes after STOP', async () => {
    const h = makeHarness();
    await h.processor.process(h.msg('echo hi'));
    await h.processor.process(h.msg('STOP'));
    const out = await h.processor.process(h.msg('start'));
    expect(out.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.resubscribed]);
    expect(await h.store.read(`user:${PHONE}`)).toEqual({ subscribed: true });
    const next = await h.processor.process(h.msg('echo hi'));
    expect(next.length).toBeGreaterThan(0);
  });

  it('STOP and DELETE still work when the number is over its inbound limit', async () => {
    const h = makeHarness();
    await h.processor.process(h.msg('echo hi'));
    for (let i = 0; i < LIMITS.rateLimit.maxInbound; i++) await h.rateLimiter.check(PHONE, 'inbound');
    expect(await h.rateLimiter.check(PHONE, 'inbound')).toBe(false);
    const stop = await h.processor.process(h.msg('STOP'));
    expect(stop.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.stopped]);
    expect(await h.store.read(`user:${PHONE}`)).toEqual({ subscribed: false });
    const del = await h.processor.process(h.msg('DELETE'));
    expect(del.map((m) => m.text)).toEqual([DEFAULT_PROCESSOR_COPY.deleted]);
    expect(await h.store.read(`user:${PHONE}`)).toBeUndefined();
  });

  it('rejects invalid copy overrides at construction', () => {
    expect(() => makeHarness({ copy: { stopped: 'x'.repeat(161) } })).toThrow();
    expect(() => makeHarness({ copy: { done: 'Done \u{1F47B}' } })).toThrow();
    expect(() => makeHarness({ copy: { done: 'All done.' } })).not.toThrow();
  });
});
