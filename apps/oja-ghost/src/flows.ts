// Menu and USSD step machine. The flow record lives at oja:flow:<phone>; only picks are stored,
// never a half-built entry or report, so a timeout cannot apply anything (Requirement 10.5).
// Terminal results reuse the shared handlers from tools.ts, passed in (no runtime import of tools.ts).
import { LIMITS, renderMenuScreen, renderMenuScreens, type Store } from '@ghostline/kit';
import { ojaConfig } from './app.config.ts';
import type { Lang, MessageKey } from './copy.ts';
import { flowKey, type FlowName, type FlowRecord } from './keys.ts';
import { parseAmount } from './money.ts';
import { validName } from './names.ts';
import { parseCommand } from './parse.ts';
import type { Handler, HandlerCtx, ToolDeps } from './tools.ts';

/** The shared handlers a flow can finish with. */
export interface StepHandlers {
  price: Handler;
  report: Handler;
  ledger: Handler;
  book: Handler;
  remind: Handler;
  reminders: Handler;
  language: Handler;
  help: Handler;
}

const FLOWS: readonly FlowName[] = ['price', 'report', 'book', 'reminders', 'language'];
const ROOT_FLOWS: readonly FlowName[] = ['price', 'report', 'book', 'reminders', 'language'];

const msg = (lang: Lang, key: MessageKey): string => ojaConfig.copy[lang][key];

// ---------- flow record ----------

function isFlowRecord(v: unknown): v is FlowRecord {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Partial<FlowRecord>;
  return (
    r.v === 1 &&
    typeof r.flow === 'string' &&
    (FLOWS as readonly string[]).includes(r.flow) &&
    Array.isArray(r.path) &&
    r.path.every((p) => typeof p === 'string') &&
    r.data !== null &&
    typeof r.data === 'object' &&
    typeof r.exp === 'number'
  );
}

/** The active flow, or undefined when there is none or it has expired. */
export async function loadFlow(store: Store, phone: string, now: number): Promise<FlowRecord | undefined> {
  const rec = await store.read<unknown>(flowKey(phone));
  if (!isFlowRecord(rec)) return undefined;
  if (rec.exp <= now) {
    await store.delete(flowKey(phone));
    return undefined;
  }
  return rec;
}

async function saveFlow(store: Store, phone: string, now: number, flow: FlowName, path: string[]): Promise<void> {
  const rec: FlowRecord = { v: 1, flow, path, data: {}, exp: now + LIMITS.ussd.sessionTimeoutMs };
  await store.write(flowKey(phone), rec);
}

export async function clearFlow(store: Store, phone: string): Promise<void> {
  await store.delete(flowKey(phone));
}

// ---------- screens ----------

function screen(lang: Lang, title: string, labels: string[]): string {
  const options = labels.map((label, i) => ({ label, value: String(i + 1) }));
  const cfg = { title, backLabel: msg(lang, 'menuBackLabel'), menuLabel: msg(lang, 'menuMenuLabel') };
  return renderMenuScreens(options, cfg)[0] ?? renderMenuScreen([], 0, cfg);
}

const commodityIds = (): string[] => ojaConfig.commodities.slice(0, 5).map((c) => c.id);
const marketIds = (): string[] => ojaConfig.markets.slice(0, 5).map((m) => m.id);

/** The root menu: the state with no flow record. */
export function rootMenu(lang: Lang): string {
  const m = ojaConfig.copy[lang];
  return screen(lang, m.menuTitle, [m.menuPrice, m.menuReport, m.menuBook, m.menuReminders, m.menuLanguage]);
}

/** The screen for a flow at a path. */
function showScreen(flow: FlowName, path: string[], lang: Lang): string {
  const m = ojaConfig.copy[lang];
  const commodities = (): string => screen(lang, m.titleCommodity, ojaConfig.commodities.slice(0, 5).map((c) => c.name[lang]));
  const markets = (): string => screen(lang, m.titleMarket, ojaConfig.markets.slice(0, 5).map((x) => x.name));
  switch (flow) {
    case 'price':
      return path.length === 0 ? commodities() : markets();
    case 'report':
      if (path.length === 0) return commodities();
      return path.length === 1 ? markets() : screen(lang, m.titleReportAmount, []);
    case 'book':
      if (path[0] === 'add') return screen(lang, m.promptDebtLine, []);
      if (path[0] === 'pay') return screen(lang, m.promptPaidLine, []);
      return screen(lang, m.titleBook, [m.bookOptWho, m.bookOptAddDebt, m.bookOptAddPaid, m.bookOptUndo]);
    case 'reminders':
      if (path[0] === 'cancel') return screen(lang, m.promptCancelNumber, []);
      return screen(lang, m.titleReminders, [m.remOptList, m.remOptCancel]);
    case 'language':
      return screen(lang, m.titleLanguage, [m.langOptEn, m.langOptPcm]);
  }
}

/** Starts a flow at its first screen and returns that screen. */
export async function startFlow(store: Store, phone: string, now: number, flow: FlowName, lang: Lang): Promise<string> {
  await saveFlow(store, phone, now, flow, []);
  return showScreen(flow, [], lang);
}

// ---------- step handler ----------

