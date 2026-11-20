import { describe, expect, it } from 'vitest';
import { TestClock, type Store } from '@ghostline/kit';
import { eraseUserData } from '../src/erase.ts';
import { flowKey, pxKey, remKey, repKey, REM_INDEX_KEY, langKey, bookKey, type RepRecord } from '../src/keys.ts';
import { displayStats, average, type PriceDay } from '../src/prices.ts';
import { coreTools } from '../src/tools.ts';
import { lagosDay } from '../src/when.ts';

const T0 = Date.UTC(2026, 10, 19, 10, 0, 0);
const ME = '+2348011112222';
const OTHER = '+2348033334444';

/** A Map-backed store that can list its keys and snapshot its content. */
class SpyStore implements Store {
  private readonly data = new Map<string, string>();
  async read<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async write<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  keys(): string[] {
    return [...this.data.keys()].sort();
  }
  snapshot(): string {
    return JSON.stringify([...this.data.entries()].sort());
  }
}

function world() {
  const store = new SpyStore();
  const clock = new TestClock(T0);
  const tools = coreTools({ store, clock, demo: false });
  const call = async (name: string, phone: string, text: string): Promise<string> =>
    String(await tools.find((t) => t.name === name)!.execute({ phoneNumber: phone, channel: 'sms', text }));
  return { store, clock, call };
}

const DAY_KEY = pxKey('mile12', 'rice', lagosDay(T0));

describe('eraseUserData', () => {
  it('removes everything of one Trader and nothing of another', async () => {
    const { store, call } = world();
    // My data: language, ledger, reminder (with index entry), and two reports on one day.
    await call('ledger', ME, 'Bola owes 4500');
    await call('remind', ME, 'remind Bola friday');
    await store.write(flowKey(ME), { v: 1, flow: 'price', path: ['1'], data: {}, exp: T0 + 1000 });
    expect(await call('report_price', ME, 'report rice mile12 82000')).toContain('Thanks');
    // Another Trader reports on the same day, and has a book and a reminder.
    await call('report_price', OTHER, 'report rice mile12 80000');
    await call('ledger', OTHER, 'Chidi owes 900');
    await call('remind', OTHER, 'remind Chidi friday');
    // My second report is far outside the range: rejected, while my first stays accepted.
    expect(await call('report_price', ME, 'report rice mile12 1000')).toContain('Not added');

    const dayBefore = (await store.read<PriceDay>(DAY_KEY))!;
    expect(dayBefore.accepted.map((r) => r.amount)).toEqual([82_000, 80_000]);
    expect(dayBefore.rejected.map((r) => r.amount)).toEqual([1_000]);
    const otherRepBefore = await store.read<RepRecord>(repKey(OTHER));
    const otherBookBefore = await store.read(bookKey(OTHER));

    await eraseUserData(store, ME);

    expect(store.keys().filter((k) => k.includes(ME))).toEqual([]);
    expect(await store.read(REM_INDEX_KEY)).toEqual([OTHER]);

    const day = (await store.read<PriceDay>(DAY_KEY))!;
    expect(day.accepted.map((r) => r.amount)).toEqual([80_000]); // the other Trader's report only
    expect(day.rejected).toEqual([]); // the rejected amount is gone
    expect(JSON.stringify(day)).not.toContain('1000');
    expect(displayStats(day)?.amount).toBe(average([80_000]));
    // The other Trader's records are unchanged.
    expect(await store.read<RepRecord>(repKey(OTHER))).toEqual(otherRepBefore);
    expect(await store.read(bookKey(OTHER))).toEqual(otherBookBefore);
    expect(await store.read(langKey(OTHER))).toBeDefined();
    expect(await store.read(remKey(OTHER))).toBeDefined();

    // Idempotent.
    const snap = store.snapshot();
    await eraseUserData(store, ME);
    expect(store.snapshot()).toBe(snap);
  });

  it('deletes a day record when its last report is erased, and the index when it empties', async () => {
    const { store, call } = world();
    await call('ledger', ME, 'Bola owes 4500');
    await call('remind', ME, 'remind Bola friday');
    await call('report_price', ME, 'report rice mile12 82000');
    await eraseUserData(store, ME);
    expect(await store.read(DAY_KEY)).toBeUndefined();
    expect(await store.read(REM_INDEX_KEY)).toBeUndefined();
    expect(store.keys().filter((k) => k.includes(ME))).toEqual([]);
  });

  it('tolerates missing and corrupt records', async () => {
    const store = new SpyStore();
    await eraseUserData(store, ME); // nothing there
    await store.write(repKey(ME), { v: 1, today: { day: 'x', count: 1 }, reports: [null, { key: 5 }, { key: DAY_KEY, id: 1 }, { key: 'user:other', id: 1 }] });
    await store.write(DAY_KEY, 'garbage');
    await store.write('user:other', { subscribed: true });
    await store.write(REM_INDEX_KEY, 'not a list');
    await eraseUserData(store, ME);
    expect(store.keys().filter((k) => k.includes(ME))).toEqual([]);
    expect(await store.read('user:other')).toEqual({ subscribed: true }); // not under oja:px:, never touched
    expect(await store.read(DAY_KEY)).toBe('garbage');
  });
});

describe('report_price index (Requirement 9.4 fix)', () => {
  it('keeps every id of the Trader for a day, including a rejected one next to an accepted one', async () => {
    const { store, call } = world();
    await call('report_price', ME, 'report rice mile12 82000'); // id 1, accepted
    await call('report_price', ME, 'report rice mile12 1000'); // id 2, rejected, id 1 kept
    const rep = (await store.read<RepRecord>(repKey(ME)))!;
    expect(rep.reports.map((e) => e.id).sort()).toEqual([1, 2]);

    await call('report_price', ME, 'report rice mile12 84000'); // replaces id 1; id 2 stays tracked
    const day = (await store.read<PriceDay>(DAY_KEY))!;
    expect(day.accepted.map((r) => r.id)).toEqual([3]);
    expect(day.rejected.map((r) => r.id)).toEqual([2]);
    const rep2 = (await store.read<RepRecord>(repKey(ME)))!;
    expect(rep2.reports.map((e) => e.id).sort()).toEqual([2, 3]);
  });

  it('a rejected report replaces the Trader\'s earlier rejected report when none is accepted', async () => {
    const { store, call } = world();
    await call('report_price', ME, 'report rice mile12 1000'); // id 1, rejected
    await call('report_price', ME, 'report rice mile12 900'); // id 2, rejected, replaces id 1
    const day = (await store.read<PriceDay>(DAY_KEY))!;
    expect(day.accepted).toEqual([]);
    expect(day.rejected.map((r) => r.id)).toEqual([2]);
    const rep = (await store.read<RepRecord>(repKey(ME)))!;
    expect(rep.reports.map((e) => e.id)).toEqual([2]);
  });
});
