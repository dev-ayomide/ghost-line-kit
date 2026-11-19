# Requirements Document

## Introduction

The Phantom Handset is a browser-based feature-phone emulator in `/phantom-handset`. A judge opens it, dials a USSD code, sends and receives SMS, and switches between Oja Ghost and Blackout Line. No SIM, account or setup is needed. Around the phone sits a dark "graveyard of dead phones" Kiroween landing page. A split view shows the agent's reasoning and tool calls beside the phone, for the demo video.

Four decisions are already made and are binding on this spec:

1. **Pure UI client.** The browser app never imports `@ghostline/kit` at runtime, because `kit/src/index.ts` pulls in `node:crypto` and the AWS SDK. It may use `import type` only. It talks over HTTP to a `web` endpoint that uses the kit's `WebAdapter` payload shape (`{ from, text, sessionId? }`).
2. **Thin Node dev server.** `phantom-handset/server` wires `WebAdapter`, `MessageProcessor` and the apps using only the public `@ghostline/kit` API, so it can later be deployed as a Lambda.
3. **Offline scripted mode.** The phone can replay fixtures (scripted conversations for the video), so the demo never depends on the network or Bedrock.
4. **Trace events come from the server.** If the kit does not expose reasoning and tool-call events, the kit is not edited from this spec. The exact kit-core change is recorded as an open question in `design.md` for the owner to route.

Two facts about the current kit affect the requirements:

- `WebAdapter.parseWebhook` accepts a payload and produces an `InboundMessage` with `channel: 'web'`. Replies come back from `MessageProcessor.process()`, not from the adapter.
- `Agent` and `MessageProcessor` do not emit reasoning or tool-call events today. They return only the outbound messages.

The LCD paginator and the keypad key-sequence composer are pure functions and are verified with property-based tests using fast-check. These tests are required. Component, accessibility and end-to-end checks are example or integration tests and are optional.

## Glossary

- **Phantom_Handset**: the browser app in `/phantom-handset`, including the phone, the landing page and the split view.
- **Phone_UI**: the retro feature-phone component: casing, LCD, keypad, call/end keys and soft keys.
- **LCD**: the green-backlit text display of the Phone_UI.
- **Page**: the text shown on the LCD at one time. It has a fixed number of rows and columns.
- **Paginator**: the pure function that splits message text into Pages.
- **Atomic_Unit**: a word (a maximal run of non-whitespace characters), a number (such as "1,500" or "3.14"), a currency amount (such as "₦1,500"), or a phone number. Defined as in kit-core. An Atomic_Unit is never split across Pages.
- **Keypad**: the 12 physical keys 0–9, `*` and `#`, plus Call, End, two soft keys and a four-way navigation key.
- **Key_Sequence**: an ordered list of key presses.
- **Composer**: the pure function that turns a Key_Sequence into a dial string or text.
- **USSD_Code**: a dial string that starts with `*` and ends with `#`, such as `*384*1#`.
- **Handset_Mode**: how the Phantom_Handset gets its replies: `live` (HTTP to the Dev_Server) or `scripted` (Fixture replay).
- **Dev_Server**: the Node server in `phantom-handset/server`.
- **Web_Endpoint**: the HTTP route on the Dev_Server that accepts the `WebAdapter` payload and returns the reply messages and trace events.
- **Trace_Event**: a record of one step the agent took: `reasoning`, `tool_call` or `tool_result`.
- **Trace_Panel**: the panel in the split view that lists Trace_Events.
- **Split_View**: the layout that shows the Phone_UI and the Trace_Panel side by side.
- **Fixture**: a JSON file that describes a scripted conversation: inbound inputs, expected outbound replies and Trace_Events, and delays.
- **App_Profile**: an entry in the Phantom_Handset config for one app (Oja Ghost or Blackout Line): its USSD code, SMS short code, display name and copy.
- **Handset_Config**: the single config module that holds all user-visible copy, App_Profiles, and landing-page text.
- **Demo_Label**: the visible text that tells the viewer this is a demo with no real SIM or telco.
- **Reduced_Motion**: the user setting `prefers-reduced-motion: reduce`.

