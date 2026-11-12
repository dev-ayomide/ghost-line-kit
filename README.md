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

## Built with Kiro

TODO: specs, hooks, steering, custom agents, MCP, property-based tests and Kiro Crew, with links.

## License

MIT. See [LICENSE](LICENSE).
