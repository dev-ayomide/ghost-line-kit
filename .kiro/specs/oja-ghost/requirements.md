# Requirements Document

## Introduction

Oja Ghost is a market assistant for traders in Lagos, in `/apps/oja-ghost`. It works on any phone over SMS and USSD. A trader can check today's price of a commodity at a market, report a price, keep a debt book, and get SMS reminders for debts and supplier payments. It speaks English and Nigerian Pidgin.

Oja Ghost is the first proof that the kit works: it should need fewer than about 300 lines of app-specific code.

Decisions already made, and binding on this spec:

1. **Public API only.** The app imports only from `@ghostline/kit`. It never imports `kit/src/...`. A hook enforces this.
2. **Drop-in for the Phantom Handset.** The app exports a `HandsetApp`-shaped object (`id`, `name`, `tools`, `intentNames`, `copy`, `buildToolCall`, `renderOutput`, `eraseUserData`), the shape defined in `phantom-handset/server/apps.ts`, so `getApps()` can replace the stand-in. `HandsetApp` itself is not imported from `phantom-handset`.
3. **Codes.** USSD `*384#` and SMS short code `38400`, as in `phantom-handset/src/config/handset-config.ts`. The handset opens USSD with the text `MENU` and starts an SMS chat with `Hi`.
4. **Reminders go to the trader only.** The app never sends an SMS to a debtor or a supplier. This avoids messaging third parties who did not consent, and SMS cost abuse.
5. **Demo data is labelled.** The seed data is illustrative, not real market data, and every reply that uses it says so.

Facts about the current kit that shape these requirements:

- `Tool.inputSchema` is a `z.ZodType`, but the kit does not export `zod`. The app needs `zod` to define tool inputs. `zod` is approved only for `kit` and `phantom-handset`. See Open Question 1.
- `ToolContext.conversationState` is read-only for tools, so the app keeps its own USSD flow state in the `Store`.
- `Store` has no list or scan operation. The app keeps its own index keys, and `eraseUserData` deletes by those keys.
- `MessageProcessor` keeps the subscribed flag in a kit-internal key. The app has no public way to check STOP. See Open Question 2.
- `ProcessorCopy` is one language per app and must be GSM-7. The Pidgin and English versions of these fixed messages are combined in one short text.
- The kit has no scheduler. Reminders need something to call a dispatch function on a timer.
- `₦` is not in GSM-7. Any SMS that contains it is sent as UCS-2 (70 characters per segment, 67 when joined). `feature-phone-ux.md` still requires `₦`, so replies with money use it and the cost is accepted. See Open Question 3.

The ledger, price statistics, command parser, reminder date parser and reminder due-check are pure functions. The three properties you named, plus the properties in Requirement 11, are verified with fast-check. These tests are required. Other tests are optional.

## Glossary

- **Oja_Ghost**: the app in `/apps/oja-ghost`.
- **Trader**: the user, identified by phone number.
- **Commodity**: a thing sold in a market, from a fixed list in the app config (for example rice 50kg bag, beans, garri, tomato basket, palm oil).
- **Market**: a Lagos market from a fixed list in the app config (for example Mile 12, Oyingbo, Ketu).
- **Unit**: the sale unit for a Commodity, from the app config (for example "50kg bag").
- **Price_Report**: one price (whole naira) for a Commodity at a Market, sent by a Trader at a time.
- **Accepted_Report**: a Price_Report that passed outlier rejection.
- **Rejected_Report**: a Price_Report that failed outlier rejection. It is stored for audit and never used in the average.
- **Reference_Price**: the demo seed price for a Commodity at a Market. Used to judge the first reports.
- **Price_Average**: the mean of the Accepted_Reports of the current Lagos day for a Commodity at a Market, rounded to the nearest ₦10.
- **Lagos_Day**: a calendar day in West Africa Time (UTC+1, no daylight saving).
- **Ledger**: the debt book of one Trader: debtors and their entries.
- **Entry**: one Ledger line with a debtor name, a type (`owe`, `paid` or `overpaid`), a whole-naira amount greater than 0, and a timestamp.
- **Balance**: for one debtor, the sum of `owe` amounts minus the sum of `paid` and `overpaid` amounts.
- **Overpaid_Entry**: an Entry of type `overpaid`. It is the only way a Balance can become negative.
- **Reminder**: a scheduled SMS to the Trader. Kind `debt` (about a debtor) or `supplier` (about paying a supplier).
- **Dispatcher**: the function that sends due Reminders. It is called by a scheduler outside the app.
- **Language**: `en` (English) or `pcm` (Nigerian Pidgin). Stored per Trader.
- **Demo_Data**: the seeded prices, labelled as demo.
- **App_Config**: `apps/oja-ghost/app.config.ts`: name, codes, menus, commodity and market lists, intents and all copy for both languages.

