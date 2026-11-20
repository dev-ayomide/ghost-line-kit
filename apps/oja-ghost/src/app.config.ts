// Oja Ghost config: lists, limits, word lists, copy (en, pcm), processor copy and demo tables.
// Every user-visible string lives here. All text is GSM-7 (no naira sign, no curly quotes, no emoji).
// Money in replies is plain "N1,500". All prices below are illustrative and NOT from any survey.
import type { Lang, Messages } from './copy.ts';

export interface Named {
  en: string;
  pcm: string;
}

export interface CommodityDef {
  id: string;
  name: Named;
  unit: Named;
  /** Illustrative base price in whole naira (not from any survey). */
  basePrice: number;
  aliases: readonly string[];
}

export interface MarketDef {
  id: string;
  name: string;
  /** Illustrative multiplier on the base price. */
  multiplier: number;
  aliases: readonly string[];
}

export type WordIntent =
  | 'price'
  | 'report'
  | 'owe'
  | 'paid'
  | 'overpaid'
  | 'undo'
  | 'book'
  | 'remind'
  | 'supplier'
  | 'reminders'
  | 'cancel'
  | 'language'
  | 'menu'
  | 'help';

export interface WordLists {
  /** Command words and phrases that start a message, per intent. */
  command: Readonly<Record<WordIntent, readonly string[]>>;
  /** Verbs in name-first sentences: "Bola owes 4500", "Bola don pay 2000". */
  verbs: Readonly<{
    owe: readonly string[];
    paid: readonly string[];
    overpaid: readonly string[];
    cost: readonly string[];
    /** Trailing word in "<name> balance". */
    balance: readonly string[];
  }>;
  /** Openers of a balance question: "how much does Bola owe", "wetin Bola owe". Checked before the price command. */
  balanceLead: readonly string[];
  /** Small words the parser skips between a command and its arguments. */
  filler: readonly string[];
  /** Leading words skipped before a name in a reminder: "remind me to collect Bola friday". */
  remindNoise: readonly string[];
  /** Words allowed in front of a date or time: "on friday", "at 14:30". Dropped before parsing. */
  whenLead: readonly string[];
}

export const INTENT_NAMES = [
  'menu',
  'help',
  'choice',
  'freetext',
  'price',
  'report',
  'owe',
  'paid',
  'overpaid',
  'undo',
  'book',
  'remind',
  'supplier',
  'reminders',
  'cancel',
  'language',
] as const;

