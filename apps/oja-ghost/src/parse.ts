// Rule-based classifier and command parser. Pure. Word lists come from ojaConfig.words.
// Names are returned as typed (raw text); the caller applies validName. Amounts go through parseAmount.
import { INTENT_NAMES, ojaConfig, type WordIntent, type WordLists } from './app.config.ts';
import type { Lang } from './copy.ts';
import { parseAmount } from './money.ts';
import { isWhenTokens } from './when.ts';

export type IntentName = (typeof INTENT_NAMES)[number];

/** Commodity and market as config ids, or the raw text when it matched no alias. */
export interface PriceRef {
  commodity?: string | undefined;
  unknownCommodity?: string | undefined;
  market?: string | undefined;
  unknownMarket?: string | undefined;
}

export type ParsedCommand =
  | ({ kind: 'price' } & PriceRef)
  | ({ kind: 'report'; amount: number | undefined } & PriceRef)
  | { kind: 'owe' | 'paid' | 'overpaid'; name: string; amount: number | undefined }
  | { kind: 'undo' | 'reminders' | 'menu' | 'help' }
  | { kind: 'book'; name?: string | undefined }
  /** `when` is lowercase date words for parseWhen. Empty when none were found. */
  | { kind: 'remind'; name: string; when: string[] }
  | { kind: 'supplier'; name: string; amount: number | undefined; when: string[] }
  | { kind: 'cancel'; n?: number | undefined }
  | { kind: 'language'; lang?: Lang | undefined }
  | { kind: 'unknown' };

const LANG_KEYS = Object.keys(ojaConfig.words) as Lang[];
const WORDS: WordLists[] = LANG_KEYS.map((l) => ojaConfig.words[l]);
const MAX = ojaConfig.limits.maxAmount;

// ---------- tokens ----------

function lowerPlain(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

interface Toks {
  /** As typed (accents and case kept), for names. */
  raw: string[];
  /** Lowercase, accents removed, for matching. */
  norm: string[];
}

function tokenise(text: string): Toks {
  const cleaned = text.trim().replace(/[.?!\s]+$/, '');
  const raw = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^[,;:]+|[,;:]+$/g, ''))
    .filter((t) => t.length > 0);
  return { raw, norm: raw.map(lowerPlain) };
}

const splitPhrase = (p: string): string[] => p.split(' ').filter((w) => w.length > 0);
const longestFirst = <T extends { tokens: string[] }>(a: T, b: T): number =>
  b.tokens.length - a.tokens.length || b.tokens.join(' ').length - a.tokens.join(' ').length;

// ---------- word tables (built once from config) ----------

interface CmdEntry {
  tokens: string[];
  intent: WordIntent;
}
const COMMANDS: CmdEntry[] = WORDS.flatMap((w) =>
  (Object.keys(w.command) as WordIntent[]).flatMap((intent) =>
    w.command[intent].map((p) => ({ tokens: splitPhrase(p), intent })),
  ),
).sort(longestFirst);

type VerbKind = 'owe' | 'paid' | 'overpaid' | 'cost';
interface VerbEntry {
  tokens: string[];
  kind: VerbKind;
}
const VERBS: VerbEntry[] = WORDS.flatMap((w) =>
  (['owe', 'paid', 'overpaid', 'cost'] as const).flatMap((kind) =>
    w.verbs[kind].map((p) => ({ tokens: splitPhrase(p), kind })),
  ),
).sort(longestFirst);

const set = (pick: (w: WordLists) => readonly string[]): Set<string> => new Set(WORDS.flatMap((w) => [...pick(w)]));
const FILLER = set((w) => w.filler);
const NOISE = set((w) => w.remindNoise);
const BALANCE_LEADS: string[][] = WORDS.flatMap((w) => w.balanceLead.map(splitPhrase)).sort((a, b) => b.length - a.length);
const BALANCE = set((w) => w.verbs.balance);

interface AliasEntry {
  id: string;
  compact: string;
}
const compact = (s: string): string => s.replace(/[\s-]/g, '');
const COMMODITIES: AliasEntry[] = ojaConfig.commodities.flatMap((c) =>
  c.aliases.map((a) => ({ id: c.id, compact: compact(a) })),
);
const MARKETS: AliasEntry[] = ojaConfig.markets.flatMap((m) =>
  m.aliases.map((a) => ({ id: m.id, compact: compact(a) })),
);
const MAX_ALIAS_TOKENS = Math.max(
  1,
  ...ojaConfig.commodities.flatMap((c) => c.aliases.map((a) => splitPhrase(a).length)),
  ...ojaConfig.markets.flatMap((m) => m.aliases.map((a) => splitPhrase(a).length)),
);

function startsWithAt(norm: string[], i: number, tokens: string[]): boolean {
  if (tokens.length === 0 || i + tokens.length > norm.length) return false;
  return tokens.every((t, k) => norm[i + k] === t);
}