## Requirements

### Requirement 1: Public API Boundary and Drop-in Shape

**User Story:** As a developer, I want the app built only on the kit's public API and ready to replace the stand-in, so that it proves the skeleton.

#### Acceptance Criteria

1. THE Oja_Ghost source SHALL import only from `@ghostline/kit` and relative files inside `apps/oja-ghost`, and SHALL NOT import `kit/src/...` paths.
2. THE Oja_Ghost SHALL NOT call any model SDK, `@aws-sdk/*` package, or telco SDK directly. All model, store and channel access SHALL go through kit interfaces.
3. THE Oja_Ghost SHALL export a factory `createOjaGhost(deps?)` that returns an object with the fields `id` (`'oja-ghost'`), `name` (`'Oja Ghost'`), `tools`, `intentNames`, `copy`, `buildToolCall`, `renderOutput` and `eraseUserData`, with types compatible with `HandsetApp` in `phantom-handset/server/apps.ts`.
4. THE factory SHALL default `deps.store` to a `MemoryStore` and `deps.clock` to a `SystemClock`, and SHALL seed Demo_Data into the store only when the store has none.
5. THE Oja_Ghost SHALL keep every user-visible string, the Commodity and Market lists, the intent names, the USSD code and the short code in the App_Config, and SHALL NOT hard-code them in tool code.
6. THE App_Config SHALL set the USSD code to `*384#`, the short code to `38400`, and SHALL accept `MENU` as the USSD opening text and `Hi` as the first SMS.
7. THE Oja_Ghost SHALL add no dependency except `zod` (see Open Question 1), and SHALL NOT add one without approval.
8. WHERE a compile-time check is added in `phantom-handset`, it SHALL assert that the object returned by `createOjaGhost()` is assignable to `HandsetApp`. This check is **optional**.

### Requirement 2: Check a Price

**User Story:** As a trader, I want to ask the price of rice at Mile 12 and get a clear, honest answer.

#### Acceptance Criteria

1. WHEN a Trader sends a message such as `price rice mile 12` or `how much rice Mile 12`, THE Oja_Ghost SHALL reply with the Commodity, Unit, Market, the Price_Average, the number of Accepted_Reports it is based on, and the age of the newest one.
2. THE Oja_Ghost SHALL match Commodity and Market names ignoring case, extra spaces and the spelling variants listed in the App_Config (for example `mile12`, `Mile 12`).
3. IF a Trader names a Commodity or Market that is not in the lists, THEN THE Oja_Ghost SHALL reply with the available names (at most 5) and a next step, and SHALL NOT guess.
4. IF the current Lagos_Day has no Accepted_Report for that Commodity and Market, THEN THE Oja_Ghost SHALL show the most recent price with its date, and SHALL say it is not from today.
5. IF there are no Accepted_Reports at all, THEN THE Oja_Ghost SHALL show the Reference_Price and SHALL label it "Demo price".
6. THE Oja_Ghost SHALL label every reply that uses Demo_Data with the word "Demo" (English) or "Demo" (Pidgin), and SHALL NOT present a Reference_Price as a live price.
7. THE Oja_Ghost SHALL show a price with the naira sign and thousands separators, such as `₦68,000`, and SHALL NOT show decimals.
8. WHEN a price reply would exceed 3 SMS segments, THE Oja_Ghost SHALL return a shorter reply and offer `Reply MORE`.

