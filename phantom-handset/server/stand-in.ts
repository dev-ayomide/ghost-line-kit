/**
 * Stand-ins so live mode works before the real apps exist:
 * a deterministic, offline LlmProvider and two tiny apps.
 * Every reply is 140 characters or fewer. zod is imported only in this file.
 */
import { UNRECOGNIZED_INTENT } from '@ghostline/kit';
import type { Intent, LlmProvider, Tool } from '@ghostline/kit';
import { z } from 'zod';
import type { HandsetApp } from './apps.js';

const SKIP_FOR_DIGITS = new Set(['menu', 'help']);

/** Matches the first word to an intent name; a digit n picks the n-th non-menu, non-help intent. */
export class KeywordLlmProvider implements LlmProvider {
  async complete(_prompt: string): Promise<string> {
    return 'Send MENU for options.';
  }

  async classifyIntent(message: string, intentNames: string[]): Promise<Intent> {
    const first = message.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const make = (name: string): Intent => ({ name, parameters: {}, rawMessage: message });
    const byName = intentNames.find((n) => n.toLowerCase() === first);
    if (byName !== undefined) return make(byName);
    if (/^\d+$/.test(first)) {
      const pool = intentNames.filter((n) => !SKIP_FOR_DIGITS.has(n));
      const picked = pool[Number(first) - 1];
      if (picked !== undefined) return make(picked);
    }
    return make(UNRECOGNIZED_INTENT);
  }
}

const inputSchema = z.object({ phoneNumber: z.string().optional() });

function tool(name: string, description: string, text: string): Tool {
  return { name, description, inputSchema, execute: async () => text };
}

const OJA_INTENTS = ['menu', 'help', 'prices', 'book'];
const BLACKOUT_INTENTS = ['menu', 'help', 'alerts', 'checkin'];

export const STAND_IN_APPS: HandsetApp[] = [
  {
    id: 'oja-ghost',
    name: 'Oja Ghost',
    intentNames: OJA_INTENTS,
    tools: [
      tool('menu', 'Show the menu', 'Oja Ghost: 1 Prices 2 Book 0 Back'),
      tool('help', 'Show help', 'Send MENU for options. Send 1 for prices or 2 for your book.'),
      tool('prices', 'Show prices', 'Prices: Tomato ₦1,500, Rice ₦68,000. Send MENU for options.'),
      tool('book', 'Show the debt book', 'Book: Ada owes ₦2,500. Send MENU for options.'),
    ],
  },
  {
    id: 'blackout-line',
    name: 'Blackout Line',
    intentNames: BLACKOUT_INTENTS,
    tools: [
      tool('menu', 'Show the menu', 'Blackout Line: 1 Alerts 2 Check-in 0 Back'),
      tool('help', 'Show help', 'Send MENU for options. Send 1 for alerts or 2 to check in.'),
      tool(
        'alerts',
        'Show the latest alert',
        'Move to higher ground now. Source: US National Weather Service. Follow official instructions.',
      ),
      tool('checkin', 'Record an I am OK check-in', "Check-in saved: I'm OK. Send MENU for options."),
    ],
  },
];
