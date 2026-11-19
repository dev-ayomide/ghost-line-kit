/**
 * SMS counter for the Compose screen (Req 6.3). Pure: no React, no DOM, no kit runtime import.
 * The Compose screen only accepts `isComposable` characters, so UCS-2 never occurs and
 * only the GSM-7 limits are used. Limits always come from the server config.
 *
 * The kit's `detectEncoding` treats the GSM-7 extension characters (`^ { } \ [ ~ ] |` and
 * the euro sign) as UCS-2. To stay consistent with the kit and never under-count segments,
 * Compose rejects them, so every accepted character costs exactly 1.
 */
import type { Limits } from '../../shared/api.ts';

export type SmsLimits = Limits['sms'];

/** Every composable character is in the GSM-7 basic alphabet and costs 1. */
export function charCost(_c: string): 1 {
  return 1;
}

/**
 * Printable ASCII 0x20-0x7E, except the backtick and the characters the kit does not
 * count as GSM-7: `^ { } \ [ ~ ] |`. The euro sign is outside ASCII, so it is rejected too.
 */
const REJECTED: ReadonlySet<string> = new Set(['`', '^', '{', '}', '\\', '[', '~', ']', '|']);

export function isComposable(c: string): boolean {
  if (c.length !== 1) return false;
  const code = c.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e && !REJECTED.has(c);
}

export function smsCount(text: string, limits: SmsLimits): { chars: number; segments: number } {
  let chars = 0;
  for (const c of text) chars += charCost(c);
  if (text.length === 0) return { chars: 0, segments: 0 };
  const segments =
    chars <= limits.gsm7.singleSegment ? 1 : Math.ceil(chars / limits.gsm7.concatSegment);
  return { chars, segments };
}
