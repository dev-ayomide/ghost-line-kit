import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ojaConfig } from '../src/app.config.ts';
import {
  activeList,
  cancelNth,
  createReminder,
  dueReminders,
  prune,
  type Reminder,
} from '../src/reminders.ts';
import { agoText, lagosDay, parseWhen } from '../src/when.ts';

const CFG = ojaConfig.limits;
const DAY = 86_400_000;

const genReminder: fc.Arbitrary<Reminder> = fc.record({
  id: fc.integer({ min: 1, max: 50 }),
  kind: fc.constantFrom('debt' as const, 'supplier' as const),
  name: fc.constantFrom('Bola', 'Chidi', 'Mama Ife'),
  dueAt: fc.integer({ min: 0, max: 1000 }),
  status: fc.constantFrom('pending' as const, 'sent' as const, 'skipped' as const, 'failed' as const, 'cancelled' as const),
  attempts: fc.integer({ min: 0, max: 3 }),
  createdAt: fc.integer({ min: 0, max: 1000 }),
});
const genList = fc.array(genReminder, { maxLength: 30 });
const byDueThenId = (a: Reminder, b: Reminder) => a.dueAt - b.dueAt || a.id - b.id;

// Feature: oja-ghost, Property 7: Due reminders are exactly the pending ones that are due
// **Validates: Requirements 12.6, 7.3, 7.4, 7.14**
describe('Property 7: dueReminders', () => {
  it('equals the pending, due reminders sorted by dueAt then id', () => {
    fc.assert(
      fc.property(genList, fc.integer({ min: -10, max: 1100 }), (list, now) => {
        const snapshot = structuredClone(list);
        const expected = list.filter((r) => r.status === 'pending' && r.dueAt <= now).sort(byDueThenId);
        expect(dueReminders(list, now)).toEqual(expected);
        expect(list).toEqual(snapshot);
      }),
    );
  });

  it('activeList is the pending reminders in due order, and does not mutate', () => {
    fc.assert(
      fc.property(genList, (list) => {
        const snapshot = structuredClone(list);
        expect(activeList(list)).toEqual(list.filter((r) => r.status === 'pending').sort(byDueThenId));
        expect(list).toEqual(snapshot);
      }),
    );
  });

  it('cancelNth cancels exactly the n-th active reminder and nothing else', () => {
    fc.assert(
      fc.property(genList, fc.integer({ min: -1, max: 35 }), (list, n) => {
        const snapshot = structuredClone(list);
        const active = activeList(list);
        const res = cancelNth(list, n);
        expect(list).toEqual(snapshot);
        if (n < 1 || n > active.length) {
          expect(res.ok).toBe(false);
          return;
        }
        if (!res.ok) throw new Error('expected ok');
        expect(res.list).toHaveLength(list.length);
        expect(activeList(res.list)).toHaveLength(active.length - 1);
        const changed = res.list.filter((r, i) => r !== list[i]);
        expect(changed).toHaveLength(1);
        expect(changed[0]?.status).toBe('cancelled');
      }),
    );
  });

  it('createReminder gives increasing ids, respects max and does not mutate', () => {
    fc.assert(
      fc.property(genList, fc.integer({ min: 1, max: 40 }), (list, max) => {
        const snapshot = structuredClone(list);
        const res = createReminder(list, { kind: 'debt', name: 'Bola', dueAt: 5 }, 100, max);
        expect(list).toEqual(snapshot);
        const pending = list.filter((r) => r.status === 'pending').length;
        if (pending >= max) {
          expect(res).toEqual({ ok: false, reason: 'too_many' });
          return;
        }
        if (!res.ok) throw new Error('expected ok');
        expect(res.reminder.id).toBe(Math.max(0, ...list.map((r) => r.id)) + 1);
        expect(res.reminder.status).toBe('pending');
        expect(res.list).toEqual([...list, res.reminder]);
      }),
    );
  });

  it('prune keeps pending reminders and recent ones, drops old final ones', () => {
    fc.assert(
      fc.property(genList, fc.integer({ min: 0, max: 40 * DAY }), (list, now) => {
        const kept = prune(list, now);
        for (const r of list) {
          const keep = r.status === 'pending' || r.dueAt >= now - 30 * DAY;
          expect(kept.includes(r)).toBe(keep);
        }
      }),
    );
  });
});

// Fixed instant: Friday 3 Jan 2025, 10:00 Lagos = 09:00 UTC.
const FRI = Date.UTC(2025, 0, 3, 9, 0);
const w = (s: string) => s.split(' ');
const ok = (ms: number) => ({ ok: true, dueAt: ms });

