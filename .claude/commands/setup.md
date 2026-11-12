Phase 0 setup for Ghost Line Kit. Follow CLAUDE.md's hybrid split strictly: no feature logic.

1. Check tools: node (20+), pnpm (install via corepack if missing), git, gh (and `gh auth status`). Report anything missing and how to install it on macOS; ask before installing.
2. `git init` (if needed), set the default branch to `main`, and make the first commit of the existing files (`.kiro/`, `docs/`, `CLAUDE.md`, etc.).
3. Create the monorepo plumbing per `.kiro/steering/tech.md` and `structure.md`:
   - root `package.json` (private, scripts: dev, build, test, test:pbt, typecheck, lint), `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), vitest config with fast-check installed.
   - empty package shells: `kit` (name `@ghostline/kit`), `apps/oja-ghost`, `apps/blackout-line`, `phantom-handset` (Vite + React + TS shell only, default page says "Phantom Handset coming soon"), each with `package.json`, `tsconfig.json`, `src/index.ts` (or `main.tsx`).
   - `crew-app/night-shift/README.md` placeholder only.
   - Root `README.md` skeleton: one-liner from product.md, the structure, "how to run", and a "Built with Kiro" section left as TODO.
4. Add `.github/workflows/ci.yml`: pnpm install, typecheck, test.
5. Run `pnpm install`, `pnpm typecheck` and `pnpm test`; everything must pass (an empty test suite is OK; add one trivial smoke test per package).
6. Commit: "chore: monorepo skeleton (Claude Code setup)".
7. Ask the user before creating the public GitHub repo: `gh repo create ghost-line-kit --public --license mit --source . --push` (if the license file already exists, skip `--license`). Then confirm the MIT license shows in the repo's About section.
8. Log everything in `docs/claude-code-log.md`.
9. Finish by telling the user exactly what to do next in Kiro: open this folder in the Kiro IDE and run **Spec 1 (kit-core)** from `docs/KICKOFF.md` Part 3.
