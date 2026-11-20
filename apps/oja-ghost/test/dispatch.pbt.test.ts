// P8 and the dispatcher behaviours of Requirement 7.8 to 7.13.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  RateLimiter,
  TestClock,
  type ChannelAdapter,
  type OutboundMessage,
  type SafeLogger,
  type SendResult,
} from '@ghostline/kit';
import { ojaConfig } from '../src/app.config.ts';
import { dispatchDueReminders, type DispatchDeps } from '../src/dispatch.ts';
import { bookKey, langKey, remKey, REM_INDEX_KEY } from '../src/keys.ts';
import { applyLedger, emptyLedger, type Ledger } from '../src/ledger.ts';
import type { Reminder } from '../src/reminders.ts';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 100);
const T0 = Date.UTC(2026, 10, 19, 10, 0, 0);
const HOUR = 3_600_000;
const GENEROUS = { windowMs: 60_000, maxInbound: 1_000_000, maxOutbound: 1_000_000 };

/** A recording ChannelAdapter. `outcome(callNumber)` decides each send; default is ok. */
class FakeSms implements ChannelAdapter {
  readonly channel = 'sms' as const;
  readonly sent: OutboundMessage[] = [];
  calls = 0;
  constructor(private readonly outcome: (call: number) => SendResult | 'throw' = () => ({ ok: true })) {}
  async send(message: OutboundMessage): Promise<SendResult> {
    this.calls += 1;
    const o = this.outcome(this.calls);
    if (o === 'throw') throw new Error('network down');
    if (o.ok) this.sent.push(message);
    return o;
  }
  parseWebhook(): never {
    throw new Error('not used');
  }
  receiveDeliveryReport(): never {
    throw new Error('not used');
  }
  onDeliveryStatus(): () => void {
    return () => {};
  }
}

class FakeLogger implements SafeLogger {
  readonly lines: string[] = [];
  info(e: object): void {
    this.lines.push(JSON.stringify(e));
  }
  error(e: object): void {
    this.lines.push(JSON.stringify(e));
  }
}

function setup(sms: FakeSms, limits = GENEROUS) {
  const store = new MemoryStore();
  const clock = new TestClock(T0);
  const logger = new FakeLogger();
  const deps: DispatchDeps = {
    store,
    sms,
    clock,
    logger,
    rateLimiter: new RateLimiter({ store, clock, limits }),
  };
  return { store, clock, logger, deps };
}

type Env = ReturnType<typeof setup>;

// The `user:<phone>` key is kit-internal. A test may write it to simulate a prior message.
const subscribe = (env: Env, phone: string, subscribed: boolean) =>
  env.store.write(`user:${phone}`, { subscribed });

async function writeBook(env: Env, phone: string, owed: Record<string, number>, paid: Record<string, number> = {}) {
  let ledger: Ledger = emptyLedger();
  for (const [name, amount] of Object.entries(owed)) {
    const r = applyLedger(ledger, { kind: 'owe', name, amount, at: T0 - 5 * HOUR }, ojaConfig.limits);
    if (!r.ok) throw new Error('setup');
    ledger = r.ledger;
  }
  for (const [name, amount] of Object.entries(paid)) {
    const r = applyLedger(ledger, { kind: 'paid', name, amount, at: T0 - 4 * HOUR }, ojaConfig.limits);
    if (!r.ok) throw new Error('setup');
    ledger = r.ledger;
  }
  await env.store.write(bookKey(phone), ledger);
}

const rem = (over: Partial<Reminder> & { id: number }): Reminder => ({
  kind: 'supplier',
  name: 'Mama Ngozi',
  amount: 50_000,
  dueAt: T0 - HOUR,
  status: 'pending',
  attempts: 0,
  createdAt: T0 - 24 * HOUR,
  ...over,
});

async function writeRems(env: Env, phone: string, list: Reminder[]) {
  await env.store.write(remKey(phone), list);
  const idx = (await env.store.read<string[]>(REM_INDEX_KEY)) ?? [];
  if (!idx.includes(phone)) await env.store.write(REM_INDEX_KEY, [...idx, phone]);
}

const readRems = async (env: Env, phone: string): Promise<Reminder[]> =>
  (await env.store.read<Reminder[]>(remKey(phone))) ?? [];

const PHONES = ['+2348010000001', '+2348010000002', '+2348010000003'] as const;

const genReminder = (id: number): fc.Arbitrary<Reminder> =>
  fc
    .record({
      kind: fc.constantFrom('debt', 'supplier'),
      name: fc.constantFrom('Bola', 'Chidi'),
      amount: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: undefined }),
      offsetH: fc.integer({ min: -48, max: 48 }),
    })
    .map(({ kind, name, amount, offsetH }) =>
      rem({ id, kind, name, amount: kind === 'supplier' ? amount : undefined, dueAt: T0 + offsetH * HOUR }),
    );

