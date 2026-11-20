// Money: parseAmount (input) and formatN (replies, plain "N1,500").

const BODY = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d))?(k?)$/;

/**
 * Parses a typed amount. Accepts an optional prefix n, ngn or the naira sign (input only),
 * plain digits or proper comma groups of three, and an optional k suffix (x1000) that
 * allows one decimal digit. Returns undefined for anything else, for results outside
 * [1, max], and for non-integers.
 */
export function parseAmount(s: string, max: number): number | undefined {
  let x = s.trim().toLowerCase();
  if (x.startsWith('ngn')) x = x.slice(3);
  else if (x.startsWith('n') || x.startsWith('\u20A6')) x = x.slice(1);
  const m = BODY.exec(x);
  if (!m) return undefined;
  const whole = m[1];
  const dec = m[2];
  const k = m[3] === 'k';
  if (whole === undefined) return undefined;
  if (dec !== undefined && !k) return undefined;
  if (whole.length > 15) return undefined;
  const int = Number(whole.replace(/,/g, ''));
  const n = k ? int * 1000 + Number(dec ?? '0') * 100 : int;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

/** 4500 -> "N4,500". Whole naira, no decimals, no naira sign. */
export function formatN(n: number): string {
  const digits = String(Math.round(Math.abs(n)));
  return 'N' + digits.replace(/\B(?=(\d{3})+$)/g, ',');
}
