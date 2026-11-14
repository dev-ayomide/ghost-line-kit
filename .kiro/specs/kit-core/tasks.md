# Implementation Plan: kit-core

## Overview

This plan implements the `@ghostline/kit` skeleton library from the ground up. The kit provides five component areas — channel adapters, a session state machine, a format module, an agent core, and a store — plus cross-cutting concerns (rate limiting, STOP/DELETE handling, phone-number masking, safe logging, error formatting). Every channel limit lives in `limits.ts`; every app imports only from `@ghostline/kit` via `index.ts`.

The design favours pure functions for testable logic (splitting, encoding detection, menu rendering, session transitions) verified with fast-check property-based tests, and interfaces for swappable backends (ChannelAdapter, LlmProvider, Store) verified with integration tests using mocked clients.

Tasks are ordered so each builds on the previous: limits first, then the format module (the most PBT-dense area), then the session state machine, store, agent, channel adapters, and finally the message processor that wires everything together and the public API.

## Tasks

### 0. Project Setup

- [ ] 0.1 Add runtime and dev dependencies to `kit/package.json`
  - Add `zod` as a runtime dependency (used by webhook validation, tool input schemas, and IntentSchema)
  - Add `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` as runtime dependencies (imported only inside BedrockProvider and DynamoStore implementation files, never in interfaces)
  - Add `@types/node` as a dev dependency (needed for `crypto.timingSafeEqual`, `process.env`, `fetch` types)
  - _Requirements: 2.2, 10.1, 11.2, 12.3_

- [ ] 0.2 Update `.env.example` with DynamoDB table name
  - Add `DYNAMO_TABLE_NAME=` for the DynamoStore production table
  - Verify existing entries cover AT, Bedrock, and webhook vars (already present: `AT_USERNAME`, `AT_API_KEY`, `AT_SHORTCODE`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `WEBHOOK_SECRET`)
  - _Requirements: 12.3_

### 1. Limits Module

- [ ] 1.1 Implement `kit/src/limits.ts`
  - Export a frozen `LIMITS` constant with the structure from the design: `sms.gsm7` (singleSegment: 160, concatSegment: 153), `sms.ucs2` (singleSegment: 70, concatSegment: 67), `ussd` (screenHardCap: 160, screenSoftTarget: 140, sessionTimeoutMs: 180_000, maxOptionsPerScreen: 5), `reply` (maxPreferredSegments: 3, nextStepMaxLength: 40), `rateLimit` (windowMs: 60_000, maxInbound: 10, maxOutbound: 10)
  - Use `as const` so all values are literal types
  - _Requirements: 1.1–1.9_
  - [ ]* 1.1a Write example tests for limits constants in `kit/test/limits.test.ts`
    - Assert every LIMITS field matches the spec values from Requirements 1.1–1.9
    - _Requirements: 1.1–1.9_

### 2. Format Module