const genWorld = fc.record({
  phones: fc.array(
    fc.record({
      subscribed: fc.constantFrom(true, false, undefined), // undefined: no user record at all
      pcm: fc.boolean(),
      reminders: fc
        .integer({ min: 1, max: 6 })
        .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => genReminder(i + 1)))),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

describe('P8: the dispatcher sends each reminder at most once', () => {
  it('two runs at the same time give the same send count, and only due reminders of subscribed Traders are sent', async () => {
    await fc.assert(
      fc.asyncProperty(genWorld, async (world) => {
        const sms = new FakeSms();
        const env = setup(sms);
        let expected = 0;
        for (const [i, p] of world.phones.entries()) {
          const phone = PHONES[i]!;
          if (p.subscribed !== undefined) await subscribe(env, phone, p.subscribed);
          if (p.pcm) await env.store.write(langKey(phone), { v: 1, lang: 'pcm' });
          await writeBook(env, phone, { Bola: 5_000, Chidi: 7_000 });
          await writeRems(env, phone, p.reminders);
          if (p.subscribed === true) expected += p.reminders.filter((r) => r.dueAt <= T0).length;
        }
        const run1 = await dispatchDueReminders(env.deps);
        const afterRun1 = sms.sent.length;
        const run2 = await dispatchDueReminders(env.deps);
        expect(sms.sent.length).toBe(afterRun1);
        expect(run2.sent).toBe(0);
        expect(run1.sent).toBe(expected);
        expect(afterRun1).toBe(expected); // every reminder here fits one segment
        const subscribedPhones = new Set<string>(world.phones.flatMap((p, i) => (p.subscribed === true ? [PHONES[i]!] : [])));
        for (const m of sms.sent) expect(subscribedPhones.has(m.to)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('dispatcher: retries', () => {
  it('a send that fails twice then succeeds ends sent after 3 runs, with attempts counted', async () => {
    const sms = new FakeSms((call) => (call <= 2 ? { ok: false, error: 'boom' } : { ok: true, messageId: 'm1' }));
    const env = setup(sms);
    await subscribe(env, PHONES[0], true);
    await writeRems(env, PHONES[0], [rem({ id: 1 })]);

    await dispatchDueReminders(env.deps);
    expect((await readRems(env, PHONES[0]))[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await dispatchDueReminders(env.deps);
    expect((await readRems(env, PHONES[0]))[0]).toMatchObject({ status: 'pending', attempts: 2 });
    const run3 = await dispatchDueReminders(env.deps);
    expect(run3.sent).toBe(1);
    expect((await readRems(env, PHONES[0]))[0]).toMatchObject({ status: 'sent', attempts: 2 });
    expect(sms.calls).toBe(3);
    expect(await env.store.read(REM_INDEX_KEY)).toEqual([]);
  });

  it('a send that always fails ends failed after 3 runs and is not tried again', async () => {
    const sms = new FakeSms(() => ({ ok: false, error: 'boom' }));
    const env = setup(sms);
    await subscribe(env, PHONES[0], true);
    await writeRems(env, PHONES[0], [rem({ id: 1 })]);

    await dispatchDueReminders(env.deps);
    await dispatchDueReminders(env.deps);
    const run3 = await dispatchDueReminders(env.deps);
    expect(run3.failed).toBe(1);
    expect((await readRems(env, PHONES[0]))[0]).toMatchObject({ status: 'failed', attempts: 3 });
    const calls = sms.calls;
    await dispatchDueReminders(env.deps);
    expect(sms.calls).toBe(calls);
  });

  it('a send that throws counts as a failed attempt and does not stop the next phone', async () => {
    const sms = new FakeSms((call) => (call === 1 ? 'throw' : { ok: true }));
    const env = setup(sms);
    for (const p of [PHONES[0], PHONES[1]]) {
      await subscribe(env, p, true);
      await writeRems(env, p, [rem({ id: 1 })]);
    }
    const run = await dispatchDueReminders(env.deps);
    expect(run.sent).toBe(1);
    expect((await readRems(env, PHONES[0]))[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await readRems(env, PHONES[1]))[0]).toMatchObject({ status: 'sent' });
  });

  it('a store failure for one phone is logged and the next phone still gets its reminder', async () => {
    const sms = new FakeSms();
    const env = setup(sms);
    for (const p of [PHONES[0], PHONES[1]]) {
      await subscribe(env, p, true);
      await writeRems(env, p, [rem({ id: 1 })]);
    }
    const realRead = env.store.read.bind(env.store);
    // Reading the first phone's reminders fails once the run starts.
    (env.store as { read: unknown }).read = async (key: string) => {
      if (key === remKey(PHONES[0])) throw new Error('store down');
      return realRead(key);
    };
    const run = await dispatchDueReminders(env.deps);
    expect(run.sent).toBe(1);
    expect(sms.sent.map((m) => m.to)).toEqual([PHONES[1]]);
    expect(env.logger.lines.some((l) => l.includes('DISPATCH_PHONE_FAILED'))).toBe(true);
  });
});

describe('dispatcher: STOP, balance and rate limit', () => {
  it('a phone with no user record, or with subscribed:false, receives nothing and is skipped', async () => {
    const sms = new FakeSms();
    const env = setup(sms);
    await subscribe(env, PHONES[1], false); // PHONES[0] has no record at all
    for (const p of [PHONES[0], PHONES[1]]) await writeRems(env, p, [rem({ id: 1 }), rem({ id: 2 })]);
    const run = await dispatchDueReminders(env.deps);
    expect(sms.calls).toBe(0);
    expect(run).toEqual({ sent: 0, skipped: 4, failed: 0, deferred: 0 });
    for (const p of [PHONES[0], PHONES[1]]) {
      expect((await readRems(env, p)).map((r) => r.status)).toEqual(['skipped', 'skipped']);
    }
  });

  it('a debt reminder whose balance is 0 is skipped, a missing debtor is skipped, an owed one is sent', async () => {
    const sms = new FakeSms();
    const env = setup(sms);
    await subscribe(env, PHONES[0], true);
    await writeBook(env, PHONES[0], { Bola: 1_000, Chidi: 2_500 }, { Bola: 1_000 });
    await writeRems(env, PHONES[0], [
      rem({ id: 1, kind: 'debt', name: 'Bola', amount: undefined }),
      rem({ id: 2, kind: 'debt', name: 'Nobody', amount: undefined }),
      rem({ id: 3, kind: 'debt', name: 'chidi', amount: undefined }),
    ]);
    const run = await dispatchDueReminders(env.deps);
    expect(run).toEqual({ sent: 1, skipped: 2, failed: 0, deferred: 0 });
    expect((await readRems(env, PHONES[0])).map((r) => r.status)).toEqual(['skipped', 'skipped', 'sent']);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.text).toContain('N2,500');
  });

  it('when the outbound limit is reached the reminder stays pending, and is sent after the window passes', async () => {
    const sms = new FakeSms();
    const env = setup(sms, { windowMs: 60_000, maxInbound: 10, maxOutbound: 1 });
    await subscribe(env, PHONES[0], true);
    await subscribe(env, PHONES[1], true);
    await writeRems(env, PHONES[0], [rem({ id: 1 }), rem({ id: 2, dueAt: T0 - 30 * 60_000 })]);
    await writeRems(env, PHONES[1], [rem({ id: 1 })]);

    const run1 = await dispatchDueReminders(env.deps);
    expect(run1).toEqual({ sent: 2, skipped: 0, failed: 0, deferred: 1 });
    const list = await readRems(env, PHONES[0]);
    expect(list.map((r) => [r.id, r.status])).toEqual([[1, 'sent'], [2, 'pending']]);
    expect(await env.store.read(REM_INDEX_KEY)).toEqual([PHONES[0]]);

    env.clock.advance(60_000);
    const run2 = await dispatchDueReminders(env.deps);
    expect(run2.sent).toBe(1);
    expect((await readRems(env, PHONES[0])).map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(await env.store.read(REM_INDEX_KEY)).toEqual([]);
  });
});

describe('dispatcher: text, language and logging', () => {
  it('uses the Trader language, ends with the next step, and fits 2 segments', async () => {
    const sms = new FakeSms();
    const env = setup(sms);
    await subscribe(env, PHONES[0], true);
    await subscribe(env, PHONES[1], true);
    await env.store.write(langKey(PHONES[1]), { v: 1, lang: 'pcm' });
    for (const p of [PHONES[0], PHONES[1]]) {
      await writeRems(env, p, [rem({ id: 1, name: 'Abcdefghijklmnopqrst', amount: 100_000_000 })]);
    }
    await dispatchDueReminders(env.deps);
    const en = sms.sent.filter((m) => m.to === PHONES[0]);
    const pcm = sms.sent.filter((m) => m.to === PHONES[1]);
    expect(en.length).toBeGreaterThan(0);
    expect(en.length).toBeLessThanOrEqual(2);
    expect(en.at(-1)?.text.endsWith(ojaConfig.copy.en.reminderNextStep)).toBe(true);
    expect(pcm.at(-1)?.text.endsWith(ojaConfig.copy.pcm.reminderNextStep)).toBe(true);
    expect(pcm.length).toBeLessThanOrEqual(2);
  });

  it('logs no text, name, amount or full phone number', async () => {
    const sms = new FakeSms((c) => (c === 1 ? { ok: false, error: 'secret-internal' } : { ok: true, messageId: 'id-1' }));
    const env = setup(sms);
    await subscribe(env, PHONES[0], true);
    await writeRems(env, PHONES[0], [rem({ id: 1, name: 'Mama Ngozi', amount: 54_321 })]);
    await dispatchDueReminders(env.deps);
    await dispatchDueReminders(env.deps);
    const all = env.logger.lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const bad of ['Ngozi', '54,321', '54321', 'secret-internal', 'Reminder']) expect(all).not.toContain(bad);
    // The fake logger records what the dispatcher hands the kit logger; masking is the kit's job.
    // The dispatcher passes the phone only in the phoneNumber field.
    for (const line of env.logger.lines) {
      const o = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(o).every((k) => ['event', 'error', 'phoneNumber', 'messageId', 'messageLength'].includes(k))).toBe(true);
    }
  });
});