const en: Messages = {
  needsReview: false,

  demoNotice: 'Demo: prices and the sample book here are for show, not real market data.',
  help: 'Demo data. Price: price rice mile12. Report: report rice mile12 68000. Debt: Bola owes 4500. Paid: Bola paid 2000. Book: book. Remind: remind Bola friday. MENU for menu.',
  unrecognized: 'Sorry, I did not get that. Try: price rice mile12, Bola owes 4500, or book. Send HELP for more.',
  helpUssd: 'Demo. Send 00 for menu. SMS: price rice mile12, Bola owes 4500, book',
  unrecognizedUssd: 'Not understood. Send 00 for the menu.',
  tryAgain: 'Try again. Send HELP for options.',
  rateLimited: 'Too many messages. Wait a minute and try again.',

  agoNow: 'just now',
  agoMin: '{n} min ago',
  agoHour: '{n} hour ago',
  agoHours: '{n} hours ago',
  agoDay: '{n} day ago',
  agoDays: '{n} days ago',

  priceLive: '{commodity} ({unit}) at {market}: {amount}. From {n} reports, newest {ago}.',
  priceLiveDemo: 'Demo: {commodity} ({unit}) at {market}: {amount}. From {n} sample reports, newest {ago}.',
  priceOld: '{commodity} ({unit}) at {market}: {amount}. Not from today ({date}). Send today\'s price with REPORT.',
  priceOldDemo: 'Demo: {commodity} ({unit}) at {market}: {amount}. Not from today ({date}). Send today\'s price with REPORT.',
  priceRef: 'Demo price: {commodity} ({unit}) at {market}: {amount}. No reports yet. Be the first: send REPORT.',
  priceLiveUssd: '{commodity} {market}: {amount} ({n} reports, {ago})',
  priceLiveDemoUssd: 'Demo {commodity} {market}: {amount} ({n} samples)',
  priceOldUssd: '{commodity} {market}: {amount}. Not from today ({date})',
  priceOldDemoUssd: 'Demo {commodity} {market}: {amount}. Not from today ({date})',
  priceRefUssd: 'Demo price {commodity} {market}: {amount}. No reports yet.',
  unknownCommodity: 'I do not know that item. Try: {list}. Example: price rice mile12',
  unknownMarket: 'I do not know that market. Try: {list}. Example: price rice mile12',
  needMarket: 'Which market for {commodity}? Try: {list}. Example: price {commodity} mile12',

  reportAdded: 'Thanks. {commodity} at {market}: {amount} added. Today\'s average is {avg} from {n} reports.',
  reportAddedDemo: 'Thanks. {commodity} at {market}: {amount} added. Demo average with samples is {avg} from {n} reports.',
  reportNotAdded: 'Not added: {amount} looks far from today\'s range ({low} to {high}). If it is right, check it and send again: report {commodity} {market} {amount}',
  reportNotAddedUssd: 'Not added: {amount} is far from today\'s range ({low} to {high}). Check and try again.',
  reportCap: 'You sent {max} reports today. Try again tomorrow.',
  reportNeedAmount: 'I need the price. Example: report rice mile12 68000',
  badAmount: 'Send the price in whole naira, like 68000 or 68k.',

  ledgerOwe: 'Saved. {name} owes you {balance} now.',
  ledgerPaid: 'Saved. {name} paid {amount}. Balance: {balance}.',
  ledgerOverpaid: 'Saved. {name} has credit of {credit}.',
  exceedsBalance: 'Not saved. {name} owes only {balance}, not {amount}. To record the extra as credit, send: overpaid {name} {amount}',
  exceedsBalanceUssd: 'Not saved. {name} owes only {balance}, not {amount}. Send: overpaid {name} {amount}',
  unknownDebtor: '{name} is not in your book. Names: {list}. To add, send: {name} owes 1000',
  unknownDebtorEmpty: '{name} is not in your book yet. To add, send: {name} owes 1000',
  invalidName: 'Use plain letters for the name (up to 20), no symbols. Example: Bola owes 4500',
  needNameAmount: 'Send a name and an amount. Example: Bola owes 4500',
  tooManyDebtors: 'Your book is full ({max} names). Send undo to remove the last entry.',
  tooManyEntries: '{name} has {max} entries, the most allowed. Use a new name, like {name} 2.',
  nothingToUndo: 'Nothing to undo. Your book is empty.',
  undone: 'Last entry removed. {name} now owes {balance}.',
  undoneCredit: 'Last entry removed. {name} now has credit of {credit}.',
  undoneGone: 'Last entry removed. {name} is out of your book.',

  bookSummary: 'You are owed {total}:\n{rows}',
  bookSummaryDemo: 'Demo book. You are owed {total}:\n{rows}',
  bookSummaryUssd: 'Owed {total}:\n{rows}\nFull list: SMS book',
  bookSummaryDemoUssd: 'Demo book. Owed {total}:\n{rows}\nFull list: SMS book',
  bookRow: '{name} {balance}',
  bookMore: '{extra} more. Send: book NAME',
  bookCredit: 'Credit: {name} {credit}',
  bookEmpty: 'Your book is empty. Add one: Bola owes 4500',
  bookClear: 'Nobody owes you now.',
  bookDebtor: '{name} owes {balance}. Last: {entries}',
  bookDebtorCredit: '{name} has credit of {credit}. Last: {entries}',
  bookDebtorZero: '{name} owes nothing. Last: {entries}',
  entryOwe: 'owe {amount} {date}',
  entryPaid: 'paid {amount} {date}',
  entryOverpaid: 'overpaid {amount} {date}',

  reminderCreatedDebt: 'Done. I will remind you on {when} to collect from {name}.',
  reminderCreatedSupplier: 'Done. I will remind you on {when} to pay {name} {amount}.',
  reminderList: 'Your reminders:\n{rows}\nTo cancel, send: cancel 1',
  reminderListUssd: 'Reminders:\n{rows}',
  reminderRowDebt: '{n}. {when} collect from {name}',
  reminderRowSupplier: '{n}. {when} pay {name} {amount}',
  reminderEmpty: 'No reminders. Add one: remind Bola friday',
  reminderCancelled: 'Reminder {n} cancelled.',
  reminderCancelBad: 'There is no reminder number {n}. Send reminders to see the list.',
  reminderTooMany: 'You have {max} reminders. Cancel one first: cancel 1',
  reminderBadDate: 'I did not get the date. Use today, tomorrow, in 3 days, friday or 15 Dec. Add a time like 14:30 if you want. The date must be within 90 days.',
  reminderNeedName: 'Say who. Example: remind Bola friday',
  reminderOnlySms: 'To add a reminder, send an SMS like: remind Bola friday',
  reminderSmsDebt: 'Reminder: collect {amount} from {name} today.',
  reminderSmsSupplier: 'Reminder: pay {name} {amount} today.',
  reminderSmsSupplierNoAmount: 'Reminder: pay {name} today.',
  reminderNextStep: 'Send HELP for options',

  languageSet: 'Language set to English.',

  menuTitle: 'Oja Ghost (demo)',
  menuPrice: 'Price',
  menuReport: 'Report price',
  menuBook: 'Debt book',
  menuReminders: 'Reminders',
  menuLanguage: 'Language',
  menuBackLabel: 'Back',
  menuMenuLabel: 'Menu',
  titleCommodity: 'Pick an item',
  titleMarket: 'Pick a market',
  titleReportAmount: 'Send the price in naira, e.g. 68000',
  titleBook: 'Debt book',
  bookOptWho: 'Who owes me',
  bookOptAddDebt: 'Add debt',
  bookOptAddPaid: 'Add payment',
  bookOptUndo: 'Undo last',
  titleReminders: 'Reminders',
  remOptList: 'My reminders',
  remOptCancel: 'Cancel one',
  titleLanguage: 'Language',
  langOptEn: 'English',
  langOptPcm: 'Pidgin',
  promptDebtLine: 'Send name and amount, e.g. Bola 4500',
  promptPaidLine: 'Send name and amount paid, e.g. Bola 2000',
  promptCancelNumber: 'Send the reminder number',
  flowBadPick: 'Pick a number from the list.',
};

