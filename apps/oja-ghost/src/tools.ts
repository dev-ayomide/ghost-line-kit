// Tools: defineTool helper and the core tools price, report_price, ledger and book.
// I/O lives here; the decisions are made by the pure modules. Replies are built from config copy.
import type { Clock, Store, Tool } from '@ghostline/kit';
import { z } from 'zod';
import { ojaConfig, type CommodityDef, type MarketDef } from './app.config.ts';
import { fill, type Lang, type MessageKey } from './copy.ts';
import {
  bookKey,
  langKey,
  pxKey,
  pxLastKey,
  remKey,
  repKey,
  REM_INDEX_KEY,
  type LangRecord,
  type PxLastRecord,
  type RepRecord,
} from './keys.ts';
import { applyLedger, balanceOf, emptyLedger, totalOwed, type Debtor, type Ledger } from './ledger.ts';
import { formatN, parseAmount } from './money.ts';
import { normaliseName, validName } from './names.ts';
import { parseCommand, type ParsedCommand } from './parse.ts';
import { addReport, average, displayStats, emptyDay, refPrice, type PriceDay } from './prices.ts';
import { activeList, cancelNth, createReminder, prune, type Reminder } from './reminders.ts';
import { agoText, lagosDay, parseWhen } from './when.ts';
import { clearFlow, rootMenu, startFlow, stepHandler, type StepHandlers } from './flows.ts';

export const Input = z.object({
  phoneNumber: z.string().min(5).max(20),
  channel: z.enum(['sms', 'ussd', 'web']),
  text: z.string().max(320),
});
export type ToolInput = z.infer<typeof Input>;

export interface ToolDeps {
  store: Store;
  clock: Clock;
  demo: boolean;
  /** Seeds the demo data once. Injected so tools do not depend on seed.ts. Default: no-op. */
  ensureSeeded?: () => Promise<void>;
}

export interface HandlerCtx {
  phone: string;
  channel: ToolInput['channel'];
  text: string;
  lang: Lang;
  now: number;
  firstReply: boolean;
}

export type Handler = (ctx: HandlerCtx) => Promise<string>;

const LINE_USSD_MAX = 140;

function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'pcm';
}

async function loadLang(
  deps: ToolDeps,
  phone: string,
): Promise<{ lang: Lang; firstReply: boolean }> {
  const rec = await deps.store.read<unknown>(langKey(phone));
  if (rec === undefined || rec === null) {
    const fresh: LangRecord = { v: 1, lang: 'en' };
    await deps.store.write(langKey(phone), fresh);
    return { lang: 'en', firstReply: true };
  }
  const lang = typeof rec === 'object' ? (rec as { lang?: unknown }).lang : undefined;
  return { lang: isLang(lang) ? lang : 'en', firstReply: false };
}

/**
 * Wraps a handler: seed, language, demo notice on the first reply. Handler errors are not
 * caught here; the registry turns them into the kit's generic failure message.
 */
export function defineTool(deps: ToolDeps, name: string, description: string, handler: Handler): Tool {
  return {
    name,
    description,
    inputSchema: Input,
    execute: async (raw: unknown): Promise<string> => {
      const input = Input.parse(raw);
      if (deps.ensureSeeded) await deps.ensureSeeded();
      const { lang, firstReply } = await loadLang(deps, input.phoneNumber);
      const reply = await handler({
        phone: input.phoneNumber,
        channel: input.channel,
        text: input.text,
        lang,
        now: deps.clock.now(),
        firstReply,
      });
      // USSD screens are 140 characters: the demo label is in the menu title and the help text instead.
      if (firstReply && deps.demo && input.channel !== 'ussd') {
        return `${ojaConfig.copy[lang].demoNotice}\n${reply}`;
      }
      return reply;
    },
  };
}

/**
 * A tool reached by a command word. It ends any active menu flow first, so a command typed
 * in the middle of a flow is never read as that flow's input.
 */
