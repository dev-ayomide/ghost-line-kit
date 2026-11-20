import { describe, expect, it } from 'vitest';
import { MemoryStore, TestClock, type Store } from '@ghostline/kit';
import { ojaConfig } from '../src/app.config.ts';
import { bookKey, pxKey, pxLastKey, SEED_KEY } from '../src/keys.ts';
import { balanceOf, totalOwed, type Ledger } from '../src/ledger.ts';
import type { PriceDay } from '../src/prices.ts';
import { makeEnsureSeeded, seedDemo } from '../src/seed.ts';
import { coreTools } from '../src/tools.ts';
import { lagosDay } from '../src/when.ts';

const T0 = Date.UTC(2026, 10, 19, 10, 0, 0);

/** Counts every write and delete. */
class CountingStore extends MemoryStore {
  changes = 0;
  override async write<T>(key: string, value: T): Promise<void> {
    this.changes += 1;
    return super.write(key, value);
  }
  override async delete(key: string): Promise<void> {
    this.changes += 1;
    return super.delete(key);
  }
}

const allKeys = (day: string): string[] => [
  SEED_KEY,
  bookKey(ojaConfig.demo.phone),
  ...ojaConfig.markets.flatMap((m) =>
    ojaConfig.commodities.flatMap((c) => [pxKey(m.id, c.id, day), pxLastKey(m.id, c.id)]),
  ),
];

async function dump(store: Store, day: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const k of allKeys(day)) out[k] = await store.read(k);
  return out;
}

describe('seedDemo', () => {
  it('seeds once: a second call (even on a later day) changes nothing', async () => {
    const store = new CountingStore();
    const clock = new TestClock(T0);
    await seedDemo(store, clock);
    expect(store.changes).toBe(15 * 2 + 1 + 1);
    const before = await dump(store, lagosDay(T0));
    const n = store.changes;
    clock.advance(86_400_000 * 2);
    await seedDemo(store, clock);
    expect(store.changes).toBe(n);
    expect(await dump(store, lagosDay(T0))).toEqual(before);
  });

  it('is deterministic for a fixed clock', async () => {
    const a = new MemoryStore();
    const b = new MemoryStore();
    await seedDemo(a, new TestClock(T0));
    await seedDemo(b, new TestClock(T0));
    const day = lagosDay(T0);
    expect(await dump(a, day)).toEqual(await dump(b, day));
    const rice = await a.read<PriceDay>(pxKey('mile12', 'rice', day));
    // 82,000 x [0.97, 1.00, 1.03], rounded to N100
    expect(rice?.accepted.map((r) => r.amount)).toEqual([79_500, 82_000, 84_500]);
  });

  it('gives every commodity and market a day with 3 demo reports and a pointer', async () => {
    const store = new MemoryStore();
    await seedDemo(store, new TestClock(T0));
    const day = lagosDay(T0);
    for (const m of ojaConfig.markets) {
      for (const c of ojaConfig.commodities) {
        const d = await store.read<PriceDay>(pxKey(m.id, c.id, day));
        expect(d?.accepted).toHaveLength(3);
        expect(d?.rejected).toEqual([]);
        expect(d?.accepted.every((r) => r.demo === true)).toBe(true);
        expect(await store.read(pxLastKey(m.id, c.id))).toEqual({ v: 1, day });
      }
    }
  });

  it('writes the demo book: N13,700 owed, Bola N4,500, flagged demo', async () => {
    const store = new MemoryStore();
    await seedDemo(store, new TestClock(T0));
    const book = await store.read<Ledger>(bookKey(ojaConfig.demo.phone));
    expect(book?.demo).toBe(true);
    expect(totalOwed(book!)).toBe(13_700);
    expect(balanceOf(book!.debtors['bola']!)).toBe(4_500);
    expect(balanceOf(book!.debtors['mama ife']!)).toBe(1_200);
    expect(balanceOf(book!.debtors['chidi']!)).toBe(8_000);
  });

  it('does not overwrite an existing ledger or day record', async () => {
    const store = new MemoryStore();
    const day = lagosDay(T0);
    const mine = { v: 1, nextN: 1, debtors: {} };
    const dayRec: PriceDay = { v: 1, next: 2, accepted: [{ id: 1, amount: 70_000, at: T0 }], rejected: [] };
    await store.write(bookKey(ojaConfig.demo.phone), mine);
    await store.write(pxKey('mile12', 'rice', day), dayRec);
    await seedDemo(store, new TestClock(T0));
    expect(await store.read(bookKey(ojaConfig.demo.phone))).toEqual(mine);
    expect(await store.read(pxKey('mile12', 'rice', day))).toEqual(dayRec);
  });
});

describe('makeEnsureSeeded', () => {
  it('writes nothing when demo is false', async () => {
    const store = new CountingStore();
    const ensure = makeEnsureSeeded(store, new TestClock(T0), false);
    await ensure();
    await ensure();
    expect(store.changes).toBe(0);
  });

  it('seeds once when called many times at the same time', async () => {
    const store = new CountingStore();
    const ensure = makeEnsureSeeded(store, new TestClock(T0), true);
    await Promise.all([ensure(), ensure(), ensure()]);
    await ensure();
    expect(store.changes).toBe(15 * 2 + 1 + 1);
  });

  it('a price call on the seeded store answers with the Demo label', async () => {
    const store = new MemoryStore();
    const clock = new TestClock(T0);
    const tools = coreTools({ store, clock, demo: true, ensureSeeded: makeEnsureSeeded(store, clock, true) });
    const price = tools.find((t) => t.name === 'price')!;
    const input = { phoneNumber: '+2348012345678', channel: 'sms', text: 'price rice mile12' };
    await price.execute(input); // first reply carries the demo notice
    const reply = String(await price.execute(input));
    expect(reply).toContain('Demo');
    expect(reply).toContain('N82,000');
  });
});
