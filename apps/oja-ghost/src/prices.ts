// Outlier judging and price averages. Pure: nothing here mutates its inputs.
import { ojaConfig } from './app.config.ts';

export interface Rep {
  id: number;
  amount: number;
  at: number;
  demo?: true;
}
export interface PriceDay {
  v: 1;
  next: number;
  accepted: Rep[];
  rejected: Rep[];
}
export interface OutlierCfg {
  minForMad: number;
  madK: number;
  minHalfWidthPct: number;
  refLow: number;
  refHigh: number;
}
export type Verdict = { accepted: true } | { accepted: false; low: number; high: number };
export interface DisplayStats {
  amount: number;
  n: number;
  lastAt: number;
  demo: boolean;
}

const MAX_ACCEPTED = ojaConfig.limits.maxAcceptedPerDay;
const MAX_REJECTED = ojaConfig.limits.maxRejectedPerDay;

export function emptyDay(): PriceDay {
  return { v: 1, next: 1, accepted: [], rejected: [] };
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid] ?? 0;
  if (s.length % 2 === 1) return hi;
  const lo = s[mid - 1] ?? hi;
  return (lo + hi) / 2;
}

export function judge(accepted: readonly number[], amount: number, ref: number, cfg: OutlierCfg): Verdict {
  let lowRaw: number;
  let highRaw: number;
  if (accepted.length < cfg.minForMad) {
    lowRaw = ref * cfg.refLow;
    highRaw = ref * cfg.refHigh;
  } else {
    const m = median(accepted);
    const mad = median(accepted.map((a) => Math.abs(a - m)));
    const half = Math.max(cfg.madK * 1.4826 * mad, cfg.minHalfWidthPct * m);
    lowRaw = m - half;
    highRaw = m + half;
  }
  if (amount >= lowRaw && amount <= highRaw) return { accepted: true };
  return { accepted: false, low: Math.max(0, Math.round(lowRaw)), high: Math.max(0, Math.round(highRaw)) };
}

/** Mean rounded to the nearest 10, half up. Undefined for an empty list. */
export function average(amounts: readonly number[]): number | undefined {
  const n = amounts.length;
  if (n === 0) return undefined;
  let sum = 0;
  for (const a of amounts) sum += a;
  // floor((sum/n)/10 + 1/2) in integer arithmetic: floor((sum + 5n) / 10n)
  const num = sum + 5 * n;
  const den = 10 * n;
  return ((num - (num % den)) / den) * 10;
}

export function addReport(
  day: PriceDay,
  r: { amount: number; at: number; replaceId?: number; demo?: true },
  ref: number,
  cfg: OutlierCfg,
): { day: PriceDay; id: number; verdict: Verdict } {
  const id = day.next;
  const rep: Rep = r.demo
    ? { id, amount: r.amount, at: r.at, demo: true }
    : { id, amount: r.amount, at: r.at };
  const others = day.accepted.filter((x) => x.id !== r.replaceId);
  const verdict = judge(others.map((x) => x.amount), r.amount, ref, cfg);

  if (!verdict.accepted) {
    const rejected = [...day.rejected.filter((x) => x.id !== r.replaceId), rep].slice(-MAX_REJECTED);
    return { day: { ...day, next: id + 1, accepted: day.accepted, rejected }, id, verdict };
  }
  const accepted = [...others, rep].slice(-MAX_ACCEPTED);
  const rejected = day.rejected.filter((x) => x.id !== r.replaceId);
  return { day: { ...day, next: id + 1, accepted, rejected }, id, verdict };
}

export function displayStats(day: PriceDay): DisplayStats | undefined {
  if (day.accepted.length === 0) return undefined;
  const real = day.accepted.filter((r) => !r.demo);
  const useReal = real.length >= 3;
  const used = useReal ? real : day.accepted;
  const amount = average(used.map((r) => r.amount));
  if (amount === undefined) return undefined;
  let lastAt = -Infinity;
  for (const r of used) if (r.at > lastAt) lastAt = r.at;
  return { amount, n: used.length, lastAt, demo: !useReal };
}

/** Illustrative reference price, rounded to the nearest 100. Undefined for an unknown id. */
export function refPrice(market: string, commodity: string): number | undefined {
  const m = ojaConfig.markets.find((x) => x.id === market);
  const c = ojaConfig.commodities.find((x) => x.id === commodity);
  if (!m || !c) return undefined;
  return Math.round((c.basePrice * m.multiplier) / 100) * 100;
}