function commandTool(deps: ToolDeps, name: string, description: string, handler: Handler): Tool {
  return defineTool(deps, name, description, async (ctx) => {
    await clearFlow(deps.store, ctx.phone);
    return handler(ctx);
  });
}

// ---------- small helpers ----------

const msg = (lang: Lang, key: MessageKey): string => ojaConfig.copy[lang][key];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-12" -> "12 Nov". */
function fmtDay(day: string): string {
  const [, m, d] = day.split('-');
  const month = MONTH_ABBR[Number(m) - 1];
  if (!month || !d) return day;
  return `${Number(d)} ${month}`;
}

const commodityDef = (id: string): CommodityDef | undefined =>
  ojaConfig.commodities.find((c) => c.id === id);
const marketDef = (id: string): MarketDef | undefined => ojaConfig.markets.find((m) => m.id === id);

const commodityList = (lang: Lang): string =>
  ojaConfig.commodities
    .slice(0, 5)
    .map((c) => c.name[lang])
    .join(', ');
const marketList = (): string =>
  ojaConfig.markets
    .slice(0, 5)
    .map((m) => m.name)
    .join(', ');

interface Resolved {
  commodity: CommodityDef;
  market: MarketDef;
}

/** Resolves commodity and market from a parsed command, or returns the reply to send. */
function resolveRef(
  cmd: Extract<ParsedCommand, { kind: 'price' | 'report' }> | { kind: 'other' },
  lang: Lang,
): { ok: true; value: Resolved } | { ok: false; reply: string } {
  const c = 'commodity' in cmd && cmd.commodity ? commodityDef(cmd.commodity) : undefined;
  if (!c) return { ok: false, reply: fill(msg(lang, 'unknownCommodity'), { list: commodityList(lang) }) };
  const m = 'market' in cmd && cmd.market ? marketDef(cmd.market) : undefined;
  if (!m) return { ok: false, reply: fill(msg(lang, 'unknownMarket'), { list: marketList() }) };
  return { ok: true, value: { commodity: c, market: m } };
}

async function readDay(deps: ToolDeps, market: string, commodity: string, day: string): Promise<PriceDay | undefined> {
  return deps.store.read<PriceDay>(pxKey(market, commodity, day));
}

// ---------- price ----------

export function priceHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const cmd = parseCommand(ctx.text);
    const r = resolveRef(cmd.kind === 'price' || cmd.kind === 'report' ? cmd : { kind: 'other' }, ctx.lang);
    if (!r.ok) return r.reply;
    const { commodity, market } = r.value;
    const ussd = ctx.channel === 'ussd';
    const suffix = ussd ? 'Ussd' : '';
    const base = {
      commodity: commodity.name[ctx.lang],
      unit: commodity.unit[ctx.lang],
      market: market.name,
    };
    const today = lagosDay(ctx.now);

    const todayDay = await readDay(deps, market.id, commodity.id, today);
    const stats = todayDay ? displayStats(todayDay) : undefined;
    if (stats) {
      const key = (stats.demo ? 'priceLiveDemo' : 'priceLive') + suffix;
      return fill(msg(ctx.lang, key as MessageKey), {
        ...base,
        amount: formatN(stats.amount),
        n: stats.n,
        ago: agoText(ctx.now - stats.lastAt, ctx.lang),
      });
    }

    const ptr = await deps.store.read<PxLastRecord>(pxLastKey(market.id, commodity.id));
    if (ptr && typeof ptr.day === 'string' && ptr.day !== today) {
      const oldDay = await readDay(deps, market.id, commodity.id, ptr.day);
      const old = oldDay ? displayStats(oldDay) : undefined;
      if (old) {
        const key = (old.demo ? 'priceOldDemo' : 'priceOld') + suffix;
        return fill(msg(ctx.lang, key as MessageKey), {
          ...base,
          amount: formatN(old.amount),
          date: fmtDay(ptr.day),
        });
      }
    }

    const ref = refPrice(market.id, commodity.id) ?? 0;
    return fill(msg(ctx.lang, ussd ? 'priceRefUssd' : 'priceRef'), { ...base, amount: formatN(ref) });
  };
}

