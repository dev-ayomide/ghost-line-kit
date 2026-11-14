# Requirements Document

## Introduction

The `@ghostline/kit` package ("the kit") is the skeleton that every Ghost Line Kit app builds on. It provides five component areas: a `ChannelAdapter` interface with `web`, `sms` (Africa's Talking) and `ussd` (Africa's Talking) adapters; a `SessionStateMachine` for USSD and SMS conversations that supports timeouts and resuming; a `Format_Module` that splits messages into SMS segments with GSM-7 vs UCS-2 encoding detection and renders numbered USSD menus within the limits defined in `limits.ts`; an `Agent` core with an intent schema, a tool registry, and an `LlmProvider` interface (with a Bedrock implementation); and a `Store` interface with in-memory and DynamoDB versions.

The kit currently ships as a stub: `kit/src/index.ts` exports nothing and tests only check fast-check wiring. This spec defines what the implemented kit must do. Apps may import only from `@ghostline/kit` and never from kit internals, so the kit's public API is the contract every app depends on.

Because the format and session logic are pure functions and a state machine, the most error-prone areas (message splitting, menu rendering, session transitions) are verified with property-based tests using fast-check. External integrations (Africa's Talking webhooks, DynamoDB, Amazon Bedrock) are verified with integration tests instead, per the testing decision guide.

## Glossary

- **Kit**: the `@ghostline/kit` package, the skeleton library that apps build on.
- **Public_API**: the only entry point apps may import, exported from `kit/src/index.ts`.
- **Limits_Module**: the single source of truth (`kit/src/limits.ts`) for all channel character, segment, timeout, and rate-limit values.
- **ChannelAdapter**: an interface abstracting a messaging channel so the kit and apps can send and receive messages without depending on a specific telco API.
- **WebAdapter**: a ChannelAdapter implementation that powers the Phantom Handset browser emulator without a real telco or SIM.
- **SmsAdapter**: a ChannelAdapter implementation that sends and receives SMS via Africa's Talking.
- **UssdAdapter**: a ChannelAdapter implementation that handles USSD sessions via Africa's Talking.
- **SessionStateMachine**: the component that tracks the state of a USSD or SMS conversation, including resuming after timeout.
- **Format_Module**: the pure-function module that splits messages into SMS segments and renders USSD menus within channel limits.
- **Agent**: the agent core that classifies inbound messages into intents and invokes registered tools.
- **Intent**: a structured classification of a user message, produced by the Agent from an inbound message.
- **Intent_Schema**: the schema that names each supported intent and its parameters, and that can be serialized to and parsed from a data format.
- **Tool**: a named function the Agent can invoke to perform an action on behalf of a user.
- **Tool_Registry**: the registry that maps tool names to their implementations and zod input schemas.
- **LlmProvider**: an interface abstracting large language model calls so apps never call a model SDK directly.
- **BedrockProvider**: an LlmProvider implementation backed by Amazon Bedrock.
- **Store**: an interface for persisting session state, user data and application data.
- **MemoryStore**: an in-memory Store implementation used in tests and development.
- **DynamoStore**: a Store implementation backed by AWS DynamoDB for production.
- **GSM-7**: the 7-bit GSM default alphabet encoding; 160 characters per single SMS segment and 153 per concatenated segment.
- **UCS-2**: the 16-bit Universal Coding Scheme 2 encoding used when a message contains characters outside the GSM-7 alphabet; 70 characters per single segment and 67 per concatenated segment.
- **Segment**: one SMS message part; concatenated segments reassemble into one logical message on the handset.
- **USSD**: Unstructured Supplementary Service Data, a session-based protocol used by feature phones for interactive menus.
- **Screen**: one USSD page of text shown to a user at a time, capped at 160 characters with a 140-character target.
- **Menu**: a numbered list of options rendered for a USSD screen.
- **Phone_Number**: a subscriber's MSISDN; treated as personal data under the security rules.
- **Atomic_Unit**: a word (a maximal run of non-whitespace characters), a number (a maximal run of digits and separators, such as "1,500" or "3.14"), a currency amount (a currency symbol adjacent to its digits, such as "₦1,500"), or a Phone_Number. Atomic units must never be split across segment or screen boundaries.
- **Rate_Limit_Window**: the 60-second sliding time period during which inbound and outbound message counts are tracked per Phone_Number for rate limiting.
- **Pure_Splitter**: the Format_Module function that splits a message into segments without applying the summary/Reply MORE truncation step. Property-based tests target the Pure_Splitter.

## Requirements

### Requirement 1: Channel Limits as a Single Source of Truth

**User Story:** As a developer, I want all channel limits defined in one place, so that format and session logic always respect the correct limits.

#### Acceptance Criteria

1. THE Limits_Module SHALL define SMS single-segment capacity as 160 characters for GSM-7 and 70 characters for UCS-2.
2. THE Limits_Module SHALL define SMS concatenated-segment capacity as 153 characters per segment for GSM-7 and 67 characters per segment for UCS-2.
3. THE Limits_Module SHALL define the USSD per-screen hard cap as 160 characters and the soft target as 140 or fewer characters.
4. THE Limits_Module SHALL define the USSD session inactivity timeout as 180 seconds.
5. THE Limits_Module SHALL define the maximum preferred SMS segments per reply as 3, where this value is a soft target rather than a hard cap.
6. THE Format_Module and SessionStateMachine SHALL reference the Limits_Module for all channel character, segment, and timeout limits and SHALL NOT define their own copies of those limits.
7. THE Limits_Module SHALL define the maximum inbound messages per Phone_Number per Rate_Limit_Window as 10.
8. THE Limits_Module SHALL define the maximum outbound messages per Phone_Number per Rate_Limit_Window as 10.
9. THE Limits_Module SHALL define the Rate_Limit_Window duration as 60 seconds.

### Requirement 2: ChannelAdapter Interface

**User Story:** As a developer, I want a common interface across channels, so that the kit and apps can send and receive messages without depending on a specific telco.

#### Acceptance Criteria

1. THE ChannelAdapter SHALL define a common interface for sending messages, receiving inbound messages, and reporting delivery status.
2. WHEN an inbound webhook is received, THE ChannelAdapter SHALL validate the payload with zod before processing.
3. IF a webhook signature does not match the expected shared secret, THEN THE ChannelAdapter SHALL reject the request without processing the payload and return an error indication to the caller.
4. THE WebAdapter SHALL implement the ChannelAdapter interface to provide a channel that the Phantom Handset uses without a real telco or SIM.
5. WHEN a delivery report is received, THE ChannelAdapter SHALL emit a delivery status event that an application can subscribe to.
6. IF an inbound webhook payload fails zod validation, THEN THE ChannelAdapter SHALL reject the request without processing it and return an error indication to the caller.

### Requirement 3: SMS and USSD Adapters via Africa's Talking

**User Story:** As a developer, I want real SMS and USSD adapters, so that the kit can run against the Africa's Talking sandbox in development and production.

#### Acceptance Criteria

1. WHEN the application requests to send an SMS message with a recipient address and message content, THE SmsAdapter SHALL submit the message to the Africa's Talking API and return a result indicating whether the submission succeeded.
2. WHEN the application requests to initiate a USSD session, THE UssdAdapter SHALL initiate the session through the Africa's Talking API and return a session identifier for subsequent continuation.
3. WHEN the application requests to continue an existing USSD session using a session identifier, THE UssdAdapter SHALL continue the session through the Africa's Talking API and return the session result to the application layer.
4. WHERE Africa's Talking sandbox credentials are configured, THE SmsAdapter and UssdAdapter SHALL operate against the sandbox without live telco access.
5. IF the Africa's Talking API returns an error, THEN the SmsAdapter and UssdAdapter SHALL return an error result to the application layer that indicates the operation failed and conveys the error returned by the API, while preserving any session or message state held prior to the failed operation.
6. IF Africa's Talking credentials are missing or invalid when an SMS or USSD operation is requested, THEN the SmsAdapter and UssdAdapter SHALL return an error result to the application layer indicating the authentication or configuration failure.

### Requirement 4: SMS Encoding Detection

**User Story:** As a developer, I want automatic encoding detection, so that messages with non-GSM characters are sent correctly and segment limits are never guessed.

#### Acceptance Criteria

1. WHEN a message contains only GSM-7 characters, THE Format_Module SHALL encode the message using GSM-7, applying a 160-character limit when the message is 160 characters or fewer and a 153-character per-segment limit when the message exceeds 160 characters.
2. WHEN a message contains any non-GSM character, THE Format_Module SHALL encode the message using UCS-2, applying a 70-character limit when the message is 70 characters or fewer and a 67-character per-segment limit when the message exceeds 70 characters.
3. THE Format_Module SHALL determine the encoding of each message by analyzing its character content before applying an encoding to that message.

### Requirement 5: SMS Message Splitting

**User Story:** As a developer, I want messages split into segments that respect channel limits, so that handsets reassemble them correctly.

#### Acceptance Criteria

1. WHEN a message exceeds the single-segment capacity, THE Format_Module SHALL split it into concatenated segments respecting the per-encoding segment limit.
2. THE Format_Module SHALL never split an Atomic_Unit across two segments.
3. **PBT** WHEN the Pure_Splitter splits a message into segments, every segment SHALL be within the character limit for the detected encoding (GSM-7 or UCS-2, single or concatenated).
4. **PBT** WHEN the Pure_Splitter splits a message and no summary truncation is applied, concatenating the resulting segments SHALL yield the original message text.
5. **PBT** WHEN the Pure_Splitter splits a message, no segment boundary SHALL fall inside a word, number, currency amount, or Phone_Number.
6. IF an Atomic_Unit exceeds the per-encoding segment character limit, THEN THE Format_Module SHALL split that unit at a segment-character boundary.

7. WHERE a message would require more than 3 segments after the Pure_Splitter runs, THE Format_Module SHALL apply a summary step that emits at most 3 segments whose concatenated text equals the leading portion of the original message and appends a "Reply MORE" instruction to the final segment.
8. The summary step described in criterion 7 SHALL be verified with named example tests, not property-based tests, because the summary behaviour is deterministic for a given input length. The example tests SHALL cover: (a) a message that produces exactly 3 segments (no summary triggered), (b) a message that produces 4 segments (summary triggered, leading portion emitted, "Reply MORE" appended), and (c) a message containing a currency amount at the truncation boundary (the amount is not split).

### Requirement 6: USSD Menu Rendering

**User Story:** As a developer, I want USSD menus rendered within screen limits, so that feature phones display them correctly.

#### Acceptance Criteria

1. THE Format_Module SHALL render USSD menus as numbered options, with at most 5 options numbered 1 to 5, plus "0 Back" and "00 Menu".
2. THE Format_Module SHALL render each USSD screen at or below the 160-character hard cap.
3. THE Format_Module SHALL never split a word, number, currency amount, or phone number across two USSD screens.
4. **PBT** WHEN the Format_Module renders a USSD menu, the rendered screen SHALL fit within the 160-character hard cap.
5. WHERE the menu content fits within 140 characters, THE Format_Module SHALL render that screen at 140 or fewer characters.
6. WHEN a menu contains more than 5 options, THE Format_Module SHALL render the additional options on subsequent USSD screens, with each screen displaying at most 5 options.

### Requirement 7: Reply Continuation Guidance

**User Story:** As a feature phone user, I want every reply to end with a clear next step, so that I always know what to do next.

#### Acceptance Criteria

1. WHEN the Format_Module formats a reply that continues an active conversation (i.e., a reply that is not an acknowledgment of STOP, DELETE, or session end), THE Format_Module SHALL append, to the final segment or screen of the reply, a next-step instruction of at most 40 characters that names a reply keyword or menu option the user can use next.
2. IF appending the next-step instruction would cause the final segment or screen to exceed its character limit, THEN THE Format_Module SHALL place the next-step instruction in an additional segment or screen without truncating the reply content.

### Requirement 8: Session State Machine

**User Story:** As a developer, I want a session state machine, so that USSD and SMS conversations can be resumed after inactivity.

#### Acceptance Criteria

1. THE SessionStateMachine SHALL track each USSD and SMS conversation keyed by phone number and channel, storing the current conversation state, the timestamp of the last inbound message, and a session status that is exactly one of: active, timed-out, or ended.
2. WHILE no inbound message has been received for a session for 180 seconds or more, THE SessionStateMachine SHALL set the session status to timed-out and SHALL preserve the conversation state as it existed at the time of the last inbound message.
3. WHEN an inbound message is received for a session whose status is timed-out, THE SessionStateMachine SHALL restore the conversation state preserved at the time of the last inbound message, set the session status to active, and process the inbound message against the restored conversation state.
4. WHEN a user sends an explicit end-session signal, THE SessionStateMachine SHALL set the session status to ended and SHALL remove the session record so that it is no longer retrievable by phone number and channel.
5. THE SessionStateMachine SHALL accept an injected time source so that session timeouts can be tested deterministically without waiting for real elapsed time.
6. **PBT** FOR ALL sequences of session events (inbound message, clock advance, explicit end) applied to a USSD session: (a) WHEN 180 seconds or more of inactivity have elapsed since the last inbound message, the session status SHALL be timed-out and the stored conversation state SHALL equal the conversation state at the time of the last inbound message; (b) WHEN the next inbound message is received on a timed-out session, the session SHALL resume to active with exactly the preserved conversation state; (c) WHEN an explicit end-session signal is received, the session record SHALL no longer be retrievable by phone number and channel; (d) WHEN 180 or more seconds have elapsed since the last inbound message, the session status SHALL NOT be active.

### Requirement 9: Agent Intent Schema

**User Story:** As a developer, I want inbound messages classified into intents, so that the kit routes them to the right tools.

#### Acceptance Criteria

1. THE Agent SHALL define an Intent_Schema that names each supported intent and the parameters each intent accepts, where each parameter is identified by a name.
2. WHEN an inbound message is received, THE Agent SHALL classify the message into an Intent using the Intent_Schema.
3. THE Agent SHALL serialize an Intent to a data format and parse an Intent back from that data format.
4. **PBT** WHEN the Agent serializes an Intent and parses the serialized data back, the resulting Intent SHALL have the same intent name and parameter names and values as the original Intent.
5. IF an inbound message does not match any intent named in the Intent_Schema, THEN THE Agent SHALL classify the message into an intent indicating the message is unrecognized.

### Requirement 10: Tool Registry

**User Story:** As a developer, I want a tool registry, so that the Agent can invoke validated tools on behalf of users.

#### Acceptance Criteria

1. THE Tool_Registry SHALL map each tool name to exactly one tool implementation and one zod input schema.
2. WHEN a tool is invoked, THE Agent SHALL validate the tool input against its zod schema before executing the tool.
3. WHEN tool input validation fails, THE Agent SHALL reject the invocation and return an error that fits within the channel character limit defined in the Limits_Module and indicates a recovery action the user can take.
4. IF a tool is invoked with a name not registered in the Tool_Registry, THEN THE Agent SHALL reject the invocation and return an error to the user without executing any tool.

### Requirement 11: LlmProvider Interface and Bedrock Implementation

**User Story:** As a developer, I want LLM calls abstracted behind a single interface, so that apps never call a model SDK directly and providers can be swapped.

#### Acceptance Criteria

1. THE LlmProvider SHALL define a common interface with a completion operation that takes prompt text and returns completion text, and an intent-classification operation that takes a message and returns an Intent.
2. THE BedrockProvider SHALL implement the LlmProvider interface using Amazon Bedrock.
3. WHERE an app needs language model capabilities, THE app SHALL call only through the LlmProvider interface and SHALL never call a model SDK directly.
4. IF Amazon Bedrock returns an error or is unavailable, THEN THE BedrockProvider SHALL surface an error to the application layer indicating that the model call failed, rather than propagating a raw model SDK error.

### Requirement 12: Store Interface

**User Story:** As a developer, I want a Store interface with memory and DynamoDB implementations, so that tests run in memory and production uses DynamoDB.

#### Acceptance Criteria

1. THE Store SHALL define a common interface with read, write, and delete operations, each keyed by an identifier, for persisting session state, user preferences, and application data.
2. THE MemoryStore SHALL implement the Store interface entirely in memory for tests and development.
3. THE DynamoStore SHALL implement the Store interface backed by AWS DynamoDB for production.
4. IF a store read, write, or delete operation fails, THEN THE Store implementation SHALL surface an error to the application layer and SHALL preserve previously persisted data.

### Requirement 13: Public API Encapsulation

**User Story:** As a developer building an app, I want a single public entry point, so that I depend only on the kit's stable API and never its internals.

#### Acceptance Criteria

1. THE Kit SHALL export its Public_API only from `kit/src/index.ts`.
2. WHERE an app imports from `@ghostline/kit`, THE Kit SHALL resolve the import to the Public_API.
3. IF an app attempts to import a kit module or symbol that is not part of the Public_API, THEN THE Kit SHALL fail to resolve that import.

### Requirement 14: Privacy and Phone Number Handling

**User Story:** As a user, I want my phone number treated as personal data, so that it is never exposed in logs.

#### Acceptance Criteria

1. WHEN the Kit logs a phone number containing more than 7 digits, THE Kit SHALL mask the number so that only the first 3 digits and the last 4 digits of the number are visible and no other digits from the original number appear in the log output.
2. THE Kit SHALL never print a complete, unmasked phone number in any log output.
3. IF a phone number contains 7 or fewer digits, THEN THE Kit SHALL mask all but the last 2 digits of the number in log output.

### Requirement 15: STOP and DELETE Handling

**User Story:** As a user, I want to control my data, so that I can unsubscribe and erase my data at any time.

#### Acceptance Criteria

1. WHEN a user texts STOP, THE Kit SHALL unsubscribe the user's Phone_Number within 5 seconds and send a confirmation message indicating the user has been unsubscribed.
2. WHEN a user texts DELETE, THE Kit SHALL erase the user's stored data within 5 seconds and send a confirmation message indicating the data has been erased.
3. IF a user texts STOP and the user's Phone_Number is not subscribed, THEN THE Kit SHALL send a message indicating the user is not currently subscribed.

### Requirement 16: Rate Limiting by Phone Number

**User Story:** As an operator, I want rate limiting by phone number, so that users are protected from SMS cost abuse.

#### Acceptance Criteria

1. WHILE the number of inbound and outbound messages processed for a Phone_Number within the preceding Rate_Limit_Window is fewer than the Limits_Module maximum, THE Kit SHALL allow inbound and outbound messages for that Phone_Number.
2. IF the number of inbound or outbound messages for a Phone_Number within the preceding Rate_Limit_Window reaches the Limits_Module maximum (10 per 60 seconds), THEN THE Kit SHALL reject additional messages for that Phone_Number and return an error response indicating the rate limit has been reached.
3. WHEN the Rate_Limit_Window for a Phone_Number expires, THE Kit SHALL resume allowing inbound and outbound messages for that Phone_Number.

### Requirement 17: Error Message Safety

**User Story:** As a feature phone user, I want short, actionable error messages, so that I can recover from errors without technical detail.

#### Acceptance Criteria

1. WHEN an error occurs, THE Kit SHALL return an error message to the user that is at most 160 characters in length.
2. WHEN an error occurs, THE Kit SHALL exclude stack traces and internal identifiers from the error message returned to the user.
3. WHEN an error occurs, THE Kit SHALL include at least one suggested recovery action the user can perform within the error message returned to the user.

### Requirement 18: Production Logging Safety

**User Story:** As an operator, I want production logs to protect user privacy, so that message contents are never stored in logs.

#### Acceptance Criteria

1. WHILE running in production, THE Kit SHALL log only message IDs, message lengths, and error indications across all log output.
2. WHILE running in production, THE Kit SHALL never log message bodies.
3. WHILE running in production, IF a message processing operation fails, THEN THE Kit SHALL log only the message ID, the message length, and an error indication.

## Property-Based Test Properties

The following correctness properties are verified with fast-check. Each maps to an acceptance criterion marked **PBT** above. These properties target the kit's pure functions and state machine, where behaviour varies with input and the cost of many iterations is low. The Pure_Splitter is tested in isolation; the summary/Reply MORE step (Requirement 5, criterion 7) is verified separately with named example tests because its behaviour is deterministic for a given input length.

1. **Segments never split a word, number, or currency amount** (Requirement 5, Criterion 5): WHEN the Pure_Splitter splits a message, no segment boundary SHALL fall inside a word (a maximal run of non-whitespace), a number (a maximal run of digits and separators), a currency amount (a currency symbol adjacent to its digits, such as "₦1,500"), or a Phone_Number.

2. **Every segment is within its limit** (Requirement 5, Criterion 3): WHEN the Pure_Splitter splits a message into segments, every segment SHALL be within the character limit for the detected encoding (GSM-7: 160 single / 153 concatenated; UCS-2: 70 single / 67 concatenated).

3. **Concatenating segments gives back the original text** (Requirement 5, Criterion 4): WHEN the Pure_Splitter splits a message and no summary truncation is applied, concatenating the resulting segments SHALL yield the original message text (round-trip property). This property does not apply to messages that trigger the summary step (criterion 7), where the leading portion is intentionally truncated.

4. **USSD session timeout, resume, and end behave correctly** (Requirement 8, Criterion 6): FOR ALL sequences of session events (inbound message, clock advance, explicit end) applied to a USSD session, the test uses an injected clock (Requirement 8, Criterion 5) for deterministic time advancement and asserts: (a) after 180s or more of inactivity the status SHALL be timed-out and the stored conversation state SHALL equal the state at the last inbound message; (b) the next inbound message on a timed-out session SHALL resume it to active with exactly the preserved state; (c) after an explicit end the session record SHALL no longer be retrievable; (d) a session SHALL never be active once 180s or more have passed since its last inbound message.

5. **Menus never exceed the screen budget** (Requirement 6, Criterion 4): WHEN the Format_Module renders a USSD menu, the rendered screen SHALL fit within the 160-character hard cap.

6. **Intent serialization round-trip** (Requirement 9, Criterion 4): WHEN the Agent serializes an Intent and parses the serialized data back, the resulting Intent SHALL have the same intent name and parameter names and values as the original Intent.

External integrations (Africa's Talking webhook handling, DynamoDB persistence, Amazon Bedrock completions) do not vary meaningfully with the kit's own input logic and are verified with integration tests using representative examples, not property-based tests.
