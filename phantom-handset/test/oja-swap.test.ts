import { MemoryStore, type Clock } from '@ghostline/kit';
import { createOjaGhost } from '@ghostline/oja-ghost';
import { describe, expect, it } from 'vitest';
import type { HandsetApp } from '../server/apps.ts';
import { createHandler } from '../server/handler.ts';
import { createDeps } from '../server/wire.ts';

// Compile-time check: the real app must be assignable to HandsetApp (typecheck covers this file).
const _assignable: HandsetApp = createOjaGhost();
void _assignable;

// Not the handset's demo number: that one has a seeded demo book, which would change the balance.
const FROM = '+2340000001234';
let n = 0;

function setup(): { send: (text: string, channel: 'web' | 'ussd') => Promise<string>; store: MemoryStore; clockCalls: () => number } {
  const store = new MemoryStore();
  let calls = 0;
  const clock: Clock = {
    now: () => {
      calls += 1;
      return Date.now();
    },
  };
  const handler = createHandler(createDeps({ HANDSET_TRACE: 'off' }, { store, clock }));
  const send = async (text: string, channel: 'web' | 'ussd'): Promise<string> => {
    const res = await handler({
      method: 'POST',
      path: '/api/web/oja-ghost',
      query: {},
      headers: {},
      body: { from: FROM, text, channel, sessionId: `s-${++n}` },
    });
    expect(res.status).toBe(200);
    return (res.body as { messages: { text: string }[] }).messages.map((m) => m.text).join('\n');
  };
  return { send, store, clockCalls: () => calls };
}

describe('oja-ghost in the handset', () => {
  it('walks USSD prices, then SMS debt book', async () => {
    const { send } = setup();
    const replies: string[] = [];
    for (const t of ['MENU', '1', '1', '1']) replies.push(await send(t, 'ussd'));
    expect(replies[3]).toContain('Demo');
    await send('Bola owes 4500', sms);
    await send('Bola paid 2000', sms);
    expect(await send('book', sms)).toContain('N2,500');
  });

  it('shares one store and clock between the handler and the app', async () => {
    const { send, store, clockCalls } = setup();
    expect(await store.read(`oja:book:${FROM}`)).toBeUndefined();
    const before = clockCalls();
    await send('Bola owes 4500', sms);
    // The app wrote through the store that the handler's processor also uses.
    expect(await store.read(`oja:book:${FROM}`)).toBeDefined();
    expect(clockCalls()).toBeGreaterThan(before);
  });
});
const sms = 'web' as const;
