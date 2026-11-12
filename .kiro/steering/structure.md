---
inclusion: always
---

# Repository structure

```
/
├── .kiro/                 # specs, hooks, steering, agents (MUST be committed)
├── kit/                   # THE SKELETON: @ghostline/kit
│   └── src/
│       ├── channels/      # ChannelAdapter: sms, ussd, web
│       ├── session/       # USSD/SMS session state machine (timeouts, resume)
│       ├── format/        # message splitting, menu rendering, character budgets
│       ├── agent/         # intent schema, tool registry, LlmProvider
│       ├── store/         # Store interface + memory + dynamo
│       ├── limits.ts      # every channel limit, in one place
│       └── index.ts       # the ONLY public API
├── apps/
│   ├── oja-ghost/         # App 1: Lagos market trader assistant
│   └── blackout-line/     # App 2: global disaster-mode line
├── phantom-handset/       # browser feature-phone emulator (judges test here)
├── crew-app/night-shift/  # Kiro Crew app (also published as its own repo)
├── docs/                  # write-up drafts, screenshots, video script
├── LICENSE                # MIT, visible in GitHub "About"
└── README.md              # explains everything in 10 minutes
```

## Rules
- An app is a folder with `app.config.ts` (name, menus, tools, copy) plus its own tools. If an app needs something the kit lacks, add it to the kit in a general form instead of hacking around it in the app.
- New apps should need fewer than about 300 lines of app-specific code. Mention this in the README; it's the proof that the skeleton works.