## Requirements

### Requirement 1: Browser Client Boundary

**User Story:** As a developer, I want the browser app kept free of Node and AWS code, so that the Vite build works and the bundle stays small.

#### Acceptance Criteria

1. THE Phantom_Handset browser source (`phantom-handset/src`) SHALL NOT import `@ghostline/kit` except with `import type`.
2. THE Phantom_Handset browser source SHALL NOT import `node:*` modules or `@aws-sdk/*` packages.
3. WHEN the browser app is built for production, THE build SHALL succeed without bundling `node:crypto` or any `@aws-sdk/*` package.
4. THE Phantom_Handset SHALL send every live request to the Web_Endpoint as JSON with the fields `from` (string), `text` (string) and an optional `sessionId` (string).
5. THE Phantom_Handset SHALL read every channel limit it needs (USSD screen cap, USSD session timeout, SMS segment sizes) from the Dev_Server configuration response, and SHALL NOT define its own copy of those numbers.
6. WHILE Handset_Mode is `scripted`, THE Phantom_Handset SHALL read the same limits from the Fixture file instead.

### Requirement 2: Retro Phone Appearance

**User Story:** As a judge, I want the phone to look and feel like a real feature phone, so that the demo makes sense at a glance.

#### Acceptance Criteria

1. THE Phone_UI SHALL render a casing, a green-backlit LCD, a 12-key Keypad, Call and End keys, two soft keys and a four-way navigation key, using hand-built CSS and no UI library.
2. THE Phone_UI SHALL render the LCD with a fixed number of rows and columns, set in one place in the Handset_Config.
3. THE LCD SHALL show a status bar with the active app name, a signal indicator, and an unread-message indicator.
4. THE Phone_UI SHALL bundle its fonts locally and SHALL NOT load fonts or other assets from the network.
5. THE Phone_UI SHALL remain usable at viewport widths from 320 CSS pixels up, scaling the phone to fit.

### Requirement 3: LCD Paginator

**User Story:** As a judge, I want long replies shown one readable screen at a time, so that nothing is cut off or garbled.

#### Acceptance Criteria

1. THE Paginator SHALL accept message text, a row count and a column count, and SHALL return an ordered list of Pages.
2. THE concatenation of all Page text, with the line breaks and padding the Paginator added removed, SHALL equal the input text with its whitespace normalised. That is, THE Paginator SHALL NOT drop, duplicate or reorder any non-whitespace character.
3. THE Paginator SHALL NOT split an Atomic_Unit across two lines or two Pages, unless the Atomic_Unit is longer than one line.
4. IF an Atomic_Unit is longer than one line, THEN THE Paginator SHALL break it at the column limit, and SHALL do so on a code-point boundary.
5. THE Paginator SHALL produce no line longer than the column count and no Page with more lines than the row count.
6. THE Paginator SHALL NOT produce a Page that contains only whitespace, except for empty input, which SHALL produce exactly one empty Page.
7. FOR ALL valid inputs, THE Paginator SHALL be deterministic: the same inputs give the same Pages.
8. WHEN a message has more than one Page, THE LCD SHALL show a position indicator (for example "2/4") and THE navigation key SHALL move between Pages.

### Requirement 4: Keypad and Key-Sequence Composition

**User Story:** As a judge, I want to dial a USSD code with the on-screen keys or my keyboard and get exactly the code I meant.

#### Acceptance Criteria