### Requirement 3: Report a Price with Crowdsourced Averaging

**User Story:** As a trader, I want to report what I paid, so that other traders get a fair average.

#### Acceptance Criteria

1. WHEN a Trader sends a message such as `report rice mile 12 68000` or `rice mile12 don cost 68,000`, THE Oja_Ghost SHALL validate the Commodity, Market and amount, and SHALL record a Price_Report.
2. THE Oja_Ghost SHALL accept amounts written `68000`, `68,000`, `N68000`, `₦68,000` and `68k`, and SHALL reject amounts that are not whole naira between ₦1 and the maximum in the App_Config.
3. THE Oja_Ghost SHALL keep at most one Price_Report per Trader, Commodity and Market per Lagos_Day. A later report from the same Trader on the same day SHALL replace the earlier one and the Price_Average SHALL be recomputed from the Accepted_Reports.
4. THE Oja_Ghost SHALL store a salted one-way hash of the phone number as the reporter key, and SHALL NOT store the phone number in a Price_Report.
5. THE Price_Average SHALL be the mean of the Accepted_Reports of the current Lagos_Day for the Commodity and Market, rounded to the nearest ₦10, and SHALL NOT include Rejected_Reports.
6. WHEN a Trader sends a Price_Report, THE Oja_Ghost SHALL confirm the report, and SHALL say whether it was added to today's average or not.
7. THE Oja_Ghost SHALL write the Price_Reports and the Trader's reporter index to the store so that DELETE can remove them (Requirement 9).

### Requirement 4: Outlier Rejection

**User Story:** As a trader, I want a typo or a joke report to be ignored, so that the average stays trustworthy.

#### Acceptance Criteria

1. WHEN a Price_Report arrives and fewer than 3 Accepted_Reports exist for that Commodity, Market and Lagos_Day, THE Oja_Ghost SHALL accept it only if it is within the plausible band of the Reference_Price, which is 0.5 times to 2 times the Reference_Price.
2. WHEN a Price_Report arrives and 3 or more Accepted_Reports exist, THE Oja_Ghost SHALL accept it only if it is within 3 times the scaled median absolute deviation of the median of those Accepted_Reports, with a minimum half-width of 10% of the median. The numbers are set in the App_Config.
3. THE Oja_Ghost SHALL decide acceptance by comparing the new Price_Report with the Accepted_Reports that exist before it is added.
4. THE Oja_Ghost SHALL NOT re-judge earlier reports when a new one arrives. A Rejected_Report SHALL stay rejected and an Accepted_Report SHALL stay accepted.
5. WHEN a Price_Report is rejected, THE Oja_Ghost SHALL leave the Price_Average and the count of Accepted_Reports unchanged, and SHALL store the Rejected_Report for audit.
6. WHEN a Price_Report is rejected, THE Oja_Ghost SHALL tell the Trader in plain words that the price looks far from today's range, show the range, and say how to send it again.
7. THE Oja_Ghost SHALL implement the Price_Average and the acceptance decision as pure functions that take the list of Accepted_Reports and the new amount, and return the decision and the new list.
8. THE Oja_Ghost SHALL rate-limit price reports per Trader using the kit rate limiter, and SHALL cap a Trader at 20 Price_Reports per Lagos_Day. This cap is in the App_Config.

### Requirement 5: Debt Book Entries

**User Story:** As a trader, I want to write down "Bola owes ₦4,500" and "Bola paid ₦2,000", so that I know who owes me.

#### Acceptance Criteria