export function priceTool(deps: ToolDeps): Tool {
  return commandTool(deps, 'price', 'Look up the price of a commodity at a market', priceHandler(deps));
}

// ---------- report_price ----------

export function reportHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const cmd = parseCommand(ctx.text);
    const r = resolveRef(cmd.kind === 'price' || cmd.kind === 'report' ? cmd : { kind: 'other' }, ctx.lang);
    if (!r.ok) return r.reply;
    const { commodity, market } = r.value;

    const amount =
      cmd.kind === 'report' && cmd.amount !== undefined
        ? parseAmount(String(cmd.amount), ojaConfig.limits.maxAmount)
        : undefined;
    if (amount === undefined) {
      return msg(ctx.lang, /\d/.test(ctx.text) && cmd.kind === 'report' ? 'badAmount' : 'reportNeedAmount');
    }

    const today = lagosDay(ctx.now);
    const stored = await deps.store.read<RepRecord>(repKey(ctx.phone));
    const rep: RepRecord = stored && Array.isArray(stored.reports) && stored.today
      ? stored
      : { v: 1, today: { day: today, count: 0 }, reports: [] };
    const count = rep.today.day === today ? rep.today.count : 0;
    const max = ojaConfig.limits.maxReportsPerDay;
    if (count >= max) return fill(msg(ctx.lang, 'reportCap'), { max });

    const dayKey = pxKey(market.id, commodity.id, today);
    const day = (await deps.store.read<PriceDay>(dayKey)) ?? emptyDay();
    // The index keeps every (key, id) of this Trader, so DELETE can remove rejected reports too.
    const mine = rep.reports.filter(
      (e) => e !== null && typeof e === 'object' && typeof e.key === 'string' && Number.isInteger(e.id),
    );
    const mineHere = mine.filter((e) => e.key === dayKey);
    const latest = (ids: number[]): number | undefined => (ids.length > 0 ? Math.max(...ids) : undefined);
    const replaceId =
      latest(mineHere.filter((e) => day.accepted.some((x) => x.id === e.id)).map((e) => e.id)) ??
      latest(mineHere.filter((e) => day.rejected.some((x) => x.id === e.id)).map((e) => e.id));
    const ref = refPrice(market.id, commodity.id) ?? amount;
    const res = addReport(
      day,
      replaceId !== undefined ? { amount, at: ctx.now, replaceId } : { amount, at: ctx.now },
      ref,
      ojaConfig.outlier,
    );

    // Write order: day record, pointer, index.
    await deps.store.write(dayKey, res.day);
    if (res.day.accepted.length > 0) {
      const ptr: PxLastRecord = { v: 1, day: today };
      await deps.store.write(pxLastKey(market.id, commodity.id), ptr);
    }
    // Keep every id of this Trader for this day that is still in the day record, plus the new one.
    const present = (id: number): boolean =>
      res.day.accepted.some((x) => x.id === id) || res.day.rejected.some((x) => x.id === id);
    const hereIds = [...mineHere.map((e) => e.id), res.id].filter(present);
    const reports = [
      ...mine.filter((e) => e.key !== dayKey),
      ...hereIds.map((id) => ({ key: dayKey, id })),
    ];
    const nextRep: RepRecord = { v: 1, today: { day: today, count: count + 1 }, reports };
    await deps.store.write(repKey(ctx.phone), nextRep);

    const names = { commodity: commodity.name[ctx.lang], market: market.name };
    if (!res.verdict.accepted) {
      return fill(msg(ctx.lang, ctx.channel === 'ussd' ? 'reportNotAddedUssd' : 'reportNotAdded'), {
        commodity: commodity.id,
        market: market.id,
        amount: formatN(amount),
        low: formatN(res.verdict.low),
        high: formatN(res.verdict.high),
      });
    }
    const stats = displayStats(res.day);
    const avg = stats?.amount ?? average(res.day.accepted.map((x) => x.amount)) ?? amount;
    return fill(msg(ctx.lang, stats?.demo ? 'reportAddedDemo' : 'reportAdded'), {
      ...names,
      amount: formatN(amount),
      avg: formatN(avg),
      n: stats?.n ?? res.day.accepted.length,
    });
  };
}

