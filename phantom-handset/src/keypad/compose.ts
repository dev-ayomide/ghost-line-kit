export type HandsetKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '*' | '#' | 'clear';

/** Append a key's character (ignored once the buffer is full); 'clear' removes the last character. */
export function applyKey(buffer: string, key: HandsetKey, maxLen: number): string {
  if (key === 'clear') return buffer.slice(0, -1);
  if (buffer.length >= maxLen) return buffer;
  return buffer + key;
}

export function composeKeys(keys: readonly HandsetKey[], maxLen: number): string {
  return keys.reduce((buf, key) => applyKey(buf, key, maxLen), '');
}

export interface UssdParse {
  service: string;
  extension: string[];
}

const USSD_RE = /^\*(\d+)((?:\*\d+)*)#$/;

export function parseUssd(dial: string): UssdParse | undefined {
  const m = USSD_RE.exec(dial);
  if (!m) return undefined;
  const rest = m[2] ?? '';
  return { service: m[1] as string, extension: rest === '' ? [] : rest.slice(1).split('*') };
}

export function formatUssd(p: UssdParse): string {
  return `*${[p.service, ...p.extension].join('*')}#`;
}
