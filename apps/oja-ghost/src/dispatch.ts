// dispatchDueReminders: sends each due reminder once, to its own Trader, over SMS.
// Order per reminder: subscription, debt balance, outbound rate limit, send, mark, write.
// Logging goes through the kit SafeLogger only: message ids, lengths and the (masked) phone.
import {
  formatReply,
  isSubscribed,
  type ChannelAdapter,
  type Clock,
  type RateLimiter,
  type SafeLogger,
  type Store,
} from '@ghostline/kit';
import { ojaConfig } from './app.config.ts';
import { fill, type Lang } from './copy.ts';
import { bookKey, langKey, remKey, REM_INDEX_KEY } from './keys.ts';
import { balanceOf, type Ledger } from './ledger.ts';
import { formatN } from './money.ts';
import { normaliseName } from './names.ts';
import { activeList, dueReminders, prune, type Reminder } from './reminders.ts';

export interface DispatchDeps {
  store: Store;
  sms: ChannelAdapter;
  clock: Clock;
  rateLimiter: RateLimiter;
  logger: SafeLogger;
}

export interface DispatchSummary {
  /** Reminders marked `sent`. */
  sent: number;
  /** Reminders marked `skipped` (not subscribed, or nothing owed any more). */
  skipped: number;
  /** Reminders that reached the final `failed` state in this run. */
  failed: number;
  /** Reminders left pending because the outbound rate limit was reached (one per phone per run). */
  deferred: number;
}

const MAX_ATTEMPTS = 3;

async function readIndex(store: Store): Promise<string[]> {
  const rec = await store.read<unknown>(REM_INDEX_KEY);
  return Array.isArray(rec) ? (rec as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

async function readLang(store: Store, phone: string): Promise<Lang> {
  const rec = await store.read<unknown>(langKey(phone));
  const lang = rec !== null && typeof rec === 'object' ? (rec as { lang?: unknown }).lang : undefined;
  return lang === 'pcm' ? 'pcm' : 'en';
}

/** The debtor's balance now, or undefined when the debtor (or the book) is missing. */
async function debtBalance(store: Store, phone: string, name: string): Promise<number | undefined> {
  const book = await store.read<Ledger>(bookKey(phone));
  if (book === undefined || book === null || typeof book !== 'object') return undefined;
  const debtors = (book as Ledger).debtors;
  if (debtors === undefined || debtors === null || typeof debtors !== 'object') return undefined;
  const key = normaliseName(name);
  const d = Object.hasOwn(debtors, key) ? debtors[key] : undefined;
  if (!d || !Array.isArray(d.entries)) return undefined;
  return balanceOf(d);
}

function buildText(r: Reminder, lang: Lang, balance: number | undefined): string {
  const c = ojaConfig.copy[lang];
  if (r.kind === 'debt') {
    return fill(c.reminderSmsDebt, { name: r.name, amount: formatN(balance ?? 0) });
  }
  if (r.amount === undefined) return fill(c.reminderSmsSupplierNoAmount, { name: r.name });
  return fill(c.reminderSmsSupplier, { name: r.name, amount: formatN(r.amount) });
}

function replace(list: Reminder[], next: Reminder): Reminder[] {
  return list.map((x) => (x.id === next.id ? next : x));
}

async function dispatchPhone(deps: DispatchDeps, phone: string, now: number, sum: DispatchSummary): Promise<void> {
  const { store, sms, rateLimiter, logger } = deps;
  const stored = await store.read<unknown>(remKey(phone));
  let list: Reminder[] = Array.isArray(stored) ? (stored as Reminder[]) : [];

  for (const due of dueReminders(list, now)) {
    let next: Reminder;

    if (!(await isSubscribed(store, phone))) {
      next = { ...due, status: 'skipped' };
      sum.skipped += 1;
    } else {
      const balance = due.kind === 'debt' ? await debtBalance(store, phone, due.name) : undefined;
      if (due.kind === 'debt' && (balance === undefined || balance <= 0)) {
        next = { ...due, status: 'skipped' };
        sum.skipped += 1;
      } else if (!(await rateLimiter.check(phone, 'outbound'))) {
        // Stays pending. Nothing is written: the reminder is unchanged.
        sum.deferred += 1;
        logger.info({ event: 'reminder_deferred', phoneNumber: phone });
        return;
      } else {
        const lang = await readLang(store, phone);
        const text = buildText(due, lang, balance);
        const reply = formatReply(text, {
          channel: 'sms',
          continueConversation: true,
          nextStep: ojaConfig.copy[lang].reminderNextStep,
        });
        let allOk = true;
        for (const segment of reply.segments) {
          try {
            const res = await sms.send({ to: phone, text: segment });
            if (res.ok) {
              logger.info({
                event: 'reminder_segment_sent',
                phoneNumber: phone,
                messageLength: segment.length,
                ...(res.messageId !== undefined ? { messageId: res.messageId } : {}),
              });
            } else {
              allOk = false;
              logger.error({ error: 'REMINDER_SEND_FAILED', phoneNumber: phone, messageLength: segment.length });
            }
          } catch {
            allOk = false;
            logger.error({ error: 'REMINDER_SEND_THREW', phoneNumber: phone, messageLength: segment.length });
          }
          if (!allOk) break;
        }
        if (allOk) {
          next = { ...due, status: 'sent' };
          sum.sent += 1;
        } else {
          const attempts = due.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            next = { ...due, attempts, status: 'failed' };
            sum.failed += 1;
          } else {
            next = { ...due, attempts };
          }
        }
      }
    }

    list = replace(list, next);
    await store.write(remKey(phone), prune(list, now));
  }

  if (activeList(list).length === 0) {
    const index = await readIndex(store);
    if (index.includes(phone)) await store.write(REM_INDEX_KEY, index.filter((p) => p !== phone));
  }
}

export async function dispatchDueReminders(deps: DispatchDeps): Promise<DispatchSummary> {
  const sum: DispatchSummary = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
  const now = deps.clock.now();
  const phones = await readIndex(deps.store);
  for (const phone of phones) {
    try {
      await dispatchPhone(deps, phone, now, sum);
    } catch {
      // One failing phone must not stop the others. The reminders stay as last written.
      deps.logger.error({ error: 'DISPATCH_PHONE_FAILED', phoneNumber: phone });
    }
  }
  return sum;
}
