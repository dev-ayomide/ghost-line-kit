# Design Document

## Overview

Oja Ghost is a set of pure modules (money, names, ledger, prices, dates, command parser, reminder due-check), a thin I/O layer (tools, flows, dispatcher, seed) over the kit `Store`, and one config file that holds every string and list. `createOjaGhost(deps)` assembles them into an object that the Phantom Handset server can load.

One kit change comes first: `isSubscribed` (Requirement 13). One small change in `phantom-handset` is needed for the demo to work (Decision D1 below). Nothing else outside `apps/oja-ghost` changes.

### Decisions that need your approval

| # | Decision | Why | If you say no |
|---|---|---|---|
| D1 | Add an optional field `llm?: LlmProvider` to `HandsetApp`, and one line in `wire.ts`: `app.llm ?? llm`. Part of the stand-in swap (Open Question 6). | The stand-in `KeywordLlmProvider` maps a digit to the n-th intent. That breaks USSD flows, where `2` means "Beans" in one step and "Report price" in another. Oja Ghost needs its own classifier. | The app still works on SMS with command-first messages (`price rice mile12`), but USSD sub-menus and name-first messages (`Bola owes 4500`) fail on the handset. |
| D2 | v1 never calls a model. Classification is rule-based and money, names and dates are parsed by code. | Money must not depend on a model's reading. A rule classifier costs nothing per SMS and behaves the same every time. Bedrock stays available through the kit for a later free-text fallback. | Add a fallback in `provider.ts`: call the base provider only for text no rule matches and no flow is waiting for. |
| D3 | Accept that the kit's default next step ("Reply HELP for options") is added to every SMS reply, in English, even for Pidgin Traders. | `MessageProcessorConfig` has no `nextStep` option, so the app cannot change it. | Add an optional `nextStep` to the kit processor (general, small). Needs your approval as a second kit amendment. |

## Architecture

```
Phantom Handset / SMS webhook / USSD webhook
   |  InboundMessage
   v
kit MessageProcessor  (STOP, DELETE, START, MORE, rate limit, formatting, session)
   |  agent.classify(text)                 -> OjaRuleProvider.classifyIntent   (provider.ts, pure)
   |  buildToolCall(intent, ctx)           -> { tool, input:{phoneNumber, channel, text} }
   v
tool.execute(input)                        (tools.ts)
   |  parse text (parse.ts, when.ts, money.ts)   pure
   |  load/save state in Store (keys.ts)         I/O
   |  decide with pure modules (ledger.ts, prices.ts, reminders.ts)
   v
reply text (string, GSM-7, language picked from the Trader's record)

Scheduler (cron, Night Shift, handset "tick")
   -> dispatchDueReminders(deps)  (dispatch.ts)  -> SmsAdapter.send
```

### File layout (`apps/oja-ghost/src`)

| File | Role | Pure |
|---|---|---|
| `app.config.ts` | `ojaConfig`: ids, codes, lists, limits, outlier numbers, word lists, copy (en, pcm), `processorCopy`, demo data tables | yes |
| `money.ts` | `parseAmount`, `formatN` | yes |
| `names.ts` | `normaliseName`, `validName` | yes |
| `ledger.ts` | `applyLedger`, `balanceOf`, `netBalance`, `totalOwed` | yes |
| `prices.ts` | `judge`, `average`, `addReport`, `displayStats`, `refPrice` | yes |
| `when.ts` | `lagosDay`, `parseWhen`, `agoText` | yes |
| `parse.ts` | `routeIntent`, `parseCommand` | yes |
| `reminders.ts` | `createReminder`, `dueReminders`, `activeList`, `cancelNth` | yes |
| `copy.ts` | `fill(template, values)`, `t(lang, key)` | yes |
| `keys.ts` | store key builders and record types | yes |
| `flows.ts` | menu and USSD step machine (reads and writes the flow record) | no |
| `tools.ts` | the tools, `defineTool` helper | no |
| `dispatch.ts` | `dispatchDueReminders` | no |
| `seed.ts` | `seedDemo` | no |
| `provider.ts` | `OjaRuleProvider` (an `LlmProvider` with no model) | yes |
| `index.ts` | `createOjaGhost`, `dispatchDueReminders`, types | no |

Tests are in `apps/oja-ghost/test`. Property tests are named `*.pbt.test.ts`, so `pnpm test:pbt` picks them up.

## HandsetApp wiring

`HandsetApp` lives in `phantom-handset/server/apps.ts` and the app cannot import it. The app returns an object with the same fields. TypeScript checks the match structurally.

