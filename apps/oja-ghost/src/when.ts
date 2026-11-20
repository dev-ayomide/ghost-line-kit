// Dates in Lagos time (UTC+1, no daylight saving): lagosDay, parseWhen and agoText. Pure: time is a parameter.
import { ojaConfig } from './app.config.ts';
import { fill, type Lang } from './copy.ts';

/** Lowercase words, as the parser produces them. */
export type Tokens = string[];

export interface WhenCfg {
  reminderHorizonDays: number;
  reminderDefaultHour: number;
}

export type WhenResult = { ok: true; dueAt: number } | { ok: false };

const OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** The Lagos calendar day of an instant, as YYYY-MM-DD. */
export function lagosDay(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

const WEEKDAYS = new Map<string, number>([
  ['sunday', 0], ['sun', 0],
  ['monday', 1], ['mon', 1],
  ['tuesday', 2], ['tue', 2], ['tues', 2],
  ['wednesday', 3], ['wed', 3],
  ['thursday', 4], ['thu', 4], ['thur', 4], ['thurs', 4],
  ['friday', 5], ['fri', 5],
  ['saturday', 6], ['sat', 6],
]);

const MONTHS = new Map<string, number>([
  ['jan', 0], ['january', 0],
  ['feb', 1], ['february', 1],
  ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3],
  ['may', 4],
  ['jun', 5], ['june', 5],
  ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7],
  ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9],
  ['nov', 10], ['november', 10],
  ['dec', 11], ['december', 11],
]);

type DateShape =
  | { k: 'today' }
  | { k: 'tomorrow' }
  | { k: 'days'; n: number }
  | { k: 'weekday'; d: number }
  | { k: 'date'; day: number; month: number };

interface Shape {
  date: DateShape;
  time?: { h: number; m: number };
}

const LEAD = new Set<string>(
  (Object.values(ojaConfig.words) as { whenLead: readonly string[] }[]).flatMap((w) => [...w.whenLead]),
);
const TIME = /^(\d{1,2}):(\d{2})$/;
const SMALL_INT = /^\d{1,3}$/;
const DAY_NUM = /^\d{1,2}$/;

function parseShape(tokens: Tokens): Shape | undefined {
  const toks = tokens.filter((t) => !LEAD.has(t));
  let time: Shape['time'];
  const last = toks[toks.length - 1];
  const tm = last === undefined ? null : TIME.exec(last);
  if (tm) {
    const h = Number(tm[1]);
    const m = Number(tm[2]);
    if (h > 23 || m > 59) return undefined;
    time = { h, m };
    toks.pop();
  }
  const [a, b, c] = toks;
  let date: DateShape | undefined;
  if (toks.length === 1 && a !== undefined) {
    if (a === 'today') date = { k: 'today' };
    else if (a === 'tomorrow') date = { k: 'tomorrow' };
    else if (WEEKDAYS.has(a)) date = { k: 'weekday', d: WEEKDAYS.get(a) as number };
  } else if (toks.length === 2 && a !== undefined && b !== undefined) {
    if (DAY_NUM.test(a) && MONTHS.has(b)) {
      const day = Number(a);
      if (day >= 1 && day <= 31) date = { k: 'date', day, month: MONTHS.get(b) as number };
    }
  } else if (toks.length === 3 && a !== undefined && b !== undefined && c !== undefined) {
    if ((a === 'in' || a === 'after') && SMALL_INT.test(b) && (c === 'day' || c === 'days')) {
      date = { k: 'days', n: Number(b) };
    }
  }
  if (!date) return undefined;
  return time ? { date, time } : { date };
}

/** True when `tokens` have the shape of a date (with optional time). Needs no clock. */
export function isWhenTokens(tokens: Tokens): boolean {
  return parseShape(tokens) !== undefined;
}

/**
 * Turns date words into an instant (epoch ms). Forms: today, tomorrow, "in N days"
 * ("after N days"), a weekday (the next one, never today), "D Mon", each with an
 * optional HH:MM. Default time is cfg.reminderDefaultHour in Lagos. The result must be
 * after `nowMs` and at most cfg.reminderHorizonDays ahead.
 */
export function parseWhen(tokens: Tokens, nowMs: number, cfg: WhenCfg): WhenResult {
  const NO: WhenResult = { ok: false };
  if (!Number.isFinite(nowMs)) return NO;
  const shape = parseShape(tokens);
  if (!shape) return NO;

  const local = new Date(nowMs + OFFSET_MS);
  const y = local.getUTCFullYear();
  const todayStart = Date.UTC(y, local.getUTCMonth(), local.getUTCDate());

  let dayStart: number;
  const d = shape.date;
  switch (d.k) {
    case 'today':
      dayStart = todayStart;
      break;
    case 'tomorrow':
      dayStart = todayStart + DAY_MS;
      break;
    case 'days':
      dayStart = todayStart + d.n * DAY_MS;
      break;
    case 'weekday': {
      const delta = (d.d - local.getUTCDay() + 7) % 7 || 7;
      dayStart = todayStart + delta * DAY_MS;
      break;
    }
    case 'date': {
      let found: number | undefined;
      for (const yr of [y, y + 1]) {
        const t = Date.UTC(yr, d.month, d.day);
        const chk = new Date(t);
        if (chk.getUTCMonth() === d.month && chk.getUTCDate() === d.day && t >= todayStart) {
          found = t;
          break;
        }
      }
      if (found === undefined) return NO;
      dayStart = found;
      break;
    }
  }

  const h = shape.time?.h ?? cfg.reminderDefaultHour;
  const m = shape.time?.m ?? 0;
  const dueAt = dayStart + (h * 60 + m) * MIN_MS - OFFSET_MS;
  if (!(dueAt > nowMs) || dueAt > nowMs + cfg.reminderHorizonDays * DAY_MS) return NO;
  return { ok: true, dueAt };
}

/** "10 min ago", "2 hours ago", "1 day ago", in the Trader's language. */
export function agoText(deltaMs: number, lang: Lang): string {
  const msgs = ojaConfig.copy[lang];
  const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const mins = Math.floor(delta / MIN_MS);
  if (mins < 1) return msgs.agoNow;
  if (mins < 60) return fill(msgs.agoMin, { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fill(hours === 1 ? msgs.agoHour : msgs.agoHours, { n: hours });
  const days = Math.floor(hours / 24);
  return fill(days === 1 ? msgs.agoDay : msgs.agoDays, { n: days });
}
