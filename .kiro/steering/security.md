---
inclusion: always
---

# Security and privacy

- Phone numbers are personal data. Mask them in logs (`+234****5678`) and never print them in full.
- Never log message bodies in production; log message IDs and lengths only.
- Verify that inbound webhooks really come from the telco (shared secret or IP allowlist), and validate them with zod.
- Secrets live only in environment variables; `.env` is gitignored and `.env.example` is committed.
- Rate-limit by phone number to protect people from SMS cost abuse.
- A broadcast (one message to many people) must pass a human approval gate. In the Crew app, this is a Kiro Crew approval step.
- Users can text STOP to unsubscribe and DELETE to erase their data. Honour both immediately.
- The `.kiro/` folder must never be added to `.gitignore`.