1. WHEN a Trader sends a message such as `Bola owes 4500` or `Bola dey owe me ₦4,500`, THE Oja_Ghost SHALL append an `owe` Entry for that debtor and reply with the new Balance.
2. WHEN a Trader sends a message such as `Bola paid 2000` or `Bola don pay 2,000`, THE Oja_Ghost SHALL append a `paid` Entry for that debtor and reply with the new Balance.
3. THE Oja_Ghost SHALL treat debtor names as the same ignoring case, accents and extra spaces, SHALL allow names of 1 to 20 characters, and SHALL store the name as the Trader first wrote it.
4. THE Oja_Ghost SHALL accept amounts in the same forms as Requirement 3.2.
5. IF a `paid` amount is greater than the debtor's Balance, THEN THE Oja_Ghost SHALL NOT append any Entry, and SHALL reply with the Balance and the exact message to send to record the extra as an overpayment.
6. WHEN a Trader sends a message such as `Bola overpaid 5000`, THE Oja_Ghost SHALL append an Overpaid_Entry and reply with the new Balance, which may be negative, shown as credit.
7. IF a `paid` message names a debtor who has no Entry, THEN THE Oja_Ghost SHALL reply that the name is not in the book, list up to 5 names, and SHALL NOT create a debtor.
8. THE Oja_Ghost SHALL limit a Ledger to 50 debtors and 200 Entries per debtor, set in the App_Config, and SHALL reply with a short, actionable message when a limit is reached.
9. WHEN a Trader sends `undo`, THE Oja_Ghost SHALL remove the newest Entry of the Ledger and show the new Balance. This SHALL be the only way an Entry is removed, apart from DELETE.
10. THE Oja_Ghost SHALL implement Ledger changes as a pure function from a Ledger and a command to a new Ledger or an error, and SHALL NOT mutate its input.

### Requirement 6: See Balances

**User Story:** As a trader, I want to see who owes me and how much.

#### Acceptance Criteria

1. WHEN a Trader sends `book`, `balance` or `who owe me`, THE Oja_Ghost SHALL reply with up to 5 debtors with the largest Balance, each with the name and Balance, and the total owed.
2. WHEN a Trader sends `book Bola` or `Bola balance`, THE Oja_Ghost SHALL reply with that debtor's Balance and the last 3 Entries with their dates.
3. IF the Ledger has more than 5 debtors with a Balance above 0, THEN THE Oja_Ghost SHALL show the first 5 and offer `Reply MORE`.
4. THE Oja_Ghost SHALL NOT list a debtor whose Balance is 0 in the summary, and SHALL show a debtor with a negative Balance as credit, separate from the total owed.
5. THE Oja_Ghost SHALL NOT split a debtor name, an amount or a date across segments or screens.
6. THE Oja_Ghost SHALL reply to an empty Ledger with a short sentence and the way to add the first Entry.

### Requirement 7: Reminders for Debts and Supplier Payments

**User Story:** As a trader, I want an SMS to remind me to collect a debt or pay a supplier on the right day.

#### Acceptance Criteria

