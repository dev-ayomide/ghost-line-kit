# Implementation Plan: oja-ghost

## Overview

This plan builds `apps/oja-ghost` in this order:

1. **Kit amendments first** (`isSubscribed`, and an optional `nextStep` on the processor), each with a required test.
2. **App scaffold and copy**, then the **pure modules** with the required property-based tests P1 to P9 from the design.
3. Then the **tools, flows, dispatcher, seed and `createOjaGhost`**.
4. Then the **phantom-handset change** (the optional `llm` and `nextStep` fields, and the swap for the stand-in).
5. A final checkpoint.

Property-based tests (PBT) are **required**. Tasks marked with `*` are optional and can be skipped to save credits. The app imports only from `@ghostline/kit`, `zod` and relative files. `zod` for `apps/oja-ghost` is recorded in `.kiro/steering/tech.md` (2026-11-19). No other dependency is added. The app reads no environment variable.

Run each test file with `pnpm vitest run <path>`. Property tests are named `*.pbt.test.ts`, so `pnpm test:pbt` finds them.

## Tasks

### 1. Kit amendments: `isSubscribed` and `nextStep`

- [x] 1.1 Export `isSubscribed` from the kit
  - Create `kit/src/subscription.ts` with `UserRecord`, `userKey(phone)` and `isSubscribed(store, phoneNumber)` exactly as in design.md "Kit amendment"
  - In `kit/src/processor.ts`, remove the private `userKey` and `UserRecord` and import them from `./subscription.js`. Change no other behaviour
  - Add `export { isSubscribed } from './subscription.js';` to `kit/src/index.ts`. Do not export `userKey`
  - _Requirements: oja-ghost 13.1, 13.2, 13.3, 13.4, 13.6_

- [x] 1.2 Write the required test in `kit/test/subscription.test.ts`
  - Drive `MessageProcessor` with `kit/test/processor-helpers.ts` through this sequence and assert `isSubscribed` after each step: before any message `false`; after an ordinary message `true`; after STOP `false`; after START `true`; after DELETE `false`
  - A store whose `read` rejects makes `isSubscribed` reject with the same error. `isSubscribed` never writes (spy on `store.write`)
  - _Requirements: oja-ghost 13.2, 13.3, 13.5_

- [x] 1.3 Add an optional `nextStep` to `MessageProcessorConfig`
  - In `kit/src/processor.ts`, add `nextStep?: string` to `MessageProcessorConfig`. Validate it in the constructor like `resolveCopy` does: a non-empty string, at most `LIMITS.reply.nextStepMaxLength` characters, and `detectEncoding(value) === 'GSM-7'`. Throw `Error('Invalid processor nextStep: ...')` otherwise
  - Pass it to `formatReply(text, { channel, continueConversation, nextStep })` in `render()`. When it is not set, pass nothing, so the default text is unchanged
  - Static only: one string per processor. It cannot follow a user's language. The app uses a short text that works in both (see task 13.1)
  - _Requirements: oja-ghost design D3, 8.5_

- [x] 1.4 Write the required test in `kit/test/processor-next-step.test.ts`
  - With `nextStep: 'Send HELP'` an SMS reply ends with `Send HELP`, and without the option it ends with `Reply HELP for options` as before
  - An empty string, a 41-character string and a string with `₦` all make the constructor throw
  - STOP and DELETE acknowledgements (no continued conversation) carry no next step
  - _Requirements: oja-ghost design D3_

- [x] 1.5 Checkpoint: kit amendments
  - Run `pnpm test` and `pnpm typecheck`. All existing kit tests pass unchanged
  - Append a short "Amendment 2026-11-19 (oja-ghost)" note to `.kiro/specs/kit-core/design.md` for `isSubscribed` and `nextStep`, and point to this spec

### 2. App scaffold, config and copy

