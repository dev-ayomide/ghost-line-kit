import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ojaConfig } from '../src/app.config.ts';
import { addReport, average, displayStats, emptyDay, judge, refPrice, type PriceDay } from '../src/prices.ts';

const CFG = ojaConfig.outlier;

const genRef = fc.integer({ min: 1_000, max: 200_000 });
const genAmounts = fc.array(fc.integer({ min: 100, max: 500_000 }), { maxLength: 40 });

/** Builds a day by adding each amount through addReport (distinct report ids come from day.next). */
function build(amounts: number[], ref: number): PriceDay {
  let day = emptyDay();
  amounts.forEach((amount, i) => {
    day = addReport(day, { amount, at: 1_000 + i }, ref, CFG).day;
  });
  return day;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Amount biased to extremes: ref*0.01, ref*50, median +/- 10*half, plus plain random. */
function genNewAmount(day: PriceDay, ref: number): fc.Arbitrary<number> {
  const amts = day.accepted.map((r) => r.amount);
  const extremes: number[] = [Math.max(1, Math.round(ref * 0.01)), Math.round(ref * 50)];
  if (amts.length >= CFG.minForMad) {
    const m = median(amts);
    const mad = median(amts.map((a) => Math.abs(a - m)));
    const half = Math.max(CFG.madK * 1.4826 * mad, CFG.minHalfWidthPct * m);
    extremes.push(Math.max(1, Math.round(m - 10 * half)), Math.round(m + 10 * half));
  }
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...extremes) },
    { weight: 2, arbitrary: fc.integer({ min: 1, max: 1_000_000 }) },
  );
}

const genScenario = fc
  .tuple(genAmounts, genRef)
  .chain(([amounts, ref]) => {
    const day = build(amounts, ref);
    const ids = day.accepted.map((r) => r.id);
    const genReplace: fc.Arbitrary<number | undefined> =
      ids.length > 0 ? fc.oneof(fc.constant(undefined), fc.constantFrom(...ids)) : fc.constant(undefined);
    return fc.tuple(fc.constant(day), fc.constant(ref), genNewAmount(day, ref), genReplace);
  });

