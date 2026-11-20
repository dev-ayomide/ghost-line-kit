// Pure debt-book maths. Balances are never stored: they are computed from entries.
// Nothing here mutates its inputs.
import { normaliseName, validName } from './names.ts';

export type EntryType = 'owe' | 'paid' | 'overpaid';
/** amount is an integer >= 1. n is the running entry number across the whole ledger. */
export interface Entry {
  n: number;
  type: EntryType;
  amount: number;
  at: number;
}
/** Never has an empty entries list. */
export interface Debtor {
  display: string;
  entries: Entry[];
}
/** debtors is keyed by normaliseName(name). */
export interface Ledger {
  v: 1;
  nextN: number;
  debtors: Record<string, Debtor>;
  demo?: true;
}

export type LedgerCmd =
  | { kind: 'owe' | 'paid' | 'overpaid'; name: string; amount: number; at: number }
  | { kind: 'undo' };

export type LedgerResult =
  | { ok: true; ledger: Ledger; debtor?: string; balance?: number }
  | {
      ok: false;
      reason:
        | 'invalid_name'
        | 'invalid_amount'
        | 'unknown_debtor'
        | 'too_many_debtors'
        | 'too_many_entries'
        | 'nothing_to_undo';
    }
  | { ok: false; reason: 'exceeds_balance'; balance: number };

export interface LedgerLimits {
  maxAmount: number;
  maxDebtors: number;
  maxEntriesPerDebtor: number;
}

export function emptyLedger(demo?: true): Ledger {
  return demo ? { v: 1, nextN: 1, debtors: {}, demo } : { v: 1, nextN: 1, debtors: {} };
}

/** sum(owe) - sum(paid) - sum(overpaid) */
export function balanceOf(d: Debtor): number {
  let b = 0;
  for (const e of d.entries) b += e.type === 'owe' ? e.amount : -e.amount;
  return b;
}

/** Sum of balanceOf over all debtors. */
export function netBalance(l: Ledger): number {
  let s = 0;
  for (const d of Object.values(l.debtors)) s += balanceOf(d);
  return s;
}

/** Sum of balanceOf over debtors whose balance is above zero. */
export function totalOwed(l: Ledger): number {
  let s = 0;
  for (const d of Object.values(l.debtors)) {
    const b = balanceOf(d);
    if (b > 0) s += b;
  }
  return s;
}

function withDebtors(l: Ledger, nextN: number, debtors: Record<string, Debtor>): Ledger {
  // Spread keeps the demo flag (and any other field) of the input.
  return { ...l, nextN, debtors };
}

export function applyLedger(l: Ledger, cmd: LedgerCmd, limits: LedgerLimits): LedgerResult {
  if (cmd.kind === 'undo') return undo(l);

  if (!validName(cmd.name)) return { ok: false, reason: 'invalid_name' };
  if (!Number.isInteger(cmd.amount) || cmd.amount < 1 || cmd.amount > limits.maxAmount) {
    return { ok: false, reason: 'invalid_amount' };
  }
  const key = normaliseName(cmd.name);
  const existing = Object.hasOwn(l.debtors, key) ? l.debtors[key] : undefined;

  if (cmd.kind === 'owe') {
    if (!existing && Object.keys(l.debtors).length >= limits.maxDebtors) {
      return { ok: false, reason: 'too_many_debtors' };
    }
  } else if (!existing) {
    return { ok: false, reason: 'unknown_debtor' };
  }
  // Every appended entry counts against the per-debtor cap, so a book cannot grow without bound.
  if (existing && existing.entries.length >= limits.maxEntriesPerDebtor) {
    return { ok: false, reason: 'too_many_entries' };
  }
  if (cmd.kind === 'paid' && existing) {
    const balance = balanceOf(existing);
    if (cmd.amount > balance) return { ok: false, reason: 'exceeds_balance', balance };
  }

  const entry: Entry = { n: l.nextN, type: cmd.kind, amount: cmd.amount, at: cmd.at };
  const debtor: Debtor = existing
    ? { display: existing.display, entries: [...existing.entries, entry] }
    : { display: cmd.name.trim(), entries: [entry] };
  const ledger = withDebtors(l, l.nextN + 1, { ...l.debtors, [key]: debtor });
  return { ok: true, ledger, debtor: debtor.display, balance: balanceOf(debtor) };
}

function undo(l: Ledger): LedgerResult {
  let topKey: string | undefined;
  let topN = -Infinity;
  for (const [key, d] of Object.entries(l.debtors)) {
    const last = d.entries[d.entries.length - 1];
    if (last && last.n > topN) {
      topN = last.n;
      topKey = key;
    }
  }
  if (topKey === undefined) return { ok: false, reason: 'nothing_to_undo' };
  const target = l.debtors[topKey];
  if (!target) return { ok: false, reason: 'nothing_to_undo' };

  const remaining = target.entries.filter((e) => e.n !== topN);
  const debtors: Record<string, Debtor> = {};
  for (const [key, d] of Object.entries(l.debtors)) {
    if (key !== topKey) debtors[key] = d;
    else if (remaining.length > 0) debtors[key] = { display: d.display, entries: remaining };
  }
  const ledger = withDebtors(l, l.nextN - 1, debtors);
  const left = debtors[topKey];
  return left
    ? { ok: true, ledger, debtor: left.display, balance: balanceOf(left) }
    : { ok: true, ledger, debtor: target.display, balance: 0 };
}
