# CLAUDE.md: Ghost Line Kit (Kiroween 2026)

You are working on **Ghost Line Kit**, a Kiroween 2026 hackathon entry (Skeleton Crew category).
Read these first, in order: `.kiro/steering/product.md`, `tech.md`, `structure.md`, `feature-phone-ux.md`, `security.md`, then `docs/KICKOFF.md` and `docs/PLAN.md`.
The steering docs are the source of truth for product, stack and rules. Follow them.

## THE MOST IMPORTANT RULE: the hybrid split
The hackathon judges score **how well the project uses Kiro** (specs, hooks, steering, custom agents, MCP, property-based tests, Kiro Crew). The write-up must honestly say what Kiro built. So:

**Claude Code (you) owns:**
- Repo setup: git, GitHub repo (`gh`), license, .gitignore, `.env.example`, README skeleton.
- Monorepo plumbing: pnpm workspaces, tsconfig, vitest + fast-check config, lint/format, scripts (`test`, `test:pbt`, `dev`, `build`).
- Empty package shells with `package.json` and an `index.ts` that exports nothing yet. **No feature logic.**
- CI (GitHub Actions: install, typecheck, test).
- Deployment infrastructure (AWS, or a fallback host), once Kiro's code exists.
- Verification: running tests, checking the submission checklist, testing the live URL, reviewing for secrets and accessibility.
- Docs: README polish, the submission write-up draft (from `docs/kiro-log.md`), the video script, and the blog draft. Everything must be accurate to what happened.

**Kiro owns (do NOT write this code):**
- Everything in the Kiro specs listed in `docs/KICKOFF.md` Part 3: kit core (`kit/src/**` logic), Phantom Handset UI, the Oja Ghost and Blackout Line apps, and the Night Shift Crew app.
- The specs themselves (`.kiro/specs/**`), the hooks (`.kiro/hooks/**`) and custom agents. The user creates these inside Kiro.

If a task needs feature code, **stop and write a short note in `docs/HANDOFF-TO-KIRO.md`** describing what Kiro should build (which spec, which task), then tell the user to run it in Kiro. You may fix build or config problems that block Kiro's code from running; log each one.

## Logging (non-negotiable)
- Append every meaningful action you take to `docs/claude-code-log.md`: date, what, why, files.
- Never edit `docs/kiro-log.md` except to add entries the user dictates.
- Never claim in any doc that Kiro did something Claude Code did, or the reverse.

## Hard rules
- Never add `.kiro` to `.gitignore`. Never delete anything in `.kiro/`.
- Never commit secrets. Use `.env` (gitignored) and keep `.env.example` current.
- Ask the user before: creating or deleting cloud resources that cost money, pushing to a public repo for the first time, changing the license, or adding a dependency not named in `tech.md`.
- Commit small and often, with clear messages. The git history proves the project started after Oct 30, 2026.
- Deadline: **Fri Dec 4, 2026, 2:00 PM PT (11:00 PM Lagos)**. Target submission: Thu Dec 3.

## Slash commands (in `.claude/commands/`)
- `/setup`: Phase 0. Repo, GitHub, monorepo shells, CI. Run once.
- `/status`: shows where we are against `docs/PLAN.md` and what to do next, in Kiro or Claude Code.
- `/verify`: runs tests, typecheck and the submission checklist; reports gaps.
- `/deploy`: deploys what exists and smoke-tests the live URL.
- `/submission`: drafts the Devpost write-up, video script, blog and social post from the logs.