export function reportPriceTool(deps: ToolDeps): Tool {
  return commandTool(deps, 'report_price', 'Report a price you paid at a market', reportHandler(deps));
}

// ---------- ledger ----------

async function loadLedger(deps: ToolDeps, phone: string): Promise<Ledger> {
  return (await deps.store.read<Ledger>(bookKey(phone))) ?? emptyLedger();
}

function debtorNames(l: Ledger): string {
  return Object.values(l.debtors)
    .slice(0, 5)
    .map((d) => d.display)
    .join(', ');
}

function unknownDebtorReply(l: Ledger, name: string, lang: Lang): string {
  const list = debtorNames(l);
  return list === ''
    ? fill(msg(lang, 'unknownDebtorEmpty'), { name })
    : fill(msg(lang, 'unknownDebtor'), { name, list });
}

export function ledgerHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const cmd = parseCommand(ctx.text);
    const lang = ctx.lang;
    const limits = ojaConfig.limits;
    if (cmd.kind !== 'owe' && cmd.kind !== 'paid' && cmd.kind !== 'overpaid' && cmd.kind !== 'undo') {
      return msg(lang, 'needNameAmount');
    }

    const book = await loadLedger(deps, ctx.phone);
    const typedAmount = 'amount' in cmd ? cmd.amount : undefined;
    let name = '';
    let result;
    if (!('name' in cmd)) {
      result = applyLedger(book, { kind: 'undo' }, limits);
    } else {
      name = cmd.name.trim();
      if (name === '' || typedAmount === undefined) return msg(lang, 'needNameAmount');
      if (!validName(name)) return msg(lang, 'invalidName');
      result = applyLedger(book, { kind: cmd.kind, name, amount: typedAmount, at: ctx.now }, limits);
    }

    if (!result.ok) {
      switch (result.reason) {
        case 'exceeds_balance':
          return fill(msg(lang, ctx.channel === 'ussd' ? 'exceedsBalanceUssd' : 'exceedsBalance'), {
            name,
            balance: formatN(result.balance),
            amount: formatN(typedAmount ?? 0),
          });
        case 'unknown_debtor':
          return unknownDebtorReply(book, name, lang);
        case 'too_many_debtors':
          return fill(msg(lang, 'tooManyDebtors'), { max: limits.maxDebtors });
        case 'too_many_entries':
          return fill(msg(lang, 'tooManyEntries'), { name, max: limits.maxEntriesPerDebtor });
        case 'nothing_to_undo':
          return msg(lang, 'nothingToUndo');
        case 'invalid_name':
          return msg(lang, 'invalidName');
        case 'invalid_amount':
          return msg(lang, 'badAmount');
      }
    }

    await deps.store.write(bookKey(ctx.phone), result.ledger);
    const who = result.debtor ?? name;
    const balance = result.balance ?? 0;
    const credit = formatN(Math.abs(balance));

    if (cmd.kind === 'undo') {
      if (!Object.hasOwn(result.ledger.debtors, normaliseName(who))) return fill(msg(lang, 'undoneGone'), { name: who });
      return balance < 0
        ? fill(msg(lang, 'undoneCredit'), { name: who, credit })
        : fill(msg(lang, 'undone'), { name: who, balance: formatN(balance) });
    }
    if (cmd.kind === 'owe') return fill(msg(lang, 'ledgerOwe'), { name: who, balance: formatN(balance) });
    if (balance < 0) return fill(msg(lang, 'ledgerOverpaid'), { name: who, credit });
    return fill(msg(lang, 'ledgerPaid'), {
      name: who,
      amount: formatN(typedAmount ?? 0),
      balance: formatN(balance),
    });
  };
}