1. WHEN a Trader sends a message such as `remind Bola friday` or `remind me collect Bola 15 Dec`, THE Oja_Ghost SHALL create a `debt` Reminder for that debtor and date.
2. WHEN a Trader sends a message such as `pay Mama Ngozi 50000 monday`, THE Oja_Ghost SHALL create a `supplier` Reminder with the supplier name, the amount and the date.
3. THE Oja_Ghost SHALL accept dates `today`, `tomorrow`, `in N days`, a weekday name (the next one), and `D Mon` (for example `15 Dec`), all in Lagos_Day. A Reminder SHALL be due at 08:00 West Africa Time on that day unless the message gives a time `HH:MM`.
4. IF a date is in the past, more than 90 days ahead, or not understood, THEN THE Oja_Ghost SHALL NOT create a Reminder, and SHALL reply with the accepted date forms.
5. THE Oja_Ghost SHALL allow at most 10 active Reminders per Trader, set in the App_Config.
6. WHEN a Reminder is created, THE Oja_Ghost SHALL confirm the date and time in plain words.
7. WHEN a Trader sends `reminders`, THE Oja_Ghost SHALL list the active Reminders with a number each. WHEN a Trader sends `cancel 2`, THE Oja_Ghost SHALL cancel the Reminder with that number.
8. THE Oja_Ghost SHALL export a function `dispatchDueReminders({ store, sms, clock, rateLimiter, isSubscribed, logger })` that sends each due Reminder to its Trader through the given `ChannelAdapter`, and SHALL NOT send to any other number.
9. WHEN a `debt` Reminder is due, THE Dispatcher SHALL compute the debtor's Balance at that moment. IF the Balance is 0 or less, THEN THE Dispatcher SHALL skip the SMS and mark the Reminder `skipped`.
10. THE Dispatcher SHALL mark a Reminder `sent` only after the send succeeds. IF a send fails, THEN THE Dispatcher SHALL retry on the next run, up to 3 attempts, and then mark the Reminder `failed`.
11. WHEN the Dispatcher runs twice with the same data and the same clock, THE second run SHALL send no Reminder that the first run sent.
12. THE Dispatcher SHALL check the kit rate limiter for the outbound direction before each send, and SHALL leave the Reminder `pending` when the limit is reached.
13. THE Dispatcher SHALL NOT send to a Trader who has sent STOP, and SHALL mark such Reminders `skipped`. This depends on Open Question 2.
14. THE due-check SHALL be a pure function that takes the Reminders and the current time, and returns the Reminders that are due, so a property test can cover it.
15. THE reminder SMS SHALL say what it is for, name the debtor or supplier, show the amount when known, and end with a next step, and SHALL fit in at most 2 SMS segments.

### Requirement 8: English and Nigerian Pidgin

**User Story:** As a trader, I want to use the app in the language I speak.

#### Acceptance Criteria

1. THE Oja_Ghost SHALL support the Languages `en` and `pcm`, with all copy for both in the App_Config.
2. THE Oja_Ghost SHALL default a new Trader to `en`. WHEN the Trader sends `pidgin` or `english`, or chooses Language from the menu, THE Oja_Ghost SHALL store the choice and confirm it in the new Language.
3. THE command parser SHALL accept command words from both Languages in any message, whatever the stored Language, so a Pidgin sentence works for an `en` Trader. The word lists are in the App_Config.
4. THE Oja_Ghost SHALL reply in the Trader's stored Language, including errors from tool failures.
5. THE `ProcessorCopy` overrides (`stopped`, `notSubscribed`, `deleted`, `resubscribed`, `unrecognized`, `nothingMore`, `done`) SHALL be one short text per field that holds both English and Pidgin, SHALL be GSM-7, and SHALL be at most `LIMITS.reply.errorMaxLength` characters.
6. THE Oja_Ghost SHALL keep Pidgin copy plain and respectful, with the same meaning and the same next step as the English copy.
7. THE Pidgin copy SHALL be marked in the App_Config as "needs native-speaker review", and SHALL be reviewed before the demo video is filmed. See Open Question 4.
8. THE Oja_Ghost SHALL NOT include Yoruba in this spec. Yoruba is a stretch goal and SHALL be addable as a third Language by adding App_Config entries only.

### Requirement 9: Privacy, STOP, DELETE and Logging

**User Story:** As a trader, I want my phone number and my book to be private, and to leave whenever I want.

#### Acceptance Criteria

1. THE Oja_Ghost SHALL mask phone numbers with `maskPhoneNumber` in every log line, trace summary and error, and SHALL NOT print a full number.
2. THE Oja_Ghost SHALL NOT log message bodies, debtor names or amounts in production. It SHALL log message IDs and lengths only, using the kit logger.
3. THE `eraseUserData(phone)` function SHALL delete the Trader's Ledger, Language, USSD flow state, Reminders, reporter index and all Price_Reports listed in the reporter index, and SHALL then be safe to call again.
4. WHEN a Trader sends DELETE, THE Oja_Ghost SHALL leave no Ledger, Reminder, Language or Price_Report of that Trader in the store, and SHALL leave the Price_Average of other Traders computed from their own reports only.
5. WHEN a Trader sends STOP, THE Oja_Ghost SHALL send no further Reminder to that Trader until START. The Ledger and Reminders SHALL be kept, so START restores service. Reminders that fall due while the Trader is stopped SHALL be marked `skipped`.
6. THE Oja_Ghost SHALL NOT store a debtor's or supplier's phone number, and SHALL NOT offer a way to enter one.
7. THE Oja_Ghost SHALL validate every tool input with `zod`, and SHALL treat message text as untrusted data.
8. THE Oja_Ghost SHALL read the reporter-hash salt only from an environment variable listed in `.env.example`, and SHALL fail with a short error at startup, not at first use, when it is missing in production.
9. User-facing errors SHALL be short and tell the Trader what to do next, such as "Try again. Send HELP for options.", and SHALL NOT contain a stack trace or an internal ID.