1. THE Composer SHALL turn a Key_Sequence of digit, `*`, `#` and Clear (backspace) presses into a dial string.
2. FOR ALL Key_Sequences made of digit, `*` and `#` presses with no Clear, THE Composer SHALL return the characters in press order.
3. FOR ALL Key_Sequences, a Clear press SHALL remove exactly the last character, and a Clear press on an empty dial string SHALL leave it empty.
4. FOR ALL USSD_Codes, pressing the keys for each character of the code in order, on the on-screen Keypad or on a physical keyboard, SHALL produce the same dial string as the code.
5. THE Composer SHALL cap the dial string at the USSD input length defined in the Handset_Config, and SHALL ignore presses beyond the cap.
6. WHILE the user is writing an SMS, THE Composer SHALL provide multi-tap text entry: repeated presses of one digit key within the multi-tap timeout cycle through that key's letters, and a different key or a timeout commits the letter.
7. FOR ALL multi-tap Key_Sequences, THE Composer SHALL produce the same text on every run when the sequence and its timings are the same.

### Requirement 5: USSD Dialing and Sessions

**User Story:** As a judge, I want to dial a code and walk through the menus as on a real phone, including a timeout.

#### Acceptance Criteria

1. WHEN the user presses Call with a valid USSD_Code in the dial string, THE Phone_UI SHALL send the code to the Web_Endpoint (or the Fixture) for the active App_Profile, and SHALL show a "Please wait" state until the reply arrives.
2. WHEN a USSD reply arrives, THE LCD SHALL show it through the Paginator, and SHALL show a reply input line when the reply offers a next step.
3. WHEN the user enters a menu choice and presses Call or the Send soft key, THE Phone_UI SHALL send the choice with the same `sessionId`.
4. WHEN a reply ends the session, THE Phone_UI SHALL show the final text and then return to the home screen on any key press.
5. WHEN the session has had no user input for the session timeout read from the server configuration, THE Phone_UI SHALL end the session and show a "Session ended" message that tells the user how to dial again.
6. WHEN the user presses End during a session, THE Phone_UI SHALL end the session and return to the home screen.
7. IF the user dials a USSD_Code that matches no App_Profile, THEN THE Phone_UI SHALL show "Code not recognised" with a short suggestion to try the code of an installed app.
8. THE Phone_UI SHALL show text exactly as the server returns it for USSD and SHALL NOT shorten or rewrite it.

### Requirement 6: SMS Compose and Inbox

**User Story:** As a judge, I want to text an app and read its replies as on a real phone.

#### Acceptance Criteria

1. THE Phone_UI SHALL provide a Messages menu with Inbox, Compose and Sent.
2. WHEN the user sends a message, THE Phone_UI SHALL post it to the Web_Endpoint for the active App_Profile, SHALL show it in Sent, and SHALL add each reply message to the Inbox.
3. WHEN the user composes a message, THE LCD SHALL show a live character counter and the segment count, using the limits and encoding rules from the server configuration.
4. WHEN an incoming message arrives, THE Phone_UI SHALL show a "New message" notice, light the unread indicator, and play no sound unless the user turned sound on.
5. WHEN a reply ends with "Reply MORE", THE Phone_UI SHALL offer MORE as a one-key soft action that sends "MORE".
6. THE Phone_UI SHALL let the user send STOP and DELETE as ordinary messages, and SHALL show the server's reply to each.
7. WHEN the user opens a message longer than one Page, THE Phone_UI SHALL show it through the Paginator.
8. THE Phone_UI SHALL keep the Inbox and Sent in memory for the browser session only, and SHALL NOT write message text to `localStorage`, `sessionStorage` or cookies.

### Requirement 7: App Switching

**User Story:** As a judge, I want to switch between Oja Ghost and Blackout Line with no setup.

#### Acceptance Criteria

1. THE Phone_UI SHALL list the App_Profiles from the Handset_Config as installed apps on the home screen and in a Menu.
2. WHEN the user selects an app, THE Phone_UI SHALL make it the active app, SHALL use its USSD code and SMS short code, and SHALL keep a separate Inbox, Sent and USSD session for each app.
3. THE Phantom_Handset SHALL use a fake sender number for the active user, defined in the Handset_Config, and SHALL display it masked in the format `+234****5678`.
4. THE Phantom_Handset SHALL provide a "Reset phone" action that clears all in-memory state and starts a new `sessionId`.
5. THE Handset_Config SHALL define App_Profiles as data, so adding a third app needs a config entry and no change to the Phone_UI code.

