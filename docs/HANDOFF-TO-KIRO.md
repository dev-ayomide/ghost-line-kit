# Handoff to Kiro

Feature work Claude Code found that Kiro should build. Format: spec, task, what, why.


- spec: kit-core, task 2.4 (cleanup): `kit/src/format/menu.ts` imports `'../limits'` without the `.js` extension, unlike split.ts and reply.ts. Make it consistent. Why: style consistency; found by Claude Code during group 2 verification (2026-11-18).

## 2026-11-21: Oja Ghost parser misroutes "how much does bola owe" (spec: oja-ghost, task 7.1 / 7.2)
Found by driving the real app through the handset server. Message `how much does bola owe` is classified as `price` and replies "I do not know that item". It should read the debtor balance (the `book`/ledger query path). Likely cause: a `how much` pattern in `parse.ts` that wins over the balance query. Please fix in `parse.ts`, add an example test in `parse.test.ts` (task 7.2 is optional, but add this case and a few phrasing variants: "how much bola owe me", "bola balance", "wetin bola owe"), and re-check the order of patterns.
Also worth a look: `price of garri` with no market replies "I do not know that market"; consider asking which market or defaulting to a nearby one, since this is the demo's first message.