// Pidgin wording is a first draft and needs native-speaker review (Open Question 4).
const pcm: Messages = {
  needsReview: true,

  demoNotice: 'Demo: the prices and sample book na for show, e no be real market data.',
  help: 'Demo data. Price: price rice mile12. Report: report rice mile12 68000. Debt: Bola owe 4500. Paid: Bola don pay 2000. Book: book. Remind: remind Bola friday. MENU for menu.',
  unrecognized: 'Abeg, I no understand. Try: price rice mile12, Bola owe 4500, or book. Send HELP make you see more.',
  helpUssd: 'Demo. Send 00 for menu. SMS: price rice mile12, Bola owe 4500, book',
  unrecognizedUssd: 'I no understand. Send 00 for menu.',
  tryAgain: 'Try again. Send HELP make you see options.',
  rateLimited: 'Too many messages. Wait small and try again.',

  agoNow: 'just now',
  agoMin: '{n} min ago',
  agoHour: '{n} hour ago',
  agoHours: '{n} hours ago',
  agoDay: '{n} day ago',
  agoDays: '{n} days ago',

  priceLive: '{commodity} ({unit}) for {market}: {amount}. From {n} reports, the newest na {ago}.',
  priceLiveDemo: 'Demo: {commodity} ({unit}) for {market}: {amount}. From {n} sample reports, the newest na {ago}.',
  priceOld: '{commodity} ({unit}) for {market}: {amount}. E no be today price ({date}). Send today price with REPORT.',
  priceOldDemo: 'Demo: {commodity} ({unit}) for {market}: {amount}. E no be today price ({date}). Send today price with REPORT.',
  priceRef: 'Demo price: {commodity} ({unit}) for {market}: {amount}. Nobody report yet. Be the first: send REPORT.',
  priceLiveUssd: '{commodity} {market}: {amount} ({n} reports, {ago})',
  priceLiveDemoUssd: 'Demo {commodity} {market}: {amount} ({n} samples)',
  priceOldUssd: '{commodity} {market}: {amount}. No be today ({date})',
  priceOldDemoUssd: 'Demo {commodity} {market}: {amount}. No be today ({date})',
  priceRefUssd: 'Demo price {commodity} {market}: {amount}. No report yet.',
  unknownCommodity: 'I no know that item. Try: {list}. Example: price rice mile12',
  unknownMarket: 'I no know that market. Try: {list}. Example: price rice mile12',
  needMarket: 'Which market for {commodity}? Try: {list}. Example: price {commodity} mile12',

  reportAdded: 'Thank you. {commodity} for {market}: {amount} don enter. Today average na {avg} from {n} reports.',
  reportAddedDemo: 'Thank you. {commodity} for {market}: {amount} don enter. Demo average with samples na {avg} from {n} reports.',
  reportNotAdded: 'E no enter: {amount} far from today range ({low} to {high}). If e correct, check am and send again: report {commodity} {market} {amount}',
  reportNotAddedUssd: 'E no enter: {amount} far from today range ({low} to {high}). Check am and try again.',
  reportCap: 'You don send {max} reports today. Try again tomorrow.',
  reportNeedAmount: 'I need the price. Example: report rice mile12 68000',
  badAmount: 'Send the price in whole naira, like 68000 or 68k.',

  ledgerOwe: 'I don save am. {name} owe you {balance} now.',
  ledgerPaid: 'I don save am. {name} don pay {amount}. Balance: {balance}.',
  ledgerOverpaid: 'I don save am. {name} get credit of {credit}.',
  exceedsBalance: 'I no save am. {name} owe only {balance}, no be {amount}. To put the extra as credit, send: overpaid {name} {amount}',
  exceedsBalanceUssd: 'I no save am. {name} owe only {balance}, no be {amount}. Send: overpaid {name} {amount}',
  unknownDebtor: '{name} no dey your book. Names: {list}. To add, send: {name} owe 1000',
  unknownDebtorEmpty: '{name} no dey your book yet. To add, send: {name} owe 1000',
  invalidName: 'Use plain letters for the name (up to 20), no symbol. Example: Bola owe 4500',
  needNameAmount: 'Send name and amount. Example: Bola owe 4500',
  tooManyDebtors: 'Your book don full ({max} names). Send undo to comot the last entry.',
  tooManyEntries: '{name} get {max} entries, na the most. Use new name, like {name} 2.',
  nothingToUndo: 'Nothing to undo. Your book empty.',
  undone: 'Last entry don comot. {name} owe {balance} now.',
  undoneCredit: 'Last entry don comot. {name} get credit of {credit} now.',
  undoneGone: 'Last entry don comot. {name} no dey your book again.',

  bookSummary: 'Dem owe you {total}:\n{rows}',
  bookSummaryDemo: 'Demo book. Dem owe you {total}:\n{rows}',
  bookSummaryUssd: 'Dem owe {total}:\n{rows}\nFull list: SMS book',
  bookSummaryDemoUssd: 'Demo book. Dem owe {total}:\n{rows}\nFull list: SMS book',
  bookRow: '{name} {balance}',
  bookMore: '{extra} more. Send: book NAME',
  bookCredit: 'Credit: {name} {credit}',
  bookEmpty: 'Your book empty. Add one: Bola owe 4500',
  bookClear: 'Nobody dey owe you now.',
  bookDebtor: '{name} owe {balance}. Last: {entries}',
  bookDebtorCredit: '{name} get credit of {credit}. Last: {entries}',
  bookDebtorZero: '{name} no owe anything. Last: {entries}',
  entryOwe: 'owe {amount} {date}',
  entryPaid: 'pay {amount} {date}',
  entryOverpaid: 'overpay {amount} {date}',

  reminderCreatedDebt: 'Done. I go remind you on {when} to collect from {name}.',
  reminderCreatedSupplier: 'Done. I go remind you on {when} to pay {name} {amount}.',
  reminderList: 'Your reminders:\n{rows}\nTo cancel, send: cancel 1',
  reminderListUssd: 'Reminders:\n{rows}',
  reminderRowDebt: '{n}. {when} collect from {name}',
  reminderRowSupplier: '{n}. {when} pay {name} {amount}',
  reminderEmpty: 'No reminder. Add one: remind Bola friday',
  reminderCancelled: 'Reminder {n} don cancel.',
  reminderCancelBad: 'Reminder number {n} no dey. Send reminders to see the list.',
  reminderTooMany: 'You get {max} reminders already. Cancel one first: cancel 1',
  reminderBadDate: 'I no get the date. Use today, tomorrow, in 3 days, friday or 15 Dec. You fit add time like 14:30. The date must dey inside 90 days.',
  reminderNeedName: 'Tell me who. Example: remind Bola friday',
  reminderOnlySms: 'To add reminder, send SMS like: remind Bola friday',
  reminderSmsDebt: 'Reminder: collect {amount} from {name} today.',
  reminderSmsSupplier: 'Reminder: pay {name} {amount} today.',
  reminderSmsSupplierNoAmount: 'Reminder: pay {name} today.',
  reminderNextStep: 'Send HELP to see options',

  languageSet: 'Language don change to Pidgin.',

  menuTitle: 'Oja Ghost (demo)',
  menuPrice: 'Price',
  menuReport: 'Report price',
  menuBook: 'Debt book',
  menuReminders: 'Reminders',
  menuLanguage: 'Language',
  menuBackLabel: 'Back',
  menuMenuLabel: 'Menu',
  titleCommodity: 'Pick item',
  titleMarket: 'Pick market',
  titleReportAmount: 'Send the price in naira, e.g. 68000',
  titleBook: 'Debt book',
  bookOptWho: 'Who owe me',
  bookOptAddDebt: 'Add debt',
  bookOptAddPaid: 'Add payment',
  bookOptUndo: 'Undo last',
  titleReminders: 'Reminders',
  remOptList: 'My reminders',
  remOptCancel: 'Cancel one',
  titleLanguage: 'Language',
  langOptEn: 'English',
  langOptPcm: 'Pidgin',
  promptDebtLine: 'Send name and amount, e.g. Bola 4500',
  promptPaidLine: 'Send name and amount wey dem pay, e.g. Bola 2000',
  promptCancelNumber: 'Send the reminder number',
  flowBadPick: 'Pick number from the list.',
};

