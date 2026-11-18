import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits';
import { TestClock } from '../src/session/clock';
import {
  SessionStateMachine,
  sessionTransition,
  type SessionState,
} from '../src/session/session-state-machine';
import { MemoryStore } from '../src/store/memory-store';

const T = LIMITS.ussd.sessionTimeoutMs;
const PHONE = '+2348012345678';

type Ev =
  | { kind: 'inbound'; state: unknown }
  | { kind: 'advance'; ms: number }
  | { kind: 'end' }
  | { kind: 'check' };

const jsonState = fc.jsonValue();
const advanceMs = fc.oneof(
  fc.integer({ min: 0, max: 300_000 }),
  fc.constantFrom(T - 1, T, T + 1),
);
const eventArb: fc.Arbitrary<Ev> = fc.oneof(
  jsonState.map((state): Ev => ({ kind: 'inbound', state })),
  advanceMs.map((ms): Ev => ({ kind: 'advance', ms })),
  fc.constant<Ev>({ kind: 'end' }),
  fc.constant<Ev>({ kind: 'check' }),
);

function run(events: Ev[]): void {
  const clock = new TestClock(1_000);
  let session: SessionState | undefined;
  // Independent model
  let model: { lastInboundMs: number; stateAtLastInbound: unknown } | undefined;

  for (const ev of events) {
    const now = clock.now();
    const input = session;
    const before = structuredClone(input);

    if (ev.kind === 'advance') {
      clock.advance(ev.ms);
    } else if (ev.kind === 'end') {
      session = sessionTransition(session, { type: 'end' }, now);
      model = undefined;
      expect(session).toBeUndefined(); // (c)
    } else if (ev.kind === 'check') {
      session = sessionTransition(session, { type: 'check' }, now);
    } else {
      const wasTimedOut = model !== undefined && now - model.lastInboundMs >= T;
      const next = sessionTransition(
        session,
        { type: 'inbound', conversationState: ev.state, phoneNumber: PHONE, channel: 'ussd' },
        now,
      );
      expect(next).toBeDefined();
      expect(next!.status).toBe('active');
      expect(next!.lastInboundMs).toBe(now); // (b)
      if (model === undefined) {
        expect(next!.conversationState).toEqual(ev.state);
        model = { lastInboundMs: now, stateAtLastInbound: ev.state };
      } else if (wasTimedOut) {
        // (b) resume with exactly the preserved state, not the new event state
        expect(next!.conversationState).toEqual(model.stateAtLastInbound);
        model = { lastInboundMs: now, stateAtLastInbound: model.stateAtLastInbound };
      } else {
        expect(next!.conversationState).toEqual(ev.state);
        model = { lastInboundMs: now, stateAtLastInbound: ev.state };
      }
      session = next;
    }

    // Purity: the input object is never mutated.
    expect(input).toEqual(before);

    // After EVERY event, apply a check (not persisted) and verify invariants.
    const nowAfter = clock.now();
    const snapshot = structuredClone(session);
    const checked = sessionTransition(session, { type: 'check' }, nowAfter);
    expect(session).toEqual(snapshot); // check did not mutate input
    if (model === undefined) {
      expect(checked).toBeUndefined(); // (c) stays undefined until a new inbound
    } else {
      expect(checked).toBeDefined();
      const elapsed = nowAfter - model.lastInboundMs;
      if (elapsed >= T) {
        expect(checked!.status).toBe('timed-out'); // (a)
        expect(checked!.status).not.toBe('active'); // (d)
      } else {
        expect(checked!.status).toBe('active');
      }
      expect(checked!.conversationState).toEqual(model.stateAtLastInbound);
      expect(checked!.lastInboundMs).toBe(model.lastInboundMs);
    }
  }
}

describe('session state machine properties', () => {
  // Feature: kit-core, Property 7: Session state machine correctness
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  it('Property 7: timeout, resume and end behave per the model for any event sequence', () => {
    fc.assert(fc.property(fc.array(eventArb, { maxLength: 40 }), run), { numRuns: 300 });
  });

  it('inbound does not mutate its input session', () => {
    fc.assert(
      fc.property(jsonState, jsonState, advanceMs, (s1, s2, ms) => {
        const created = sessionTransition(
          undefined,
          { type: 'inbound', conversationState: s1, phoneNumber: PHONE, channel: 'sms' },
          5,
        )!;
        const snap = structuredClone(created);
        sessionTransition(
          created,
          { type: 'inbound', conversationState: s2, phoneNumber: PHONE, channel: 'sms' },
          5 + ms,
        );
        expect(created).toEqual(snap);
      }),
    );
  });

  it('elapsed T-1 stays active, elapsed T times out', () => {
    const s = sessionTransition(
      undefined,
      { type: 'inbound', conversationState: { a: 1 }, phoneNumber: PHONE, channel: 'ussd' },
      0,
    );
    expect(sessionTransition(s, { type: 'check' }, T - 1)!.status).toBe('active');
    expect(sessionTransition(s, { type: 'check' }, T)!.status).toBe('timed-out');
  });
});

// Feature: kit-core, Property 7b: SessionStateMachine over MemoryStore matches the pure transition
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**
describe('SessionStateMachine class properties', () => {
  it('Property 7b: SessionStateMachine over MemoryStore matches the pure transition', async () => {
    // Round-trip through JSON so values equal what MemoryStore returns (e.g. no -0).
    const storable = fc.jsonValue().map((v) => JSON.parse(JSON.stringify(v)) as unknown);
    const events: fc.Arbitrary<Ev> = fc.oneof(
      storable.map((state): Ev => ({ kind: 'inbound', state })),
      advanceMs.map((ms): Ev => ({ kind: 'advance', ms })),
      fc.constant<Ev>({ kind: 'end' }),
      fc.constant<Ev>({ kind: 'check' }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(events, { maxLength: 30 }), async (evs) => {
        const clock = new TestClock(1_000);
        const machine = new SessionStateMachine({ store: new MemoryStore(), clock });
        let model: SessionState | undefined;

        for (const ev of evs) {
          const now = clock.now();
          if (ev.kind === 'advance') {
            clock.advance(ev.ms);
          } else if (ev.kind === 'end') {
            await machine.endSession(PHONE, 'ussd');
            model = sessionTransition(model, { type: 'end' }, now);
          } else if (ev.kind === 'check') {
            model = sessionTransition(model, { type: 'check' }, now);
            expect(await machine.getSession(PHONE, 'ussd')).toEqual(model);
          } else {
            model = sessionTransition(
              model,
              { type: 'inbound', conversationState: ev.state, phoneNumber: PHONE, channel: 'ussd' },
              now,
            );
            expect(await machine.handleInbound(PHONE, 'ussd', ev.state)).toEqual(model);
          }

          // Lazy timeout: whatever the class reports now matches the model's check, never stale-active.
          const expected = sessionTransition(model, { type: 'check' }, clock.now());
          const actual = await machine.getSession(PHONE, 'ussd');
          expect(actual).toEqual(expected);
          if (actual !== undefined && clock.now() - actual.lastInboundMs >= T) {
            expect(actual.status).not.toBe('active');
          }
          model = expected;
        }
      }),
      { numRuns: 200 },
    );
  });
});
