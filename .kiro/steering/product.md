---
inclusion: always
---

# Product: Ghost Line Kit

## One-liner
Any phone, any outage, no one left behind. Ghost Line Kit is an open-source skeleton for building AI agents that work over SMS and USSD on any phone, including a $10 feature phone with no internet.

## Why it exists
- Many people own a mobile phone but don't use the internet. In Africa (ITU 2023), 63% own a mobile phone but only 37% use the internet.
- During disasters, power cuts and internet shutdowns, smartphones also fall back to plain SMS.
- Building SMS/USSD apps is painful: tiny screens, 160-character segments, USSD session timeouts, and telco APIs. The kit removes that pain so a developer (with Kiro) can ship a new any-phone app in an afternoon.

## Hackathon framing (Kiroween 2026, Skeleton Crew)
- `/kit` is the skeleton: lean, clear and flexible.
- Two very different apps prove the kit's range:
  1. `/apps/oja-ghost`: a Lagos market trader assistant (prices, a debt "book", reminders).
  2. `/apps/blackout-line`: a global disaster-mode line (official alerts, shelters, family "I'm OK" check-ins).
- `/crew-app/night-shift`: a Kiro Crew app whose bots run operations (data refresh, failed-message triage, daily summary), with an approval gate before any broadcast.

## Users
- Primary (App 1): market traders in Lagos on feature phones; English and Nigerian Pidgin, with Yoruba as a stretch goal.
- Primary (App 2): anyone in an outage or disaster zone, starting with US weather alerts.
- Secondary: developers and NGOs who build on the kit.

## Product principles
1. Works without a smartphone. Never assume data, apps, links or images.
2. Every feature can be tried in the browser through the Phantom Handset emulator. No SIM needed.
3. Short, kind and clear wording. Every message fits the channel's limits.
4. Privacy by default. Phone numbers are personal data.
5. The theme is spooky; the help is real. Halloween flavour lives in the web UI and the story, never in the messages users get in an emergency.

## Non-goals
- Not a replacement for official emergency services. Blackout Line always states its source and tells people to follow official instructions.
- No smartphone app.
