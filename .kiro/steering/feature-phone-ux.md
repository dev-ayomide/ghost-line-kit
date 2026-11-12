---
inclusion: fileMatch
fileMatchPattern: ["kit/src/format/**", "kit/src/session/**", "apps/**", "phantom-handset/**"]
---

# Feature-phone UX rules

## Channel limits (the source of truth is `kit/src/limits.ts`)
- SMS (GSM-7): 160 characters for a single segment and 153 per segment when concatenated. With any non-GSM character (UCS-2), it is 70 single and 67 concatenated. Detect the encoding and never guess it.
- USSD: treat 160 characters per screen as a hard cap and aim for 140 or fewer. Sessions time out (assume about 180 seconds of inactivity); always allow resuming.
- Prefer at most 3 SMS segments per reply. If more are needed, send a summary and offer "Reply MORE".

## Writing style
- Plain words, short sentences. Use numbers and currency the way traders write them: "₦1,500", never "1500.00 NGN".
- Never split a number, an amount, a phone number or a word across segments or screens.
- USSD menus: at most 5 options, numbered 1–5, plus "0 Back" and "00 Menu".
- Every reply ends with a next step when useful ("Reply 1 to confirm").
- Support English and Nigerian Pidgin for Oja Ghost. Keep the copy in app config, not in code.
- Never send links as the only way to do something.

## Emergency copy (Blackout Line)
- Lead with the action, then the source: "Go to higher ground now. Source: US National Weather Service."
- No jokes, no spooky theme and no emoji in alert messages.