- [ ] 2.1 Implement `detectEncoding` and `GSM7_CHARS` in `kit/src/format/encoding.ts`
  - Build `GSM7_CHARS` as a `ReadonlySet<string>` from the 3GPP TS 23.038 GSM 7-bit default alphabet (128 basic characters: a–z, A–Z, 0–9, common punctuation, space, `@`, accented and Greek chars in the basic table)
  - `detectEncoding(text: string): Encoding` returns `'GSM-7'` if every character is in `GSM7_CHARS`, otherwise `'UCS-2'`
  - Export `type Encoding = 'GSM-7' | 'UCS-2'`
  - _Requirements: 4.1, 4.2, 4.3_
  - [ ]* 2.1a Write PBT for encoding detection in `kit/test/encoding.pbt.test.ts`
    - **Property 1: Encoding detection correctness** — for any string, `detectEncoding` returns `'GSM-7'` iff every character is in the GSM-7 alphabet, else `'UCS-2'`
    - Generator: two branches — (a) strings of only GSM-7 chars, (b) strings with at least one non-GSM-7 char (emoji, CJK, `{}|^~\`)
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [ ] 2.2 Implement `pureSplit` in `kit/src/format/split.ts`
  - `pureSplit(text: string, encoding: Encoding): string[]` — the Pure_Splitter
  - Determine single vs concatenated limit from encoding: GSM-7 → 160 single / 153 concat; UCS-2 → 70 single / 67 concat
  - Tokenise by whitespace (keeping whitespace tokens so concatenation round-trips), then greedily fill segments
  - Never split a non-whitespace atomic unit (word, number, currency amount, phone number) across segments unless the unit itself exceeds the segment limit (Req 5.6), in which case hard-split at a character boundary
  - Concatenating returned segments yields the original text
  - Import `LIMITS` from `limits.ts` for segment sizes; do not hardcode limits
  - _Requirements: 5.1, 5.2, 5.5, 5.6_
  - [ ]* 2.2a Write PBT for segment limit compliance in `kit/test/split.pbt.test.ts`
    - **Property 2: Segment limit compliance** — every segment from `pureSplit` is within the char limit for the detected encoding (160/70 single, 153/67 concat)
    - Generator: random strings of varying lengths, including just under/over the single-segment boundary; constrain non-whitespace token lengths to the segment limit
    - **Validates: Requirements 5.1, 5.3**
  - [ ]* 2.2b Write PBT for split round-trip in `kit/test/split.pbt.test.ts`
    - **Property 3: Split round-trip** — for messages producing ≤3 segments, concatenating segments yields the original text exactly
    - Generator: strings whose length yields ≤3 segments; include leading/trailing whitespace, consecutive spaces, single-char words, mixed GSM-7/UCS-2
    - **Validates: Requirements 5.4**
  - [ ]* 2.2c Write PBT for no atomic unit split in `kit/test/split.pbt.test.ts`
    - **Property 4: No atomic unit split across segments** — no segment boundary falls inside a word, number, currency amount, or phone number
    - Generator: strings of words, numbers (`1,500`, `3.14`), currency (`₦1,500`), and phone numbers (`+2348051234567`) separated by single spaces; constrain each token to the segment limit
    - **Validates: Requirements 5.2, 5.5**

- [ ] 2.3 Implement `splitMessage` (summary + Reply MORE step) in `kit/src/format/split.ts`
  - `splitMessage(text: string): SplitResult` — calls `detectEncoding` then `pureSplit`
  - If segment count exceeds `LIMITS.reply.maxPreferredSegments` (3), apply summary step: keep leading segments, trim the last at a word boundary, append `" Reply MORE"` to the final segment
  - Return `SplitResult` with `segments`, `truncated`, `encoding`, `segmentCount`
  - Export `interface SplitResult` from this file
  - _Requirements: 5.7, 5.8_
  - [ ]* 2.3a Write example tests for the summary step in `kit/test/split.test.ts`
    - Test (a): message producing exactly 3 segments (no summary triggered, `truncated: false`)
    - Test (b): message producing 4 segments (summary triggered, leading portion emitted, `" Reply MORE"` appended, `truncated: true`)
    - Test (c): message with a currency amount at the truncation boundary (amount not split across the boundary)
    - Also test the hard-split edge case (Req 5.6): a single atomic unit longer than the segment limit is hard-split at a character boundary
    - _Requirements: 5.6, 5.7, 5.8_

- [ ] 2.4 Implement `renderMenuScreen` and `renderMenuScreens` in `kit/src/format/menu.ts`
  - `renderMenuScreen(options: MenuOption[], offset: number, config?: Partial<MenuConfig>): string` — renders one USSD screen with up to 5 numbered options (1–5) plus `0 Back` and `00 Menu`; returns text ≤160 chars
  - `renderMenuScreens(options: MenuOption[], config?: Partial<MenuConfig>): string[]` — renders all screens for a menu with more than 5 options, splitting across subsequent screens
  - Never split a word, number, currency amount, or phone number across screens
  - Import `LIMITS` for screen cap and max options per screen
  - Export `interface MenuOption`, `interface MenuConfig` from this file
  - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_
  - [ ]* 2.4a Write PBT for menu screen character limit in `kit/test/menu.pbt.test.ts`
    - **Property 5: Menu screen character limit** — every screen from `renderMenuScreens` is ≤160 characters
    - Generator: arrays of `MenuOption` with random labels (1–50 chars); include 1 option, 5 options, and >5 options (multi-screen)
    - **Validates: Requirements 6.2, 6.4**
  - [ ]* 2.4b Write PBT for no atomic unit split across USSD screens in `kit/test/menu.pbt.test.ts`
    - **Property 6: No atomic unit split across USSD screens** — no screen boundary falls inside a word, number, currency amount, or phone number
    - Generator: `MenuOption` arrays whose labels contain atomic units, with label lengths pushing against the 160-char cap
    - **Validates: Requirements 6.3**
  - [ ]* 2.4c Write example tests for menu rendering in `kit/test/menu.test.ts`
    - Test menu format: 5 options numbered 1–5 plus `0 Back` and `00 Menu` (Req 6.1)
    - Test soft target: menu content fitting within 140 chars renders at ≤140 chars (Req 6.5)
    - Test multi-screen: >5 options split across subsequent screens, each with ≤5 options (Req 6.6)
    - _Requirements: 6.1, 6.5, 6.6_

- [ ] 2.5 Implement `maskPhoneNumber` in `kit/src/format/phone.ts`
  - `maskPhoneNumber(phone: string): string` — if more than 7 digits: keep first 3 and last 4 digits visible, mask the rest with `*`; if 7 or fewer digits: keep only last 2 visible; preserve non-digit characters (like `+`) as-is
  - _Requirements: 14.1, 14.2, 14.3_
  - [ ]* 2.5a Write PBT for phone number masking in `kit/test/phone.pbt.test.ts`
    - **Property 9: Phone number masking** — for any phone string, preserves only first 3 and last 4 digits when >7 digits, only last 2 when ≤7 digits; no other original digits appear; non-digit chars preserved
    - Generator: two branches — (a) strings with 8–20 digits mixed with optional `+` prefix and separators, (b) strings with 1–7 digits
    - **Validates: Requirements 14.1, 14.2, 14.3**

- [ ] 2.6 Implement `formatReply` in `kit/src/format/reply.ts`
  - `formatReply(content: string, opts: ReplyOpts): ReplyResult` — detects encoding, splits into segments via `splitMessage`, appends a next-step instruction (≤40 chars) to the final segment when `continueConversation` is true
  - If the next-step instruction would overflow the final segment, place it in an additional segment without truncating reply content
  - Never append a next step to STOP, DELETE, or session-end acknowledgments (`continueConversation: false`)
  - Import `detectEncoding`, `splitMessage` from format modules; import `LIMITS` for `nextStepMaxLength`
  - Export `interface ReplyOpts`, `interface ReplyResult` from this file
  - _Requirements: 7.1, 7.2_
  - [ ]* 2.6a Write example tests for reply formatting in `kit/test/reply.test.ts`
    - Test next-step instruction appended to final segment when conversation continues (Req 7.1)
    - Test next-step instruction placed in additional segment when it would overflow (Req 7.2)
    - Test no next-step appended when `continueConversation` is false (STOP/DELETE/session-end ack)
    - _Requirements: 7.1, 7.2_

### 3. Session State Machine

- [ ] 3.1 Implement `Clock`, `SystemClock`, `TestClock` in `kit/src/session/clock.ts`
  - `Clock` interface: `now(): number` (returns epoch milliseconds)
  - `SystemClock` uses `Date.now()`
  - `TestClock` holds a mutable counter with `advance(ms)` and `set(ms)` methods for deterministic timeout testing
  - _Requirements: 8.5_

- [ ] 3.2 Implement `sessionTransition` pure function in `kit/src/session/session-state-machine.ts`
  - `sessionTransition(current: SessionState | undefined, event: SessionEvent, nowMs: number, timeoutMs: number): SessionState | undefined`
  - Event types: `{ type: 'inbound', conversationState }` creates/resumes/updates; `{ type: 'check' }` computes timeout; `{ type: 'end' }` returns undefined (session removed)
  - On `inbound`: creates session if none exists; resumes timed-out session to `active` with new conversation state; updates active session
  - On `check`: if `nowMs - lastInboundMs >= timeoutMs`, set status to `timed-out`; preserve conversation state
  - Export `SessionState`, `SessionStatus`, `SessionEvent` types from this file
  - Import `LIMITS.ussd.sessionTimeoutMs` for default timeout (callers may override)
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ]* 3.2a Write PBT for session state machine in `kit/test/session.pbt.test.ts`
    - **Property 7: Session state machine correctness** — for all event sequences: (a) after 180s+ inactivity, status is `timed-out` and stored state equals state at last inbound; (b) next inbound on timed-out session resumes to `active` with preserved state; (c) after explicit end, session not retrievable; (d) session never `active` after 180s+ since last inbound
    - Generator: sequences of events (`inbound`, `advance` 0–300000ms, `end`, `check`) applied with a `TestClock`; assert applicable sub-property after each event
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.6**

- [ ] 3.3 Implement `SessionStateMachine` class in `kit/src/session/session-state-machine.ts`
  - Wraps the pure `sessionTransition` with `Store` persistence and an injected `Clock`
  - `handleInbound(phone, channel, conversationState): SessionState` — loads from store, calls `sessionTransition`, writes back
  - `endSession(phone, channel): void` — calls `sessionTransition` with `end` event, removes from store
  - `getSession(phone, channel): SessionState | undefined` — loads and applies `check` event for lazy timeout computation
  - Constructor takes `{ store: Store, clock: Clock, timeoutMs?: number }`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

### 4. Store

- [ ] 4.1 Implement `Store` interface in `kit/src/store/store.ts`
  - `Store` interface: `read<T>(key: string): Promise<T | undefined>`, `write<T>(key: string, value: T): Promise<void>`, `delete(key: string): Promise<void>`
  - Each operation keyed by a string identifier for session state, user preferences, and application data
  - If an operation fails, the implementation surfaces an error and preserves previously persisted data
  - _Requirements: 12.1, 12.4_

- [ ] 4.2 Implement `MemoryStore` in `kit/src/store/memory-store.ts`
  - Backed by a `Map<string, unknown>`; all operations synchronous internally but return Promises for interface conformance
  - Used in tests and development
  - _Requirements: 12.2_

- [ ] 4.3 Implement `DynamoStore` in `kit/src/store/dynamo-store.ts`
  - Backed by `@aws-sdk/lib-dynamodb` (`DynamoDBDocumentClient`); imported only inside this file
  - Constructor takes `{ tableName: string, client?: DynamoDBDocumentClient }`; client is injectable for testing
  - Stores values as JSON-serialised attributes; reads parse JSON back
  - If an operation fails, surface a `KitError` and preserve previously persisted data
  - _Requirements: 12.3, 12.4_
  - [ ]* 4.3a Write integration tests for DynamoStore in `kit/test/store-dynamo.test.ts`
    - Test read/write/delete with a mocked `DynamoDBDocumentClient`
    - Test failure preserves previously persisted data (Req 12.4)
    - _Requirements: 12.3, 12.4_

### Checkpoint — Ensure all tests pass, ask the user if questions arise.

### 5. Agent

- [ ] 5.1 Implement `Intent`, `IntentSchema`, `serializeIntent`, `parseIntent` in `kit/src/agent/intent.ts`
  - `Intent` type: `{ name: string, parameters: Record<string, string | number | boolean>, rawMessage: string }`
  - `IntentSchema` — a zod schema matching the `Intent` type, used for validation and serialization
  - `serializeIntent(intent: Intent): string` — serialises to JSON string
  - `parseIntent(json: string): Intent` — parses from JSON string, validating with `IntentSchema`
  - _Requirements: 9.1, 9.3, 9.4_
  - [ ]* 5.1a Write PBT for intent serialization round-trip in `kit/test/intent.pbt.test.ts`
    - **Property 8: Intent serialization round-trip** — serializing an Intent to JSON and parsing it back produces an Intent with the same name, parameter names and values, and raw message
    - Generator: `fc.record({ name: fc.string(), parameters: fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())), rawMessage: fc.string() })`
    - **Validates: Requirements 9.3, 9.4**

- [ ] 5.2 Implement `Tool` interface and `ToolRegistry` in `kit/src/agent/tool-registry.ts`
  - `Tool` interface: `{ name: string, description: string, inputSchema: z.ZodType, execute: (input: unknown) => Promise<unknown> }`
  - `ToolRegistry` class: `register(tool: Tool)`, `get(name: string): Tool | undefined`, `invoke(name: string, input: unknown): Promise<ToolResult>`
  - `invoke` validates input against the tool's zod schema before executing; on validation failure returns `{ ok: false, userMessage }` with a message ≤160 chars and a recovery action
  - If tool name is unregistered, returns an error result without executing any tool
  - Export `ToolResult` type from this file
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 5.3 Implement `LlmProvider` interface in `kit/src/agent/llm-provider.ts`
  - `LlmProvider` interface: `{ complete(prompt: string): Promise<string>, classifyIntent(message: string, intentNames: string[]): Promise<Intent> }`
  - Import `Intent` type from `agent/intent.ts`
  - _Requirements: 11.1_

- [ ] 5.4 Implement `BedrockProvider` in `kit/src/agent/bedrock-provider.ts`
  - Implements `LlmProvider` using `@aws-sdk/client-bedrock-runtime` (`BedrockRuntimeClient`, `Converse` command); imported only inside this file
  - Constructor takes `{ region: string, modelId?: string, client?: BedrockRuntimeClient }`; `modelId` defaults to `process.env.BEDROCK_MODEL_ID`; client is injectable for tests
  - `complete()` calls the Bedrock Converse API and extracts text from the response
  - `classifyIntent()` prompts the model to return a JSON Intent, parses with `IntentSchema`; if intent name not in `intentNames`, classifies as `'unrecognized'`
  - If Bedrock returns an error or is unavailable, surfaces a `KitError` with a generic user message instead of propagating the raw SDK error
  - Import `IntentSchema`, `parseIntent` from `agent/intent.ts`; import `KitError` from `errors.ts`
  - _Requirements: 11.2, 11.4_
  - [ ]* 5.4a Write integration tests for BedrockProvider in `kit/test/bedrock.test.ts`
    - Test `complete()` and `classifyIntent()` with a mocked `BedrockRuntimeClient`
    - Test error → `KitError` (does not propagate raw SDK error) (Req 11.4)
    - Test unrecognized intent when model returns a name not in `intentNames`
    - _Requirements: 11.2, 11.4_

- [ ] 5.5 Implement `Agent` class in `kit/src/agent/agent.ts`
  - Constructor takes `{ llm: LlmProvider, tools: ToolRegistry, intentNames: string[] }`
  - `classify(message: string): Promise<Intent>` — uses `LlmProvider.classifyIntent`; if no match, classifies as `'unrecognized'`
  - `invokeTool(name: string, input: unknown): Promise<ToolResult>` — delegates to `ToolRegistry.invoke`
  - _Requirements: 9.2, 9.5, 10.2, 10.3, 10.4_
  - [ ]* 5.5a Write example tests for Agent in `kit/test/agent.test.ts`
    - Test unrecognized intent when message matches no intent name (Req 9.5)
    - Test tool validation failure returns actionable error ≤160 chars (Req 10.3)
    - Test unregistered tool name returns error without executing (Req 10.4)
    - _Requirements: 9.5, 10.2, 10.3, 10.4_

### 6. Channel Adapters

- [ ] 6.1 Implement `ChannelAdapter` interface and shared types in `kit/src/channels/types.ts`
  - `ChannelAdapter` interface: `channel: ChannelType`, `send(message: OutboundMessage): Promise<SendResult>`, `parseWebhook(rawPayload: unknown, headers: Record<string, string>): WebhookResult`, `onDeliveryStatus(handler: (status: DeliveryStatus) => void): () => void`
  - Export `ChannelType`, `OutboundMessage`, `InboundMessage`, `SendResult`, `WebhookResult`, `DeliveryStatus` types from this file
  - Import `LIMITS` for type-level reference where channel limits are relevant
  - _Requirements: 2.1, 2.5_

- [ ] 6.2 Implement `WebAdapter` in `kit/src/channels/web-adapter.ts`
  - Powers the Phantom Handset browser emulator; no real telco, no webhook authentication
  - `send()` delivers via a registered `onDeliver` callback; returns `{ ok: true, messageId }` immediately
  - `parseWebhook()` validates browser-originated payload with a zod schema (`{ from: string, text: string, sessionId?: string }`), returns `InboundMessage` or error
  - `onDeliveryStatus()` returns a no-op unsubscribe (delivery is simulated)
  - _Requirements: 2.4, 2.2, 2.6_

- [ ] 6.3 Implement `SmsAdapter` in `kit/src/channels/sms-adapter.ts`
  - Sends SMS via Africa's Talking REST API using `fetch` (no AT SDK imported)
  - Constructor takes `{ username, apiKey, shortcode?, webhookSecret? }`
  - `send()` POSTs form-encoded data to `https://api.africastalking.com/version1/messaging`; returns `{ ok, messageId?, error? }`; on API error returns `{ ok: false, error }` preserving prior state
  - `parseWebhook()` validates inbound SMS payload with zod, authenticates by comparing `WEBHOOK_SECRET` query parameter in constant time using `crypto.timingSafeEqual`; optional IP allowlisting left to deployment
  - If credentials are missing or invalid, returns error result indicating config failure
  - _Requirements: 2.2, 2.3, 2.6, 3.1, 3.4, 3.5, 3.6_

