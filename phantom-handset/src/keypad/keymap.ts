import type { HandsetKey } from './compose.js';

const CHAR_KEYS: ReadonlySet<string> = new Set([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#',
]);

export function keyForChar(c: string): HandsetKey | undefined {
  return CHAR_KEYS.has(c) ? (c as HandsetKey) : undefined;
}

/** Uses `e.key` (not `e.code`) so '*' and '#' work on any keyboard layout. */
export function keyFromKeyboardEvent(e: { key: string }): HandsetKey | undefined {
  if (e.key === 'Backspace') return 'clear';
  return keyForChar(e.key);
}