### Requirement 8: Dev Server

**User Story:** As a developer, I want a thin server that runs the real kit pipeline, so the demo shows the real agent and can later be deployed as a Lambda.

#### Acceptance Criteria

1. THE Dev_Server SHALL import only from `@ghostline/kit` (the public API) and SHALL NOT import kit internals.
2. THE Dev_Server SHALL wire `WebAdapter`, `MessageProcessor` and the app configurations for Oja Ghost and Blackout Line.
3. THE Dev_Server SHALL expose the Web_Endpoint, which validates the payload with the `WebAdapter` and returns the reply messages produced by `MessageProcessor`.
4. THE Dev_Server SHALL expose a configuration endpoint that returns the kit's channel limits (from `LIMITS`) and the list of available apps.
5. THE Dev_Server SHALL keep its request handler free of Node-only server objects, so that it can be wrapped as an AWS Lambda handler without changes to the logic.
6. THE Dev_Server SHALL select the model provider and store from environment variables, and SHALL default to `MemoryStore` and a deterministic non-network provider when no AWS credentials are set.
7. WHEN the Dev_Server rejects a request (invalid payload, rate limit, internal error), THE Dev_Server SHALL return a short, actionable user message and SHALL NOT return stack traces or internal IDs.
8. THE Dev_Server SHALL log phone numbers masked and SHALL NOT log message bodies, using the kit logger.
9. THE Dev_Server SHALL read all secrets and configuration from environment variables, and `.env.example` SHALL list every variable the server reads.
10. IF the Web_Endpoint is exposed beyond localhost, THEN THE Dev_Server SHALL require an operator-set access token, and SHALL document this in the README.

### Requirement 9: Offline Scripted Mode

**User Story:** As a presenter, I want the demo to work with no network and no Bedrock, so that the video never fails on the day.

#### Acceptance Criteria

1. THE Phantom_Handset SHALL support Handset_Mode `scripted`, which replays Fixtures and makes no network request.
2. THE Phantom_Handset SHALL start in `scripted` mode when the URL has `?mode=scripted`, and SHALL offer a visible toggle between `live` and `scripted`.
3. IF a `live` request fails because the Dev_Server cannot be reached, THEN THE Phone_UI SHALL show a short message and offer to switch to `scripted` mode.
4. THE Phantom_Handset SHALL validate each Fixture on load and SHALL show a clear error naming the Fixture and the invalid field if it is malformed.
5. WHEN the user's input matches a step of the active Fixture, THE Phantom_Handset SHALL return that step's reply and Trace_Events, after that step's delay.
6. WHEN the user's input matches no step, THE Phantom_Handset SHALL show a scripted-mode hint that lists the inputs the Fixture understands.
7. THE Phantom_Handset SHALL provide an "Autoplay" control that types the Fixture's inputs for the user, at a speed the user can change.
8. WHERE Reduced_Motion is set, THE Autoplay SHALL skip typing animation and apply each step immediately.
9. THE Fixtures SHALL follow the same copy rules as live replies (limits, plain words, no emoji in Blackout Line alerts), and the Fixture loader SHALL reject a USSD reply longer than the screen hard cap from the Fixture limits.

### Requirement 10: Trace Panel and Split View

**User Story:** As a viewer of the demo video, I want to see what the agent thinks and which tools it calls, next to the phone.

#### Acceptance Criteria

