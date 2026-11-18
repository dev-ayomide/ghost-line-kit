export type Encoding = 'GSM-7' | 'UCS-2';

// GSM 7-bit default (basic) alphabet, 3GPP TS 23.038. The ESC code point is excluded.
// Extension-table characters (€ [ ] { } \ ^ ~ |) are deliberately left out, so a
// message containing any of them is treated as UCS-2 (conservative: UCS-2 limits are smaller).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿' +
  'abcdefghijklmnopqrstuvwxyzäöñüà';

export const GSM7_CHARS: ReadonlySet<string> = new Set(Array.from(GSM7_BASIC));

/** Returns 'GSM-7' iff every code point of `text` is in GSM7_CHARS, otherwise 'UCS-2'. */
export function detectEncoding(text: string): Encoding {
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch)) return 'UCS-2';
  }
  return 'GSM-7';
}