export function ledgerTool(deps: ToolDeps): Tool {
  return commandTool(
    deps,
    'ledger',
    'Add a debt, a payment, an overpayment, or undo the last entry',
    ledgerHandler(deps),
  );
}

// ---------- book ----------

/** Joins rows under a summary, dropping rows from the end until the USSD limit holds. */
function fitUssd(build: (rows: string[]) => string, rows: string[]): string {
  let n = rows.length;
  let out = build(rows.slice(0, n));
  while (out.length > LINE_USSD_MAX && n > 1) {
    n -= 1;
    out = build(rows.slice(0, n));
  }
  return out;
}

function entryText(d: Debtor, lang: Lang, count: number): string[] {
  return d.entries
    .slice(-count)
    .reverse()
    .map((e) => {
      const key = e.type === 'owe' ? 'entryOwe' : e.type === 'paid' ? 'entryPaid' : 'entryOverpaid';
      return fill(msg(lang, key), { amount: formatN(e.amount), date: fmtDay(lagosDay(e.at)) });
    });
}

export function bookHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const cmd = parseCommand(ctx.text);
    const lang = ctx.lang;
    const ussd = ctx.channel === 'ussd';
    const book = await loadLedger(deps, ctx.phone);
    const debtors = Object.entries(book.debtors);

    if (cmd.kind === 'book' && cmd.name) {
      const name = cmd.name.trim();
      if (!validName(name)) return msg(lang, 'invalidName');
      const key = normaliseName(name);
      const d = Object.hasOwn(book.debtors, key) ? book.debtors[key] : undefined;
      if (!d) return unknownDebtorReply(book, name, lang);
      const bal = balanceOf(d);
      const tpl: MessageKey = bal > 0 ? 'bookDebtor' : bal < 0 ? 'bookDebtorCredit' : 'bookDebtorZero';
      const build = (n: number): string =>
        fill(msg(lang, tpl), {
          name: d.display,
          balance: formatN(bal),
          credit: formatN(Math.abs(bal)),
          entries: entryText(d, lang, n).join(', '),
        });
      let n = 3;
      let out = build(n);
      while (ussd && out.length > LINE_USSD_MAX && n > 1) {
        n -= 1;
        out = build(n);
      }
      return out;
    }

    if (debtors.length === 0) return msg(lang, 'bookEmpty');

    const owing = debtors
      .map(([, d]) => ({ d, bal: balanceOf(d) }))
      .filter((x) => x.bal > 0)
      .sort((a, b) => b.bal - a.bal || a.d.display.localeCompare(b.d.display));
    const credits = debtors
      .map(([, d]) => ({ d, bal: balanceOf(d) }))
      .filter((x) => x.bal < 0)
      .sort((a, b) => a.bal - b.bal || a.d.display.localeCompare(b.d.display));

    const limit = ussd ? ojaConfig.limits.ussdListRows : ojaConfig.limits.smsListRows;
    const shown = ussd ? owing.slice(0, limit) : owing;
    const rows = shown.map((x) => fill(msg(lang, 'bookRow'), { name: x.d.display, balance: formatN(x.bal) }));
    const creditRows = credits
      .slice(0, limit)
      .map((x) => fill(msg(lang, 'bookCredit'), { name: x.d.display, credit: formatN(Math.abs(x.bal)) }));

    if (owing.length === 0) {
      const head = msg(lang, 'bookClear');
      return ussd ? head : [head, ...creditRows].join('\n');
    }

    const total = formatN(totalOwed(book));
    if (ussd) {
      const key: MessageKey = book.demo ? 'bookSummaryDemoUssd' : 'bookSummaryUssd';
      return fitUssd((r) => fill(msg(lang, key), { total, rows: r.join('\n') }), rows);
    }
    const key: MessageKey = book.demo ? 'bookSummaryDemo' : 'bookSummary';
    return [fill(msg(lang, key), { total, rows: rows.join('\n') }), ...creditRows].join('\n');
  };
}

