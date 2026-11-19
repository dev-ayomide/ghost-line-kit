/**
 * Pure planning: what request (if any) an action should send. The hook (task 11.2)
 * executes plans. Nothing here performs I/O or reads a clock.
 */
import type { SendRequest } from '../../shared/api';
import type { HandsetConfig } from '../config/handset-config';
import { parseUssd } from '../keypad/compose';
import { displayText } from '../keypad/multitap';
import type { HandsetAction, HandsetState } from './reducer';
import { selectCanMore, sliceOf } from './selectors';

export type Plan =
  | { kind: 'none' }
  | { kind: 'ussd'; request: SendRequest }
  | { kind: 'sms'; request: SendRequest }
  | { kind: 'unknown-code' }
  | { kind: 'error'; message: string };

/** Protocol keyword the kit understands. Not display copy. */
const MORE_KEYWORD = 'MORE';

const NONE: Plan = { kind: 'none' };

/** Deterministic id for the next USSD session, from the seed and a counter. */
export function nextSessionId(state: HandsetState): string {
  return `hs-${state.seed}-${state.sessionCount + 1}`;
}

function planDial(state: HandsetState, config: HandsetConfig): Plan {
  if (state.dial === '') return NONE;
  const parsed = parseUssd(state.dial);
  if (!parsed) return { kind: 'unknown-code' };
  const app = config.apps.find((a) => parseUssd(a.ussdCode)?.service === parsed.service);
  if (!app) return { kind: 'unknown-code' };
  const text = parsed.extension.length > 0 ? parsed.extension.join('*') : app.ussdOpenText;
  return {
    kind: 'ussd',
    request: {
      appId: app.id,
      from: config.fakeFrom,
      text,
      sessionId: nextSessionId(state),
      channel: 'ussd',
    },
  };
}

function planUssdReply(state: HandsetState, config: HandsetConfig): Plan {
  const u = sliceOf(state, state.activeApp).ussd;
  if (!u || u.ended || u.waiting || u.replyBuffer === '') return NONE;
  return {
    kind: 'ussd',
    request: {
      appId: state.activeApp,
      from: config.fakeFrom,
      text: u.replyBuffer,
      sessionId: u.sessionId,
      channel: 'ussd',
    },
  };
}

function planSend(state: HandsetState, config: HandsetConfig): Plan {
  const text = displayText(state.compose).trim();
  if (text === '') return NONE;
  if (!config.apps.some((a) => a.id === state.activeApp)) {
    return { kind: 'error', message: config.copy.errors.server };
  }
  return { kind: 'sms', request: { appId: state.activeApp, from: config.fakeFrom, text } };
}

/** What Call (or the left soft key on dial, USSD and compose screens) should send. */
export function planCall(state: HandsetState, config: HandsetConfig): Plan {
  if (state.busy || state.notice) return NONE;
  switch (state.screen) {
    case 'dial':
      return planDial(state, config);
    case 'ussd':
      return planUssdReply(state, config);
    case 'compose':
      return planSend(state, config);
    default:
      return NONE;
  }
}

/** The MORE soft key: sends 'MORE' when the viewed message ends with the hint. */
export function planMore(state: HandsetState, config: HandsetConfig): Plan {
  if (!selectCanMore(state, config)) return NONE;
  return {
    kind: 'sms',
    request: { appId: state.activeApp, from: config.fakeFrom, text: MORE_KEYWORD },
  };
}

/** The plan for any action: the hook calls this before dispatching the action. */
export function planForAction(
  state: HandsetState,
  action: HandsetAction,
  config: HandsetConfig,
): Plan {
  if (action.type === 'call') return planCall(state, config);
  if (action.type === 'softLeft') {
    return state.screen === 'message' ? planMore(state, config) : planCall(state, config);
  }
  return NONE;
}
