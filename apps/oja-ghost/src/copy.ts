// Message templates: types and the fill/t helpers. The templates themselves live in app.config.ts.
import { ojaConfig } from './app.config.ts';

export type Lang = 'en' | 'pcm';
export const LANGS: readonly Lang[] = ['en', 'pcm'];

/**
 * Every template of one language. Both languages use this one interface, so a key
 * missing in either language is a type error. Templates use {slot} placeholders.
 * Keys ending in `Ussd` are shorter variants for USSD screens.
 */
export interface Messages {
  /** true when a native speaker has not reviewed the wording yet. */
  needsReview: boolean;

  // First reply, help, errors
  demoNotice: string;
  help: string;
  helpUssd: string;
  unrecognized: string;
  unrecognizedUssd: string;
  tryAgain: string;
  rateLimited: string;

  // Time ("{n} min ago")
  agoNow: string;
  agoMin: string;
  agoHour: string;
  agoHours: string;
  agoDay: string;
  agoDays: string;

  // Price
  priceLive: string;
  priceLiveDemo: string;
  priceOld: string;
  priceOldDemo: string;
  priceRef: string;
  priceLiveUssd: string;
  priceLiveDemoUssd: string;
  priceOldUssd: string;
  priceOldDemoUssd: string;
  priceRefUssd: string;
  unknownCommodity: string;
  unknownMarket: string;

  // Report
  reportAdded: string;
  reportAddedDemo: string;
  reportNotAdded: string;
  reportNotAddedUssd: string;
  reportCap: string;
  reportNeedAmount: string;
  badAmount: string;

  // Ledger
  ledgerOwe: string;
  ledgerPaid: string;
  ledgerOverpaid: string;
  exceedsBalance: string;
  exceedsBalanceUssd: string;
  unknownDebtor: string;
  unknownDebtorEmpty: string;
  invalidName: string;
  needNameAmount: string;
  tooManyDebtors: string;
  tooManyEntries: string;
  nothingToUndo: string;
  undone: string;
  undoneCredit: string;
  undoneGone: string;

  // Book
  bookSummary: string;
  bookSummaryDemo: string;
  bookSummaryUssd: string;
  bookSummaryDemoUssd: string;
  bookRow: string;
  bookMore: string;
  bookCredit: string;
  bookEmpty: string;
  bookClear: string;
  bookDebtor: string;
  bookDebtorCredit: string;
  bookDebtorZero: string;
  entryOwe: string;
  entryPaid: string;
  entryOverpaid: string;

  // Reminders
  reminderCreatedDebt: string;
  reminderCreatedSupplier: string;
  reminderList: string;
  reminderListUssd: string;
  reminderRowDebt: string;
  reminderRowSupplier: string;
  reminderEmpty: string;
  reminderCancelled: string;
  reminderCancelBad: string;
  reminderTooMany: string;
  reminderBadDate: string;
  reminderNeedName: string;
  reminderOnlySms: string;
  reminderSmsDebt: string;
  reminderSmsSupplier: string;
  reminderSmsSupplierNoAmount: string;
  /** Next step on a reminder SMS, in the Trader's language. GSM-7, at most 40 characters. */
  reminderNextStep: string;

  // Language
  languageSet: string;

  // Menus and flows (labels and prompts)
  menuTitle: string;
  menuPrice: string;
  menuReport: string;
  menuBook: string;
  menuReminders: string;
  menuLanguage: string;
  menuBackLabel: string;
  menuMenuLabel: string;
  titleCommodity: string;
  titleMarket: string;
  titleReportAmount: string;
  titleBook: string;
  bookOptWho: string;
  bookOptAddDebt: string;
  bookOptAddPaid: string;
  bookOptUndo: string;
  titleReminders: string;
  remOptList: string;
  remOptCancel: string;
  titleLanguage: string;
  langOptEn: string;
  langOptPcm: string;
  promptDebtLine: string;
  promptPaidLine: string;
  promptCancelNumber: string;
  flowBadPick: string;
}

/** Keys that hold a template string (everything except the review flag). */
export type MessageKey = Exclude<keyof Messages, 'needsReview'>;

const SLOT = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * Replaces every {slot} in `template` with `values[slot]`, in a single pass, so a
 * value that itself contains "{x}" is never expanded again.
 * A slot with no value is a programming error and throws, so a raw "{slot}" never
 * reaches a Trader. Extra values are ignored.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(SLOT, (_m, slot: string) => {
    const v = Object.hasOwn(values, slot) ? values[slot] : undefined;
    if (v === undefined) throw new Error(`Missing copy slot: ${slot}`);
    return String(v);
  });
}

/** Names of the {slots} in a template, in order of first appearance. */
export function slotsOf(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(SLOT)) {
    const s = m[1];
    if (s !== undefined && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The template for `key` in `lang`. */
export function t(lang: Lang, key: MessageKey): string {
  return ojaConfig.copy[lang][key];
}
