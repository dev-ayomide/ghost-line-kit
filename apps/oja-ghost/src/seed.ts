// Demo data: sample price reports for every commodity and market, and one demo debt book.
// Deterministic (no randomness) and idempotent. All values are illustrative, not from a survey.
// Whether to seed at all (the demo flag) is decided by the caller; see makeEnsureSeeded.
import type { Clock, Store } from '@ghostline/kit';
import { ojaConfig } from './app.config.ts';
import {
  bookKey,
  pxKey,
  pxLastKey,
  SEED_KEY,
  type PxLastRecord,
  type SeedRecord,
} from './keys.ts';
import { applyLedger, emptyLedger, type Ledger } from './ledger.ts';
import { refPrice, type PriceDay, type Rep } from './prices.ts';
import { lagosDay } from './when.ts';

/** Sample reports sit this far around the reference price. */
const SAMPLE_FACTORS = [0.97, 1.0, 1.03] as const;

const round100 = (n: number): number => Math.round(n / 100) * 100;

export async function seedDemo(store: Store, clock: Clock): Promise<void> {
  if ((await store.read<SeedRecord>(SEED_KEY)) !== undefined) return;
  const now = clock.now();
  const day = lagosDay(now);

  for (const market of ojaConfig.markets) {
    for (const commodity of ojaConfig.commodities) {
      const key = pxKey(market.id, commodity.id, day);
      // Never overwrite a day record that already exists.
      if ((await store.read<PriceDay>(key)) !== undefined) continue;
      const ref = refPrice(market.id, commodity.id) ?? commodity.basePrice;
      const accepted: Rep[] = SAMPLE_FACTORS.map((f, i) => ({
        id: i + 1,
        amount: round100(ref * f),
        at: now,
        demo: true as const,
      }));
      const record: PriceDay = { v: 1, next: accepted.length + 1, accepted, rejected: [] };
      await store.write(key, record);
      const ptr: PxLastRecord = { v: 1, day };
      await store.write(pxLastKey(market.id, commodity.id), ptr);
    }
  }

  // Never overwrite an existing ledger.
  if ((await store.read<Ledger>(bookKey(ojaConfig.demo.phone))) === undefined) {
    let ledger = emptyLedger(true);
    for (const debtor of ojaConfig.demo.book) {
      for (const e of debtor.entries) {
        const res = applyLedger(ledger, { kind: e.type, name: debtor.name, amount: e.amount, at: now }, ojaConfig.limits);
        if (!res.ok) throw new Error(`Demo ledger invalid: ${res.reason}`);
        ledger = res.ledger;
      }
    }
    await store.write(bookKey(ojaConfig.demo.phone), ledger);
  }

  // Written last, so a failure in the middle is retried on the next call.
  const marker: SeedRecord = { v: 1, day };
  await store.write(SEED_KEY, marker);
}

/**
 * Returns a function that seeds once. All callers share one promise. When `demo` is false
 * it does nothing. A failed seed is retried on the next call.
 */
export function makeEnsureSeeded(store: Store, clock: Clock, demo: boolean): () => Promise<void> {
  if (!demo) return async () => {};
  let pending: Promise<void> | undefined;
  return () => {
    if (!pending) {
      pending = seedDemo(store, clock).catch((err: unknown) => {
        pending = undefined;
        throw err;
      });
    }
    return pending;
  };
}
