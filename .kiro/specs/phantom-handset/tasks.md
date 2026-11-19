# Implementation Plan: phantom-handset

## Overview

This plan builds the Phantom Handset in `/phantom-handset`, in this order:

1. Two small **kit-core amendments** (trace events, optional `channel`) come first, because the server and the shared types depend on them.
2. The **pure modules** (LCD paginator, keypad composer, multi-tap, SMS counter) come next, with the two required property-based tests.
3. Then the **server** (pure handler, Node wrapper, Vite plugin), the **transports and fixtures**, the **state layer**, and the **UI** (phone, trace panel, landing page).
4. The last task is the final checkpoint.

All tests are from the approved design. Property-based tests (PBT) are **required**. Tasks marked with `*` are optional example or integration tests and can be skipped to save credits. The two kit amendments have their own required tests (the owner approved all three kit trace tests and the channel test as required).

`@types/node` for `phantom-handset` is already recorded in `.kiro/steering/tech.md` (2026-11-19). No other dependency is added. The browser source in `phantom-handset/src` never imports `@ghostline/kit` at runtime (`import type` only), and `server/` imports only the public `@ghostline/kit` API.

## Tasks

### 1. Kit-core amendment A: trace events

- [x] 1.1 Add `onTrace` to the message processor
  - Create `kit/src/trace.ts` (types only): `TraceEventType`, `TraceEvent` (`type`, `messageId`, `at`, `title`, optional `tool`, `ok`, `summary`, `durationMs`) and `TraceSink`, exactly as in design.md Open question 1
  - Add `onTrace?: TraceSink` to `MessageProcessorConfig` in `kit/src/processor.ts`, and keep the injected `clock` so `durationMs` and `at` use it
  - Add one private `emit()` helper that builds the event, calls the sink inside `try/catch`, and does nothing when no sink is set. Add one `redactSummary(value, senderPhone)` helper: `JSON.stringify` (a failure or `undefined` gives `[unserialisable]`), replace the sender number, in both exact and digits-only form, with `maskPhoneNumber(number)`, then cut to 200 characters. Cut `title` to 80 characters
  - Fire the six events from the design table inside `run()`, in order: (1) STOP/DELETE/START handled, (2) inbound rate limit refused, (3) MORE, (4) after `agent.classify` (parameters redacted into `summary`, no `rawMessage`), (5) before `agent.invokeTool` (`tool_call`), (6) after it returns (`tool_result` with `ok`, `durationMs`, output or `userMessage` as `summary`)
  - Export the types `TraceEvent`, `TraceEventType` and `TraceSink` from `kit/src/index.ts`. Do not change `Agent`, `ToolRegistry` or the logger
  - _Requirements: phantom-handset 10.2, 10.5, 10.9, 16.1; design Open question 1_

- [x] 1.2 Write the required example test for trace events in `kit/test/trace.test.ts`
  - A full classified run emits the `reasoning` (classify), `tool_call` and `tool_result` events in that order, all with the same `messageId`, and `tool_call` comes before `tool_result`
  - STOP, a refused rate limit, MORE and an unrecognized message each emit their one `reasoning` event with the specified title
  - A run with no `onTrace` returns the same messages as before
  - Reuse `kit/test/processor-helpers.ts`
  - _Requirements: phantom-handset 10.2, 10.9_

- [x] 1.3 Write the required PBT: a failing sink never changes the result, in `kit/test/trace.pbt.test.ts`
  - **Property:** for any inbound text, the messages returned by `process()` with a sink that always throws equal the messages returned with no sink, and the store contents are equal
  - _Requirements: phantom-handset 10.9; design Open question 1 (rule "never breaks the pipeline")_

- [x] 1.4 Write the required PBT: summaries are bounded and redacted, in `kit/test/trace.pbt.test.ts`
  - **Property:** for any generated sender number (with and without `+`) and tool input or output that contains it, no event `summary` is longer than 200 characters, no `title` is longer than 80 characters, and no `summary` contains the unmasked number or its digits-only form
  - Generators include nested objects, long strings, and values that cannot be serialised
  - _Requirements: phantom-handset 10.5, 16.1; design Open question 1 (rule "redaction happens in the kit")_

### 2. Kit-core amendment B: optional `channel` on the web payload

