# Handoff to Kiro

Feature work Claude Code found that Kiro should build. Format: spec, task, what, why.


- spec: kit-core, task 2.4 (cleanup): `kit/src/format/menu.ts` imports `'../limits'` without the `.js` extension, unlike split.ts and reply.ts. Make it consistent. Why: style consistency; found by Claude Code during group 2 verification (2026-11-18).