- [x] 2.1 Scaffold the package
  - In `apps/oja-ghost/package.json` add `zod` to `dependencies` with the same range as `kit` (`^4.6.7`), and add `"test": "vitest run"` only if the other apps do. Run `pnpm install` and confirm no other package changes
  - Create the empty files listed in design.md "File layout", each with a one-line comment saying what it will hold. Keep `src/index.ts` exporting `{}` until task 13
  - _Requirements: oja-ghost 1.1, 1.7_

- [x] 2.2 Write `app.config.ts`, `copy.ts` and `keys.ts`
  - `ojaConfig` with: id, name, `*384#`, `38400`, `MENU`, `Hi`; the 5 commodities (units, aliases, illustrative base prices) and 3 markets (aliases, multipliers) from design.md "Seed"; `limits`; `outlier`; `words` (both languages); `intentNames` and `intentTool`; `demo` (fake phone, sample book); and a note that all prices are illustrative
  - `copy: Record<Lang, Messages>` typed by one `Messages` interface, so a missing key in either language fails type-check. Include `ussd` variants where the design says a shorter text is needed. Mark `pcm` with `needsReview: true`. All text is GSM-7, amounts are `N`
  - `processorCopy` (one bilingual string per `ProcessorCopy` field, at most 160 characters) and `nextStep` (a short bilingual text of at most 40 characters, GSM-7)
  - `fill(template, values)` and `t(lang, key)` in `copy.ts`. `keys.ts` has the key builders and record types from the data model table
  - _Requirements: oja-ghost 1.5, 1.6, 8.1, 8.5, 8.6, 8.7, 10.12, 10.13, 11.2_

- [x] 2.3 Write the required PBT P9 in `apps/oja-ghost/test/copy.pbt.test.ts`
  - **Property:** for every template key in both languages, filling the slots with generated names (from `genName`), `formatN` amounts and `agoText` values gives text that `detectEncoding` reports as `GSM-7`. Static strings (`processorCopy`, `nextStep`, menu labels) are also `GSM-7`. `formatN(n)` matches `/^N\d{1,3}(,\d{3})*$/`
  - Also assert `processorCopy` fields pass the kit's length limit, and `nextStep` is at most `LIMITS.reply.nextStepMaxLength`
  - _Requirements: oja-ghost 12.12, 10.12, 10.13, 8.5_

### 3. Money and names

