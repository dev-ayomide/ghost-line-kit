// Name helpers: normaliseName and validName.
import { detectEncoding } from '@ghostline/kit';

const MARKS = /\p{M}/gu;

function once(s: string): string {
  return s.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Lowercase, accents removed, whitespace collapsed and trimmed. Repeats until stable
 * because lowercasing can create new combining marks (for example a dotted capital I).
 */
export function normaliseName(s: string): string {
  let cur = once(s);
  for (let i = 0; i < 4; i++) {
    const next = once(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

const ALLOWED = /^[\p{L}\p{N} .'-]+$/u;

/** 1 to 20 characters after trim, letters, digits, space, dot, apostrophe, hyphen; GSM-7 only. */
export function validName(s: string): boolean {
  const name = s.trim();
  return name.length >= 1 && name.length <= 20 && ALLOWED.test(name) && detectEncoding(name) === 'GSM-7';
}