export const ojaConfig = {
  id: 'oja-ghost',
  name: 'Oja Ghost',
  ussdCode: '*384#',
  shortCode: '38400',
  ussdOpenText: 'MENU',
  smsFirstText: 'Hi',

  /** All prices and multipliers below are illustrative, not from any real survey. */
  illustrative:
    'Illustrative demo values for scale only. Not from any market survey. Not live market data.',

  commodities: [
    {
      id: 'rice',
      name: { en: 'Rice', pcm: 'Rice' },
      unit: { en: '50kg bag', pcm: '50kg bag' },
      basePrice: 82_000,
      aliases: ['rice', 'shinkafa'],
    },
    {
      id: 'beans',
      name: { en: 'Beans', pcm: 'Beans' },
      unit: { en: 'paint bucket', pcm: 'paint bucket' },
      basePrice: 4_500,
      aliases: ['beans', 'ewa'],
    },
    {
      id: 'garri',
      name: { en: 'Garri', pcm: 'Garri' },
      unit: { en: 'paint bucket', pcm: 'paint bucket' },
      basePrice: 3_200,
      aliases: ['garri', 'gari'],
    },
    {
      id: 'tomato',
      name: { en: 'Tomato', pcm: 'Tomato' },
      unit: { en: 'big basket', pcm: 'big basket' },
      basePrice: 45_000,
      aliases: ['tomato', 'tomatoes', 'tomato basket'],
    },
    {
      id: 'palmoil',
      name: { en: 'Palm oil', pcm: 'Palm oil' },
      unit: { en: '25L gallon', pcm: '25L gallon' },
      basePrice: 65_000,
      aliases: ['palm oil', 'palmoil', 'red oil'],
    },
  ] as readonly CommodityDef[],

  markets: [
    { id: 'mile12', name: 'Mile 12', multiplier: 1.0, aliases: ['mile12', 'mile 12', 'mile-12'] },
    { id: 'oyingbo', name: 'Oyingbo', multiplier: 1.04, aliases: ['oyingbo'] },
    { id: 'ketu', name: 'Ketu', multiplier: 1.02, aliases: ['ketu'] },
  ] as readonly MarketDef[],

  limits: {
    maxAmount: 100_000_000,
    maxDebtors: 50,
    maxEntriesPerDebtor: 200,
    maxActiveReminders: 10,
    maxReportsPerDay: 20,
    reminderHorizonDays: 90,
    reminderDefaultHour: 8,
    ussdListRows: 3,
    smsListRows: 5,
    maxAcceptedPerDay: 200,
    maxRejectedPerDay: 50,
  },

  outlier: {
    minForMad: 3,
    madK: 3,
    minHalfWidthPct: 0.1,
    refLow: 0.5,
    refHigh: 2,
  },

  words: {
    en: {
      command: {
        price: ['price', 'prices', 'how much'],
        report: ['report'],
        owe: ['owe'],
        paid: ['paid'],
        overpaid: ['overpaid'],
        undo: ['undo'],
        book: ['book', 'balance', 'who owe me', 'who owes me'],
        remind: ['remind'],
        supplier: ['pay'],
        reminders: ['reminders', 'reminder'],
        cancel: ['cancel'],
        language: ['language', 'english', 'pidgin'],
        menu: ['menu', 'hi', 'hello'],
        help: ['help'],
      },
      verbs: {
        owe: ['owes', 'owe', 'owes me'],
        paid: ['paid'],
        overpaid: ['overpaid'],
        cost: ['cost', 'costs'],
        balance: ['balance'],
      },
      balanceLead: ['how much does', 'how much do', 'how much'],
      filler: ['for', 'at', 'in', 'of', 'the'],
      remindNoise: ['me', 'to', 'collect', 'from', 'about'],
      whenLead: ['on', 'by', 'at'],
    },
    pcm: {
      command: {
        price: ['wetin be price', 'wetin be the price', 'how much', 'price'],
        report: ['report', 'tell price'],
        owe: ['owe'],
        paid: ['paid', 'don pay'],
        overpaid: ['overpaid', 'don overpay'],
        undo: ['undo', 'comot last'],
        book: ['book', 'balance', 'who dey owe me', 'who owe me'],
        remind: ['remind', 'remind me', 'mind me'],
        supplier: ['pay'],
        reminders: ['reminders'],
        cancel: ['cancel', 'cancel am'],
        language: ['language', 'pidgin', 'english'],
        menu: ['menu', 'hi', 'hello', 'how far'],
        help: ['help', 'abeg help'],
      },
      verbs: {
        owe: ['dey owe me', 'dey owe', 'owe'],
        paid: ['don pay', 'paid'],
        overpaid: ['don overpay', 'overpaid'],
        cost: ['don cost', 'cost'],
        balance: ['balance'],
      },
      balanceLead: ['how much', 'wetin'],
      filler: ['for', 'at', 'in', 'of', 'the', 'dey', 'na'],
      remindNoise: ['me', 'make', 'collect', 'from', 'about'],
      whenLead: ['on', 'by', 'at', 'for'],
    },
  } as Readonly<Record<Lang, WordLists>>,

  /** Words that pick a language in "language pidgin" and "english". */
  languageWords: {
    en: ['english', 'en'],
    pcm: ['pidgin', 'pcm', 'naija'],
  } as Readonly<Record<Lang, readonly string[]>>,

  intentNames: INTENT_NAMES as readonly string[],

  intentTool: {
    menu: 'menu',
    help: 'help',
    choice: 'step',
    freetext: 'step',
    price: 'price',
    report: 'report_price',
    owe: 'ledger',
    paid: 'ledger',
    overpaid: 'ledger',
    undo: 'ledger',
    book: 'book',
    remind: 'remind',
    supplier: 'remind',
    reminders: 'reminders',
    cancel: 'reminders',
    language: 'language',
  } as Readonly<Record<(typeof INTENT_NAMES)[number], string>>,

  demo: {
    /** Same value as `fakeFrom` in phantom-handset/src/config/handset-config.ts (copied, not imported). */
    phone: '+2340000005678',
    book: [
      {
        name: 'Bola',
        entries: [
          { type: 'owe', amount: 6_500 },
          { type: 'paid', amount: 2_000 },
        ],
      },
      { name: 'Mama Ife', entries: [{ type: 'owe', amount: 1_200 }] },
      { name: 'Chidi', entries: [{ type: 'owe', amount: 8_000 }] },
    ] as readonly { name: string; entries: readonly { type: 'owe' | 'paid'; amount: number }[] }[],
  },

  copy: { en, pcm } as Readonly<Record<Lang, Messages>>,

  /** One short text per ProcessorCopy field: English, then Pidgin. GSM-7, at most 160 characters. */
  processorCopy: {
    stopped: 'You are unsubscribed. Send START to join again. Una don comot. Send START to join again.',
    notSubscribed: 'You are not subscribed. Send START to join. You never join. Send START to join.',
    deleted: 'Your data is erased. Send START to begin again. We don delete your data. Send START to start again.',
    resubscribed: 'Welcome back. Send HELP for options. Welcome back o. Send HELP to see options.',
    unrecognized: 'Sorry, I did not get that. Send HELP. Abeg, I no understand. Send HELP.',
    nothingMore: 'Nothing more to send. Send HELP. Nothing remain. Send HELP.',
    done: 'Done. Don do.',
  },

  /** Bilingual next step for the processor. GSM-7, at most 40 characters. */
  nextStep: 'Send HELP / Send HELP make I show you',
} as const;

export type OjaConfig = typeof ojaConfig;