- [x] 2.1 Accept an optional `channel` in `WebAdapter`
  - In `kit/src/channels/web-adapter.ts`, add `channel: z.enum(['web', 'ussd']).optional()` to `webPayloadSchema`
  - `parseWebhook` returns `channel: parsed.channel ?? 'web'` on the inbound message. The adapter's own `channel` property stays `'web'`. Update the doc comment
  - Any other value, such as `'sms'`, is rejected as `INVALID_PAYLOAD`
  - _Requirements: phantom-handset 5.1, 5.4, 8.3; design Open question 2_

- [x] 2.2 Write the required test for the web channel in `kit/test/web-adapter-channel.test.ts`
  - Omitted `channel` gives `'web'`. `'ussd'` gives `'ussd'`. `'sms'` and a non-string value give `INVALID_PAYLOAD`. The existing web adapter tests still pass
  - A `ussd` inbound from `parseWebhook` run through `MessageProcessor.process()` returns exactly one message
  - _Requirements: phantom-handset 5.1, 5.4; design Open question 2_

- [x] 2.3 Checkpoint: kit amendments
  - Run `pnpm test` and `pnpm typecheck`. All kit tests must pass
  - Append a short "Amendment 2026-11-19" note to `.kiro/specs/kit-core/design.md` for the `onTrace` callback and the optional web `channel`, and point to this spec

### 3. Project setup

- [x] 3.1 Set up `phantom-handset` for the browser and the server
  - Add `@types/node` as a `devDependency` in `phantom-handset/package.json` (already approved, recorded in `tech.md`). Add no other dependency
  - Add `tsconfig.server.json` (`types: ["node"]`, no DOM) covering `server/` and `shared/`. Update `tsconfig.json` (DOM, `vite/client`) to cover `src/` and `test/` only. Make `typecheck` run both
  - Add `shared/api.ts` with types only, from the design: `Limits` (from `typeof LIMITS`), `ServerConfig`, `SendRequest`, `SendResponse`, `ApiError`, and `HandsetTraceEvent = Omit<TraceEvent, 'messageId'>`, all using `import type` from `@ghostline/kit`
  - Add a `serve` script: `vite build --ssr server/main.ts --outDir dist-server && node dist-server/main.js`. Add `dist-server` to `.gitignore` (do not touch the `.kiro/` rules)
  - _Requirements: 1.1, 1.2, 8.1; design "Wire shapes and transports", "Running it without a new dependency"_

### 4. Handset_Config

- [x] 4.1 Write `src/config/handset-config.ts`
  - One typed `as const satisfies HandsetConfig` module with the interfaces from the design: `lcd` (default 6 rows × 16 columns), `dialMaxLen`, `multitap` (timeout and letters per key), `fakeFrom` (`+2340000005678`), `fakeFromMasked` (`+234******5678`), `moreHint` (`Reply MORE`), the two `apps` profiles (ids `oja-ghost` and `blackout-line`, placeholder USSD codes and short codes to confirm in the app specs, `ussdOpenText: 'MENU'`), and `copy` for the demo label, scripted label, errors, menus, soft keys, keyboard help, landing page and trace panel
  - Error copy is short and says what to do next. No spooky wording appears in anything shown on the LCD. A missing key must fail `tsc`
  - _Requirements: 2.2, 7.1, 7.3, 7.5, 12.1, 15.1, 15.2, 15.3, 15.4_

- [ ]* 4.2 Write an example test in `test/config.test.ts`
  - `fakeFromMasked` equals `maskPhoneNumber(fakeFrom)` from the kit (tests may import the kit, `src/` may not), and `fakeFrom` matches `^\+2340\d{9}$`
  - _Requirements: 7.3, 12.4_

### 5. LCD paginator

