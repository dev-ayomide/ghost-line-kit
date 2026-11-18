import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits';
import { TestClock } from '../src/session/clock';
import { SessionStateMachine } from '../src/session/session-state-machine';
import { MemoryStore } from '../src/store/memory-store';
import { StoreError, type Store } from '../src/store/store';

const T = LIMITS.ussd.sessionTimeoutMs;
const PHONE = '+2348012345678';

function setup() {
  const store = new MemoryStore();
  const clock = new TestClock(1_000);
  const machine = new SessionStateMachine({ store, clock });
  return { store, clock, machine };
}

describe('SessionStateMachine', () => {
  it('creates a new active session', async () => {
    const { machine, clock } = setup();
    const s = await machine.handleInbound(PHONE, 'ussd', { step: 1 });
    expect(s).toEqual({
      phoneNumber: PHONE,
      channel: 'ussd',
      conversationState: { step: 1 },
      lastInboundMs: clock.now(),
      status: 'active',
    });
    expect(await machine.getSession(PHONE, 'ussd')).toEqual(s);
  });

  it('inbound within the timeout stays active and updates state', async () => {
    const { machine, clock } = setup();
    await machine.handleInbound(PHONE, 'ussd', { step: 1 });
    clock.advance(T - 1);
    const s = await machine.handleInbound(PHONE, 'ussd', { step: 2 });
    expect(s.status).toBe('active');
    expect(s.conversationState).toEqual({ step: 2 });
    expect(s.lastInboundMs).toBe(clock.now());
  });

  it('reports timed-out at exactly the timeout, with preserved state', async () => {
    const { machine, clock } = setup();
    await machine.handleInbound(PHONE, 'ussd', { step: 1 });
    clock.advance(T - 1);
    expect((await machine.getSession(PHONE, 'ussd'))!.status).toBe('active');
    clock.advance(1);
    const s = await machine.getSession(PHONE, 'ussd');
    expect(s!.status).toBe('timed-out');
    expect(s!.conversationState).toEqual({ step: 1 });
  });

  it('persists the timed-out status', async () => {
    const { machine, clock, store } = setup();
    await machine.handleInbound(PHONE, 'ussd', 'a');
    clock.advance(T);
    await machine.getSession(PHONE, 'ussd');
    const raw = await store.read<{ status: string }>(`session:ussd:${PHONE}`);
    expect(raw!.status).toBe('timed-out');
  });

  it('resumes a timed-out session with the preserved state', async () => {
    const { machine, clock } = setup();
    await machine.handleInbound(PHONE, 'ussd', { step: 1 });
    clock.advance(T + 5_000);
    const s = await machine.handleInbound(PHONE, 'ussd', { step: 99 });
    expect(s.status).toBe('active');
    expect(s.conversationState).toEqual({ step: 1 });
    expect(s.lastInboundMs).toBe(clock.now());
  });

  it('resumes after getSession already marked it timed-out', async () => {
    const { machine, clock } = setup();
    await machine.handleInbound(PHONE, 'ussd', { step: 1 });
    clock.advance(T);
    await machine.getSession(PHONE, 'ussd');
    const s = await machine.handleInbound(PHONE, 'ussd', { step: 2 });
    expect(s.status).toBe('active');
    expect(s.conversationState).toEqual({ step: 1 });
  });

  it('endSession makes the session undefined and removes the key', async () => {
    const { machine, store } = setup();
    await machine.handleInbound(PHONE, 'ussd', 'x');
    await machine.endSession(PHONE, 'ussd');
    expect(await machine.getSession(PHONE, 'ussd')).toBeUndefined();
    expect(await store.read(`session:ussd:${PHONE}`)).toBeUndefined();
  });

  it('endSession on a missing session does not throw', async () => {
    const { machine } = setup();
    await expect(machine.endSession(PHONE, 'sms')).resolves.toBeUndefined();
  });

  it('isolates sessions per channel and per phone number', async () => {
    const { machine } = setup();
    await machine.handleInbound(PHONE, 'ussd', 'ussd-state');
    await machine.handleInbound(PHONE, 'sms', 'sms-state');
    await machine.handleInbound('+2348099999999', 'ussd', 'other-state');
    expect((await machine.getSession(PHONE, 'ussd'))!.conversationState).toBe('ussd-state');
    expect((await machine.getSession(PHONE, 'sms'))!.conversationState).toBe('sms-state');
    expect((await machine.getSession('+2348099999999', 'ussd'))!.conversationState).toBe('other-state');
    await machine.endSession(PHONE, 'ussd');
    expect(await machine.getSession(PHONE, 'sms')).toBeDefined();
    expect(await machine.getSession('+2348099999999', 'ussd')).toBeDefined();
  });

  it('honours a custom timeoutMs', async () => {
    const store = new MemoryStore();
    const clock = new TestClock(0);
    const machine = new SessionStateMachine({ store, clock, timeoutMs: 1_000 });
    await machine.handleInbound(PHONE, 'sms', 1);
    clock.advance(1_000);
    expect((await machine.getSession(PHONE, 'sms'))!.status).toBe('timed-out');
  });

  it('surfaces store failures without swallowing them', async () => {
    const failure = new StoreError('read', 'k');
    const failing: Store = {
      read: () => Promise.reject(failure),
      write: () => Promise.reject(failure),
      delete: () => Promise.reject(failure),
    };
    const machine = new SessionStateMachine({ store: failing, clock: new TestClock(0) });
    await expect(machine.handleInbound(PHONE, 'ussd', 1)).rejects.toBe(failure);
    await expect(machine.getSession(PHONE, 'ussd')).rejects.toBe(failure);
    await expect(machine.endSession(PHONE, 'ussd')).rejects.toBe(failure);
  });

  it('does not write when the read fails', async () => {
    const writes: string[] = [];
    const store: Store = {
      read: () => Promise.reject(new StoreError('read', 'k')),
      write: async (key) => {
        writes.push(key);
      },
      delete: async () => {},
    };
    const machine = new SessionStateMachine({ store, clock: new TestClock(0) });
    await expect(machine.handleInbound(PHONE, 'ussd', 1)).rejects.toBeInstanceOf(StoreError);
    expect(writes).toEqual([]);
  });
});
