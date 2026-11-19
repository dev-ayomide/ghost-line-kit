/**
 * SMS counter for the Compose screen (Req 6.3). Pure: no React, no DOM, no kit runtime import.
 * The Compose screen only accepts `isComposable` characters, so UCS-2 never occurs and
 * only the GSM-7 limits are used. Limits always come from the server config.
 */
import type { Limits } from '../../shared/api.ts';

export type SmsLimits = Limits['sms'];

/** GSM-7 extension table characters: each is sent as ESC + code, so it costs 2. */
const GSM7_EXTENSION: ReadonlySet<string> = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

export function charCost(c: string): 1 | 2 {
  return GSM7_EXTENSION.has(c) ? 2 : 1;
}

/** Printable ASCII 0x20-0x7E except the backtick (not in GSM-7). */
export function isComposable(c: string): boolean {
  if (c.length !== 1) return false;
  const code = c.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e && c !== '`';
}

export function smsCount(text: string, limits: SmsLimits): { chars: number; segments: number } {
  let chars = 0;
  for (const c of text) chars += charCost(c);
  if (text.length === 0) return { chars: 0, segments: 0 };
  const segments =
    chars <= limits.gsm7.singleSegment ? 1 : Math.ceil(chars / limits.gsm7.concatSegment);
  return { chars, segments };
}
