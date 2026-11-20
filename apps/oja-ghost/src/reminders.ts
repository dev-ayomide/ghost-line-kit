// Reminder list helpers. Pure: no input is mutated, time is a parameter.

export type ReminderKind = 'debt' | 'supplier';
export type ReminderStatus = 'pending' | 'sent' | 'skipped' | 'failed' | 'cancelled';

export interface Reminder {
  id: number;
  kind: ReminderKind;
  name: string;
  amount?: number | undefined;
  /** Epoch ms. */
  dueAt: number;
  status: ReminderStatus;
  attempts: number;
  createdAt: number;
}

export interface NewReminder {
  kind: ReminderKind;
  name: string;
  amount?: number | undefined;
  dueAt: number;
}

const DAY_MS = 86_400_000;
/** Reminders in a final state are dropped after this long. */
export const PRUNE_AFTER_MS = 30 * DAY_MS;

const byDueThenId = (a: Reminder, b: Reminder): number => a.dueAt - b.dueAt || a.id - b.id;

/** Pending reminders, oldest due first. Numbering for "cancel N". */
export function activeList(list: readonly Reminder[]): Reminder[] {
  return list.filter((r) => r.status === 'pending').sort(byDueThenId);
}

/** Pending reminders that are due at `now`, oldest first. */
export function dueReminders(list: readonly Reminder[], now: number): Reminder[] {
  return list.filter((r) => r.status === 'pending' && r.dueAt <= now).sort(byDueThenId);
}

/** Adds a pending reminder. Fails when `max` reminders are already pending. */
export function createReminder(
  list: readonly Reminder[],
  r: NewReminder,
  now: number,
  max: number,
): { ok: true; list: Reminder[]; reminder: Reminder } | { ok: false; reason: 'too_many' } {
  if (list.filter((x) => x.status === 'pending').length >= max) return { ok: false, reason: 'too_many' };
  const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const reminder: Reminder = {
    id,
    kind: r.kind,
    name: r.name,
    ...(r.amount !== undefined ? { amount: r.amount } : {}),
    dueAt: r.dueAt,
    status: 'pending',
    attempts: 0,
    createdAt: now,
  };
  return { ok: true, list: [...list, reminder], reminder };
}

/** Cancels the n-th reminder (1-based) of `activeList`. */
export function cancelNth(list: readonly Reminder[], n: number): { ok: true; list: Reminder[] } | { ok: false } {
  const target = Number.isInteger(n) && n >= 1 ? activeList(list)[n - 1] : undefined;
  if (!target) return { ok: false };
  const idx = list.indexOf(target);
  return { ok: true, list: list.map((r, i) => (i === idx ? { ...r, status: 'cancelled' as const } : r)) };
}

/** Drops reminders in a final state whose due time is more than 30 days before `now`. */
export function prune(list: readonly Reminder[], now: number): Reminder[] {
  return list.filter((r) => r.status === 'pending' || r.dueAt >= now - PRUNE_AFTER_MS);
}