- [ ] 6.4 Implement `UssdAdapter` in `kit/src/channels/ussd-adapter.ts`
  - Handles USSD sessions via Africa's Talking; same constructor shape as SmsAdapter
  - `send()` is synchronous: formats response with `CON ` or `END ` prefix (based on `endSession`) and returns it in `SendResult.responseText`
  - `parseWebhook()` validates USSD callback payload (`sessionId`, `phoneNumber`, `serviceCode`, `text`) with zod, returns `InboundMessage` with `sessionId` set; same webhook auth as SmsAdapter
  - Export `formatResponse(message: OutboundMessage): string` helper returning `"CON " + text` or `"END " + text`
  - _Requirements: 2.2, 2.3, 2.6, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 6.4a Write integration tests for channel adapters in `kit/test/channels.test.ts`
    - Test webhook zod validation for SMS and USSD payloads (Req 2.2, 2.6)
    - Test webhook signature mismatch rejected in constant time (Req 2.3)
    - Test delivery status event emission (Req 2.5)
    - Test AT SMS send with mocked `fetch` — success and API error (Req 3.1, 3.5)
    - Test AT USSD initiate and continue with mocked `fetch` (Req 3.2, 3.3)
    - Test missing/invalid credentials return config error (Req 3.6)
    - Test sandbox credentials route to sandbox (Req 3.4)
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 3.1–3.6_

