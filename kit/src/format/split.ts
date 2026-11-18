import { LIMITS } from '../limits.js';
import { detectEncoding, type Encoding } from './encoding.js';

function limitsFor(encoding: Encoding): { singleSegment: number; concatSegment: number } {
  return encoding === 'GSM-7' ? LIMITS.sms.gsm7 : LIMITS.sms.ucs2;
}

/** Largest cut index <= start + max that does not fall inside a surrogate pair. */
function safeEnd(s: string, start: number, max: number): number {
  let end = Math.min(s.length, start + max);
  if (end < s.length && end > start + 1) {
    const prev = s.charCodeAt(end - 1);
    const next = s.charCodeAt(end);
    if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  }
  return end;
}

/**
 * Pure_Splitter. Lengths are UTF-16 code units. Never splits a surrogate pair.
 * Whitespace-delimited units are kept whole unless a unit alone exceeds the
 * concatenated-segment limit (then it is hard-split). Concatenating the result
 * always yields `text` exactly.
 */
export function pureSplit(text: string, encoding: Encoding): string[] {
  if (text.length === 0) return [];
  const { singleSegment, concatSegment } = limitsFor(encoding);
  if (text.length <= singleSegment) return [text];
  return splitByLimit(text, concatSegment);
}

/**
 * Internal (not part of the public API). Greedy word-boundary packing into pieces of
 * at most `limit` UTF-16 code units; concatenating the result yields `text` exactly.
 */
export function splitByLimit(text: string, limit: number): string[] {
  if (text.length === 0) return [];
  const segments: string[] = [];
  let cur = '';
  const flush = (): void => {
    if (cur.length > 0) segments.push(cur);
    cur = '';
  };

  for (const m of text.matchAll(/\s+|\S+/g)) {
    const token = m[0];
    const isSpace = /^\s/.test(token);

    if (!isSpace && token.length <= limit) {
      if (cur.length + token.length > limit) flush();
      cur += token;
      continue;
    }

    if (!isSpace) flush(); // oversize word: start on a fresh segment (Req 5.6)

    // Whitespace run or oversize word: fill greedily, cutting anywhere (pair-safe).
    let pos = 0;
    while (pos < token.length) {
      const room = limit - cur.length;
      if (room <= 1) {
        flush();
        continue;
      }
      const end = safeEnd(token, pos, room);
      cur += token.slice(pos, end);
      pos = end;
      if (cur.length >= limit - 1 && pos < token.length) flush();
    }
  }
  flush();
  return segments;
}

/** Result of {@link splitMessage}. */
export interface SplitResult {
  segments: string[];
  truncated: boolean;
  encoding: Encoding;
  segmentCount: number;
}

const MORE_SUFFIX = ' Reply MORE';

/**
 * Summary step (Req 5.7). Takes the Pure_Splitter output (more than the preferred
 * number of segments), keeps the leading preferred segments, trims trailing
 * whitespace and whole words from the last kept segment until it plus the
 * " Reply MORE" suffix fits the concatenated limit, and appends the suffix.
 * The kept text is always a prefix of the original message.
 */
export function summarizeSegments(segments: string[], encoding: Encoding): string[] {
  const limit = limitsFor(encoding).concatSegment;
  const keep = segments.slice(0, LIMITS.reply.maxPreferredSegments);
  let last = (keep.pop() ?? '').trimEnd();
  const room = limit - MORE_SUFFIX.length;
  while (last.length > room) {
    const idx = last.search(/\s\S*$/);
    if (idx < 0) {
      // A single oversize unit (Req 5.6): cut at a character boundary.
      last = last.slice(0, safeEnd(last, 0, room)).trimEnd();
      break;
    }
    last = last.slice(0, idx).trimEnd();
  }
  keep.push(last + MORE_SUFFIX);
  return keep;
}

/** Splits `text` into SMS segments, summarising with "Reply MORE" past the preferred segment count. */
export function splitMessage(text: string): SplitResult {
  const encoding = detectEncoding(text);
  const segments = pureSplit(text, encoding);
  if (segments.length <= LIMITS.reply.maxPreferredSegments) {
    return { segments, truncated: false, encoding, segmentCount: segments.length };
  }
  const summary = summarizeSegments(segments, encoding);
  return { segments: summary, truncated: true, encoding, segmentCount: summary.length };
}