1. THE Phantom_Handset SHALL provide a Split_View with the Phone_UI on one side and the Trace_Panel on the other, switchable with a visible control and the keyboard.
2. THE Web_Endpoint response SHALL carry an ordered list of Trace_Events for the request, when the server can produce them.
3. THE Trace_Panel SHALL list Trace_Events in order, each with its type, a short title, a time, and, for tool calls, the tool name, its input and its result.
4. THE Trace_Panel SHALL highlight the Trace_Events that belong to the message currently shown on the LCD.
5. THE Trace_Panel SHALL mask phone numbers in every Trace_Event, and SHALL show message text only as it already appears on the Phone_UI.
6. IF the server returns no Trace_Events, THEN THE Trace_Panel SHALL show "No trace for this message" and SHALL NOT show invented events.
7. THE Phantom_Handset SHALL treat the Trace_Event shape as untrusted input, and SHALL validate it with a type guard before rendering, ignoring malformed events.
8. THE Trace_Panel SHALL render Trace_Event content as plain text.
9. WHERE the kit does not expose reasoning or tool-call events, THE Dev_Server SHALL return an empty list, AND the kit-core change needed SHALL be listed as an open question in `design.md`, AND this spec SHALL NOT modify the kit.
10. WHILE Handset_Mode is `scripted`, THE Trace_Panel SHALL show the Trace_Events from the Fixture.

### Requirement 11: Kiroween Landing Page

**User Story:** As a hackathon judge, I want a memorable first screen that explains the project and takes me to the phone.

#### Acceptance Criteria

1. THE landing page SHALL show a dark "graveyard of dead phones" theme around the Phone_UI, built with CSS and inline SVG, with no external images or fonts.
2. THE landing page SHALL state the one-line pitch, the Africa phone-ownership statistic from `product.md` with its source, and short descriptions of Oja Ghost, Blackout Line and the kit.
3. THE landing page SHALL link to the repository and to the quick-start instructions.
4. THE landing page SHALL keep the Halloween styling to the page chrome and SHALL NOT put themed wording in any message shown on the LCD.
5. THE landing page SHALL have a "Try it" control that moves focus to the Phone_UI.
6. THE landing page SHALL render fully, with all text readable, when JavaScript animation is disabled or when Reduced_Motion is set.

### Requirement 12: Demo Label and Honesty

**User Story:** As a viewer, I want it to be obvious this is a demo, so that I am not misled about what is real.

#### Acceptance Criteria

1. THE Phantom_Handset SHALL show the Demo_Label (for example "Demo: no SIM, no real telco") on the landing page and on the Phone_UI casing, at all times.
2. WHILE Handset_Mode is `scripted`, THE Phantom_Handset SHALL show an additional "Scripted replay" label.
3. THE Blackout Line experience SHALL show its source and the instruction to follow official emergency instructions, as the app returns them, and THE Phantom_Handset SHALL NOT present a scripted alert as a live alert.
4. THE Phantom_Handset SHALL NOT send any message to a real phone number, and SHALL NOT offer a field that accepts a real recipient number.

### Requirement 13: Accessibility

**User Story:** As a user of assistive technology or a keyboard, I want to use the whole phone.

#### Acceptance Criteria

1. THE Phantom_Handset SHALL meet WCAG 2.2 AA contrast: 4.5:1 for normal text, 3:1 for large text and for user-interface component boundaries, including the LCD green-on-dark text, the Keypad labels and the landing page.
2. THE Phantom_Handset SHALL be fully operable by keyboard: every Keypad key, soft key and navigation key SHALL be a focusable control with a visible focus indicator.
3. THE Phantom_Handset SHALL map physical keys as follows: `0`–`9`, `*` and `#` to Keypad keys; Enter to Call or the middle soft key; Escape to End; Backspace to Clear; arrow keys to navigation; and F1 and F2 to the left and right soft keys.
4. THE Phantom_Handset SHALL provide a "Keyboard help" overlay that lists the mapping, opened with `?`, and SHALL NOT trap focus outside that overlay while it is open.
5. THE Phantom_Handset SHALL NOT capture keyboard keys when focus is in a text input outside the Phone_UI.
6. WHEN the LCD content changes, THE Phantom_Handset SHALL announce the new Page text in an `aria-live="polite"` region, and SHALL NOT announce unchanged content twice.
7. WHEN a USSD session ends, an error occurs, or a new message arrives, THE Phantom_Handset SHALL announce it, using `aria-live="assertive"` only for errors.
8. EACH Keypad key SHALL have an accessible name that includes its digit and its letters (for example "2, ABC").
9. THE Phantom_Handset SHALL NOT convey information by colour alone.
10. THE Phantom_Handset SHALL keep a logical focus order and SHALL provide a "Skip to phone" link at the top of the page.