```ts
// index.ts
import type { LlmProvider, MessageProcessorConfig, ProcessorCopy, Tool } from '@ghostline/kit';

export interface OjaGhostApp {
  id: 'oja-ghost';
  name: 'Oja Ghost';
  tools: Tool[];
  intentNames: string[];
  copy: Partial<ProcessorCopy>;                                   // from ojaConfig.processorCopy
  buildToolCall: NonNullable<MessageProcessorConfig['buildToolCall']>;
  eraseUserData: (phoneNumber: string) => Promise<void>;
  llm: LlmProvider;                                               // D1: OjaRuleProvider
}

export interface OjaGhostDeps {
  store?: Store;      // default MemoryStore
  clock?: Clock;      // default SystemClock
  demo?: boolean;     // default true. false skips the seed.
}

export function createOjaGhost(deps?: OjaGhostDeps): OjaGhostApp;
export function dispatchDueReminders(deps: DispatchDeps): Promise<DispatchSummary>;
```

- `renderOutput` is omitted. Every tool returns a plain string, which the processor's default renderer accepts.
- `ToolCall` is not exported by the kit, so the type comes from `MessageProcessorConfig['buildToolCall']`, as `apps.ts` does.
- `getApps()` after the swap: `[createOjaGhost({ store }), blackoutLine]`. The handset must pass the same `store` it gives the processor, so `isSubscribed` reads the right record. The swap (a workspace dependency, `getApps` taking a store) is Open Question 6, outside this spec.
- Seeding is lazy. `createOjaGhost` is synchronous, so each tool awaits `ensureSeeded()` (one shared promise) before its first read.

### Intents and tools

