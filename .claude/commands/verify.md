Verify Ghost Line Kit. Do not write feature code; report problems and route feature fixes to Kiro via `docs/HANDOFF-TO-KIRO.md`.

1. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm test:pbt`. Summarize failures.
2. Skeleton Crew discipline: grep `apps/**` for imports from kit internals (anything other than `@ghostline/kit`). List violations.
3. Secrets scan: grep for keys and tokens; make sure `.env` is gitignored and `.kiro` is NOT gitignored.
4. Submission checklist (`docs/SUBMISSION-CHECKLIST.md`): tick what's verifiably done and list what's left.
5. If a live URL is set in `docs/SUBMISSION-CHECKLIST.md`, fetch it and check it loads.
6. Log results in `docs/claude-code-log.md`.
