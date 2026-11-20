import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ojaConfig } from '../src/app.config.ts';
import {
  applyLedger,
  balanceOf,
  emptyLedger,
  netBalance,
  type Ledger,
  type LedgerCmd,
  type LedgerLimits,
} from '../src/ledger.ts';
import { normaliseName, validName } from '../src/names.ts';
import { genCmd, genCmds } from './gen.ts';

const REAL: LedgerLimits = ojaConfig.limits;
const TINY: LedgerLimits = { maxAmount: 6_000, maxDebtors: 2, maxEntriesPerDebtor: 3 };
const genLimits = fc.constantFrom(REAL, TINY);
const genStart = fc.boolean().map((demo) => (demo ? emptyLedger(true) : emptyLedger()));

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
const snap = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Replays cmds. Each call gets a frozen input, so any mutation throws. */
function replay(start: Ledger, cmds: LedgerCmd[], limits: LedgerLimits, each: (before: Ledger, cmd: LedgerCmd, r: ReturnType<typeof applyLedger>) => void): Ledger {
  let cur = deepFreeze(snap(start));
  for (const cmd of cmds) {
    const before = snap(cur);
    const r = applyLedger(cur, cmd, limits);
    expect(cur, 'input ledger was mutated').toEqual(before);
    each(before, cmd, r);
    if (r.ok) cur = deepFreeze(r.ledger);
  }
  return cur;
}

// Feature: oja-ghost, Property 1: The ledger balance equals the sum of transactions
// **Validates: Requirements 12.1**
describe('Property 1: balance equals the sum of transactions', () => {
  it('matches a naive reference model after every step', () => {
    fc.assert(
      fc.property(genStart, genCmds, genLimits, (start, cmds, limits) => {
        const model = new Map<string, number[]>();
        const ops: string[] = [];
        replay(start, cmds, limits, (_b, cmd, r) => {
          if (r.ok) {
            if (cmd.kind === 'undo') {
              const key = ops.pop();
              expect(key).toBeDefined();
              const list = model.get(key as string) ?? [];
              list.pop();
              if (list.length === 0) model.delete(key as string);
            } else {
              const key = normaliseName(cmd.name);
              const list = model.get(key) ?? [];
              list.push(cmd.kind === 'owe' ? cmd.amount : -cmd.amount);
              model.set(key, list);
              ops.push(key);
            }
            const l = r.ledger;
            expect(Object.keys(l.debtors).sort()).toEqual([...model.keys()].sort());
            let total = 0;
            for (const [key, list] of model) {
              const sum = list.reduce((a, b) => a + b, 0);
              expect(balanceOf(l.debtors[key]!)).toBe(sum);
              total += sum;
            }
            expect(netBalance(l)).toBe(total);
          }
        });
      }),
    );
  });
});

// Feature: oja-ghost, Property 2: A payment never makes a balance negative without an Overpaid_Entry
// **Validates: Requirements 12.2**
describe('Property 2: no negative balance without an overpaid entry', () => {
  it('holds after every step, and an excessive payment returns exceeds_balance with no ledger', () => {
    fc.assert(
      fc.property(genStart, genCmds, genLimits, (start, cmds, limits) => {
        replay(start, cmds, limits, (before, cmd, r) => {
          if (cmd.kind === 'paid') {
            const d = before.debtors[normaliseName(cmd.name)];
            const valid =
              validName(cmd.name) && Number.isInteger(cmd.amount) && cmd.amount >= 1 && cmd.amount <= limits.maxAmount;
            if (d && valid && d.entries.length < limits.maxEntriesPerDebtor) {
              if (cmd.amount > balanceOf(d)) {
                expect(r.ok).toBe(false);
                if (!r.ok) {
                  expect(r.reason).toBe('exceeds_balance');
                  if (r.reason === 'exceeds_balance') expect(r.balance).toBe(balanceOf(d));
                  expect('ledger' in r).toBe(false);
                }
              } else {
                expect(r.ok).toBe(true);
              }
            }
          }
          if (r.ok) {
            for (const d of Object.values(r.ledger.debtors)) {
              expect(balanceOf(d) >= 0 || d.entries.some((e) => e.type === 'overpaid')).toBe(true);
              expect(d.entries.length).toBeGreaterThan(0);
            }
          }
        });
      }),
    );
  });

  // Reasoning-based example (not found by fast-check): paying exactly the balance is allowed,
  // one naira more is exceeds_balance, and overpaid is the only way to go negative.
  it('example: exact payment ok, one more is exceeds_balance, overpaid goes negative', () => {
    const owe = applyLedger(emptyLedger(), { kind: 'owe', name: 'Bola', amount: 100, at: 1 }, REAL);
    if (!owe.ok) throw new Error('owe failed');
    const over = applyLedger(owe.ledger, { kind: 'paid', name: 'bola', amount: 101, at: 2 }, REAL);
    expect(over).toEqual({ ok: false, reason: 'exceeds_balance', balance: 100 });
    const exact = applyLedger(owe.ledger, { kind: 'paid', name: 'bola', amount: 100, at: 2 }, REAL);
    expect(exact.ok && exact.balance).toBe(0);
    const credit = applyLedger(owe.ledger, { kind: 'overpaid', name: 'bola', amount: 150, at: 2 }, REAL);
    expect(credit.ok && credit.balance).toBe(-50);
  });
});

