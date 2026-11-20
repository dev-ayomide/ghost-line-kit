// DELETE sweep: removes everything the app holds about one Trader. Safe to call twice.
// The kit calls this after it deletes its own keys. A missing or corrupt record is tolerated.
import type { Store } from '@ghostline/kit';
import { bookKey, flowKey, langKey, remKey, repKey, REM_INDEX_KEY, type RepRecord } from './keys.ts';
import type { PriceDay } from './prices.ts';

const PX_PREFIX = 'oja:px:';

async function removeReports(store: Store, ids: Map<string, Set<number>>): Promise<void> {
  for (const [key, drop] of ids) {
    const day = await store.read<PriceDay>(key);
    if (day === undefined || day === null || typeof day !== 'object') continue;
    if (!Array.isArray(day.accepted) || !Array.isArray(day.rejected)) continue;
    const accepted = day.accepted.filter((r) => !drop.has(r?.id));
    const rejected = day.rejected.filter((r) => !drop.has(r?.id));
    if (accepted.length === day.accepted.length && rejected.length === day.rejected.length) continue;
    if (accepted.length === 0 && rejected.length === 0) await store.delete(key);
    else await store.write(key, { ...day, accepted, rejected });
  }
}

export async function eraseUserData(store: Store, phone: string): Promise<void> {
  // 1. The Trader's reports, found through the reporter index.
  const rep = await store.read<RepRecord>(repKey(phone));
  const ids = new Map<string, Set<number>>();
  if (rep && typeof rep === 'object' && Array.isArray(rep.reports)) {
    for (const e of rep.reports) {
      if (!e || typeof e.key !== 'string' || !e.key.startsWith(PX_PREFIX) || typeof e.id !== 'number') continue;
      const set = ids.get(e.key) ?? new Set<number>();
      set.add(e.id);
      ids.set(e.key, set);
    }
  }
  await removeReports(store, ids);

  // 2. The Trader's own records and the reminder index entry. The reporter index goes last,
  //    so a failure above can be retried and still finds the reports.
  for (const key of [langKey(phone), bookKey(phone), flowKey(phone), remKey(phone)]) await store.delete(key);

  const index = await store.read<unknown>(REM_INDEX_KEY);
  if (Array.isArray(index) && index.includes(phone)) {
    const rest = index.filter((p) => p !== phone);
    if (rest.length === 0) await store.delete(REM_INDEX_KEY);
    else await store.write(REM_INDEX_KEY, rest);
  }

  await store.delete(repKey(phone));
}
