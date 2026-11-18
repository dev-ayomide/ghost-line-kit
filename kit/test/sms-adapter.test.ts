import { describe, expect, it, vi } from 'vitest';
import { SmsAdapter } from '../src/channels/sms-adapter.js';
import { TestClock } from '../src/session/clock.js';

const okReply = () =>
  new Response(
    JSON.stringify({
      SMSMessageData: { Recipients: [{ statusCode: 101, messageId: 'ATXid_1', status: 'Success' }] },
    }),
    { status: 201 },
  );

const msg = { to: '+2348012345678', text: 'hello' };
const fakeFetch = (impl: () => Promise<Response> = async () => okReply()) =>
  vi.fn<typeof fetch>(async () => impl());

describe('SmsAdapter send', () => {
  it('uses the sandbox URL for username sandbox and live otherwise', async () => {
    const fake = fakeFetch();
    await new SmsAdapter({ username: 'sandbox', apiKey: 'k', fetch: fake }).send(msg);
    await new SmsAdapter({ username: 'acme', apiKey: 'k', fetch: fake }).send(msg);
    expect(fake.mock.calls[0]![0]).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect(fake.mock.calls[1]![0]).toBe('https://api.africastalking.com/version1/messaging');
  });

  it('sends the expected headers and form body, with from only when a shortcode is set', async () => {
    const fake = fakeFetch();
    await new SmsAdapter({ username: 'acme', apiKey: 'k', shortcode: '12345', fetch: fake }).send(msg);
    await new SmsAdapter({ username: 'acme', apiKey: 'k', shortcode: '', fetch: fake }).send(msg);
    const init = fake.mock.calls[0]![1]!;
    expect(init.headers).toEqual({
      apiKey: 'k',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const withFrom = new URLSearchParams(String(init.body));
    expect(withFrom.get('username')).toBe('acme');
    expect(withFrom.get('to')).toBe(msg.to);
    expect(withFrom.get('message')).toBe('hello');
    expect(withFrom.get('from')).toBe('12345');
    expect(new URLSearchParams(String(fake.mock.calls[1]![1]!.body)).has('from')).toBe(false);
  });

  it('returns messageId on success', async () => {
    const adapter = new SmsAdapter({ username: 'sandbox', apiKey: 'k', fetch: fakeFetch() });
    expect(await adapter.send(msg)).toEqual({ ok: true, messageId: 'ATXid_1' });
  });

  it('does not call fetch when credentials are missing', async () => {
    const fake = fakeFetch();
    const adapter = new SmsAdapter({ username: '', apiKey: '', fetch: fake });
    expect(await adapter.send(msg)).toEqual({ ok: false, error: 'SMS adapter is not configured' });
    expect(fake).not.toHaveBeenCalled();
  });

  it('resolves ok:false for non-2xx and 403-style recipient failures', async () => {
    const http = fakeFetch(async () => new Response('x', { status: 500 }));
    expect((await new SmsAdapter({ username: 'a', apiKey: 'k', fetch: http }).send(msg)).ok).toBe(false);
    const rejected = fakeFetch(
      async () =>
        new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 403, status: 'Invalid' }] } })),
    );
    expect((await new SmsAdapter({ username: 'a', apiKey: 'k', fetch: rejected }).send(msg)).ok).toBe(false);
  });

  it('never leaks secrets or user data in error text', async () => {
    const apiKey = 'SUPER-SECRET-KEY';
    const failures = [
      fakeFetch(async () => {
        throw new Error(`boom ${apiKey} acme +2348012345678 hello`);
      }),
      fakeFetch(async () => new Response('x', { status: 403 })),
      fakeFetch(async () => new Response('not json', { status: 200 })),
      fakeFetch(
        async () =>
          new Response(
            JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 403, status: 'Invalid Phone Number' }] } }),
          ),
      ),
    ];
    for (const f of failures) {
      const r = await new SmsAdapter({ username: 'acme', apiKey, fetch: f }).send(msg);
      expect(r.ok).toBe(false);
      for (const secret of [apiKey, 'acme', '+2348012345678', 'hello']) {
        expect(r.error).not.toContain(secret);
      }
    }
  });
});

describe('SmsAdapter webhooks', () => {
  const adapter = new SmsAdapter({ username: 'u', apiKey: 'k', webhookSecret: 's3cret', clock: new TestClock(42) });

  it('rejects unauthorized webhooks without reading the body', () => {
    const body = new Proxy({}, { get: () => { throw new Error('body touched'); } });
    for (const call of [
      () => adapter.parseWebhook({ body, query: { secret: 'wrong' }, headers: {} }),
      () => adapter.receiveDeliveryReport({ body, query: {}, headers: {} }),
    ]) {
      expect(call()).toEqual({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Request rejected.' } });
    }
  });

  it('fails closed when no webhook secret is configured', () => {
    const open = new SmsAdapter({ username: 'u', apiKey: 'k', webhookSecret: '' });
    expect(open.parseWebhook({ body: {}, query: {}, headers: {} }).ok).toBe(false);
  });

  it('parses an inbound SMS and rejects bad payloads without echoing them', () => {
    const good = adapter.parseWebhook({
      body: { from: '+2348012345678', to: '1', text: 'hi', id: 'm1', extra: 'ignored' },
      query: { secret: 's3cret' },
      headers: {},
    });
    expect(good).toEqual({
      ok: true,
      inbound: { from: '+2348012345678', text: 'hi', channel: 'sms', timestamp: 42, messageId: 'm1' },
    });
    const bad = adapter.parseWebhook({ body: { text: 'SECRET-TEXT' }, query: { secret: 's3cret' }, headers: {} });
    expect(bad).toEqual({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid request.' } });
  });

  it('emits mapped delivery status and survives a throwing subscriber', () => {
    const seen: unknown[] = [];
    adapter.onDeliveryStatus(() => {
      throw new Error('bad subscriber');
    });
    const off = adapter.onDeliveryStatus((s) => seen.push(s));
    const report = (status: string) =>
      adapter.receiveDeliveryReport({
        body: { id: 'm1', status, phoneNumber: '+2348012345678' },
        query: { secret: 's3cret' },
        headers: {},
      });
    expect(report('Success')).toEqual({ ok: true });
    report('Failed');
    report('Sent');
    expect(seen).toEqual([
      { messageId: 'm1', status: 'delivered', phoneNumber: '+2348012345678' },
      { messageId: 'm1', status: 'failed', phoneNumber: '+2348012345678' },
      { messageId: 'm1', status: 'pending', phoneNumber: '+2348012345678' },
    ]);
    off();
    report('Success');
    expect(seen).toHaveLength(3);
  });
});
