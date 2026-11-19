import { useEffect } from 'react';
import type { HandsetAction, HandsetState } from './reducer';
import { sliceOf } from './selectors';

/** Pure: has a session that last saw input at `lastInputAt` expired at `now`? */
export function isSessionExpired(lastInputAt: number, now: number, timeoutMs: number): boolean {
  return now - lastInputAt >= timeoutMs;
}

/**
 * Arms one timeout while the active app has an open, idle USSD session. Every input changes
 * `lastInputAt`, which re-arms it. `timeoutMs` comes from the server config (never a constant);
 * without it, no timer runs.
 */
export function useSessionTimer(
  state: HandsetState,
  timeoutMs: number | undefined,
  dispatch: (action: HandsetAction) => void,
): void {
  const appId = state.activeApp;
  const u = sliceOf(state, appId).ussd;
  const armed = u !== undefined && !u.waiting && !u.ended && timeoutMs !== undefined;
  const sessionId = u?.sessionId;
  const lastInputAt = u?.lastInputAt;

  useEffect(() => {
    if (!armed || timeoutMs === undefined) return undefined;
    const id = setTimeout(() => dispatch({ type: 'ussd/timeout', appId }), timeoutMs);
    return () => clearTimeout(id);
  }, [armed, appId, sessionId, lastInputAt, timeoutMs, dispatch]);
}