- [x] 5.1 Implement `src/lcd/paginate.ts`
  - `paginate(text, { rows, cols }): Page[]` as specified in the design: split on `\n`, tokenise on spaces and tabs, fill lines greedily by code-point length, break tokens longer than `cols` on code-point boundaries starting on a fresh line, group `rows` lines per page, drop blank lines at page edges, and return one empty page for empty input. `rows < 1` or `cols < 1` throws `RangeError`
  - No React or DOM imports
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5.2 Write the required PBT for the paginator in `test/paginate.pbt.test.ts`
  - **P1:** non-whitespace code points of all pages, in order, equal those of the input (nothing dropped, duplicated or reordered)
  - **P2:** the tokens read back from the pages equal `expectedTokens(input, cols)`, where tokens of length ≤ `cols` stay whole and longer tokens become consecutive `cols`-sized chunks (so no amount, number, phone number or word is split)
  - **P3:** every line has ≤ `cols` code points with no leading or trailing space, every page has ≤ `rows` lines, and no page is whitespace-only except the single page for empty input
  - **P4:** the same inputs give the same pages
  - Generators: words, amounts (`'₦' + n.toLocaleString('en-US')`), decimals, `+234` numbers, tokens longer than `cols`, runs of spaces, tabs and newlines, astral code points; `cols` 1–40, `rows` 1–12
  - Keep any counterexample as a named regression example with a comment saying what bug it found
  - _Requirements: 3.2, 3.3, 3.5, 3.6, 3.7, 17.1, 17.3_

### 6. Keypad composer

- [x] 6.1 Implement `src/keypad/compose.ts` and `src/keypad/keymap.ts`
  - Export `HandsetKey`, `applyKey`, `composeKeys`, `parseUssd`, `formatUssd` (`compose.ts`) and `keyForChar`, `keyFromKeyboardEvent` (`keymap.ts`) as in the design. `applyKey` ignores presses beyond `maxLen`, and `clear` on an empty buffer is a no-op. `keyFromKeyboardEvent` reads `event.key` and maps Backspace to `clear`
  - No React or DOM imports
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6.2 Write the required PBT for the composer in `test/compose.pbt.test.ts`
  - **C1:** for any digit/`*`/`#` key sequence with no `clear`, `composeKeys` returns the characters in press order, cut at `maxLen`
  - **C2:** for any mix of keys and `clear`, `composeKeys` equals a reference model (array with push and pop); `clear` on empty stays empty
  - **C3:** for any generated USSD code (`*` digits (`*` digits)* `#`, up to `maxLen`), mapping each character through `keyForChar` and through `keyFromKeyboardEvent({ key: c })` then `composeKeys` returns the code, and `formatUssd(parseUssd(code)) === code`
  - Keep any counterexample as a named regression example with a comment
  - _Requirements: 4.2, 4.3, 4.4, 17.2, 17.3_

### 7. Multi-tap and SMS counter

- [x] 7.1 Implement `src/keypad/multitap.ts`
  - Pure reducer `step(state, { key, at }, cfg)` with `state = { text, pending?: { key, index, at } }`. A repeat press within `cfg.timeoutMs` advances through the key's letters. A different key or a press after the timeout commits the pending letter first. It never reads a clock. Letters come from the Handset_Config, and all are GSM-7
  - _Requirements: 4.6, 4.7_

