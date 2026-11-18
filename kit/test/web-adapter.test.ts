import { describe, expect, it } from 'vitest';
import { WebAdapter } from '../src/channels/web-adapter.js';
import { TestClock } from '../src/session/clock.js';
import type { DeliveryStatus } from '../src/channels/types.js';

const input = (body: unknown) => ({ body, query: {}, headers: {} });

describe('WebAdapter', () => {
  it('parses a valid payload with the clock timestamp', () => {
    const a = new WebAdapter({ clock: new TestClock(1234) });
    const r = a.parseWebhook(input({ from: 'u1', text: 'hi', sessionId: 's1', extra: 1 }));
    expect(r).toEqual({
      ok: true,
      inbound: { from: 'u1', text: 'hi', channel: 'web', sessionId: 's1', timestamp: 1234 },
    });
  });

  it('rejects invalid payloads without echoing them', () => {
    const a = new WebAdapter();
    for (const body of [null, {}, { from: '', text: 'x' }, { from: 'SECRET-user', text: 5 }]) {
      const r = a.parseWebhook(input(body));
      expect(r).toEqual({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid request.' } });
      expect(JSON.stringify(r)).not.toContain('SECRET');
    }
  });

  it('delivers to the handler and emits a delivered status', async () => {
    const a = new WebAdapter();
    const got: string[] = [];
    const statuses: DeliveryStatus[] = [];
    a.onDeliver((m) => {
      got.push(m.text);
    });
    a.onDeliveryStatus((s) => statuses.push(s));
    const r = await a.send({ to: 'u1', text: 'hello' });
    expect(r.ok).toBe(true);
    expect(got).toEqual(['hello']);
    expect(statuses).toEqual([{ messageId: r.messageId, status: 'delivered', phoneNumber: 'u1' }]);
  });

  it('fails when no client is connected', async () => {
    const r = await new WebAdapter().send({ to: 'u1', text: 'x' });
    expect(r).toEqual({ ok: false, error: 'No web client connected' });
  });

  it('fails without emitting when the deliver handler throws', async () => {
    const a = new WebAdapter();
    const statuses: DeliveryStatus[] = [];
    a.onDeliver(() => {
      throw new Error('boom at /secret/path');
    });
    a.onDeliveryStatus((s) => statuses.push(s));
    const r = await a.send({ to: 'u1', text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('boom');
    expect(statuses).toEqual([]);
  });

  it('unsubscribe removes handlers', async () => {
    const a = new WebAdapter();
    const off = a.onDeliver(() => {});
    off();
    expect((await a.send({ to: 'u', text: 'x' })).ok).toBe(false);

    a.onDeliver(() => {});
    const statuses: DeliveryStatus[] = [];
    const offStatus = a.onDeliveryStatus((s) => statuses.push(s));
    offStatus();
    await a.send({ to: 'u', text: 'x' });
    expect(statuses).toEqual([]);
  });

  it('a throwing status handler does not break send or other handlers', async () => {
    const a = new WebAdapter();
    const statuses: DeliveryStatus[] = [];
    a.onDeliver(() => {});
    a.onDeliveryStatus(() => {
      throw new Error('bad');
    });
    a.onDeliveryStatus((s) => statuses.push(s));
    const r = await a.send({ to: 'u', text: 'x' });
    expect(r.ok).toBe(true);
    expect(statuses).toHaveLength(1);
  });

  it('reports delivery reports as unsupported', () => {
    expect(new WebAdapter().receiveDeliveryReport(input({}))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED', message: 'Not supported.' },
    });
  });
});
