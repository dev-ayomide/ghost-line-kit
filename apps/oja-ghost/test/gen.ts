// Shared fast-check generators for the oja-ghost property tests.
import fc from 'fast-check';
import { ojaConfig } from '../src/app.config.ts';

/** Small pool, so that collisions happen: same name with other case, accents or spaces. */
export const NAME_POOL: readonly string[] = [
  'Bola',
  'b\u00F3la', // accented o: not GSM-7, but must collide with Bola
  'BOLA',
  'Mama Ife',
  'Chidi',
  'Ngozi',
  'Tunde',
  'Abcdefghijklmnopqrst', // exactly 20 characters
];

const CASES = ['same', 'upper', 'lower'] as const;

/** Names with mixed case, accents and extra spaces. */
export const genName: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...NAME_POOL),
    fc.constantFrom(...CASES),
    fc.constantFrom('', ' ', '  '),
    fc.constantFrom('', ' ', '   '),
    fc.boolean(),
  )
  .map(([base, c, lead, trail, wide]) => {
    let s = c === 'upper' ? base.toUpperCase() : c === 'lower' ? base.toLowerCase() : base;
    if (wide) s = s.replace(/ /g, '   ');
    return lead + s + trail;
  });

export const MAX_AMOUNT = ojaConfig.limits.maxAmount;

/** Whole naira, including the minimum and the maximum. */
export const genAmount: fc.Arbitrary<number> = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 100_000 }) },
  { weight: 1, arbitrary: fc.constant(1) },
  { weight: 1, arbitrary: fc.constant(MAX_AMOUNT) },
);

// ---- ledger generators ----
import type { LedgerCmd } from '../src/ledger.ts';

const genAt: fc.Arbitrary<number> = fc.integer({ min: 0, max: 2_000_000_000_000 });
/** Small amounts so that payments often fit the balance; includes 1 and maxAmount. */
const genCmdAmount: fc.Arbitrary<number> = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 5_000 }) },
  { weight: 1, arbitrary: fc.constant(1) },
  { weight: 1, arbitrary: fc.constant(MAX_AMOUNT) },
);
const genMoneyKind = (kind: 'owe' | 'paid' | 'overpaid'): fc.Arbitrary<LedgerCmd> =>
  fc.record({
    kind: fc.constant(kind),
    name: genName,
    amount: genCmdAmount,
    at: genAt,
  });
/** owe / paid / overpaid with weights 4 / 4 / 1, and undo with weight 1. */
export const genCmd: fc.Arbitrary<LedgerCmd> = fc.oneof(
  { weight: 4, arbitrary: genMoneyKind('owe') },
  { weight: 4, arbitrary: genMoneyKind('paid') },
  { weight: 1, arbitrary: genMoneyKind('overpaid') },
  { weight: 1, arbitrary: fc.constant<LedgerCmd>({ kind: 'undo' }) },
);
export const genCmds: fc.Arbitrary<LedgerCmd[]> = fc.array(genCmd, { maxLength: 60 });