### Checkpoint — Ensure all tests pass, ask the user if questions arise.

### 7. Message Processor and Cross-Cutting

- [ ] 7.1 Implement `KitError` in `kit/src/errors.ts`
  - `KitError extends Error` with `userMessage` (≤160 chars, no stack traces or internal IDs, includes ≥1 recovery action), `internalMessage` (for logs only), and `code` (internal error code like `'AT_API_ERROR'`, `'RATE_LIMITED'`)
  - Example user messages: `"Too many messages. Wait 1 min and try again."`, `"That didn't work. Send HELP for options."`, `"Service briefly unavailable. Try again in a moment."`
  - _Requirements: 17.1, 17.2, 17.3_
  - [ ]* 7.1a Write example tests for error safety in `kit/test/errors.test.ts`
    - Test `userMessage` is ≤160 characters (Req 17.1)
    - Test `userMessage` excludes stack traces and internal IDs (Req 17.2)
    - Test `userMessage` includes at least one suggested recovery action (Req 17.3)
    - _Requirements: 17.1, 17.2, 17.3_

- [ ] 7.2 Implement `checkRateLimit` in `kit/src/rate-limiter.ts`
  - `checkRateLimit(state: RateLimitState, direction: 'inbound' | 'outbound', nowMs: number, limits: { windowMs: number; max: number }): { allowed: boolean; newState: RateLimitState }`
  - Filters out timestamps older than `windowMs`, counts remaining entries, returns `allowed: true` if count is below `max`, along with updated state (includes new timestamp if allowed)
  - Import `LIMITS.rateLimit` for default window and max values
  - Export `RateLimitState`, `RateLimitConfig` types from this file
  - _Requirements: 16.1, 16.2, 16.3_
  - [ ]* 7.2a Write PBT for rate limit correctness in `kit/test/rate-limit.pbt.test.ts`
    - **Property 10: Rate limit correctness** — `checkRateLimit` allows a message iff the count within `windowMs` is below max (10); when all prior timestamps expired, next message is allowed and new state contains only the new timestamp
    - Generator: rate-limit states with 0–15 timestamps at varying ages relative to `nowMs` (some within window, some expired), combined with current `nowMs`
    - **Validates: Requirements 16.1, 16.2, 16.3**