### Requirement 10: Feature-Phone UX, USSD Menu and Reply Limits

**User Story:** As a trader on a $10 phone, I want short screens and clear next steps.

#### Acceptance Criteria

1. THE Oja_Ghost SHALL read every channel limit from `LIMITS` in the kit, and SHALL NOT define its own copy of an SMS or USSD limit.
2. WHEN a Trader dials `*384#` or sends `MENU`, THE Oja_Ghost SHALL show a menu with at most 5 options plus `0 Back` and `00 Menu`: `1 Price`, `2 Report price`, `3 Debt book`, `4 Reminders`, `5 Language`.
3. THE USSD screens SHALL be 140 characters or fewer, and SHALL never exceed `LIMITS.ussd.screenHardCap`. The menu SHALL be rendered with the kit's menu functions.
4. THE Oja_Ghost SHALL keep the state of a multi-step USSD flow (for example choose Commodity, then Market, then enter amount) under an app-owned store key for the Trader, and SHALL resume the flow when the Trader dials again within the session timeout.
5. WHEN a USSD session times out, THE Oja_Ghost SHALL start from the menu on the next dial and SHALL NOT apply a half-finished Entry or Price_Report.
6. THE Oja_Ghost SHALL write USSD flows for checking a price, reporting a price, seeing balances, listing and cancelling Reminders, and choosing a Language. Adding a debtor Entry or a Reminder by USSD MAY be limited to typed input within one step, and creating a Reminder MAY be SMS-only.
7. EVERY SMS reply SHALL be at most 3 segments, with `Reply MORE` when there is more, and SHALL end with a next step when useful.
8. THE Oja_Ghost SHALL NOT split a number, an amount, a phone number or a word across segments or screens. THE Oja_Ghost SHALL rely on the kit's formatting functions for this and SHALL NOT split text itself.
9. THE Oja_Ghost SHALL NOT send a link as the only way to do something, and SHALL NOT use emoji or Halloween wording in any reply.
10. THE Oja_Ghost SHALL accept `HELP` and `MENU` at any point and SHALL reply with the options in the Trader's Language.
11. WHEN the Trader's message is not understood, THE Oja_Ghost SHALL reply with the `unrecognized` copy and up to 3 example commands.

### Requirement 11: Demo Data and Honest Labels

**User Story:** As a judge, I want realistic data that is clearly marked as demo, so that nothing is mistaken for real market prices.

#### Acceptance Criteria

1. THE Oja_Ghost SHALL seed Demo_Data for at least 5 Commodities at 3 Markets, with a Reference_Price and a few sample Price_Reports around each, and SHALL store it with a `demo: true` flag.
2. THE seed values SHALL be realistic for scale, written in the App_Config and the seed file, and SHALL be marked there as illustrative and not from any real survey.
3. THE Oja_Ghost SHALL include the label "Demo" in every reply that uses seeded values, and SHALL stop using the label for an average that has at least 3 Accepted_Reports from the current Lagos_Day that are not seeded.
4. THE seed SHALL include one sample debtor book for the demo phone number of the Phantom Handset, marked as Demo_Data, and SHALL NOT contain any real person's name or phone number.
5. THE Oja_Ghost SHALL show a Demo_Data label in the first reply to a new Trader and in the `HELP` reply.
6. THE seed SHALL be generated by a deterministic function, so tests and the demo video show the same values.
7. THE Oja_Ghost SHALL NOT be described in the README as using live market data.

