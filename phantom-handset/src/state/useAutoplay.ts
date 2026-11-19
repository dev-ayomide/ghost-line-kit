import { useCallback, useEffect, useRef, useState } from 'react';
import { handsetConfig } from '../config/handset-config';
import { keyForChar } from '../keypad/keymap';
import { parseUssd, type HandsetKey } from '../keypad/compose';
import type { Fixture } from '../fixtures/schema';
import type { HandsetState, Screen } from './reducer';
import type { ActAction } from './useHandset';

/** What a person does, without timestamps (the hook fills `at`). */
export type AutoplayAction =
  | { type: 'key'; key: HandsetKey }
  | { type: 'type'; char: string }
  | { type: 'call' }
  | { type: 'softLeft' }
  | { type: 'end' }
  | { type: 'openScreen'; screen: Screen };

export interface AutoplayStep {
  action: AutoplayAction;
  /** 'type': a key press, wait a short beat after. 'read': a request was sent, let the viewer read. */
  pause: 'type' | 'read' | 'none';
}

const step = (action: AutoplayAction, pause: AutoplayStep['pause'] = 'none'): AutoplayStep => ({
  action,
  pause,
});

function isDial(input: string): boolean {
  return parseUssd(input.trim()) !== undefined;
}

function dialKeys(code: string): AutoplayStep[] {
  const out: AutoplayStep[] = [];
  for (const c of code) {
    const key = keyForChar(c);
    if (key) out.push(step({ type: 'key', key }, 'type'));
  }
  return out;
}

/**
 * Turns fixture steps into the actions a person would perform. USSD: a dial is keys then
 * `call`; a menu choice is keys then `call` inside the open session (a dial is added first
 * if no session is open). SMS: open Compose, type each character, then `softLeft` to send.
 * Each dial or SMS starts from the home screen.
 */
export function buildAutoplayScript(fixture: Fixture): AutoplayStep[] {
  const out: AutoplayStep[] = [];
  const profile = handsetConfig.apps.find((a) => a.id === fixture.appId);
  let inSession = false;

  const toHome = (): void => {
    out.push(step({ type: 'end' }), step({ type: 'openScreen', screen: 'home' }));
    inSession = false;
  };

  for (const s of fixture.steps) {
    const input = s.when.input.trim();
    if (s.when.kind === 'ussd') {
      if (isDial(input)) {
        toHome();
        out.push(...dialKeys(input));
      } else {
        if (!inSession) {
          toHome();
          if (profile) out.push(...dialKeys(profile.ussdCode), step({ type: 'call' }, 'read'));
        }
        out.push(...dialKeys(input));
      }
      out.push(step({ type: 'call' }, 'read'));
      inSession = !s.replies.some((r) => r.endSession === true);
    } else {
      toHome();
      out.push(step({ type: 'openScreen', screen: 'compose' }));
      for (const char of s.when.input) out.push(step({ type: 'type', char }, 'type'));
      out.push(step({ type: 'softLeft' }, 'read'));
    }
  }
  return out;
}

const TYPE_DELAY_MS = 140;
const READ_DELAY_MS = 1200;

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        resolve();
      },
      { once: true },
    );
  });

export interface UseAutoplayOptions {
  act: (action: ActAction) => Promise<void>;
  getState: () => HandsetState;
  fixtures: Fixture[];
  reducedMotion: boolean;
}

export interface UseAutoplay {
  running: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  start: (fixtureId: string) => Promise<void>;
  stop: () => void;
}

export function useAutoplay(opts: UseAutoplayOptions): UseAutoplay {
  const [running, setRunning] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const speedRef = useRef(1);
  const latest = useRef(opts);
  latest.current = opts;
  const abortRef = useRef<AbortController | undefined>(undefined);

  const setSpeed = useCallback((v: number) => {
    const next = Number.isFinite(v) && v > 0 ? v : 1;
    speedRef.current = next;
    setSpeedState(next);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setRunning(false);
  }, []);

  const start = useCallback(
    async (fixtureId: string): Promise<void> => {
      abortRef.current?.abort();
      const fixture = latest.current.fixtures.find((f) => f.id === fixtureId);
      if (!fixture) return;
      const ctl = new AbortController();
      abortRef.current = ctl;
      setRunning(true);
      try {
        if (latest.current.getState().activeApp !== fixture.appId) {
          await latest.current.act({ type: 'selectApp', appId: fixture.appId });
        }
        for (const s of buildAutoplayScript(fixture)) {
          if (ctl.signal.aborted) return;
          await latest.current.act(s.action);
          if (ctl.signal.aborted || latest.current.reducedMotion || s.pause === 'none') continue;
          const base = s.pause === 'type' ? TYPE_DELAY_MS : READ_DELAY_MS;
          await defaultSleep(base / speedRef.current, ctl.signal);
        }
      } finally {
        if (abortRef.current === ctl) {
          abortRef.current = undefined;
          setRunning(false);
        }
      }
    },
    [],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return { running, speed, setSpeed, start, stop };
}