- [ ] 7.3 Implement `SafeLogger`, `ProductionLogger`, `DevLogger` in `kit/src/logger.ts`
  - `SafeLogger` interface: `info(event: { messageId?, phoneNumber?, messageLength?, event }): void`, `error(event: { messageId?, phoneNumber?, messageLength?, error }): void`
  - `ProductionLogger` logs only message IDs, message lengths, error indications, and masked phone numbers; never logs message bodies
  - `DevLogger` is more verbose but still masks phone numbers and omits message bodies
  - Both use `maskPhoneNumber` from `format/phone.ts`
  - _Requirements: 18.1, 18.2, 18.3_
  - [ ]* 7.3a Write integration tests for logger safety in `kit/test/logger.test.ts`
    - Test `ProductionLogger` logs only message IDs, lengths, and error indications (Req 18.1)
    - Test `ProductionLogger` never logs message bodies (Req 18.2)
    - Test failed message processing logs only message ID, length, and error indication (Req 18.3)
    - Test phone numbers are masked in all log output
    - _Requirements: 18.1, 18.2, 18.3_

- [ ] 7.4 Implement `MessageProcessor` in `kit/src/processor.ts`
  - Constructor takes `{ adapter, store, session, agent, clock, rateLimiter, logger }`
  - `process(inbound: InboundMessage): Promise<OutboundMessage[]>` pipeline:
    1. Rate-limit check (inbound) — reject if phone number exceeded `maxInbound` in `windowMs`
    2. STOP / DELETE — if text (trimmed, uppercased) is `STOP`, unsubscribe phone number and return confirmation; if `DELETE`, erase stored data and return confirmation; if `STOP` and not subscribed, return "not subscribed" message
    3. Session — call `SessionStateMachine.handleInbound()` to get or resume session
    4. Classify — `Agent.classify(message)` produces an `Intent`
    5. Invoke tool — `Agent.invokeTool(intent)` runs the tool
    6. Format reply — `formatReply(toolResult, { channel, continueConversation })` splits and formats
    7. Rate-limit check (outbound) — track outbound messages
    8. Log — log message ID, length, and status via `SafeLogger`; never log body
  - Wrap all processing in try/catch; any unhandled error becomes a `KitError` with a generic user message
  - _Requirements: 15.1, 15.2, 15.3, 16.1, 16.2, 16.3, 17.1, 17.2, 17.3, 18.1, 18.2, 18.3_
  - [ ]* 7.4a Write example tests for STOP/DELETE handling in `kit/test/stop-delete.test.ts`
    - Test STOP unsubscribes phone number and sends confirmation (Req 15.1)
    - Test DELETE erases stored data and sends confirmation (Req 15.2)
    - Test STOP when not subscribed sends "not subscribed" message (Req 15.3)
    - _Requirements: 15.1, 15.2, 15.3_

