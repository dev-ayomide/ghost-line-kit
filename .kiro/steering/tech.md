---
inclusion: always
---

# Tech stack and conventions

## Stack
- Language: TypeScript (strict) everywhere. Node 20+.
- Monorepo: pnpm workspaces (`kit`, `apps/*`, `phantom-handset`).
- HTTP: Hono (small, fast, easy to run on Node or AWS Lambda).
- Validation: zod for all inbound webhooks and agent tool inputs.
- Tests: vitest for unit tests and fast-check for property-based tests (PBT). Every kit module that formats, splits or stores data must have properties, not just examples.
- AI: Amazon Bedrock, behind a single `LlmProvider` interface in the kit so other providers can be swapped in. Never call a model SDK directly from an app.
- Telco: Africa's Talking (SMS + USSD) through a `ChannelAdapter` interface. Use the sandbox in development. A `web` adapter powers the Phantom Handset.
- Storage: a `Store` interface with an in-memory version for tests and a DynamoDB version for production.
- Frontend (Phantom Handset + landing page): Vite + React + TypeScript. No heavy UI libraries; hand-built CSS for the retro phone look.
- Deploy: AWS (App Runner or Lambda for the API, S3 + CloudFront or Amplify for the web). Use a single `.env.example`; never commit secrets.

## Code rules
- Apps may import only from `@ghostline/kit`, never from kit internals (`kit/src/...`). A hook enforces this.
- Prefer pure functions for formatting, splitting, menus and ledger maths, so property tests can cover them.
- Every channel limit lives in one place: `kit/src/limits.ts`.
- Errors shown to end users are short and actionable ("Try again. Send HELP for options."). Never send stack traces or internal IDs.
- Keep dependencies few. Ask before adding one.

## Testing
- `pnpm test` runs everything. `pnpm test:pbt` runs only the property tests, with more runs.
- When a property test finds a counterexample, keep it as a named regression example in the test file, with a comment saying what bug it found. This record is evidence for the hackathon write-up.
