/**
 * Mask a phone number for logs.
 * More than 7 digits: keep the first 3 and last 4 digits.
 * 7 or fewer digits: keep only the last 2 digits.
 * Non-digit characters are preserved. Output length equals input length
 * (counted in UTF-16 code units; every \p{Nd} digit is replaced by one '*'
 * per code point, so astral digits are handled by a per-code-point pass below).
 */
export function maskPhoneNumber(phone: string): string {
  const chars = Array.from(phone);
  const isDigit = (c: string): boolean => /^\p{Nd}$/u.test(c);
  const total = chars.filter(isDigit).length;
  const keepHead = total > 7 ? 3 : 0;
  const keepTail = total > 7 ? 4 : 2;
  let seen = 0;
  return chars
    .map((c) => {
      if (!isDigit(c)) return c;
      const i = seen++;
      return i < keepHead || i >= total - keepTail ? c : '*';
    })
    .join('');
}
