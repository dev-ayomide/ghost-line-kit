# Ghost Line Kit

**Any phone, any outage, no one left behind.** Ghost Line Kit is an open-source skeleton for building AI agents that work over SMS and USSD on any phone, including a $10 feature phone with no internet.

> Kiroween 2026 entry, Skeleton Crew category. Work in progress.

## Structure

```
.kiro/                 specs, hooks, steering, agents
kit/                   @ghostline/kit: the skeleton (channels, sessions, formatting, agent core, store)
apps/oja-ghost/        App 1: Lagos market trader assistant
apps/blackout-line/    App 2: global disaster-mode line
phantom-handset/       browser feature-phone emulator (try everything here, no SIM needed)
crew-app/night-shift/  Kiro Crew app that runs operations
docs/                  plan, logs, write-up drafts
```

## How to run

Requires Node 20+ and pnpm (via `corepack enable pnpm`).

```bash
pnpm install
pnpm dev          # Phantom Handset at http://localhost:5173
pnpm test         # all tests
pnpm test:pbt     # property-based tests only, with more runs
pnpm typecheck
pnpm build
```

Copy `.env.example` to `.env` for Africa's Talking sandbox and AWS settings. Never commit `.env`.

## Phantom Handset (try it with no SIM)

The Phantom Handset is a browser feature phone: dial USSD codes, send and receive SMS, and switch between Oja Ghost and Blackout Line. A split view shows the agent's reasoning and tool calls next to the phone. Everything on the page is labelled as a demo. It sends nothing to a real phone number.

**Run it**

```bash
pnpm install
pnpm dev          # open http://localhost:5173 (use "localhost", not 127.0.0.1)
```

`pnpm dev` starts the page and the demo API on one port. The browser app never imports the kit at runtime. It talks to `POST /api/web/:appId` with `{ from, text, sessionId?, channel? }`, the kit's `WebAdapter` payload.

| URL | What you get |
|---|---|
| `/` | Live mode: replies come from the demo server (the real kit pipeline). |
| `/?mode=scripted` | Scripted mode: replays recorded conversations. No network and no Bedrock needed. Use this for demos and videos. |
| `/?view=split` | Split view: the phone and the agent trace side by side. Also toggled with the Split view button or F4. |
| `/?mode=scripted&view=split` | Both. Press Start autoplay to watch a scripted conversation type itself. |

Live mode shows "Something went wrong. Try again." if the demo server is not reachable. Use the Scripted mode button, or add `?mode=scripted`.

**Try this**

- Press the green Call key after dialling `*384#` (Oja Ghost) or `*385#` (Blackout Line), then choose menu options. These codes are placeholders until the app specs fix them.
- Open Messages, then Write message, and send `prices`, `help`, `MORE`, `STOP`, `START` or `DELETE`.

**Keyboard**

| Keys | Action |
|---|---|
| `0`-`9`, `*`, `#` | Keypad key |
| Enter | Call, or the middle soft key |
| Escape | End |
| Backspace | Clear |
| Arrow keys | Navigation key |
| F1 / F2 | Left / right soft key |
| F4 | Toggle split view |
| `?` | Keyboard help |

Exceptions: Enter or Space on a focused button presses that button. On the Write screen the keyboard types characters directly (the on-screen keys use multi-tap, and some symbols are not accepted).

**Standalone server**

```bash
pnpm --filter phantom-handset serve   # builds server/main.ts, then runs it on 127.0.0.1:8787
```

The server is a pure request handler (`phantom-handset/server/handler.ts`) wrapped by a small `node:http` listener, using only the public `@ghostline/kit` API, so it can later be wrapped as a Lambda handler. Until the real app specs land, it runs two small stand-in apps with the same ids.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. |
| `PORT` | `8787` | Port. |
| `HANDSET_ACCESS_TOKEN` | unset | Required when `HOST` is not loopback. The server refuses to start without it. The browser sends it as `Authorization: Bearer`, read from `#token=...` in the page URL (kept in memory only). |
| `HANDSET_ALLOWED_ORIGIN` | unset | Adds CORS headers for that one origin. |
| `HANDSET_LLM` | `scripted` | `scripted` (offline keyword stand-in) or `bedrock` (also needs `BEDROCK_MODEL_ID`). |
| `HANDSET_STORE` | `memory` | `memory` or `dynamo` (also needs `DYNAMO_TABLE_NAME`). |
| `HANDSET_TRACE` | `on` | `off` turns trace collection off. |

The web endpoint is for demos only. It accepts only the phone's built-in fake sender number, has no telco authentication, and must not expose private data. Put it behind the access token, or keep it on localhost.

## Built with Kiro

TODO: specs, hooks, steering, custom agents, MCP, property-based tests and Kiro Crew, with links.

## License

MIT. See [LICENSE](LICENSE).