// Feature: oja-ghost, Property 4: A rejected paid leaves the ledger equal to its input
// **Validates: Requirements 12.4**
describe('Property 4: failed commands leave the ledger unchanged', () => {
  it('never mutates the input and a failure carries no ledger', () => {
    fc.assert(
      fc.property(genStart, genCmds, genLimits, (start, cmds, limits) => {
        replay(start, cmds, limits, (before, cmd, r) => {
          // replay() already asserts the input is unchanged for every result.
          if (!r.ok) {
            expect('ledger' in r).toBe(false);
            expect(before).toEqual(snap(before));
          } else {
            expect(r.ledger.demo).toBe(before.demo);
            expect(r.ledger).not.toBe(before);
          }
          void cmd;
        });
      }),
    );
  });

  it('the exceeds_balance case leaves the stored book byte-for-byte equal', () => {
    const owe = applyLedger(emptyLedger(true), { kind: 'owe', name: 'Chidi', amount: 50, at: 1 }, REAL);
    if (!owe.ok) throw new Error('owe failed');
    const frozen = deepFreeze(snap(owe.ledger));
    const r = applyLedger(frozen, { kind: 'paid', name: 'CHIDI', amount: 51, at: 2 }, REAL);
    expect(r.ok).toBe(false);
    expect(frozen).toEqual(owe.ledger);
  });
});

// Feature: oja-ghost, Property 6: undo inverts owe and paid
// **Validates: Requirements 12.5**
describe('Property 6: undo inverts an accepted owe or paid', () => {
  const genMoneyCmd = genCmd.filter((c) => c.kind === 'owe' || c.kind === 'paid');
  it('apply then undo returns a ledger deep-equal to the original', () => {
    fc.assert(
      fc.property(genStart, genCmds, genMoneyCmd, genLimits, (start, cmds, cmd, limits) => {
        const base = replay(start, cmds, limits, () => {});
        const r = applyLedger(base, cmd, limits);
        if (!r.ok) return;
        const back = applyLedger(deepFreeze(snap(r.ledger)), { kind: 'undo' }, limits);
        expect(back.ok).toBe(true);
        if (back.ok) expect(back.ledger).toEqual(base);
      }),
    );
  });

  it('owe that created a debtor: undo removes that debtor', () => {
    const o = applyLedger(emptyLedger(), { kind: 'owe', name: ' Mama   Ife ', amount: 10, at: 5 }, REAL);
    if (!o.ok) throw new Error('owe failed');
    expect(Object.keys(o.ledger.debtors)).toEqual(['mama ife']);
    const u = applyLedger(o.ledger, { kind: 'undo' }, REAL);
    expect(u.ok && u.ledger).toEqual(emptyLedger());
  });

  it('paid then undo restores the debtor exactly', () => {
    const a = applyLedger(emptyLedger(), { kind: 'owe', name: 'Bola', amount: 300, at: 1 }, REAL);
    if (!a.ok) throw new Error('owe failed');
    const p = applyLedger(a.ledger, { kind: 'paid', name: 'BOLA', amount: 300, at: 2 }, REAL);
    if (!p.ok) throw new Error('paid failed');
    const u = applyLedger(p.ledger, { kind: 'undo' }, REAL);
    expect(u.ok && u.ledger).toEqual(a.ledger);
  });

  it('nothing_to_undo on an empty ledger', () => {
    expect(applyLedger(emptyLedger(), { kind: 'undo' }, REAL)).toEqual({ ok: false, reason: 'nothing_to_undo' });
  });
});
