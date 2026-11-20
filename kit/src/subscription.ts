import type { Store } from './store/store.js';

export interface UserRecord {
  subscribed: boolean;
}

export const userKey = (phone: string): string => `user:${phone}`;

/**
 * True only when the number has a user record with `subscribed === true`.
 * A number with no record (never messaged, or erased by DELETE) is not subscribed.
 * Read-only. Store errors propagate to the caller.
 */
export async function isSubscribed(store: Store, phoneNumber: string): Promise<boolean> {
  const rec = await store.read<UserRecord>(userKey(phoneNumber));
  return rec !== undefined && rec.subscribed === true;
}