describe('parseWhen examples', () => {
  it('tomorrow is 08:00 Lagos the next day', () => {
    expect(parseWhen(w('tomorrow'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 4, 7, 0)));
  });

  it('a time after the date word sets the hour, and "on" and "at" are ignored', () => {
    expect(parseWhen(w('tomorrow 14:30'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 4, 13, 30)));
    expect(parseWhen(w('on tomorrow at 14:30'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 4, 13, 30)));
  });

  it('friday on a Friday means next week', () => {
    expect(parseWhen(w('friday'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 10, 7, 0)));
    expect(parseWhen(w('fri'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 10, 7, 0)));
    expect(parseWhen(w('monday'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 6, 7, 0)));
  });

  it('"in N days" and "after N days"', () => {
    expect(parseWhen(w('in 3 days'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 6, 7, 0)));
    expect(parseWhen(w('after 1 day'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 4, 7, 0)));
  });

  it('in 91 days is rejected (beyond 90 days)', () => {
    expect(parseWhen(w('in 91 days'), FRI, CFG)).toEqual({ ok: false });
    expect(parseWhen(w('in 400 days'), FRI, CFG)).toEqual({ ok: false });
  });

  it('a past time today is rejected, a later time today is accepted', () => {
    expect(parseWhen(w('today 09:00'), FRI, CFG)).toEqual({ ok: false });
    expect(parseWhen(w('today'), FRI, CFG)).toEqual({ ok: false }); // 08:00 has passed
    expect(parseWhen(w('today 11:30'), FRI, CFG)).toEqual(ok(Date.UTC(2025, 0, 3, 10, 30)));
  });

  it('a date that already passed this year means next year', () => {
    const now = Date.UTC(2025, 11, 20, 9, 0); // 20 Dec 2025
    // The task text says "15 dec after 15 Dec gives next year". With the 90-day limit that is
    // always more than a year away, so it is only reachable with a wider horizon (below).
    // "5 jan" shows the rollover inside the limit.
    expect(parseWhen(w('5 jan'), now, CFG)).toEqual(ok(Date.UTC(2026, 0, 5, 7, 0)));
    const afterDec15 = Date.UTC(2025, 11, 16, 9, 0);
    expect(parseWhen(w('15 dec'), afterDec15, { ...CFG, reminderHorizonDays: 400 })).toEqual(
      ok(Date.UTC(2026, 11, 15, 7, 0)),
    );
    expect(parseWhen(w('15 dec'), afterDec15, CFG)).toEqual({ ok: false });
    // Same day, time still ahead: this year.
    expect(parseWhen(w('15 dec 18:00'), Date.UTC(2025, 11, 15, 9, 0), CFG)).toEqual(ok(Date.UTC(2025, 11, 15, 17, 0)));
  });

  it('impossible dates and bad words are rejected', () => {
    for (const t of ['31 feb', '32 jan', '0 jan', 'tomorrow 25:00', 'tomorrow 10:75', 'soon', '', 'in days', 'next friday']) {
      expect(parseWhen(w(t).filter(Boolean), FRI, CFG), t).toEqual({ ok: false });
    }
  });

  it('29 Feb: rejected when neither this year nor next has it, accepted in a leap year', () => {
    expect(parseWhen(w('29 feb'), Date.UTC(2025, 11, 20, 9, 0), CFG)).toEqual({ ok: false });
    expect(parseWhen(w('29 feb'), Date.UTC(2027, 11, 20, 9, 0), CFG)).toEqual(ok(Date.UTC(2028, 1, 29, 7, 0)));
    expect(parseWhen(w('29 feb'), Date.UTC(2028, 0, 20, 9, 0), CFG)).toEqual(ok(Date.UTC(2028, 1, 29, 7, 0)));
  });

  it('result is always after now and within 90 days', () => {
    const forms = fc.constantFrom('today', 'tomorrow', 'monday', 'sat', '15 dec', '1 jan', 'in 5 days', 'after 89 days', 'in 90 days');
    const times = fc.constantFrom('', ' 00:00', ' 08:00', ' 23:59');
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) }), forms, times, (now, f, t) => {
        const r = parseWhen(w(f + t), now, CFG);
        if (r.ok) {
          expect(r.dueAt).toBeGreaterThan(now);
          expect(r.dueAt).toBeLessThanOrEqual(now + CFG.reminderHorizonDays * DAY);
        }
      }),
    );
  });
});

describe('lagosDay and agoText', () => {
  it('lagosDay uses UTC+1', () => {
    expect(lagosDay(Date.UTC(2025, 0, 3, 22, 59))).toBe('2025-01-03');
    expect(lagosDay(Date.UTC(2025, 0, 3, 23, 0))).toBe('2025-01-04');
  });

  it('agoText examples', () => {
    expect(agoText(10 * 60_000, 'en')).toBe('10 min ago');
    expect(agoText(2 * 3_600_000, 'en')).toBe('2 hours ago');
    expect(agoText(3_600_000, 'en')).toBe('1 hour ago');
    expect(agoText(DAY, 'pcm')).toBe('1 day ago');
    expect(agoText(30_000, 'en')).toBe('just now');
    expect(agoText(-5, 'en')).toBe('just now');
  });
});
