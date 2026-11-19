import { describe, expect, it } from 'vitest';
import { WebAdapter } from '../src/channels/web-adapter.js';
import { PHONE, makeHarness } from './processor-helpers.js';

function parse(extra: Record<string, unknown>) {
  const adapter = new WebAdapter();
  return adapter.parseWebhook({ body: { from: PHONE, text: 'echo hi', ...extra }, query: {}, headers: {} });
}

describe('WebAdapter payload channel', () => {
  it('defaults to web when channel is omitted', () => {
    const r = parse({});
    expect(r.ok && r.inbound.channel).toBe('web');
  });

  it("accepts 'ussd' and 'web'", () => {
    const u = parse({ channel: 'ussd', sessionId: 's1' });
    expect(u.ok && u.inbound.channel).toBe('ussd');
    const w = parse({ channel: 'web' });
    expect(w.ok && w.inbound.channel).toBe('web');
  });

  it.each([['sms'], [''], [42], [null]])('rejects channel %j', (channel) => {
    const r = parse({ channel });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_PAYLOAD');
  });

  it('still ignores unknown extra fields', () => {
    const r = parse({ channel: 'ussd', extra: 'x', nested: { a: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inbound).not.toHaveProperty('extra');
  });

  it("keeps the adapter's own channel as 'web'", () => {
    expect(new WebAdapter().channel).toBe('web');
  });

  it('a ussd inbound from parseWebhook yields exactly one outbound message', async () => {
    const h = makeHarness();
    h.toolOutput.value = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const adapter = new WebAdapter();

    const web = adapter.parseWebhook({ body: { from: PHONE, text: 'echo hi' }, query: {}, headers: {} });
    const ussd = adapter.parseWebhook({
      body: { from: PHONE, text: 'echo hi', channel: 'ussd', sessionId: 'sess-1' },
      query: {},
      headers: {},
    });
    if (!web.ok || !ussd.ok) throw new Error('parse failed');

    const webOut = await h.processor.process(web.inbound);
    expect(webOut.length).toBeGreaterThan(1);

    h.clock.advance(1000);
    const ussdOut = await h.processor.process(ussd.inbound);
    expect(ussdOut).toHaveLength(1);
  });
});