export function bookTool(deps: ToolDeps): Tool {
  return commandTool(deps, 'book', 'Show who owes you, or one debtor in detail', bookHandler(deps));
}

// ---------- reminders ----------

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Lagos date and time in plain words. long: "Friday 15 Dec at 08:00". short: "Fri 15 Dec, 08:00". */
function whenText(dueAt: number, long: boolean): string {
  const d = new Date(dueAt + 3_600_000);
  const wd = WEEKDAY_NAMES[d.getUTCDay()] ?? '';
  const mon = MONTH_ABBR[d.getUTCMonth()] ?? '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return long
    ? `${wd} ${d.getUTCDate()} ${mon} at ${hh}:${mm}`
    : `${wd.slice(0, 3)} ${d.getUTCDate()} ${mon}, ${hh}:${mm}`;
}

async function loadReminders(deps: ToolDeps, phone: string): Promise<Reminder[]> {
  const rec = await deps.store.read<unknown>(remKey(phone));
  return Array.isArray(rec) ? (rec as Reminder[]) : [];
}

async function loadIndex(deps: ToolDeps): Promise<string[]> {
  const rec = await deps.store.read<unknown>(REM_INDEX_KEY);
  return Array.isArray(rec) ? (rec as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

export function remindHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const lang = ctx.lang;
    if (ctx.channel === 'ussd') return msg(lang, 'reminderOnlySms');
    const cmd = parseCommand(ctx.text);
    if (cmd.kind !== 'remind' && cmd.kind !== 'supplier') return msg(lang, 'reminderNeedName');
    const typed = cmd.name.trim();
    if (typed === '') return msg(lang, 'reminderNeedName');
    if (!validName(typed)) return msg(lang, 'invalidName');

    let name = typed;
    let amount: number | undefined;
    if (cmd.kind === 'supplier') {
      amount = cmd.amount !== undefined ? parseAmount(String(cmd.amount), ojaConfig.limits.maxAmount) : undefined;
    } else {
      const book = await loadLedger(deps, ctx.phone);
      const key = normaliseName(typed);
      const debtor = Object.hasOwn(book.debtors, key) ? book.debtors[key] : undefined;
      if (!debtor) return unknownDebtorReply(book, typed, lang);
      name = debtor.display;
    }

    const when = parseWhen(cmd.when, ctx.now, ojaConfig.limits);
    if (!when.ok) return msg(lang, 'reminderBadDate');

    const existing = prune(await loadReminders(deps, ctx.phone), ctx.now);
    const created = createReminder(
      existing,
      { kind: cmd.kind === 'supplier' ? 'supplier' : 'debt', name, amount, dueAt: when.dueAt },
      ctx.now,
      ojaConfig.limits.maxActiveReminders,
    );
    if (!created.ok) return fill(msg(lang, 'reminderTooMany'), { max: ojaConfig.limits.maxActiveReminders });

    // Write order: the reminders, then the index.
    await deps.store.write(remKey(ctx.phone), created.list);
    const index = await loadIndex(deps);
    if (!index.includes(ctx.phone)) await deps.store.write(REM_INDEX_KEY, [...index, ctx.phone]);

    const w = whenText(when.dueAt, true);
    if (created.reminder.kind === 'debt') return fill(msg(lang, 'reminderCreatedDebt'), { when: w, name });
    const text = fill(msg(lang, 'reminderCreatedSupplier'), {
      when: w,
      name,
      amount: amount === undefined ? '' : formatN(amount),
    });
    // Without an amount the template leaves " ." before the full stop.
    return amount === undefined ? text.replace(' .', '.') : text;
  };
}