### Requirement 12: Property-Based Tests

**User Story:** As a maintainer, I want the money maths proven by properties, not only by examples.

#### Acceptance Criteria

1. THE project SHALL include a property-based test that, for any generated sequence of Ledger commands, the Balance of each debtor equals the sum of its `owe` amounts minus the sum of its `paid` and `overpaid` amounts, and the total equals the sum of all signed Entries. This test is **required**.
2. THE project SHALL include a property-based test that, for any generated sequence of Ledger commands, a `paid` command never makes a Balance negative, and a Balance is negative only when the Ledger holds an Overpaid_Entry for that debtor. This test is **required**.
3. THE project SHALL include a property-based test that, for any set of Accepted_Reports and any new amount that the acceptance decision rejects, adding the Rejected_Report leaves the Price_Average and the Accepted_Reports unchanged. This test is **required**.
4. THE project SHALL include a property-based test that a rejected `paid` command leaves the Ledger equal to its input. This test is **required**.
5. THE project SHALL include property-based tests, **required**, for the amount parser (every string the formatter produces parses back to the same amount, and no string parses to a non-integer or non-positive amount) and for the Entry `undo` (an `owe` or `paid` followed by `undo` returns the same Ledger).
6. THE project SHALL include property-based tests, **required**, for the reminder due-check (a Reminder is due iff its time is not after the current time and its status is `pending`) and for the Dispatcher (two runs with the same clock send each Reminder at most once).
7. THE generators SHALL include names with mixed case, accents and extra spaces, and amounts at the minimum and the maximum.
8. WHEN a property test finds a counterexample, THE test file SHALL keep it as a named regression example with a comment that says what bug it found.
9. THE property tests SHALL run under `pnpm test` and `pnpm test:pbt`.
10. THE project MAY include example tests for the command parser in both Languages, the reply lengths for each tool, the `HandsetApp` shape, and one scripted walkthrough (price, report, owe, paid, balance, reminder). These are **optional**.
11. THE architecture SHALL check Requirement 1.1 automatically, using the existing hook. This check is **optional**.

## Open Questions for the Owner

1. **`zod` in the app.** `Tool.inputSchema` needs a `z.ZodType`, but the kit does not export `zod`, and `zod` is approved only for `kit` and `phantom-handset`. Options: (a) approve `zod` for `apps/oja-ghost` (same range as `kit`), or (b) add a general `defineTool` helper to the kit that builds a schema from a small descriptor, so apps need no `zod`. Option (a) is smaller and is what these requirements assume.
2. **STOP is not visible to the app.** The subscribed flag lives in a kit-internal store key. The Dispatcher needs it. Add a general `isSubscribed(store, phoneNumber)` to the kit's public API (kit-core change, outside this spec), or accept that Reminder SMS ignore STOP, which breaks `security.md`. Requirement 7.13 assumes the first option.
3. **`₦` makes SMS UCS-2.** A reply with `₦` has 70 characters per single segment and 67 joined, so 3 segments hold about 200 characters instead of about 459. These requirements keep `₦` as `feature-phone-ux.md` says, and shorten replies to fit. The alternative is to send `N` in SMS and `₦` only in the handset.
4. **Pidgin review.** The Pidgin phrases for the command words and replies need a native speaker to check them before the video.
5. **Reminders on the demo phone.** The handset can only show replies to the user's own messages. A Reminder SMS needs a trigger in the demo. Options: a small "run reminders now" call in `phantom-handset/server`, or Night Shift ("Scout") calling the Dispatcher on a schedule. Not in this spec.
6. **Swapping the stand-in.** Replacing the stand-in in `phantom-handset/server/apps.ts` needs a workspace dependency from `phantom-handset` to `@ghostline/oja-ghost`. This is outside this spec and will be a separate, small task after the design is approved.