- [x] 7.2 Implement `src/sms/counter.ts`
  - `charCost(c)` (always 1; decision 2026-11-19: extension characters are rejected instead of counted twice, to match the kit's `detectEncoding`) and `smsCount(text, limits)` returning `{ chars, segments }` with the limits passed in (no hard-coded numbers). Add a `isComposable(c)` helper: printable ASCII except the backtick and `^ { } \ [ ~ ] |` (the euro sign is not ASCII)
  - _Requirements: 6.3, 1.5_

- [ ]* 7.3 Write optional tests
  - `test/multitap.pbt.test.ts`: a reference-model property over generated key and gap sequences, plus determinism (same input and timings, same text)
  - `test/counter.test.ts`: examples for 160/161 and 153-per-segment boundaries, and that `isComposable` rejects the extension characters
  - _Requirements: 4.6, 4.7, 6.3_

### 8. Server: handler and wiring

- [x] 8.1 Implement `server/handler.ts`, `server/wire.ts`, `server/apps.ts` and `server/stand-in.ts`
  - `createHandler(deps)` returns `(HandlerRequest) => Promise<HandlerResponse>` with no Node-only objects. Routes: `GET /api/health`, `GET /api/config` (`LIMITS`, apps, `trace` flag), `POST /api/web/:appId`
  - POST steps as in the design: 404 for an unknown app; token check for non-loopback use with the kit's `verifyWebhookSecret`; a **new `WebAdapter` per request** (`parseWebhook`, then `onDeliver` and `send` to collect replies); reject any `from` not matching `^\+2340\d{9}$`; set a `messageId` with `randomUUID`; collect trace events by `messageId` and strip `messageId` before responding; short user messages for 400/401/404/500 with no stack traces or internal IDs; optional CORS for `HANDSET_ALLOWED_ORIGIN`
  - `wire.ts` builds `MemoryStore` or `DynamoStore`, `SystemClock`, `createLogger`, `SessionStateMachine`, `RateLimiter`, and per app a `ToolRegistry`, `Agent` and `MessageProcessor` (passing `onTrace` unless `HANDSET_TRACE=off`). The model is `BedrockProvider` or `KeywordLlmProvider`. Import only names exported from `@ghostline/kit`
  - `apps.ts` defines `HandsetApp` as confirmed. `stand-in.ts` has a deterministic `KeywordLlmProvider` (public `LlmProvider` interface, no network) and two tiny stand-in apps with the real ids, so live mode works until the app specs land
  - Add every variable (`HOST`, `PORT`, `HANDSET_ACCESS_TOKEN`, `HANDSET_ALLOWED_ORIGIN`, `HANDSET_LLM`, `HANDSET_STORE`, `HANDSET_TRACE`) to `.env.example`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 10.2, 12.4, 16.3, 16.4_

- [ ]* 8.2 Write example tests for the handler in `test/handler.test.ts`
  - 200 with replies and trace, 404 unknown app, 400 bad payload, 400 for a `from` outside the fake range, 401 without the token when one is required, `channel: 'ussd'` returns one message, and `GET /api/config` returns the kit limits
  - _Requirements: 8.3, 8.4, 8.7, 8.10, 12.4_

### 9. Server: Node wrapper and Vite plugin

- [x] 9.1 Implement `server/node-listener.ts`, `server/main.ts` and the Vite dev plugin
  - `node-listener.ts`: `(IncomingMessage, ServerResponse)` to `HandlerRequest` (body cap 8 KiB, JSON parse failure gives `body: undefined`) and back to the response. Plain `node:http` only
  - `main.ts`: `http.createServer(listener).listen(PORT, HOST)`; refuse to start when `HOST` is not loopback and `HANDSET_ACCESS_TOKEN` is unset
  - `vite.config.ts`: a plugin that mounts the listener at `/api` through `server.ssrLoadModule('/server/wire.ts')` and builds the env with `loadEnv(mode, repoRoot, '')`. Confirm no `HANDSET_*` variable reaches the browser bundle
  - Verify both paths: the SSR build bundles the linked kit workspace (the AWS SDK stays external), `pnpm --filter phantom-handset serve` answers `GET /api/health` (start it in the background with the process tool, then stop it), and `pnpm dev` serves `/api/config`. If SSR bundling fails, apply the fallback in the design and note it in the task summary
  - _Requirements: 8.1, 8.5, 8.10, 16.3_

- [ ]* 9.2 Write an integration test in `test/server.integration.test.ts`
  - Start `node-listener` on an ephemeral port, then post a web payload and check the 200 shape and the 8 KiB body cap
  - _Requirements: 8.3, 8.7_

### 10. Transports, trace guard and fixtures

- [x] 10.1 Implement `src/transport/{types,live,scripted}.ts` and `src/trace/guard.ts`
  - `HandsetTransport`, `TransportError`, `LiveTransport` (10 s timeout with `AbortController`, `VITE_API_BASE`, optional `Authorization: Bearer` from the `#token=` URL fragment kept in memory only, hand-written response guards, network failure gives `kind: 'offline'`) and `ScriptedTransport` (no network)
  - `isTraceEvent(x): x is HandsetTraceEvent` as in the design (type is one of three, `at` finite, `title` ≤ 120 characters, optional fields typed). Failing events are dropped
  - No `@ghostline/kit` runtime import, no `localStorage`, no console logging of message text
  - _Requirements: 1.1, 1.4, 1.5, 6.8, 9.3, 10.7, 16.2, 16.5_

- [x] 10.2 Implement `src/fixtures/schema.ts`, the loader, and two starter fixtures
  - `parseFixture(raw, name)` returns `{ ok, fixture } | { ok: false, error }`, where the error names the file and the field. Reject a `ussd` reply longer than `limits.ussd.screenHardCap`. Load with `import.meta.glob('./*.json', { eager: true })`
  - Matching: USSD exact after trim, SMS case-insensitive after trim, steps in order, hint copy with the accepted inputs when nothing matches
  - Add `oja-ghost-demo.json` (USSD menu, prices, debt "book") and `blackout-line-demo.json` (menu, alert in action-then-source form with no emoji, "I'm OK" check-in), each with trace events. Copy follows the feature-phone UX rules: no word, amount or number split, USSD replies within 160 characters
  - _Requirements: 1.6, 9.1, 9.4, 9.5, 9.6, 9.9, 10.10_

- [ ]* 10.3 Write example tests in `test/fixtures.test.ts` and `test/trace-guard.test.ts`
  - Valid and malformed fixtures (error names file and field), the screen cap rejection, step matching, and `isTraceEvent` accept and reject cases
  - _Requirements: 9.4, 9.9, 10.7_

### 11. State layer

- [x] 11.1 Implement `src/state/reducer.ts` and `src/state/selectors.ts`
  - The pure `HandsetState`, actions, reducer and `selectLcdView(state, config)` from the design: per-app slices (inbox, sent, unread, USSD session), screens, dial buffer, compose state, exchanges with trace, notices, split view, and a reset action. DELETE confirmation clears that app's inbox and sent. The reducer has no timers and no I/O
  - _Requirements: 5.2, 5.4, 5.6, 5.7, 6.2, 6.5, 7.2, 7.4, 16.6_

- [x] 11.2 Implement the hooks `src/state/useHandset.ts`, `useSessionTimer.ts`, `useReducedMotion.ts` and `useAutoplay.ts`
  - `useHandset` runs the dial flow (`parseUssd`, text is the extension or `ussdOpenText`, request with `channel: 'ussd'` and one `sessionId` per session) and the SMS flow through the active `HandsetTransport`, and switches to scripted mode on request after an `offline` error
  - `useSessionTimer` arms `limits.ussd.sessionTimeoutMs` (from the server config or fixture) on each input and ends the session with the redial hint
  - `useReducedMotion` reads `matchMedia` and subscribes to `change`. `useAutoplay` types fixture inputs at a user-set speed, or applies each step at once under reduced motion
  - _Requirements: 5.1, 5.3, 5.5, 5.6, 6.2, 9.2, 9.3, 9.7, 9.8, 14.3_

- [ ]* 11.3 Write example tests for the reducer in `test/reducer.test.ts`
  - Dial then reply then end, unrecognised code, per-app separation, reset, and DELETE clearing
  - _Requirements: 5.7, 7.2, 7.4, 16.6_

### 12. Phone UI

- [x] 12.1 Build the phone shell, keyboard and accessibility layer
  - `ui/{Phone,Lcd,Keypad,SoftKeys,Announcer,KeyboardHelp}.tsx`, `ui/useKeyboard.ts`, and `styles/{tokens,phone,motion}.css` with the colour tokens from the design table (key borders at `#8c8c9c`), local font files, and hand-built CSS only
  - Every key is a focusable `<button>` with a visible focus ring and a name such as "2, ABC". The visible LCD is `aria-hidden`. `Announcer` has a polite region (updates only when the view key changes) and a `role="alert"` region for errors. `KeyboardHelp` is a native `<dialog>` opened with `?`. A "Skip to phone" link comes first. The key map and its three confirmed exceptions follow the design
  - All animation sits in `motion.css` under `prefers-reduced-motion: no-preference`; the LCD shows each page whole under reduce; nothing flashes more than three times per second
  - The demo label sits on the casing at all times
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 12.1, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 14.1, 14.2, 14.4_

- [x] 12.2 Wire the screens: home, apps, dial, USSD, messages, compose, settings
  - Home with installed apps from config, app switching with separate state, dial screen, USSD view with paginated reply and input line, Inbox, message view (MORE soft key), Compose (multi-tap on-screen, literal typing on the physical keyboard, live counter from `smsCount`), Sent, Settings (live or scripted toggle, sound, reset, fixture errors). Page navigation uses the position indicator ("2/4")
  - Server text is rendered as plain text only. No message text goes to `localStorage`, `sessionStorage`, cookies or the console
  - _Requirements: 3.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 9.3, 16.2, 16.5_

### 13. Trace panel and split view

- [x] 13.1 Implement `src/trace/TracePanel.tsx` and the split layout
  - Side-by-side `Split` (stacked below 900 px) with a visible `aria-pressed` toggle, F4, and `?view=split`. The panel lists events in order (type, title, time, tool name, input and result summary), highlights the events of the exchange for the message on the LCD, shows "No trace for this message" when empty, and renders plain text only
  - Add the live/scripted toggle, the "Scripted replay" label, and the Autoplay controls (start, stop, speed). Start in scripted mode with `?mode=scripted`
  - _Requirements: 9.2, 9.7, 10.1, 10.3, 10.4, 10.6, 10.8, 12.2, 12.3_

### 14. Landing page

- [x] 14.1 Implement `src/landing/{Landing,Graveyard}.tsx`, replace the placeholder `App.tsx`, and fix the smoke test
  - Hero with the pitch and a "Try it" button that moves focus to the phone, the stage, the inline-SVG graveyard of dead phones with drifting fog only when motion is allowed, the ITU 2023 statistic with its source, cards for Oja Ghost, Blackout Line and the kit, and the footer with repo and quick-start links. All text comes from the config. No external images or fonts. The page is fully readable with animation off
  - Replace `App.tsx` with the real app, and update `test/smoke.test.tsx` (it still asserts "Phantom Handset coming soon", so `pnpm test` fails until it is changed) to check the landing title and the demo label
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 14.1_

- [ ]* 14.2 Write optional render and contrast tests in `test/a11y.test.tsx` and `test/contrast.test.ts`
  - With `renderToString`: the `aria-live` region and the `role="alert"` region exist, each key has its accessible name, and the Demo_Label is present. Recompute the contrast ratios from the token values and assert the table in the design
  - _Requirements: 12.1, 13.1, 13.6, 13.8_

### 15. Documentation and final checkpoint

- [ ] 15.1 Add the Phantom Handset section to `README.md`
  - How to run: live (`pnpm dev`), scripted (`?mode=scripted`), split view (`?view=split`), standalone server (`serve`), the env variables, the access-token rule for non-loopback use, and the keyboard map. Note that the web endpoint is demo-only
  - _Requirements: 8.9, 8.10, 13.3_

- [ ]* 15.2 Write the optional boundary test in `test/boundary.test.ts`
  - Scan `phantom-handset/src` for any `@ghostline/kit` import that is not `import type`, any `node:*` import, and any `@aws-sdk/*` import. Scan `server/` for imports of `kit/src/...`
  - _Requirements: 1.1, 1.2, 8.1, 17.7_

- [ ] 15.3 Final checkpoint
  - Run `pnpm test`, `pnpm test:pbt`, `pnpm typecheck` and `pnpm --filter phantom-handset build`. All must pass, and the production build must contain no `node:crypto` or `@aws-sdk` code
  - Manually check: keyboard-only use of every screen, scripted mode with the network off, Reduced Motion (OS setting toggled live), screen-reader announcement of an LCD change, and the split view with a live trace once the kit amendment is in place
  - _Requirements: 1.3, 9.1, 13.2, 13.6, 14.3, 17.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster delivery. The kit amendment tests (1.2, 1.3, 1.4, 2.2) and the two property tests (5.2, 6.2) are required.
- Each task lists the requirements it covers. Kit tasks also point to the design's open questions.
- Property tests validate universal properties over generated inputs. Example tests cover specific scenarios. Integration tests cover the Node listener.
- Counterexamples found by PBT are kept as named regression examples with a comment describing the bug. This is evidence for the hackathon write-up.
- `pnpm test` runs everything. `pnpm test:pbt` runs only `*.pbt.test.ts` files with `FC_NUM_RUNS=1000`.
- Until the Oja Ghost and Blackout Line specs land, live mode uses the stand-in apps in `server/stand-in.ts`. Scripted mode does not depend on them.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2", "3.1", "5.2", "6.2", "7.1", "7.2"] },
    { "id": 2, "tasks": ["2.3", "4.1", "8.1", "10.1", "10.2"] },
    { "id": 3, "tasks": ["4.2", "7.3", "8.2", "9.1", "10.3", "11.1"] },
    { "id": 4, "tasks": ["9.2", "11.2", "11.3"] },
    { "id": 5, "tasks": ["12.1"] },
    { "id": 6, "tasks": ["12.2"] },
    { "id": 7, "tasks": ["13.1"] },
    { "id": 8, "tasks": ["14.1"] },
    { "id": 9, "tasks": ["14.2", "15.1", "15.2"] },
    { "id": 10, "tasks": ["15.3"] }
  ]
}
```
