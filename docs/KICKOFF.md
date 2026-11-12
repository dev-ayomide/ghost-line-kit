# Ghost Line Kit: Kickoff Guide (Kiroween 2026)

**Decision:** Ghost Line Kit · **Category:** Skeleton Crew · **Bonus targets:** Best Startup ($10k), Best Kiro Crew App, Best Demo, Blog, Social Blitz
**Deadline:** Fri Dec 4, 2026, 2:00 PM PT = **11:00 PM Lagos**. Aim to submit by **Thu Dec 3**.

---

## Part 1: Do these today (setup checklist)

### Accounts and access
- [ ] Register on Devpost for Kiroween (if you haven't) and start a **draft submission** now.
- [ ] Request your **Kiro credits** on the Resources tab (cut-off: Tue Dec 1, 12:00 PT, but do it today).
- [ ] Install the **Kiro IDE** and **Kiro CLI**, and sign in. Set up **Kiro Crew** (it runs on the CLI).
- [ ] Join the Kiro **Discord** → #kiroween-hackathon. Note the office-hours dates.
- [ ] Create an **Africa's Talking** account and use the **sandbox** (SMS + USSD simulator). Separately, ask their sales/support how long a live Nigerian USSD code takes. Don't depend on it; the sandbox plus the Phantom Handset is enough to win.
- [ ] Create an **AWS** account and enable **Amazon Bedrock** model access. Check that the model you want is available in your region.
- [ ] Check the **US National Weather Service API** (api.weather.gov) terms and usage rules for Blackout Line.

### Repo
- [ ] Create a **public GitHub repo** `ghost-line-kit` with the **MIT license**, and confirm it shows in the About section.
- [ ] Copy this starter pack's `.kiro/steering/` into the repo root. **Never** add `.kiro` to `.gitignore`.
- [ ] Create a second public repo `night-shift-crew` for the Kiro Crew app. It's needed for the Best Kiro Crew App prize.
- [ ] Make your first commit today. The commit history proves the project is new (started after Oct 30).

### Startup prize prep (an hour, this week)
- [ ] Polish your LinkedIn with your founder role: "Founder, Ghost Line".
- [ ] Get a domain and a one-page site. Kiro can build it later as part of the Phantom Handset web app.

### Evidence habit (this wins "Technological Implementation")
- [ ] Keep `docs/kiro-log.md`. Every day, add 3 lines: what Kiro feature you used, what it did, and one screenshot. Your write-up and blog will come from this log.

---

## Part 2: Build plan (22 days)

| Days | Dates | Goal | Done when |
|---|---|---|---|
| 1–4 | Nov 12–15 | **Kit core + Phantom Handset** | You can "dial" a demo USSD menu in the browser; property tests pass |
| 5–9 | Nov 16–20 | **App 1: Oja Ghost** | Price check, report price, debt book and reminders work in the sandbox + Phantom Handset |
| 10–13 | Nov 21–24 | **App 2: Blackout Line** | Real NWS alert by ZIP; "OK" check-in reaches a family number |
| 14–16 | Nov 25–27 | **Crew app: Night Shift** | Scout, Undertaker and Medium bots run on schedules; broadcast needs approval |
| 17–19 | Nov 28–30 | **Polish + deploy** | Live URL works on a judge's laptop with no setup; landing page; README |
| 20–21 | Dec 1–2 | **Video, write-up, blog, social** | Video ≤ 2:55 on YouTube (public); blog on DEV; social post |
| 22 | Dec 3 | **Submit** | Every Devpost field filled; links tested in an incognito window |

**Cut order if you fall behind:** drop Yoruba → drop live AWS deploy of the Crew app (keep the repo + video) → simplify Blackout Line to alerts + check-in only. **Never cut:** the Phantom Handset, the property-test bug story, or the video.

---

## Part 3: Paste these into Kiro (in order)

Use **Spec mode** for each. Review the requirements before letting Kiro move on to design and tasks, and take a screenshot of each stage for the video.

### Spec 1: `kit-core`
> Read the steering docs. Create a spec for the `@ghostline/kit` package: a ChannelAdapter interface with `web`, `sms` (Africa's Talking) and `ussd` (Africa's Talking) adapters; a session state machine for USSD and SMS conversations that supports timeouts and resuming; a `format` module that splits messages into SMS segments (GSM-7 vs UCS-2 detection) and renders numbered USSD menus within the limits in `limits.ts`; an agent core with an intent schema, a tool registry and an `LlmProvider` interface (Bedrock implementation); and a `Store` interface with in-memory and DynamoDB versions. Requirements must use EARS format. Mark which requirements should be verified with property-based tests (fast-check). Required properties include: messages never split a word, number or currency amount; every segment is within its limit; concatenating segments gives back the original text; every USSD session either resumes or ends cleanly; menus never exceed the screen budget.

### Spec 2: `phantom-handset`
> Create a spec for `phantom-handset`: a React web app that shows a realistic retro feature phone (green-backlit LCD, physical keypad, call/end keys, keyboard support) and talks to the kit through the `web` channel adapter. It must let a judge dial USSD codes, send and receive SMS, and switch between apps (Oja Ghost, Blackout Line) with no SIM and no setup. Include a spooky-but-tasteful Kiroween landing page around the phone (a dark "graveyard of dead phones" theme), and a split view that shows the agent's reasoning and tool calls next to the phone, for the demo video. Meet WCAG AA contrast for the page.

### Spec 3: `oja-ghost`
> Create a spec for `apps/oja-ghost`, built ONLY on `@ghostline/kit`'s public API. Features: (1) check today's price for a commodity at a Lagos market (e.g. "rice Mile 12"); (2) report a price, with crowdsourced averaging and outlier rejection; (3) a debt book: record "Bola owes ₦4,500" or "Bola paid ₦2,000" and see balances; (4) SMS reminders for debts and supplier payments. Support English and Nigerian Pidgin. Property tests: ledger balance always equals the sum of transactions; a payment can never make a balance go negative without an explicit overpayment record; the price average is unchanged when a rejected outlier is added. Seed with realistic demo data and label it as demo data.

### Spec 4: `blackout-line`
> Create a spec for `apps/blackout-line`, built ONLY on `@ghostline/kit`'s public API. Features: (1) text a US ZIP code to get active official alerts from the National Weather Service API (api.weather.gov), summarised for SMS, always naming the source; (2) text SHELTER to get the nearest listed shelter, with a demo dataset if no open API is suitable; (3) text OK or HELP to send a check-in to a saved family list; (4) a "simulate storm" mode for demos that is clearly marked as a simulation. Follow the emergency copy rules in steering. Property tests: an alert summary never drops the alert's action instruction or its source; every check-in reaches each family member exactly once.

### Spec 5: `night-shift` (Kiro Crew app, separate repo)
> Create a Kiro Crew app called Night Shift that operates Ghost Line Kit deployments. Bots: "Scout" refreshes market prices and alert data on a schedule; "Undertaker" triages failed or undelivered SMS overnight and retries or reports them; "Medium" writes a daily plain-English summary for the operator and posts it to Telegram or Discord. Any broadcast SMS to more than 10 people must go through a Crew approval gate. Use webhooks from the kit's delivery reports. Keep the signed audit log on.

### Hooks to create (ask Kiro: "Create an agent hook that…")
1. **On save** in `kit/src/format/**`: run `pnpm test:pbt` for the format module and report any counterexample.
2. **On a new or changed file in `apps/**`**: check that the app imports only from `@ghostline/kit` and fails loudly otherwise. This is your Skeleton Crew proof.
3. **On a change to any spec file**: update `docs/kiro-log.md` with a one-line summary of what changed.
4. **On save** in `phantom-handset/**`: regenerate the demo fixtures, the scripted conversations used in the video.

### Custom agents
- **USSD Menu Designer:** turns a feature idea into a USSD menu tree that fits the limits. Use it in both the IDE and the CLI, and note the differences for your write-up.
- **Spec Auditor:** checks that every requirement has a task and a test, and that every PBT-marked requirement has a property.

### MCP
- **GitHub MCP:** issues, PRs and release notes from inside Kiro.
- **Africa's Talking MCP** (or a simple HTTP MCP you build): lets Kiro read delivery reports while debugging. If you build it yourself, put it in `/tools/at-mcp` and mention it in the write-up.

---

## Part 4: The moments the video needs (capture them as they happen)
1. **The PBT bug:** fast-check finds "₦1,500" split as "₦1," | "500" across segments. Record the red → green moment.
2. **"Same skeleton, different afterlife":** create `apps/blackout-line` from the kit and show how little app code it needs.
3. **The real phone:** a reminder SMS arrives on a real cheap phone, filmed on camera.
4. **Night Shift:** Crew bots working in the activity view, and an approval gate stopping a broadcast.

Film raw clips as you go, so you aren't scrambling on Dec 2.