// Feature: oja-ghost, Property 3: The price average is unchanged when a rejected outlier is added
// **Validates: Requirements 12.3, 4.5**
describe('Property 3: a rejected report leaves the accepted set alone', () => {
  it('accepted and average are unchanged by a rejected report, even with a replaceId', () => {
    let rejections = 0;
    let replaceRejections = 0;
    fc.assert(
      fc.property(genScenario, ([day, ref, amount, replaceId]) => {
        const before = JSON.parse(JSON.stringify(day)) as PriceDay;
        const res = addReport(day, { amount, at: 9_999, ...(replaceId !== undefined ? { replaceId } : {}) }, ref, CFG);
        expect(day).toEqual(before); // input not mutated
        if (!res.verdict.accepted) {
          rejections++;
          if (replaceId !== undefined) {
            replaceRejections++;
            expect(res.day.accepted.some((r) => r.id === replaceId)).toBe(true);
          }
          expect(res.day.accepted).toEqual(before.accepted);
          expect(average(res.day.accepted.map((r) => r.amount))).toBe(average(before.accepted.map((r) => r.amount)));
          expect(res.day.rejected.some((r) => r.id === res.id)).toBe(true);
          expect(res.day.rejected.length).toBeLessThanOrEqual(ojaConfig.limits.maxRejectedPerDay);
        } else {
          expect(res.day.accepted.some((r) => r.id === res.id)).toBe(true);
          if (replaceId !== undefined) expect(res.day.accepted.some((r) => r.id === replaceId)).toBe(false);
        }
        expect(res.id).toBe(day.next);
        expect(res.day.next).toBe(day.next + 1);
      }),
    );
    expect(rejections).toBeGreaterThan(0);
    expect(replaceRejections).toBeGreaterThan(0);
  });

  // Reasoning-based example (not found by fast-check): a rejected replacement must not delete
  // the Trader's earlier accepted report.
  it('example: rejected report with replaceId keeps the earlier accepted report', () => {
    const ref = 50_000;
    let day = build([50_000, 51_000, 49_000], ref);
    const earlier = day.accepted[0]!;
    const res = addReport(day, { amount: 5_000_000, at: 5, replaceId: earlier.id }, ref, CFG);
    expect(res.verdict.accepted).toBe(false);
    expect(res.day.accepted).toEqual(day.accepted);
    day = res.day;
    expect(day.rejected).toHaveLength(1);
  });

  it('example: an accepted replacement removes the earlier report', () => {
    const ref = 50_000;
    const day = build([50_000, 51_000, 49_000], ref);
    const earlier = day.accepted[0]!;
    const res = addReport(day, { amount: 50_500, at: 5, replaceId: earlier.id }, ref, CFG);
    expect(res.verdict.accepted).toBe(true);
    expect(res.day.accepted.map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it('caps accepted at 200 and rejected at 50, keeping the newest', () => {
    const ref = 50_000;
    let day = emptyDay();
    for (let i = 0; i < 210; i++) day = addReport(day, { amount: 50_000, at: i }, ref, CFG).day;
    expect(day.accepted).toHaveLength(200);
    expect(day.accepted[199]!.id).toBe(210);
    expect(day.accepted[0]!.id).toBe(11);
    for (let i = 0; i < 60; i++) day = addReport(day, { amount: 9_000_000, at: 1_000 + i }, ref, CFG).day;
    expect(day.rejected).toHaveLength(50);
    expect(day.rejected[49]!.id).toBe(day.next - 1);
  });
});

describe('average', () => {
  it('is the mean rounded to the nearest 10 and ignores rejected reports', () => {
    fc.assert(
      fc.property(genAmounts, genRef, (amounts, ref) => {
        const day = build(amounts, ref);
        const acc = day.accepted.map((r) => r.amount);
        const avg = average(acc);
        if (acc.length === 0) {
          expect(avg).toBeUndefined();
          return;
        }
        const mean = acc.reduce((a, b) => a + b, 0) / acc.length;
        expect(avg).toBe(Math.round(mean / 10) * 10);
        // Rejected amounts do not enter the average.
        expect(day.rejected.length + day.accepted.length).toBe(Math.min(amounts.length, day.next - 1));
        expect(displayStats(day)?.amount).toBe(avg);
      }),
    );
  });

  it('rounds half up', () => {
    expect(average([5])).toBe(10);
    expect(average([14])).toBe(10);
    expect(average([15])).toBe(20);
    expect(average([])).toBeUndefined();
  });
});

describe('displayStats', () => {
  const genDemoMix = fc.array(fc.tuple(fc.integer({ min: 1_000, max: 100_000 }), fc.boolean()), { maxLength: 15 });
  it('ignores demo reports with 3 or more real ones (demo:false), else uses all (demo:true)', () => {
    fc.assert(
      fc.property(genDemoMix, (rows) => {
        const accepted = rows.map(([amount, demo], i) => ({
          id: i + 1,
          amount,
          at: 100 + i,
          ...(demo ? { demo: true as const } : {}),
        }));
        const day: PriceDay = { v: 1, next: accepted.length + 1, accepted, rejected: [] };
        const s = displayStats(day);
        if (accepted.length === 0) {
          expect(s).toBeUndefined();
          return;
        }
        const real = accepted.filter((r) => !r.demo);
        expect(s).toBeDefined();
        if (real.length >= 3) {
          expect(s!.demo).toBe(false);
          expect(s!.n).toBe(real.length);
          expect(s!.amount).toBe(average(real.map((r) => r.amount)));
          expect(s!.lastAt).toBe(Math.max(...real.map((r) => r.at)));
        } else {
          expect(s!.demo).toBe(true);
          expect(s!.n).toBe(accepted.length);
          expect(s!.amount).toBe(average(accepted.map((r) => r.amount)));
        }
      }),
    );
  });
});

describe('judge and refPrice', () => {
  it('never throws on a finite number and returns an integer band on rejection', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 500_000 }), { maxLength: 20 }), fc.double({ noNaN: true, noDefaultInfinity: true }), genRef, (acc, amount, ref) => {
        const v = judge(acc, amount, ref, CFG);
        if (!v.accepted) {
          expect(Number.isInteger(v.low)).toBe(true);
          expect(Number.isInteger(v.high)).toBe(true);
          expect(v.low).toBeGreaterThanOrEqual(0);
          expect(v.high).toBeGreaterThanOrEqual(v.low);
        }
      }),
    );
  });

  it('refPrice rounds to the nearest 100', () => {
    expect(refPrice('mile12', 'rice')).toBe(82_000);
    expect(refPrice('oyingbo', 'rice')).toBe(85_300);
    expect(refPrice('nowhere', 'rice')).toBeUndefined();
  });
});
