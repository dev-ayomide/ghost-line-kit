import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits.js';
import type { TraceEvent } from '../src/trace.js';
import { makeHarness, PHONE } from './processor-helpers.js';

function traced() {
  const events: TraceEvent[] = [];
  const h = makeHarness({ onTrace: (e) => void events.push(e) });
  return { h, events };
}

describe('processor trace events', () => {
  it('emits reasoning, tool_call, tool_result in order for a classified run', async () => {
    const { h, events } = traced();
    const inbound = h.msg('echo hi');
    await h.processor.process(inbound);

    expect(events.map((e) => e.type)).toEqual(['reasoning', 'tool_call', 'tool_result']);
    expect(new Set(events.map((e) => e.messageId))).toEqual(new Set([inbound.messageId]));
    const [, call, result] = events;
    expect(call!.tool).toBe('echo');
    expect(result!.tool).toBe('echo');
    expect(result!.ok).toBe(true);
    expect(events.indexOf(call!)).toBeLessThan(events.indexOf(result!));
  });

  it('emits one reasoning event for STOP', async () => {
    const { h, events } = traced();
    await h.processor.process(h.msg('STOP'));
    expect(events.map((e) => [e.type, e.title])).toEqual([['reasoning', 'Keyword STOP handled']]);
  });

  it('emits one reasoning event for a refused inbound rate limit', async () => {
    const { h, events } = traced();
    for (let i = 0; i < LIMITS.rateLimit.maxInbound; i++) await h.rateLimiter.check(PHONE, 'inbound');
    await h.processor.process(h.msg('echo hi'));
    expect(events.map((e) => [e.type, e.title])).toEqual([['reasoning', 'Rate limit reached']]);
  });

  it('emits one reasoning event for MORE', async () => {
    const { h, events } = traced();
    await h.processor.process(h.msg('MORE'));
    expect(events.map((e) => [e.type, e.title])).toEqual([
      ['reasoning', 'Sending the rest of a long reply'],
    ]);
  });

  it('emits one reasoning event for an unrecognized message', async () => {
    const { h, events } = traced();
    await h.processor.process(h.msg('blah blah'));
    expect(events.map((e) => [e.type, e.title])).toEqual([
      ['reasoning', 'Not understood, asking the user to try HELP'],
    ]);
  });

  it('returns the same messages with or without a sink', async () => {
    const withSink = traced().h;
    const without = makeHarness();
    for (const text of ['echo hi', 'blah blah', 'MORE', 'STOP']) {
      const a = await withSink.processor.process({ ...withSink.msg(text), messageId: 'fixed' });
      const b = await without.processor.process({ ...without.msg(text), messageId: 'fixed' });
      expect(a).toEqual(b);
    }
  });
});