`intentNames`, in this order (the order is also the order of the stand-in's digit shortcuts, which no longer matter once D1 is done):

`menu, help, choice, freetext, price, report, owe, paid, overpaid, undo, book, remind, supplier, reminders, cancel, language`

| Intent | Tool | What it does |
|---|---|---|
| `menu`, `help` | `menu`, `help` | root menu, help text with demo label |
| `choice`, `freetext` | `step` | USSD or SMS menu step, typed flow input, or a name-first command |
| `price` | `price` | Requirement 2 |
| `report` | `report_price` | Requirements 3 and 4 |
| `owe`, `paid`, `overpaid`, `undo` | `ledger` | Requirement 5 |
| `book` | `book` | Requirement 6 |
| `remind`, `supplier` | `remind` | Requirement 7.1 to 7.6 |
| `reminders`, `cancel` | `reminders` | Requirement 7.7 |
| `language` | `language` | Requirement 8.2 |

The intent to tool table is in `ojaConfig.intentTool`. Every tool has the same input schema:

```ts
const Input = z.object({
  phoneNumber: z.string().min(5).max(20),
  channel: z.enum(['sms', 'ussd', 'web']),
  text: z.string().max(320),
});
```

`buildToolCall(intent, ctx)` returns `{ name: intentTool[intent.name], input: { phoneNumber: ctx.phoneNumber, channel: ctx.channel, text: intent.rawMessage } }`. It ignores `intent.parameters`. Tools parse `text` again with the pure parser, so a wrong classification can change which tool runs but never an amount or a name.

`defineTool(name, description, handler)` wraps each handler. It does these things in order:

1. `await ensureSeeded()`.
2. Load the Trader's `lang` record. If there is none, this is the first reply: create it with `en` and remember to prepend the demo notice (Requirement 11.5).
3. Run `handler({ phone, channel, text, lang, now })`, which returns a string.
4. Return the string. Handler errors are not caught here. The registry turns them into the kit's generic failure message.

### Classification (`provider.ts`, `parse.ts`)

`OjaRuleProvider.classifyIntent(message, names)` returns `{ name: routeIntent(message), parameters: {}, rawMessage: message }`. `complete()` returns a fixed short string and is never called. `routeIntent` is pure:

1. Normalise: NFD, strip accents, lowercase, collapse spaces, drop trailing `.?!`.
2. If the text is only an amount or a small number (`^(n)?\d[\d,.]*k?$`): `choice`.
3. If it starts with a command word or phrase from `ojaConfig.words` (both languages): that intent. Examples: `price`, `how much`, `wetin be price` give `price`; `report`; `owe`; `paid`; `overpaid`; `undo`; `book`; `balance`; `remind`; `pay`; `reminders`; `cancel`; `pidgin`, `english`, `language`; `menu`, `hi`; `help`.
4. Otherwise: `freetext`.

`routeIntent` never returns `unrecognized`. `freetext` ends with the `unrecognized` reply and 3 example commands (Requirement 10.11). The `unrecognized` field of `processorCopy` stays set as a safe default.

### Command grammar (`parseCommand`)

Input is the normalised token list. Output is a tagged value or `{ kind: 'unknown' }`. Word lists are in config; these are the shapes.

| Kind | Command-first | Name-first or sentence |
|---|---|---|
| `price` | `price <commodity> <market>` | `how much <commodity> <market>`, `wetin be price <commodity> <market>` |
| `report` | `report <commodity> <market> <amount>` | `<commodity> <market> don cost <amount>`, `<commodity> <market> cost <amount>` |
| `owe` | `owe <name> <amount>` | `<name> owes <amount>`, `<name> dey owe (me) <amount>` |
| `paid` | `paid <name> <amount>` | `<name> paid <amount>`, `<name> don pay <amount>` |
| `overpaid` | `overpaid <name> <amount>` | `<name> overpaid <amount>` |
| `book` | `book`, `book <name>`, `balance`, `who owe me` | `<name> balance` |
| `remind` | `remind <name> <when>`, `remind me <name> <when>` | none |
| `supplier` | `pay <name> <amount> <when>` | none |
| `undo`, `reminders`, `cancel N`, `language`, `menu`, `help` | one word (and a number for `cancel`) | none |

Rules:

- A `<name>` is the words between the command (or the start) and the verb or the amount. It is 1 to 20 characters after trimming.
- `<commodity>` and `<market>` are matched against the aliases in config, longest alias first, so `mile 12` and `mile12` both match `mile12`.
- `<amount>` is the first token that `parseAmount` accepts. `<when>` is the rest, handled by `parseWhen`.
- Name-first sentences are reached through `freetext` and the `step` tool.

## Data model

All keys start with `oja:`. All records are JSON and versioned with `v: 1`. The kit's own keys (`user:`, `pending:`, `session:`, `ratelimit:`) are not touched.

| Key | Value | Written by | Erased by DELETE |
|---|---|---|---|
| `oja:lang:<phone>` | `{ v, lang: 'en' \| 'pcm' }` | any tool, `language` | yes |
| `oja:book:<phone>` | `Ledger` | `ledger`, seed | yes |
| `oja:flow:<phone>` | `{ v, flow, path: string[], data, exp }` | `step`, `menu` | yes |
| `oja:rem:<phone>` | `Reminder[]` | `remind`, `reminders`, dispatcher | yes |
| `oja:rem-index` | `string[]` of phones that have a pending Reminder | `remind`, dispatcher | phone removed |
| `oja:rep:<phone>` | `{ today: { day, count }, reports: { key, id }[] }` | `report_price` | yes |
| `oja:px:<market>:<commodity>:<day>` | `PriceDay` | `report_price`, seed | own reports removed |
| `oja:pxlast:<market>:<commodity>` | `{ day }` (pointer to the latest day with an Accepted_Report) | `report_price`, seed | no (holds no identity) |
| `oja:seed` | `{ day }` | seed | no |

`<phone>` is the number as the kit gives it. `<market>` and `<commodity>` are config ids. `<day>` is `YYYY-MM-DD` in Lagos time.

```ts
type Lang = 'en' | 'pcm';

// ledger.ts
type EntryType = 'owe' | 'paid' | 'overpaid';
interface Entry { n: number; type: EntryType; amount: number; at: number }   // amount: integer >= 1
interface Debtor { display: string; entries: Entry[] }                        // never empty
interface Ledger { v: 1; nextN: number; debtors: Record<string, Debtor>; demo?: true } // key = normaliseName

// prices.ts
interface Rep { id: number; amount: number; at: number; demo?: true }
interface PriceDay { v: 1; next: number; accepted: Rep[]; rejected: Rep[] }   // accepted <= 200, rejected <= 50 (newest kept)

// reminders.ts
interface Reminder {
  id: number; kind: 'debt' | 'supplier'; name: string; amount?: number;
  dueAt: number;                                   // epoch ms
  status: 'pending' | 'sent' | 'skipped' | 'failed' | 'cancelled';
  attempts: number; createdAt: number;
}
```

A report carries no identity (Requirement 3.4). The Trader's `oja:rep:<phone>` record maps `(price-day key) -> report id`. That link is what lets a later report replace an earlier one and lets DELETE remove it. The Store has no list operation and no atomic update, so the app assumes one message at a time per phone, which is how the kit processes a number, and accepts a lost update if two requests for the same phone overlap.

## Pure modules

### `money.ts`

```ts
parseAmount(s: string, max: number): number | undefined
formatN(n: number): string            // 4500 -> "N4,500"
```

`parseAmount` accepts, after trimming and lowercasing: an optional prefix `n`, `ngn` or `₦`; then digits, either plain or in proper comma groups of three (`4,500`, `1,250,000`); then an optional `k` that multiplies by 1,000 (`68k`, and one decimal digit with `k`: `1.5k` is 1500). It returns `undefined` for anything else, for a result below 1 or above `max`, and for a non-integer result. `formatN` never uses `₦` and never shows decimals.

### `names.ts`

`normaliseName(s)`: NFD, drop combining marks, lowercase, collapse whitespace, trim. `validName(s)`: after trim, 1 to 20 characters, only letters, digits, space, `.`, `'`, `-`, and `detectEncoding(s) === 'GSM-7'` (kit function). A failing name gets the "use plain letters" reply (Requirement 10.13).

### `ledger.ts`

```ts
type LedgerCmd =
  | { kind: 'owe' | 'paid' | 'overpaid'; name: string; amount: number; at: number }
  | { kind: 'undo' };

type LedgerResult =
  | { ok: true; ledger: Ledger; debtor?: string; balance?: number }
  | { ok: false; reason: 'invalid_name' | 'invalid_amount' | 'unknown_debtor' | 'too_many_debtors'
                       | 'too_many_entries' | 'nothing_to_undo' }
  | { ok: false; reason: 'exceeds_balance'; balance: number };

applyLedger(l: Ledger, cmd: LedgerCmd, limits: LedgerLimits): LedgerResult
balanceOf(d: Debtor): number          // sum(owe) - sum(paid) - sum(overpaid)
netBalance(l: Ledger): number         // sum of balanceOf over all debtors
totalOwed(l: Ledger): number          // sum of balanceOf where balance > 0
```

Rules inside `applyLedger`:

- It never mutates `l`. A failure returns no ledger, so the caller keeps the input.
- `owe`: creates the debtor if new (checks `maxDebtors`), appends `{ n: nextN, ... }`, increments `nextN`.
- `paid`: the debtor must exist (`unknown_debtor`). If `amount > balanceOf(debtor)`, it returns `exceeds_balance` with the balance and changes nothing. Otherwise it appends.
- `overpaid`: the debtor must exist. It always appends. This is the only command that can make a balance negative.
- `undo`: removes the entry with the highest `n` across all debtors. It decrements `nextN`. If that empties a debtor, the debtor is removed. An empty ledger returns `nothing_to_undo`.
- Balances are never stored. They are always computed from entries, so "the balance equals the sum of transactions" holds by construction, and the property test checks that no operation breaks it.

The reply for `exceeds_balance` tells the Trader the balance and the exact message to send: `overpaid Bola 5000`.

### `prices.ts`

```ts
interface OutlierCfg { minForMad: number; madK: number; minHalfWidthPct: number; refLow: number; refHigh: number }

judge(accepted: number[], amount: number, ref: number, cfg: OutlierCfg):
  { accepted: true } | { accepted: false; low: number; high: number }

average(amounts: number[]): number | undefined        // mean, rounded to the nearest 10 (half up)

addReport(day: PriceDay, r: { amount: number; at: number; replaceId?: number; demo?: true },
          ref: number, cfg: OutlierCfg):
  { day: PriceDay; id: number; verdict: ReturnType<typeof judge> }

displayStats(day: PriceDay): { amount: number; n: number; lastAt: number; demo: boolean } | undefined
```

`judge`, with `a` the accepted amounts:

- If `a.length < cfg.minForMad` (3): accept iff `ref * refLow <= amount <= ref * refHigh`. The band returned on rejection is that range.
- Otherwise: `m = median(a)`, `mad = median(|a_i - m|)`, `half = max(cfg.madK * 1.4826 * mad, cfg.minHalfWidthPct * m)`. Accept iff `|amount - m| <= half`. The band is `[m - half, m + half]`.

`addReport`:

1. `others` = accepted reports with `id !== replaceId`.
2. `verdict = judge(others.map(amount), amount, ref, cfg)`.
3. **Rejected:** `day.accepted` is returned unchanged (same array contents, same order). The report goes into `rejected` (if `replaceId` points into `rejected`, it replaces that entry). The earlier accepted report of the same Trader, if any, stays.
4. **Accepted:** the earlier report of the same Trader (in `accepted` or `rejected`) is removed, and the new one is appended to `accepted`.
5. A report is judged once, against the accepted set at that moment. Nothing is re-judged later.

Steps 3 and 5 are what make the required property true (see Property 3).

`displayStats` takes `real = accepted.filter(r => !r.demo)`. If `real.length >= 3` it uses only `real` and `demo: false`. Otherwise it uses all accepted reports and `demo: true`. A day with no accepted reports returns `undefined`, and the tool falls back to the day behind `oja:pxlast`, then to `refPrice`, labelled "Demo price".

`refPrice(market, commodity)` = `round100(base(commodity) * mult(market))`, from config tables.

### `when.ts`

`lagosDay(ms)`: `new Date(ms + 3_600_000).toISOString().slice(0, 10)`. Lagos is UTC+1 all year.

`parseWhen(tokens, nowMs, cfg)` returns `{ ok: true; dueAt } | { ok: false }`. Forms: `today`, `tomorrow`, `in N days` (also `after N days`), a weekday name (the next one, never today), `D Mon` (for example `15 dec`; if that date has passed this year it means next year), each with an optional `HH:MM`. Default time is 08:00 Lagos. `dueAt` must be later than `nowMs` and at most 90 days ahead. The date arithmetic uses `Date.UTC` on Lagos calendar parts, so it needs no time-zone library.

`agoText(deltaMs, lang)`: "10 min ago", "2 hours ago", "1 day ago".

### `reminders.ts`

```ts
createReminder(list: Reminder[], r: NewReminder, now: number, max: number): { ok: true; list } | { ok: false; reason: 'too_many' }
dueReminders(list: Reminder[], now: number): Reminder[]    // status === 'pending' && dueAt <= now, oldest first
activeList(list: Reminder[]): Reminder[]                   // pending, sorted by dueAt (numbering for `cancel N`)
cancelNth(list: Reminder[], n: number): { ok: true; list } | { ok: false }
```

Reminders in a final state (`sent`, `skipped`, `failed`, `cancelled`) older than 30 days are dropped whenever the list is written.

## Flows (`flows.ts`)

The kit lets tools read `conversationState` but not write it, so the app keeps its own flow record at `oja:flow:<phone>`:

```ts
{ v: 1, flow: 'price' | 'report' | 'book' | 'reminders' | 'language', path: string[], data: Record<string, string>, exp: number }
```

`exp = now + LIMITS.ussd.sessionTimeoutMs` and is renewed on every step. An expired record counts as no record. Only the picks are stored, never a half-built Entry or report, so a timeout cannot apply anything (Requirement 10.5).

`step` runs in this order for `choice` and `freetext`:

1. If `0` and a flow is active: pop one step of `path` and show the previous screen (or the root menu). `00`: delete the flow and show the root menu.
2. If a flow is active: give the text to that flow's current step. A pick outside the list repeats the screen. Typed input that fails validation repeats the prompt with the reason.
3. If no flow: a digit `1` to `5` starts that flow. Anything else goes to `parseCommand` for name-first forms (`owe`, `paid`, `overpaid`, `book <name>`, `price`, `report`). If nothing matches, reply with the `unrecognized` text and 3 example commands.

The `menu` tool deletes the flow record and returns the root menu. The root menu is the state with no flow record, so it needs no record of its own.

Screens (labels in config, per language). Each one is built with `renderMenuScreens(options, { title, backLabel: 'Back', menuLabel: 'Menu' })[0]` from the kit:

| Flow | Screens |
|---|---|
| root | `1 Price  2 Report price  3 Debt book  4 Reminders  5 Language` |
| `price` | commodity list (5) -> market list (3) -> result (terminal) |
| `report` | commodity list -> market list -> "Send the price in naira" (typed) -> confirmation (terminal) |
| `book` | `1 Who owes me  2 Add debt  3 Add payment  4 Undo last`. `2` and `3` ask for "Name and amount, e.g. Bola 4500" (typed) |
| `reminders` | `1 My reminders  2 Cancel one`. `2` asks for the number. Adding a Reminder is SMS-only (Requirement 10.6) |
| `language` | `1 English  2 Pidgin` |

Screen budget on USSD: 140 characters, set by `LIMITS.ussd.screenSoftTarget`. The kit's `formatReply` appends its next step ("Reply HELP for options", 22 characters plus a newline) only if it fits, and the processor sends only the first screen, so the app never relies on it. Every screen states its own instruction. With 5 options and the footer, the longest planned screen is about 90 characters.

The same flows run on SMS and web. The text is the same, and the Trader replies with a digit.

## Tool behaviour

Replies are built from config templates with `fill(template, values)`. Values are already formatted: amounts through `formatN`, names through `validName`, ages through `agoText`. The tool picks the shorter template on USSD (`ussd` variants, 3 rows instead of 5).

- **`price`**: resolves commodity and market (or lists up to 5 valid names), reads `oja:px:...:<today>`, then `displayStats`, then the `pxlast` day, then `refPrice`. Reply: commodity, unit, market, `formatN(amount)`, "from N reports, newest 2 hours ago", or "not from today (12 Nov)", or "Demo price". The word "Demo" is added whenever `demo` is true or the value is a reference price.
- **`report_price`**: parse, check today's cap in `oja:rep` (20), read the day record, `addReport` with `replaceId` from the Trader's index, write the day record, update the index and the `pxlast` pointer, reply with "added" or "not added" and the range (Requirement 4.6). Write order: day record, then pointer, then index, so a failure in the middle never leaves an index entry that points at a missing report.
- **`ledger`**: load the ledger, `applyLedger`, write on success, reply with the debtor's new balance (credit if negative). A rejected `paid` replies with the balance and `overpaid <name> <amount>`.
- **`book`**: top rows by balance (5 on SMS and web, 3 on USSD), the total owed, credit shown separately, `Demo` label when `ledger.demo`. `book <name>` shows the balance and the last 3 entries.
- **`remind`**: `parseCommand` gives name, optional amount and the date tokens. `parseWhen` and `createReminder` do the rest. Writes `oja:rem:<phone>` then `oja:rem-index`.
- **`reminders`**: lists `activeList` with numbers, or cancels the n-th.
- **`language`**: writes `oja:lang:<phone>` and confirms in the new language.
- **`help`**: commands with one example each, and the demo label.

## Reminder dispatcher (`dispatch.ts`)

```ts
interface DispatchDeps {
  store: Store; sms: ChannelAdapter; clock: Clock; rateLimiter: RateLimiter; logger: SafeLogger;
}
interface DispatchSummary { sent: number; skipped: number; failed: number; deferred: number }

dispatchDueReminders(deps): Promise<DispatchSummary>
```

For each phone in `oja:rem-index`, in order, and for each due reminder from `dueReminders`:

1. `await isSubscribed(store, phone)` (kit). If false: mark `skipped`, continue.
2. If `kind === 'debt'`: compute the debtor's balance now. If `<= 0`: mark `skipped`, continue.
3. `await rateLimiter.check(phone, 'outbound')`. If false: leave `pending`, count `deferred`, stop this phone, go to the next.
4. Build the text with `fill`, in the Trader's language, then `formatReply(text, { channel: 'sms', continueConversation: true, nextStep })` from the kit. The Pidgin next step is passed here. The result is at most 2 segments.
5. `sms.send` each segment. If every send returns `ok`: mark `sent`. Otherwise `attempts += 1`, and when `attempts >= 3` mark `failed`.
6. Write `oja:rem:<phone>` after each reminder, so a crash repeats at most one SMS (at-least-once).

When a phone has no pending reminder left, it is removed from `oja:rem-index`. The logger gets message ids and lengths only. The phone goes through the kit logger, which masks it.

The function runs when someone calls it. The scheduler is not part of this spec (Open Question 5).

## Seed (`seed.ts`)

`seedDemo(store, clock)` runs once, guarded by `oja:seed`, and only when `deps.demo !== false`.

- For each of the 5 commodities at each of the 3 markets, it writes a `PriceDay` for the seed day with 3 sample reports flagged `demo: true`. Amounts are `refPrice * [0.97, 1.00, 1.03]`, rounded to N100. It sets the `pxlast` pointer. No random numbers: the same seed day gives the same data.
- It writes one demo ledger for the handset's fake number `+2340000005678` (the value of `fakeFrom` in `handset-config.ts`, copied into `ojaConfig.demo.phone` because the app cannot import from `phantom-handset`), with `demo: true`: Bola owes N4,500 (owe N6,500, paid N2,000), Mama Ife N1,200, Chidi N8,000. These are common first names, not people.
- Commodities (unit, illustrative base price): rice (50kg bag, N82,000), beans (paint bucket, N4,500), garri (paint bucket, N3,200), tomato (big basket, N45,000), palm oil (25L gallon, N65,000). Markets and multipliers: Mile 12 x1.00, Oyingbo x1.04, Ketu x1.02. The config marks all of it as illustrative, not from a survey (Requirement 11.2).
- The seed day is the day of first use. On later days there are no accepted reports for today, so the price tool shows the latest day with its date and the "Demo" label until real reports arrive.

## Language and copy

`ojaConfig.copy` is `Record<Lang, Messages>`. A `Messages` value is a flat object of template strings with `{slot}` placeholders, plus `needsReview: true` on `pcm`. A missing key in either language is a type error, because both objects are typed with the same `Messages` interface.

`ojaConfig.processorCopy` has one string per `ProcessorCopy` field, each holding English then Pidgin in 160 characters or fewer, for example `stopped: 'You are unsubscribed. Send START to join. Una don comot. Send START to join again.'` These are checked at startup by the kit's `resolveCopy`, which throws if a string is not GSM-7 or is too long.

Pidgin wording is a first draft for the review in Open Question 4. It is a copy change only.

Every string in both languages is GSM-7 (no `₦`, no curly quotes, no emoji). Amounts are `N` plus digits and commas.

## Privacy, STOP and DELETE

- The app logs nothing itself. It passes message ids, lengths and the phone through the kit's `SafeLogger`, which masks the number and has no field for text.
- `eraseUserData(phone)`:
  1. Read `oja:rep:<phone>`. For each `(key, id)`, read the day record, remove `id` from `accepted` and `rejected`, and write it back (delete the key if both lists are empty).
  2. Delete `oja:rep:`, `oja:lang:`, `oja:book:`, `oja:flow:` and `oja:rem:` for the phone.
  3. Remove the phone from `oja:rem-index`.
  Every step tolerates a missing record, so a second call changes nothing. The kit calls this function after it deletes its own keys.
- The `pxlast` pointer holds a day and no identity, so DELETE leaves it. If the day it points to loses its last report, the price tool falls back to the reference price.
- STOP is handled by the kit. The dispatcher honours it through `isSubscribed` (Requirement 13).
- No debtor or supplier phone number is accepted or stored. A name is just text.
- Tool input is validated by `zod` at the registry (Requirement 9.7). The parser treats text as data and builds no code, query or path from it. Store keys use config ids and the kit-provided phone, never user text.
- User-facing errors come from the kit (`toUserMessage`, the registry's messages) or from config templates. Neither contains a stack trace or an id.

## Kit amendment: `isSubscribed` (Requirement 13)

New file `kit/src/subscription.ts`:

```ts
import type { Store } from './store/store.js';

export interface UserRecord { subscribed: boolean }
export const userKey = (phone: string): string => `user:${phone}`;

export async function isSubscribed(store: Store, phoneNumber: string): Promise<boolean> {
  const rec = await store.read<UserRecord>(userKey(phoneNumber));
  return rec !== undefined && rec.subscribed === true;
}
```

`processor.ts` drops its private `userKey` and `UserRecord` and imports them from `subscription.ts`, so there is one key builder. `index.ts` adds one line: `export { isSubscribed } from './subscription.js';`. The kit test `kit/test/subscription.test.ts` drives `MessageProcessor` through the sequence in Requirement 13.5 with the existing `processor-helpers.ts`, and asserts the result after each step. The existing kit tests must pass unchanged.

## Properties and tests

All property tests use fast-check, import only the pure modules, and run under `pnpm test:pbt` with `FC_NUM_RUNS=1000`. A counterexample is kept as a named regression example with a comment saying what it found.

**Generators** (in `test/gen.ts`):

- `genName`: from a small pool, so that collisions happen, with random case changes, accents (`Bólá`), and extra spaces, plus one name of exactly 20 characters.
- `genAmount`: `fc.integer({ min: 1, max: 100_000 })`, mixed with `1` and `maxAmount` through `fc.oneof`.
- `genCmd`: `owe`, `paid`, `overpaid` (weights 4, 4, 1) and `undo` (1).
- `genCmds`: `fc.array(genCmd, { maxLength: 60 })`. Replaying applies each command to the running ledger and keeps the ledger unchanged on `ok: false`.
- `genReports`: `fc.array(fc.integer({ min: 100, max: 500_000 }), { maxLength: 40 })`, each added through `addReport` with distinct Trader ids, plus a reference price from `fc.integer({ min: 1_000, max: 200_000 })`.

| # | Property | Requirement | How it is checked |
|---|---|---|---|
| P1 | The ledger balance equals the sum of transactions | 12.1 | Replay `genCmds`. A naive reference model (a `Map<normalisedName, number>` that adds on `owe`, subtracts on `paid` and `overpaid`, and drops the last operation on `undo`) must match `balanceOf` for every debtor after every step. `netBalance` equals the sum of all signed entries. |
| P2 | A payment never makes a balance negative without an Overpaid_Entry | 12.2 | After every step, for every debtor: `balanceOf(d) >= 0` or `d.entries.some(e => e.type === 'overpaid')`. A second assertion: for any `paid` with `amount > balance`, the result is `exceeds_balance` and `result.ledger` is absent. |
| P3 | The price average is unchanged when a rejected outlier is added | 12.3 | Build a day with `genReports`. Take `amount` from a generator biased to extremes (`ref * 0.01`, `ref * 50`, and `median +/- 10 * half`). Whenever `addReport` returns a rejected verdict, assert `deepEqual(after.accepted, before.accepted)` and `average` of both is equal. Also covered: a report that carries `replaceId` of an accepted report and is rejected leaves that report in place. |
| P4 | A rejected `paid` leaves the ledger equal to its input | 12.4 | Part of P2's harness: assert the input ledger is deep-equal to a snapshot taken before the call, for every result. |
| P5 | Amount round trip and validity | 12.5 | `parseAmount(formatN(n), max) === n`; `parseAmount(String(n), max) === n`; for any string, a defined result is an integer in `[1, max]`. |
| P6 | `undo` inverts `owe` and `paid` | 12.5 | For a ledger and an accepted `owe` or `paid`, applying it then `undo` deep-equals the original ledger (including `nextN`). |
| P7 | Due-check | 12.6 | `dueReminders(list, now)` equals `list.filter(r => r.status === 'pending' && r.dueAt <= now)` sorted by `dueAt`, for generated lists and times. |
| P8 | Dispatcher sends each reminder at most once | 12.6 | In-memory store, a recording `ChannelAdapter` fake that returns `ok`, a `TestClock`, an `isSubscribed` record in the store. Run `dispatchDueReminders` twice at the same time. The count of sends after run 2 equals the count after run 1. A second variant with a fake that fails twice then succeeds checks `attempts` and the `failed` state at 3. |
| P9 | Replies are GSM-7 and money is plain | 12.12 | For every template key in both languages, fill the slots with generated names, `formatN` amounts and `agoText` values. `detectEncoding(result) === 'GSM-7'`. `formatN(n)` matches `/^N\d{1,3}(,\d{3})*$/`. |

Optional example tests (Requirement 12.10): the parser in both languages (a table of 20 messages), the reply length of each tool on SMS (at most 3 segments through `formatReply`) and on USSD (at most 140 characters), the `OjaGhostApp` shape against a copy of `HandsetApp`, the DELETE sweep leaving no `oja:` key for the phone, and one scripted walkthrough: price, report, `Bola owes 4500`, `Bola paid 2000`, `book`, `remind Bola friday`, dispatch.

## Requirements traceability

| Requirement | Where |
|---|---|
| 1 Boundary, drop-in | HandsetApp wiring, file layout, D1 |
| 2 Check a price | `price` tool, `prices.ts` `displayStats`, `refPrice`, seed |
| 3 Report | `report_price` tool, `oja:rep`, `oja:px` |
| 4 Outliers | `judge`, `addReport`, P3 |
| 5 Debt entries | `ledger.ts`, `ledger` tool, P1, P2, P4, P6 |
| 6 Balances | `book` tool |
| 7 Reminders | `when.ts`, `reminders.ts`, `remind`, `reminders`, `dispatch.ts`, P7, P8 |
| 8 Languages | `copy`, `processorCopy`, `parse.ts` word lists |
| 9 Privacy | Privacy section, `eraseUserData`, kit logger |
| 10 UX and USSD | Flows, screens budget, `renderMenuScreens`, P9 |
| 11 Demo data | `seed.ts`, `demo` labels |
| 12 Tests | Properties table |
| 13 `isSubscribed` | Kit amendment section |

## Risks

- Lost updates under concurrent requests for the same phone or the same price day (no atomic Store operation). Accepted for v1. The DynamoDB store could add a conditional write later.
- A price day with many reports is one record. It is capped at 200 accepted and 50 rejected, and a Trader at 20 reports a day.
- Price days are never deleted by age. They hold no identity. DELETE removes the Trader's own reports.
- The Pidgin command words and replies are a draft until reviewed (Open Question 4).