- [ ] 7.5 Implement public API in `kit/src/index.ts`
  - Re-export the full public API: `LIMITS` from `limits.ts`; `detectEncoding`, `GSM7_CHARS`, `Encoding` from `format/encoding.ts`; `pureSplit`, `splitMessage`, `SplitResult` from `format/split.ts`; `renderMenuScreen`, `renderMenuScreens`, `MenuOption`, `MenuConfig` from `format/menu.ts`; `maskPhoneNumber` from `format/phone.ts`; `formatReply`, `ReplyOpts`, `ReplyResult` from `format/reply.ts`; `Clock`, `SystemClock`, `TestClock` from `session/clock.ts`; `SessionStateMachine`, `SessionState`, `SessionStatus`, `SessionEvent` from `session/session-state-machine.ts`; `ChannelAdapter`, `ChannelType`, `OutboundMessage`, `InboundMessage`, `SendResult`, `WebhookResult`, `DeliveryStatus` from `channels/types.ts`; `WebAdapter` from `channels/web-adapter.ts`; `SmsAdapter` from `channels/sms-adapter.ts`; `UssdAdapter`, `formatResponse` from `channels/ussd-adapter.ts`; `Intent`, `IntentSchema`, `serializeIntent`, `parseIntent` from `agent/intent.ts`; `Tool`, `ToolRegistry`, `ToolResult` from `agent/tool-registry.ts`; `LlmProvider` from `agent/llm-provider.ts`; `BedrockProvider` from `agent/bedrock-provider.ts`; `Agent` from `agent/agent.ts`; `Store` from `store/store.ts`; `MemoryStore` from `store/memory-store.ts`; `DynamoStore` from `store/dynamo-store.ts`; `KitError` from `errors.ts`; `checkRateLimit`, `RateLimitState` from `rate-limiter.ts`; `SafeLogger`, `ProductionLogger`, `DevLogger` from `logger.ts`; `MessageProcessor` from `processor.ts`
  - Ensure `kit/package.json` `exports` map resolves `"."` to `./src/index.ts` (already configured) so subpath imports like `@ghostline/kit/src/format/split` are not resolvable
  - _Requirements: 13.1, 13.2, 13.3_
  - [ ]* 7.5a Write encapsulation tests in `kit/test/encapsulation.test.ts`
    - Test that all public API symbols are exported from `@ghostline/kit` (Req 13.1, 13.2)
    - Test that importing a kit internal module directly (e.g., `@ghostline/kit/src/format/split`) fails to resolve (Req 13.3)
    - _Requirements: 13.1, 13.2, 13.3_