### Requirement 14: Reduced Motion

**User Story:** As a user who is sensitive to motion, I want no animation I did not ask for.

#### Acceptance Criteria

1. WHERE Reduced_Motion is set, THE Phantom_Handset SHALL disable CSS animation and transition effects for the landing page (flicker, floating, fog, glitch) and for the LCD (backlight flicker, typewriter reveal).
2. WHERE Reduced_Motion is set, THE LCD SHALL show each Page in full at once.
3. WHEN the user changes the Reduced_Motion setting while the app is open, THE Phantom_Handset SHALL apply it without a reload.
4. THE Phantom_Handset SHALL NOT use any flashing content that flashes more than three times in one second.

### Requirement 15: Copy and Configuration

**User Story:** As a maintainer, I want all wording in one place, so that copy can change without touching code.

#### Acceptance Criteria

1. THE Handset_Config SHALL hold all user-visible text of the Phone_UI, landing page, Demo_Label, error messages and keyboard help, and the Phone_UI and landing page components SHALL read text only from it.
2. THE Handset_Config SHALL hold the App_Profiles, the LCD size and the multi-tap settings.
3. EACH error message in the Handset_Config SHALL be short, plain, and tell the user what to do next, and SHALL NOT contain a stack trace or internal ID.
4. THE Handset_Config SHALL be typed so that a missing key causes a type-check failure.

### Requirement 16: Privacy and Security

**User Story:** As a maintainer, I want the demo to follow the project's privacy rules.

#### Acceptance Criteria

1. THE Phantom_Handset SHALL mask phone numbers in every place it displays them, in logs and in Trace_Events.
2. THE Phantom_Handset SHALL NOT log message bodies to the browser console.
3. THE Phantom_Handset browser bundle SHALL NOT contain secrets, and the Dev_Server SHALL read `WEBHOOK_SECRET` and any access token only from environment variables.
4. THE Dev_Server SHALL apply the kit's per-phone-number rate limit to Web_Endpoint requests.
5. THE Phantom_Handset SHALL render all server text as plain text and SHALL NOT insert it as HTML.
6. WHEN the user sends DELETE, THE Phantom_Handset SHALL also clear its in-memory Inbox and Sent for the active app after the server confirms.

### Requirement 17: Testing

**User Story:** As a maintainer with limited credits, I want a small set of strong tests that protect the riskiest logic.

#### Acceptance Criteria

1. THE project SHALL include a property-based test for the Paginator that checks Requirement 3.2, 3.3 and 3.5 across generated text that includes amounts (such as "₦1,500"), numbers, phone numbers, long words, multiple spaces and line breaks. This test is **required**.
2. THE project SHALL include a property-based test for the Composer that checks Requirement 4.2, 4.3 and 4.4 across generated Key_Sequences and USSD_Codes. This test is **required**.
3. WHEN a property test finds a counterexample, THE test file SHALL keep it as a named regression example with a comment that says what bug it found.
4. THE project MAY include example tests for Fixture validation, the type guard for Trace_Events, and the Dev_Server handler. These are **optional**.
5. THE project MAY include component tests for keyboard operation, `aria-live` announcements and Reduced_Motion, and one end-to-end smoke test of a USSD dial in scripted mode. These are **optional**.
6. THE property tests SHALL run under `pnpm test` and `pnpm test:pbt`, and SHALL import the Paginator and Composer as pure modules with no DOM or React dependency.
7. THE architecture SHALL check Requirement 1.1 and 1.2 automatically, for example with a test that scans `phantom-handset/src` for forbidden imports. This check is **optional**.