function matchCommand(norm: string[]): { intent: WordIntent; len: number } | undefined {
  for (const e of COMMANDS) if (startsWithAt(norm, 0, e.tokens)) return { intent: e.intent, len: e.tokens.length };
  return undefined;
}

function matchVerb(norm: string[], i: number, kinds: readonly VerbKind[]): { kind: VerbKind; len: number } | undefined {
  for (const v of VERBS) if (kinds.includes(v.kind) && startsWithAt(norm, i, v.tokens)) return { kind: v.kind, len: v.tokens.length };
  return undefined;
}

/** Longest alias first: "mile 12", "mile12" and "mile-12" all give the same compact form. */
function matchAlias(norm: string[], i: number, entries: AliasEntry[]): { id: string; len: number } | undefined {
  for (let k = Math.min(MAX_ALIAS_TOKENS, norm.length - i); k >= 1; k--) {
    const joined = compact(norm.slice(i, i + k).join(''));
    const hit = entries.find((e) => e.compact === joined);
    if (hit) return { id: hit.id, len: k };
  }
  return undefined;
}

const skipFiller = (norm: string[], i: number): number => {
  let j = i;
  while (j < norm.length && FILLER.has(norm[j] as string)) j++;
  return j;
};

const amountAt = (norm: string[], i: number): number | undefined =>
  i < norm.length ? parseAmount(norm[i] as string, MAX) : undefined;

/** The first token from `start` that is a valid amount. */
function firstAmount(norm: string[], start: number): number | undefined {
  for (let i = start; i < norm.length; i++) {
    const a = amountAt(norm, i);
    if (a !== undefined) return a;
  }
  return undefined;
}

/**
 * "how much does Bola owe (me)", "wetin Bola dey owe me": a balance question about one person.
 * Must run before the command match, because "how much" is also a price command. It needs an
 * owe verb at the end and a name between, so "how much rice mile12" still reaches price.
 */
function parseBalanceQuestion(raw: string[], norm: string[]): ParsedCommand | undefined {
  const lead = BALANCE_LEADS.find((l) => startsWithAt(norm, 0, l));
  if (!lead) return undefined;
  let end = norm.length;
  if (end > lead.length + 1 && norm[end - 1] === 'me') end -= 1;
  for (let i = lead.length + 1; i <= end - 1; i++) {
    const hit = VERBS.some((v) => v.kind === 'owe' && i + v.tokens.length === end && startsWithAt(norm, i, v.tokens));
    if (hit) return { kind: 'book', name: raw.slice(lead.length, i).join(' ') };
  }
  return undefined;
}
// ---------- routing ----------

const AMOUNT_LIKE = /^(n|ngn|\u20A6)?\d[\d,.]*k?$/;

/**
 * Picks an intent name from the text. Never returns 'unrecognized'; every result is in
 * ojaConfig.intentNames. Name-first sentences ("Bola owes 4500") return 'freetext', and the
 * step tool hands them to parseCommand.
 */
export function routeIntent(text: string): IntentName {
  const { raw, norm } = tokenise(text);
  if (AMOUNT_LIKE.test(norm.join(' '))) return 'choice';
  if (parseBalanceQuestion(raw, norm)) return 'book';
  const cmd = matchCommand(norm);
  return cmd ? cmd.intent : 'freetext';
}

// ---------- command parsing ----------

/** Commodity then market, left to right. With `stopAtAmount`, an amount ends an unknown market. */
function parseRef(raw: string[], norm: string[], start: number, stopAtAmount: boolean): { ref: PriceRef; next: number } {
  const ref: PriceRef = {};
  let i = skipFiller(norm, start);
  if (i < norm.length && !(stopAtAmount && amountAt(norm, i) !== undefined)) {
    const c = matchAlias(norm, i, COMMODITIES);
    if (c) {
      ref.commodity = c.id;
      i += c.len;
    } else {
      ref.unknownCommodity = raw[i] as string;
      i += 1;
    }
  }
  i = skipFiller(norm, i);
  if (i < norm.length) {
    const m = matchAlias(norm, i, MARKETS);
    if (m) {
      ref.market = m.id;
      i += m.len;
    } else {
      let j = i;
      while (j < norm.length && j - i < 3 && !(stopAtAmount && amountAt(norm, j) !== undefined)) j++;
      if (j > i) ref.unknownMarket = raw.slice(i, j).join(' ');
      i = j;
    }
  }
  return { ref, next: i };
}

/** Name = everything before a trailing amount; amount = last token when valid. */
function nameAndAmount(raw: string[], norm: string[], start: number): { name: string; amount: number | undefined } {
  let end = norm.length;
  let amount: number | undefined;
  if (end > start) {
    amount = amountAt(norm, end - 1);
    if (amount !== undefined) end -= 1;
  }
  return { name: raw.slice(start, end).join(' '), amount };
}

/** Smallest j in [from, len) where norm[j..] is a date. */
function findWhenStart(norm: string[], from: number): number | undefined {
  for (let j = from; j < norm.length; j++) if (isWhenTokens(norm.slice(j))) return j;
  return undefined;
}