/** A 1-based pick from a list of `size` items, or undefined. */
function pick(text: string, size: number): number | undefined {
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 && n <= size ? n : undefined;
}

export function stepHandler(deps: ToolDeps, h: StepHandlers): Handler {
  const { store } = deps;

  return async (ctx: HandlerCtx): Promise<string> => {
    const { phone, lang, now } = ctx;
    const text = ctx.text.trim();
    const flow = await loadFlow(store, phone, now);

    /** Runs a shared handler with a synthetic text, ends the flow and returns the result. */
    const finish = async (handler: Handler, synthetic: string): Promise<string> => {
      const reply = await handler({ ...ctx, text: synthetic });
      await clearFlow(store, phone);
      return reply;
    };
    const enter = async (name: FlowName, path: string[]): Promise<string> => {
      await saveFlow(store, phone, now, name, path);
      return showScreen(name, path, lang);
    };
    const repeat = (name: FlowName, path: string[], reason: string): string =>
      `${reason}\n${showScreen(name, path, lang)}`;

    // (1) back and menu
    if (text === '00') {
      await clearFlow(store, phone);
      return rootMenu(lang);
    }
    if (text === '0') {
      if (!flow || flow.path.length === 0) {
        await clearFlow(store, phone);
        return rootMenu(lang);
      }
      const path = flow.path.slice(0, -1);
      return enter(flow.flow, path);
    }

    // (2) an active flow takes the text
    if (flow) {
      const { path } = flow;
      switch (flow.flow) {
        case 'price': {
          const ids = path.length === 0 ? commodityIds() : marketIds();
          const n = pick(text, ids.length);
          if (n === undefined) return repeat('price', path, msg(lang, 'flowBadPick'));
          const id = ids[n - 1] as string;
          if (path.length === 0) return enter('price', [id]);
          return finish(h.price, `price ${path[0] as string} ${id}`);
        }
        case 'report': {
          if (path.length < 2) {
            const ids = path.length === 0 ? commodityIds() : marketIds();
            const n = pick(text, ids.length);
            if (n === undefined) return repeat('report', path, msg(lang, 'flowBadPick'));
            return enter('report', [...path, ids[n - 1] as string]);
          }
          const amount = parseAmount(text, ojaConfig.limits.maxAmount);
          if (amount === undefined) return repeat('report', path, msg(lang, 'badAmount'));
          return finish(h.report, `report ${path[0] as string} ${path[1] as string} ${amount}`);
        }
        case 'book': {
          if (path[0] === 'add' || path[0] === 'pay') {
            const verb = path[0] === 'add' ? 'owe' : 'paid';
            const parsed = parseCommand(`owe ${text}`);
            if (parsed.kind !== 'owe' || parsed.name === '' || parsed.amount === undefined) {
              return repeat('book', path, msg(lang, 'needNameAmount'));
            }
            if (!validName(parsed.name)) return repeat('book', path, msg(lang, 'invalidName'));
            return finish(h.ledger, `${verb} ${parsed.name.trim()} ${parsed.amount}`);
          }
          const n = pick(text, 4);
          if (n === undefined) return repeat('book', path, msg(lang, 'flowBadPick'));
          if (n === 1) return finish(h.book, 'book');
          if (n === 2) return enter('book', ['add']);
          if (n === 3) return enter('book', ['pay']);
          return finish(h.ledger, 'undo');
        }
        case 'reminders': {
          if (path[0] === 'cancel') {
            if (!/^\d{1,3}$/.test(text) || Number(text) < 1) return repeat('reminders', path, msg(lang, 'flowBadPick'));
            return finish(h.reminders, `cancel ${Number(text)}`);
          }
          const n = pick(text, 2);
          if (n === undefined) return repeat('reminders', path, msg(lang, 'flowBadPick'));
          if (n === 1) return finish(h.reminders, 'reminders');
          return enter('reminders', ['cancel']);
        }
        case 'language': {
          const n = pick(text, 2);
          if (n === undefined) return repeat('language', path, msg(lang, 'flowBadPick'));
          return finish(h.language, n === 1 ? 'english' : 'pidgin');
        }
      }
    }

    // (3) no flow: a digit starts one; otherwise a name-first or sentence command
    const start = pick(text, ROOT_FLOWS.length);
    if (/^\d$/.test(text) && start !== undefined) return enter(ROOT_FLOWS[start - 1] as FlowName, []);

    const cmd = parseCommand(text);
    switch (cmd.kind) {
      case 'price':
        return h.price(ctx);
      case 'report':
        return h.report(ctx);
      case 'owe':
      case 'paid':
      case 'overpaid':
      case 'undo':
        return h.ledger(ctx);
      case 'book':
        return h.book(ctx);
      case 'remind':
      case 'supplier':
        return h.remind(ctx);
      case 'reminders':
      case 'cancel':
        return h.reminders(ctx);
      case 'language':
        return h.language(ctx);
      case 'menu':
        return rootMenu(lang);
      case 'help':
        return h.help(ctx);
      case 'unknown':
        return ctx.channel === 'ussd'
          ? msg(lang, 'unrecognizedUssd')
          : msg(lang, 'unrecognized');
    }
  };
}