function reminderRow(r: Reminder, n: number, lang: Lang): string {
  const when = whenText(r.dueAt, false);
  if (r.kind === 'debt') return fill(msg(lang, 'reminderRowDebt'), { n, when, name: r.name });
  return fill(msg(lang, 'reminderRowSupplier'), {
    n,
    when,
    name: r.name,
    amount: r.amount === undefined ? '' : formatN(r.amount),
  }).trimEnd();
}

export function remindersHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const lang = ctx.lang;
    const cmd = parseCommand(ctx.text);
    const list = await loadReminders(deps, ctx.phone);

    if (cmd.kind === 'cancel' && cmd.n !== undefined) {
      const res = cancelNth(list, cmd.n);
      if (!res.ok) return fill(msg(lang, 'reminderCancelBad'), { n: cmd.n });
      await deps.store.write(remKey(ctx.phone), prune(res.list, ctx.now));
      if (activeList(res.list).length === 0) {
        const index = await loadIndex(deps);
        if (index.includes(ctx.phone)) {
          await deps.store.write(REM_INDEX_KEY, index.filter((p) => p !== ctx.phone));
        }
      }
      return fill(msg(lang, 'reminderCancelled'), { n: cmd.n });
    }

    const active = activeList(list);
    if (active.length === 0) return msg(lang, 'reminderEmpty');
    const ussd = ctx.channel === 'ussd';
    const rows = active.map((r, i) => reminderRow(r, i + 1, lang));
    if (ussd) {
      const shown = rows.slice(0, ojaConfig.limits.ussdListRows);
      return fitUssd((r) => fill(msg(lang, 'reminderListUssd'), { rows: r.join('\n') }), shown);
    }
    return fill(msg(lang, 'reminderList'), { rows: rows.join('\n') });
  };
}

// ---------- language, help, menu, step ----------

export function languageHandler(deps: ToolDeps): Handler {
  return async (ctx) => {
    const cmd = parseCommand(ctx.text);
    const target = cmd.kind === 'language' ? cmd.lang : undefined;
    if (target === undefined) return startFlow(deps.store, ctx.phone, ctx.now, 'language', ctx.lang);
    const rec: LangRecord = { v: 1, lang: target };
    await deps.store.write(langKey(ctx.phone), rec);
    return msg(target, 'languageSet');
  };
}

export function helpHandler(): Handler {
  return async (ctx) => msg(ctx.lang, ctx.channel === 'ussd' ? 'helpUssd' : 'help');
}

/** Every tool of the app, named as in ojaConfig.intentTool. */
export function coreTools(deps: ToolDeps): Tool[] {
  const handlers: StepHandlers = {
    price: priceHandler(deps),
    report: reportHandler(deps),
    ledger: ledgerHandler(deps),
    book: bookHandler(deps),
    remind: remindHandler(deps),
    reminders: remindersHandler(deps),
    language: languageHandler(deps),
    help: helpHandler(),
  };
  return [
    defineTool(deps, 'menu', 'Show the main menu', async (ctx) => {
      await clearFlow(deps.store, ctx.phone);
      return rootMenu(ctx.lang);
    }),
    commandTool(deps, 'help', 'Show the commands with an example each', handlers.help),
    defineTool(deps, 'step', 'Handle a menu choice, typed flow input or a name-first command', stepHandler(deps, handlers)),
    priceTool(deps),
    reportPriceTool(deps),
    ledgerTool(deps),
    bookTool(deps),
    commandTool(deps, 'remind', 'Set a reminder for a debt or a supplier payment', handlers.remind),
    commandTool(deps, 'reminders', 'List or cancel reminders', handlers.reminders),
    commandTool(deps, 'language', 'Choose English or Pidgin', handlers.language),
  ];
}