function parseRemind(raw: string[], norm: string[], start: number): ParsedCommand {
  let i = start;
  while (i < norm.length && NOISE.has(norm[i] as string)) i++;
  const j = findWhenStart(norm, i + 1);
  if (j === undefined) return { kind: 'remind', name: raw.slice(i).join(' '), when: [] };
  return { kind: 'remind', name: raw.slice(i, j).join(' '), when: norm.slice(j) };
}

function parseSupplier(raw: string[], norm: string[], start: number): ParsedCommand {
  for (let j = start + 1; j < norm.length; j++) {
    const amount = amountAt(norm, j);
    if (amount !== undefined && (j === norm.length - 1 || isWhenTokens(norm.slice(j + 1)))) {
      return { kind: 'supplier', name: raw.slice(start, j).join(' '), amount, when: norm.slice(j + 1) };
    }
  }
  const j = findWhenStart(norm, start + 1);
  if (j === undefined) return { kind: 'supplier', name: raw.slice(start).join(' '), amount: undefined, when: [] };
  return { kind: 'supplier', name: raw.slice(start, j).join(' '), amount: undefined, when: norm.slice(j) };
}

function parseLanguage(norm: string[]): Lang | undefined {
  for (const l of LANG_KEYS) if (norm.some((w) => ojaConfig.languageWords[l].includes(w))) return l;
  return undefined;
}

function parseCommandFirst(intent: WordIntent, raw: string[], norm: string[], len: number): ParsedCommand {
  switch (intent) {
    case 'price':
      return { kind: 'price', ...parseRef(raw, norm, len, false).ref };
    case 'report': {
      const { ref, next } = parseRef(raw, norm, len, true);
      return { kind: 'report', ...ref, amount: firstAmount(norm, next) };
    }
    case 'owe':
    case 'paid':
    case 'overpaid':
      return { kind: intent, ...nameAndAmount(raw, norm, len) };
    case 'book': {
      const i = skipFiller(norm, len);
      const name = raw.slice(i).join(' ');
      return name ? { kind: 'book', name } : { kind: 'book' };
    }
    case 'remind':
      return parseRemind(raw, norm, len);
    case 'supplier':
      return parseSupplier(raw, norm, len);
    case 'cancel': {
      const tok = (norm[len] ?? '').replace(/^#/, '');
      return /^\d{1,3}$/.test(tok) && Number(tok) >= 1 ? { kind: 'cancel', n: Number(tok) } : { kind: 'cancel' };
    }
    case 'language': {
      const lang = parseLanguage(norm);
      return lang ? { kind: 'language', lang } : { kind: 'language' };
    }
    case 'undo':
    case 'reminders':
    case 'menu':
    case 'help':
      return { kind: intent };
  }
}

/** Sentence forms that do not start with a command word. Returns undefined when nothing fits. */
function parseSentence(raw: string[], norm: string[]): ParsedCommand | undefined {
  // "<name> owes <amount>", "<name> don pay <amount>"
  for (let i = 1; i < norm.length; i++) {
    const v = matchVerb(norm, i, ['owe', 'paid', 'overpaid']);
    if (!v || v.kind === 'cost') continue;
    let a = i + v.len;
    if (norm[a] === 'me') a += 1;
    const amount = firstAmount(norm, a);
    if (amount === undefined) continue;
    return { kind: v.kind, name: raw.slice(0, i).join(' '), amount };
  }
  // "<commodity> <market> don cost <amount>"
  for (let i = 1; i < norm.length; i++) {
    const v = matchVerb(norm, i, ['cost']);
    if (!v) continue;
    const { ref } = parseRef(raw.slice(0, i), norm.slice(0, i), 0, false);
    if (ref.commodity === undefined && ref.market === undefined) continue;
    return { kind: 'report', ...ref, amount: firstAmount(norm, i + v.len) };
  }
  // "<name> balance"
  const last = norm[norm.length - 1];
  if (norm.length >= 2 && last !== undefined && BALANCE.has(last)) {
    return { kind: 'book', name: raw.slice(0, -1).join(' ') };
  }
  return undefined;
}

/** Parses a message into a command, or `{ kind: 'unknown' }`. */
export function parseCommand(text: string): ParsedCommand {
  const { raw, norm } = tokenise(text);
  if (norm.length === 0) return { kind: 'unknown' };
  const balance = parseBalanceQuestion(raw, norm);
  if (balance) return balance;
  const cmd = matchCommand(norm);
  if (cmd) return parseCommandFirst(cmd.intent, raw, norm, cmd.len);
  return parseSentence(raw, norm) ?? { kind: 'unknown' };
}

/** Tool name for an intent name (from ojaConfig.intentTool). Unknown names go to the step tool. */
export function toolFor(intentName: string): string {
  return Object.hasOwn(ojaConfig.intentTool, intentName)
    ? ojaConfig.intentTool[intentName as IntentName]
    : ojaConfig.intentTool.freetext;
}