- [x] 3.1 Implement `money.ts` and `names.ts`
  - `parseAmount(s, max)` and `formatN(n)` as in design.md. `normaliseName` and `validName` (uses the kit's `detectEncoding`)
  - `parseAmount` rejects malformed comma groups (`4,50`), decimals without `k`, zero, negatives and values above `max`
  - _Requirements: oja-ghost 3.2, 5.3, 5.4, 10.12, 10.13_

- [x] 3.2 Write the required PBT P5 in `apps/oja-ghost/test/money.pbt.test.ts`
  - **Property:** `parseAmount(formatN(n), max) === n` and `parseAmount(String(n), max) === n` for `n` in `[1, max]`, including `1` and `max`
  - **Property:** for any string, a defined result is an integer in `[1, max]`
  - **Property:** `normaliseName` is idempotent and ignores case, accents and extra spaces
  - Keep any counterexample as a named regression example
  - _Requirements: oja-ghost 12.5, 12.7, 12.8_

### 4. Ledger

- [x] 4.1 Implement `ledger.ts`
  - `applyLedger`, `balanceOf`, `netBalance`, `totalOwed` with the rules in design.md: no mutation, `paid` above the balance returns `exceeds_balance` and no ledger, `overpaid` is the only way to a negative balance, `undo` removes the highest `n`, restores `nextN` and drops an emptied debtor, limits from config
  - _Requirements: oja-ghost 5.1, 5.2, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

- [x] 4.2 Write the required PBTs P1, P2 and P4 in `apps/oja-ghost/test/ledger.pbt.test.ts`
  - Put the generators (`genName`, `genAmount`, `genCmd`, `genCmds`) in `apps/oja-ghost/test/gen.ts`
  - **P1:** after every step of a replay, `balanceOf` for each debtor equals a naive reference model, and `netBalance` equals the sum of all signed entries
  - **P2:** after every step, every debtor has `balanceOf >= 0` or holds an `overpaid` entry. A `paid` above the balance returns `exceeds_balance` with no ledger
  - **P4:** the input ledger is deep-equal to a snapshot taken before the call, for every result (nothing is mutated), and every failed command leaves the ledger equal to its input
  - _Requirements: oja-ghost 12.1, 12.2, 12.4, 12.7, 12.8_

- [x] 4.3 Write the required PBT P6 in the same file
  - **P6:** applying an accepted `owe` or `paid` and then `undo` returns a ledger deep-equal to the original, including `nextN`
  - _Requirements: oja-ghost 12.5_

### 5. Prices and outlier rejection

- [x] 5.1 Implement `prices.ts`
  - `judge`, `average`, `addReport`, `displayStats`, `refPrice` with the rules in design.md. A rejected report leaves `accepted` unchanged, including when it carries a `replaceId`. Nothing is re-judged
  - _Requirements: oja-ghost 2.4, 2.5, 2.6, 3.3, 3.5, 4.1 to 4.5, 4.7, 11.3_

- [x] 5.2 Write the required PBT P3 in `apps/oja-ghost/test/prices.pbt.test.ts`
  - **P3:** build a day from generated reports, then add an amount from an extreme-biased generator. Whenever the verdict is a rejection, `after.accepted` deep-equals `before.accepted` and `average` of both is equal. Include reports with `replaceId` of an accepted report
  - **Also:** `average` is the mean of the accepted amounts, rounded to the nearest 10, and ignores rejected ones. With 3 or more non-demo reports, `displayStats` ignores demo reports and reports `demo: false`
  - Keep any counterexample as a named regression example
  - _Requirements: oja-ghost 12.3, 12.8, 4.5_

### 6. Dates and reminders

- [x] 6.1 Implement `when.ts` and `reminders.ts`
  - `lagosDay`, `parseWhen` and `agoText` (design.md "when.ts"), then `createReminder`, `dueReminders`, `activeList`, `cancelNth`. Dates are in Lagos time (UTC+1), default 08:00, at most 90 days ahead, never in the past
  - _Requirements: oja-ghost 7.1 to 7.7, 7.14_

- [x] 6.2 Write the required PBT P7 in `apps/oja-ghost/test/reminders.pbt.test.ts`
  - **P7:** `dueReminders(list, now)` equals `list.filter(r => r.status === 'pending' && r.dueAt <= now)` sorted by `dueAt`, for generated lists and times
  - Add example cases for `parseWhen`: `tomorrow`, `friday` on a Friday (next week), `15 dec` after 15 Dec (next year), `in 91 days` (rejected), a past time (rejected)
  - _Requirements: oja-ghost 12.6, 7.3, 7.4, 7.14_

### 7. Parser and classifier

- [x] 7.1 Implement `parse.ts` and `provider.ts`
  - `routeIntent(text)` and `parseCommand(text)` with the grammar in design.md, using the word lists from config (both languages). `routeIntent` never returns `unrecognized`
  - `OjaRuleProvider implements LlmProvider`: `classifyIntent` returns `{ name: routeIntent(message), parameters: {}, rawMessage: message }`. `complete` returns a short fixed string
  - Names are the words between the command and the amount or verb, 1 to 20 characters. Commodity and market use the longest alias first
  - _Requirements: oja-ghost 2.2, 2.3, 3.1, 5.1, 5.2, 6.1, 7.1, 7.2, 8.3, 10.10_

- [ ]* 7.2 Write example tests for the parser in `apps/oja-ghost/test/parse.test.ts`
  - A table of about 20 messages in English and Pidgin with the expected intent and parsed fields, including `Bola owes 4500`, `Bola don pay 2,000`, `how much rice Mile 12`, `rice mile12 don cost 68k`, `pay Mama Ngozi 50000 monday`, `remind Bola friday`, a bare `2`, `68000`, `00`
  - `routeIntent` returns a name that is in `intentNames` for every generated string
  - _Requirements: oja-ghost 8.3, 12.10_

### 8. Tools: price, report, ledger, book

- [x] 8.1 Implement `defineTool` and the tools `price`, `report_price`, `ledger` and `book` in `tools.ts`
  - Shared `Input` zod schema. `defineTool` does seed, language load, first-reply demo notice and calls the handler, as in design.md
  - `report_price` writes in the order day record, pointer, index, and enforces the 20-per-day cap. `ledger` replies with the exact `overpaid` message after `exceeds_balance`. `book` shows 5 rows on SMS and web, 3 on USSD
  - Every reply is built with `fill` and the formatters, never string-concatenated user text outside `validName`
  - _Requirements: oja-ghost 2, 3, 4.6, 4.8, 5, 6, 9.7, 11.3, 11.5_

### 9. Flows and the remaining tools

- [x] 9.1 Implement `flows.ts` and the tools `menu`, `help`, `step`, `language`, `remind` and `reminders`
  - The flow record, expiry and the `0` and `00` rules from design.md. Screens are built with the kit's `renderMenuScreens` and fit 140 characters
  - `step` order: back or menu, active flow input, digit starts a flow, name-first command, else the `unrecognized` reply with 3 examples
  - `remind` and `reminders` read and write `oja:rem:<phone>` and `oja:rem-index`
  - _Requirements: oja-ghost 7.1 to 7.7, 8.2, 8.4, 10.2 to 10.6, 10.10, 10.11_

### 10. Dispatcher

- [x] 10.1 Implement `dispatch.ts`
  - `dispatchDueReminders` with the steps in design.md: `isSubscribed`, balance check for debt reminders, outbound rate limit, `formatReply` with the app's next step, send, mark and write after each reminder, three attempts, remove the phone from the index when nothing is pending
  - _Requirements: oja-ghost 7.8 to 7.13, 7.15, 9.5_

- [x] 10.2 Write the required PBT P8 in `apps/oja-ghost/test/dispatch.pbt.test.ts`
  - **P8:** with a `MemoryStore`, a recording fake `ChannelAdapter` that returns `ok`, a `TestClock` and generated reminders, running `dispatchDueReminders` twice at the same time gives the same send count after run 2 as after run 1
  - **Also:** a fake that fails twice then succeeds ends `sent` after 3 runs. A fake that always fails ends `failed` after 3 runs. A number that sent STOP is `skipped` and receives nothing. A debt reminder whose balance is 0 is `skipped`
  - Keep any counterexample as a named regression example
  - _Requirements: oja-ghost 12.6, 7.9 to 7.13_

### 11. Seed

- [x] 11.1 Implement `seed.ts`
  - `seedDemo(store, clock)`, guarded by `oja:seed`: 3 sample reports (`demo: true`) per commodity and market from the reference price, the `pxlast` pointers, and the demo ledger for the fake number. Deterministic, no randomness
  - _Requirements: oja-ghost 1.4, 11.1 to 11.6_

### 12. `eraseUserData`

- [x] 12.1 Implement the DELETE sweep and its test
  - `eraseUserData(phone)` as in design.md "Privacy": remove the Trader's reports from the day records through `oja:rep:<phone>`, delete the Trader's `oja:` keys, remove the phone from `oja:rem-index`. Safe to call twice
  - Write the required example test `apps/oja-ghost/test/erase.test.ts`: create a language, a ledger, a flow, a reminder and two price reports (one accepted, one rejected), call `eraseUserData`, and assert no `oja:` key for the phone remains, other Traders' reports and the day average from them are unchanged, and a second call does nothing
  - _Requirements: oja-ghost 9.3, 9.4_

### 13. `createOjaGhost` and the package entry

- [x] 13.1 Implement `index.ts`
  - `createOjaGhost(deps?)` returning `OjaGhostApp` (add `nextStep` to the interface in design.md), with `buildToolCall` from the intent to tool table, `intentNames` from config, `copy` from `processorCopy`, `llm` from `OjaRuleProvider`, and `eraseUserData`. Defaults: `MemoryStore`, `SystemClock`, `demo: true`
  - Export `dispatchDueReminders` and the types. Export nothing else from the app internals
  - Update the design.md D3 row and the interface to say `nextStep` is now a kit option
  - _Requirements: oja-ghost 1.1 to 1.6_

- [x] 13.2 Checkpoint: app
  - Run `pnpm test` and `pnpm typecheck`. All required PBTs (P1 to P9) pass
  - Replace the placeholder smoke test only if it no longer applies. Do not delete it otherwise

### 14. phantom-handset: classifier hook and the swap

- [x] 14.1 Add the optional `llm` and `nextStep` fields (approved D1, D3)
  - In `phantom-handset/server/apps.ts` add `llm?: LlmProvider` and `nextStep?: string` to `HandsetApp`
  - In `phantom-handset/server/wire.ts`, build each app's `Agent` with `app.llm ?? llm`, and pass `...(app.nextStep ? { nextStep: app.nextStep } : {})` to `MessageProcessor`. No other change. The stand-in apps keep working without the new fields
  - Run the existing phantom-handset tests. They must pass unchanged
  - _Requirements: oja-ghost 1.3; design D1, D3_

- [x] 14.2 Swap the stand-in for the real app (Open Question 6 approved by the owner)
  - Add `@ghostline/oja-ghost` as a workspace dependency of `phantom-handset`. Change `getApps()` to take the shared `store` and `clock` from `createDeps`, and return `[createOjaGhost({ store, clock }), <stand-in Blackout Line>]`. Keep the Blackout Line stand-in until its own spec
  - Update the two "placeholder, confirm with the app specs" comments in `handset-config.ts` for `*384#` and `38400`. Do not change the values
  - Add a compile-time check in `phantom-handset/test` that `createOjaGhost()` is assignable to `HandsetApp`
  - Run a scripted walkthrough through the handler in a test: `MENU`, `1`, `1`, `1` (rice at Mile 12 on USSD), then SMS `Bola owes 4500`, `Bola paid 2000`, `book`. Assert the replies contain `Demo` for prices and `N2,500` for the balance
  - _Requirements: oja-ghost 1.3, 1.8, 10.2; Open Question 6_

### 15. Optional tasks

- [ ]* 15.1 Add the model fallback for unmatched free text (approved as optional, D2)
  - In `provider.ts`, accept an optional base `LlmProvider`. When `routeIntent` returns `freetext` and no flow is waiting for text, call `base.classifyIntent` with the intent names. Use its answer only if it is a real command intent. Parse the amount, name and date from the raw text by code, as before, and never use model parameters
  - A failing or unrecognized model answer falls back to `freetext`. The flow check needs the phone, so the `step` tool makes this call, not the provider (the provider does not receive the phone). Keep it behind `deps.llm`
  - Tests: a fake model that answers `price` for `abeg wetin rice dey cost for Oyingbo` leads to the price tool, and a fake that throws leaves the `unrecognized` reply
  - _Requirements: oja-ghost design D2_

- [ ]* 15.2 Write the remaining example tests
  - Reply length for each tool: at most 3 segments through `formatReply` on SMS and at most 140 characters on USSD
  - An import scan of `apps/oja-ghost/src` that fails on any import other than `@ghostline/kit`, `zod` and relative paths
  - One scripted walkthrough: price, report, `Bola owes 4500`, `Bola paid 2000`, `book`, `remind Bola friday`, dispatch
  - _Requirements: oja-ghost 1.1, 12.10, 12.11_

### 16. Final checkpoint

- [ ] 16.1 Final checks and notes
  - Run `pnpm test`, `pnpm test:pbt` and `pnpm typecheck`
  - Add a short section to the root `README.md` for Oja Ghost: codes, commands in both languages, "demo data, not live market data", and how to run the dispatcher. Do not claim a line count
  - Do not edit `docs/kiro-log.md`. It only takes entries the owner dictates
  - Report which Open Questions (4 pidgin review, 5 reminder trigger in the demo) are still open