### Final Checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests (PBT) validate universal correctness properties over generated inputs; example tests cover deterministic scenarios and edge cases; integration tests cover external service interactions with mocked clients
- The 10 PBT properties from the design are each their own sub-task, placed immediately after the code task they cover
- Counterexamples found by PBT should be kept as named regression examples with a comment describing the bug — this is evidence for the hackathon write-up
- `pnpm test` runs all tests; `pnpm test:pbt` runs only `*.pbt.test.ts` files with `FC_NUM_RUNS=1000`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "0.2", "1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "7.1", "7.2"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "3.2", "4.2", "5.1", "5.2", "5.3", "6.1"] },
    { "id": 3, "tasks": ["1.1a", "2.1a", "2.2a", "2.3", "2.4a", "2.5a", "3.2a", "3.3", "4.3", "5.4", "6.2", "7.2a", "7.3"] },
    { "id": 4, "tasks": ["2.2b", "2.3a", "2.4b", "2.6", "5.5", "6.3"] },
    { "id": 5, "tasks": ["2.2c", "2.4c", "2.6a", "5.1a", "5.4a", "5.5a", "6.4", "7.1a", "7.3a", "7.4"] },
    { "id": 6, "tasks": ["4.3a", "6.4a", "7.4a", "7.5"] },
    { "id": 7, "tasks": ["7.5a"] }
  ]
}
```
