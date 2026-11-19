/**
 * Pure handset state (design section 7). No React, DOM, timers, clock, randomness or I/O.
 * Every timestamp arrives inside an action. Session ids come from `seed` and `sessionCount`.
 * Transport calls, the USSD timer and autoplay live in the hook (task 11.2), which runs
 * `planForAction(state, action, config)` before it dispatches the action.
 */
import type { HandsetTraceEvent, SendRequest, SendResponse } from '../../shared/api';
import type { HandsetConfig } from '../config/handset-config';
import { applyKey, type HandsetKey } from '../keypad/compose';
import { commit, displayText, initialMultiTap, step, type MultiTapState } from '../keypad/multitap';
import { isComposable } from '../sms/counter';
import { planCall } from './plan';
import { boxMessages, selectLcdView, selectListItems, sliceOf } from './selectors';

export type Screen =
  | 'home'
  | 'apps'
  | 'dial'
  | 'ussd'
  | 'messages'
  | 'inbox'
  | 'message'
  | 'compose'
  | 'sent'
  | 'settings';

export type Mode = 'live' | 'scripted';

export interface Msg {
  id: string;
  text: string;
  direction: 'in' | 'out';
  at: number;
  /** Incoming messages start unread. Outgoing ones are always read. */
  read: boolean;
  exchangeId?: string;
}

export interface UssdSession {
  sessionId: string;
  lastInputAt: number;
  replyBuffer: string;
  /** The last reply, shown as received (R5.8). */
  text: string;
  /** The server ended the session. The text stays up until any key is pressed. */
  ended?: boolean;
  /** A request is in flight. */
  waiting?: boolean;
}

/** One per App_Profile (R7.2). */
export interface AppSlice {
  inbox: Msg[];
  sent: Msg[];
  unread: number;
  ussd?: UssdSession;
}

export interface Exchange {
  id: string;
  appId: string;
  channel: 'web' | 'ussd';
  /** The text that was sent. */
  request: string;
  replies: string[];
  trace: HandsetTraceEvent[];
}

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export interface PendingRequest {
  kind: 'ussd' | 'sms';
  appId: string;
  exchangeId: string;
  text: string;
}

export interface HandsetState {
  mode: Mode;
  screen: Screen;
  activeApp: string;
  dial: string;
  compose: MultiTapState;
  page: number;
  cursor: number;
  apps: Record<string, AppSlice>;
  exchanges: Exchange[];
  busy: boolean;
  pending: PendingRequest | undefined;
  notice: Notice | undefined;
  /** The message open on the 'message' screen. */
  openMessage: string | undefined;
  splitView: boolean;
  soundOn: boolean;
  /** Session ids are `hs-${seed}-${n}`. `reset` bumps the seed. */
  seed: number;
  sessionCount: number;
  msgCount: number;
  /** Fixture load errors, shown on the Settings screen. */
  fixtureErrors: string[];
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

export type HandsetAction =
  | { type: 'key'; key: HandsetKey; at: number }
  | { type: 'type'; char: string; at: number }
  | { type: 'nav'; dir: NavDir }
  | { type: 'softLeft'; at: number }
  | { type: 'softRight'; at: number }
  | { type: 'call'; at: number }
  | { type: 'end' }
  | { type: 'selectApp'; appId: string }
  | { type: 'openScreen'; screen: Screen }
  | { type: 'ussd/sent'; appId: string; request: SendRequest; at: number }
  | { type: 'ussd/reply'; appId: string; response: SendResponse; at: number }
  | { type: 'ussd/timeout'; appId: string }
  | { type: 'ussd/error'; appId: string; message: string }
  | { type: 'sms/sent'; appId: string; request: SendRequest; at: number }
  /** `deleted` marks the reply to DELETE. It is also detected from the sent text. */
  | { type: 'sms/reply'; appId: string; response: SendResponse; at: number; deleted?: boolean }
  | { type: 'sms/error'; appId: string; message: string }
  | { type: 'setMode'; mode: Mode }
  | { type: 'toggleSplit' }
  | { type: 'toggleSound' }
  | { type: 'dismissNotice' }
  | { type: 'markRead'; appId?: string; msgId?: string }
  | { type: 'reset' };

export interface InitialStateOptions {
  mode?: Mode;
  seed?: number;
  splitView?: boolean;
  soundOn?: boolean;
  fixtureErrors?: string[];
  activeApp?: string;
}

export function initialState(config: HandsetConfig, opts: InitialStateOptions = {}): HandsetState {
  const apps: Record<string, AppSlice> = {};
  for (const a of config.apps) apps[a.id] = { inbox: [], sent: [], unread: 0 };
  return {
    mode: opts.mode ?? 'live',
    screen: 'home',
    activeApp: opts.activeApp ?? config.apps[0]?.id ?? '',
    dial: '',
    compose: initialMultiTap,
    page: 0,
    cursor: 0,
    apps,
    exchanges: [],
    busy: false,
    pending: undefined,
    notice: undefined,
    openMessage: undefined,
    splitView: opts.splitView ?? false,
    soundOn: opts.soundOn ?? false,
    seed: opts.seed ?? 1,
    sessionCount: 0,
    msgCount: 0,
    fixtureErrors: opts.fixtureErrors ?? [],
  };
}

// ---------------------------------------------------------------- helpers

function withApp(
  state: HandsetState,
  appId: string,
  f: (s: AppSlice) => AppSlice,
): HandsetState {
  return { ...state, apps: { ...state.apps, [appId]: f(sliceOf(state, appId)) } };
}

function clearUssd(state: HandsetState, appId: string): HandsetState {
  if (!sliceOf(state, appId).ussd) return state;
  return withApp(state, appId, (s) => {
    const { ussd: _gone, ...rest } = s;
    return rest;
  });
}

function go(state: HandsetState, screen: Screen): HandsetState {
  return {
    ...state,
    screen,
    cursor: 0,
    page: 0,
    dial: '',
    openMessage: undefined,
  };
}

function withNotice(state: HandsetState, kind: Notice['kind'], text: string): HandsetState {
  return { ...state, notice: { kind, text }, page: 0 };
}

function countUnread(inbox: readonly Msg[]): number {
  return inbox.filter((m) => !m.read).length;
}

function updateExchange(
  state: HandsetState,
  id: string,
  f: (e: Exchange) => Exchange,
): HandsetState {
  return { ...state, exchanges: state.exchanges.map((e) => (e.id === id ? f(e) : e)) };
}

function openExchange(
  state: HandsetState,
  appId: string,
  channel: 'web' | 'ussd',
  text: string,
): [HandsetState, string] {
  const id = `e${state.exchanges.length + 1}`;
  const ex: Exchange = { id, appId, channel, request: text, replies: [], trace: [] };
  return [{ ...state, exchanges: [...state.exchanges, ex] }, id];
}

function pageCount(state: HandsetState, config: HandsetConfig): number {
  return selectLcdView(state, config).pages.length;
}

function movePage(state: HandsetState, delta: number, config: HandsetConfig): HandsetState {
  const last = pageCount(state, config) - 1;
  const page = Math.min(Math.max(state.page + delta, 0), Math.max(0, last));
  return page === state.page ? state : { ...state, page };
}

function backTo(state: HandsetState): HandsetState {
  switch (state.screen) {
    case 'apps':
    case 'messages':
    case 'settings':
      return go(state, 'home');
    case 'dial':
      return go(state, 'home');
    case 'inbox':
    case 'sent':
      return go(state, 'messages');
    case 'compose':
      return go(state, 'messages');
    case 'message': {
      const box = sliceOf(state, state.activeApp).sent.some((m) => m.id === state.openMessage)
        ? 'sent'
        : 'inbox';
      // Keep the cursor so the list shows the same row.
      return { ...state, screen: box, openMessage: undefined, page: 0 };
    }
    default:
      return state;
  }
}

/** End: ends any open USSD session for the active app and returns home (R5.6). */
function endAll(state: HandsetState): HandsetState {
  const s = clearUssd(state, state.activeApp);
  return { ...go(s, 'home'), notice: undefined };
}

function cancelBusy(state: HandsetState): HandsetState {
  let s = state;
  if (s.pending?.kind === 'ussd') s = clearUssd(s, s.pending.appId);
  return endAll({ ...s, busy: false, pending: undefined });
}

// ---------------------------------------------------------------- input

function pressKey(
  state: HandsetState,
  key: HandsetKey,
  at: number,
  config: HandsetConfig,
): HandsetState {
  switch (state.screen) {
    case 'home':
      if (key === 'clear') return state;
      return {
        ...go(state, 'dial'),
        dial: applyKey('', key, config.dialMaxLen),
      };
    case 'dial':
      if (key === 'clear' && state.dial === '') return go(state, 'home');
      return { ...state, dial: applyKey(state.dial, key, config.dialMaxLen) };
    case 'ussd': {
      const u = sliceOf(state, state.activeApp).ussd;
      if (!u || u.waiting) return state;
      return withApp(state, state.activeApp, (s) => ({
        ...s,
        ussd: {
          ...u,
          replyBuffer: applyKey(u.replyBuffer, key, config.dialMaxLen),
          lastInputAt: at,
        },
      }));
    }
    case 'compose':
      return {
        ...state,
        compose: step(
          state.compose,
          { key, at },
          { timeoutMs: config.multitap.timeoutMs, letters: config.multitap.letters },
        ),
      };
    default:
      return state;
  }
}

function navigate(state: HandsetState, dir: NavDir, config: HandsetConfig): HandsetState {
  const delta = dir === 'up' || dir === 'left' ? -1 : 1;
  if (state.notice) return movePage(state, delta, config);
  const items = selectListItems(state, config);
  if (items !== undefined) {
    if (dir === 'left' || dir === 'right' || items.length === 0) return state;
    const cursor = Math.min(Math.max(state.cursor + delta, 0), items.length - 1);
    return cursor === state.cursor ? state : { ...state, cursor };
  }
  if (state.screen === 'ussd' || state.screen === 'message') return movePage(state, delta, config);
  return state;
}

function markMessageRead(state: HandsetState, appId: string, msgId?: string): HandsetState {
  return withApp(state, appId, (s) => {
    const inbox = s.inbox.map((m) => (msgId === undefined || m.id === msgId ? { ...m, read: true } : m));
    return { ...s, inbox, unread: countUnread(inbox) };
  });
}

/** Select the highlighted row of a list screen (Call or the left soft key). */
function select(state: HandsetState, config: HandsetConfig): HandsetState {
  const c = state.cursor;
  switch (state.screen) {
    case 'home': {
      const target = (['apps', 'dial', 'messages', 'settings'] as const)[c];
      return target ? go(state, target) : state;
    }
    case 'apps': {
      const app = config.apps[c];
      return app ? selectApp(state, app.id, config) : state;
    }
    case 'messages': {
      const target = (['inbox', 'sent', 'compose'] as const)[c];
      return target ? go(state, target) : state;
    }
    case 'inbox':
    case 'sent': {
      const msg = boxMessages(state, state.screen)[c];
      if (!msg) return state;
      const opened = { ...state, screen: 'message' as const, openMessage: msg.id, page: 0 };
      return state.screen === 'inbox' ? markMessageRead(opened, state.activeApp, msg.id) : opened;
    }
    case 'settings':
      switch (c) {
        case 0:
          return setMode(state, 'live');
        case 1:
          return setMode(state, 'scripted');
        case 2:
          return { ...state, splitView: !state.splitView };
        case 3:
          return { ...state, soundOn: !state.soundOn };
        case 4:
          return resetState(state, config);
        default:
          return state;
      }
    default:
      return state;
  }
}

function primary(state: HandsetState, config: HandsetConfig): HandsetState {
  switch (state.screen) {
    case 'dial': {
      const plan = planCall(state, config);
      if (plan.kind === 'unknown-code') return withNotice(state, 'error', config.copy.errors.unknownCode);
      if (plan.kind === 'error') return withNotice(state, 'error', plan.message);
      return state; // the hook runs the plan, then dispatches `ussd/sent`
    }
    case 'ussd':
    case 'compose':
    case 'message':
      return state;
    default:
      return select(state, config);
  }
}

function secondary(state: HandsetState, at: number, config: HandsetConfig): HandsetState {
  switch (state.screen) {
    case 'home':
      return state;
    case 'dial':
      return state.dial === '' ? backTo(state) : { ...state, dial: applyKey(state.dial, 'clear', 0) };
    case 'ussd': {
      const u = sliceOf(state, state.activeApp).ussd;
      if (u && u.replyBuffer !== '') return pressKey(state, 'clear', at, config);
      return endAll(state);
    }
    case 'compose':
      return displayText(state.compose) === ''
        ? backTo(state)
        : pressKey(state, 'clear', at, config);
    default:
      return backTo(state);
  }
}

function onInput(
  state: HandsetState,
  action: Extract<
    HandsetAction,
    { type: 'key' | 'type' | 'nav' | 'softLeft' | 'softRight' | 'call' | 'end' }
  >,
  config: HandsetConfig,
): HandsetState {
  if (state.busy) return action.type === 'end' ? cancelBusy(state) : state;

  if (state.notice) {
    if (action.type === 'nav') return navigate(state, action.dir, config);
    return { ...state, notice: undefined, page: 0 };
  }

  // A reply that ended the session stays up. Any key (except paging) returns home (R5.4).
  const u = sliceOf(state, state.activeApp).ussd;
  if (state.screen === 'ussd' && u?.ended && action.type !== 'nav') return endAll(state);

  switch (action.type) {
    case 'key':
      return pressKey(state, action.key, action.at, config);
    case 'type':
      if (state.screen !== 'compose' || !isComposable(action.char)) return state;
      return { ...state, compose: { text: commit(state.compose).text + action.char } };
    case 'nav':
      return navigate(state, action.dir, config);
    case 'call':
    case 'softLeft':
      return primary(state, config);
    case 'softRight':
      return secondary(state, action.at, config);
    case 'end':
      return endAll(state);
  }
}

// ---------------------------------------------------------------- app, mode, reset

function selectApp(state: HandsetState, appId: string, config: HandsetConfig): HandsetState {
  if (state.busy || !config.apps.some((a) => a.id === appId)) return state;
  return { ...go(state, 'home'), activeApp: appId, notice: undefined };
}

function setMode(state: HandsetState, mode: Mode): HandsetState {
  if (mode === state.mode) return state;
  // A session belongs to one transport, so switching drops all open sessions.
  const apps: Record<string, AppSlice> = {};
  for (const [id, s] of Object.entries(state.apps)) {
    const { ussd: _gone, ...rest } = s;
    apps[id] = rest;
  }
  const screen = state.screen === 'ussd' ? 'home' : state.screen;
  return { ...state, mode, apps, screen, busy: false, pending: undefined };
}

function resetState(state: HandsetState, config: HandsetConfig): HandsetState {
  return initialState(config, {
    mode: state.mode,
    seed: state.seed + 1,
    splitView: state.splitView,
    soundOn: state.soundOn,
    fixtureErrors: state.fixtureErrors,
    activeApp: config.apps[0]?.id ?? state.activeApp,
  });
}

// ---------------------------------------------------------------- request lifecycle

function ussdSent(
  state: HandsetState,
  a: Extract<HandsetAction, { type: 'ussd/sent' }>,
): HandsetState {
  const prev = sliceOf(state, a.appId).ussd;
  const sessionId = a.request.sessionId ?? `hs-${state.seed}-${state.sessionCount + 1}`;
  const isNew = !prev || prev.sessionId !== sessionId;
  const [s1, exchangeId] = openExchange(state, a.appId, 'ussd', a.request.text);
  const s2 = withApp(s1, a.appId, (s) => ({
    ...s,
    ussd: {
      sessionId,
      lastInputAt: a.at,
      replyBuffer: '',
      text: prev && !isNew ? prev.text : '',
      waiting: true,
    },
  }));
  return {
    ...s2,
    activeApp: a.appId,
    screen: 'ussd',
    busy: true,
    pending: { kind: 'ussd', appId: a.appId, exchangeId, text: a.request.text },
    sessionCount: state.sessionCount + (isNew ? 1 : 0),
    notice: undefined,
    page: 0,
  };
}

function ussdReply(
  state: HandsetState,
  a: Extract<HandsetAction, { type: 'ussd/reply' }>,
): HandsetState {
  const p = state.pending;
  const prev = sliceOf(state, a.appId).ussd;
  if (!p || p.kind !== 'ussd' || p.appId !== a.appId || !prev) return state;
  const texts = a.response.messages.map((m) => m.text);
  const ended = a.response.messages.some((m) => m.endSession === true);
  const s1 = updateExchange(state, p.exchangeId, (e) => ({
    ...e,
    replies: texts,
    trace: a.response.trace,
  }));
  const s2 = withApp(s1, a.appId, (s) => ({
    ...s,
    ussd: {
      sessionId: prev.sessionId,
      lastInputAt: a.at,
      replyBuffer: '',
      text: texts.join('\n'),
      ...(ended ? { ended: true } : {}),
    },
  }));
  return { ...s2, busy: false, pending: undefined, dial: '', page: 0, cursor: 0 };
}

function ussdTimeout(state: HandsetState, appId: string, config: HandsetConfig): HandsetState {
  let s = clearUssd(state, appId);
  if (s.pending?.kind === 'ussd' && s.pending.appId === appId) {
    s = { ...s, busy: false, pending: undefined };
  }
  if (appId !== s.activeApp) return s;
  const home = s.screen === 'ussd' ? go(s, 'home') : s;
  return withNotice(home, 'info', config.copy.errors.sessionEnded);
}

function ussdError(state: HandsetState, appId: string, message: string): HandsetState {
  const u = sliceOf(state, appId).ussd;
  let s: HandsetState = { ...state, busy: false, pending: undefined };
  let screen = s.screen;
  if (u && u.text === '') {
    // The first request of a session failed: back to the dial screen, buffer kept.
    s = clearUssd(s, appId);
    if (screen === 'ussd') screen = 'dial';
  } else if (u) {
    s = withApp(s, appId, (x) => {
      const { waiting: _w, ...rest } = u;
      return { ...x, ussd: rest };
    });
  }
  return withNotice({ ...s, screen }, 'error', message);
}

function smsSent(
  state: HandsetState,
  a: Extract<HandsetAction, { type: 'sms/sent' }>,
): HandsetState {
  const [s1, exchangeId] = openExchange(state, a.appId, 'web', a.request.text);
  const msg: Msg = {
    id: `m${state.msgCount + 1}`,
    text: a.request.text,
    direction: 'out',
    at: a.at,
    read: true,
    exchangeId,
  };
  const s2 = withApp(s1, a.appId, (s) => ({ ...s, sent: [...s.sent, msg] }));
  return {
    ...s2,
    msgCount: state.msgCount + 1,
    busy: true,
    pending: { kind: 'sms', appId: a.appId, exchangeId, text: a.request.text },
    notice: undefined,
  };
}

function smsReply(
  state: HandsetState,
  a: Extract<HandsetAction, { type: 'sms/reply' }>,
  config: HandsetConfig,
): HandsetState {
  const p = state.pending;
  if (!p || p.kind !== 'sms' || p.appId !== a.appId) return state;
  const texts = a.response.messages.map((m) => m.text);
  const s1 = updateExchange(state, p.exchangeId, (e) => ({
    ...e,
    replies: texts,
    trace: a.response.trace,
  }));
  const cleared: HandsetState = { ...s1, busy: false, pending: undefined };

  const isDelete = a.deleted === true || p.text.trim().toUpperCase() === 'DELETE';
  if (isDelete) {
    // R16.6: erase this app's Inbox and Sent, and its older exchanges. The reply is
    // shown as a notice instead of being stored.
    const s2 = withApp(cleared, a.appId, (s) => ({ ...s, inbox: [], sent: [], unread: 0 }));
    const s3: HandsetState = {
      ...s2,
      exchanges: s2.exchanges.filter((e) => e.appId !== a.appId || e.id === p.exchangeId),
      compose: initialMultiTap,
    };
    if (a.appId !== s3.activeApp) return s3;
    return withNotice({ ...go(s3, 'messages') }, 'info', texts.join('\n'));
  }

  let n = state.msgCount;
  const incoming: Msg[] = texts.map((text) => {
    n += 1;
    return { id: `m${n}`, text, direction: 'in', at: a.at, read: false, exchangeId: p.exchangeId };
  });
  const s2 = withApp(cleared, a.appId, (s) => {
    const inbox = [...s.inbox, ...incoming];
    return { ...s, inbox, unread: countUnread(inbox) };
  });
  const s3: HandsetState = { ...s2, msgCount: n };
  if (a.appId !== s3.activeApp || incoming.length === 0) return s3;
  const fromCompose = s3.screen === 'compose';
  const shown = { ...go(s3, 'inbox'), compose: fromCompose ? initialMultiTap : s3.compose };
  return withNotice(shown, 'info', config.copy.menus.newMessage);
}

function smsError(state: HandsetState, appId: string, message: string): HandsetState {
  const p = state.pending;
  let s: HandsetState = { ...state, busy: false, pending: undefined };
  if (p && p.kind === 'sms') {
    // The send failed, so it is not shown as sent. The draft stays on Compose.
    s = withApp(s, p.appId, (x) => ({
      ...x,
      sent: x.sent.filter((m) => m.exchangeId !== p.exchangeId),
    }));
  }
  void appId;
  return withNotice(s, 'error', message);
}

// ---------------------------------------------------------------- reducer

export function reduce(
  state: HandsetState,
  action: HandsetAction,
  config: HandsetConfig,
): HandsetState {
  switch (action.type) {
    case 'key':
    case 'type':
    case 'nav':
    case 'softLeft':
    case 'softRight':
    case 'call':
    case 'end':
      return onInput(state, action, config);
    case 'selectApp':
      return selectApp(state, action.appId, config);
    case 'openScreen': {
      if (action.screen === 'message') return state;
      if (action.screen === 'ussd' && !sliceOf(state, state.activeApp).ussd) return state;
      return { ...go(state, action.screen), notice: undefined };
    }
    case 'ussd/sent':
      return ussdSent(state, action);
    case 'ussd/reply':
      return ussdReply(state, action);
    case 'ussd/timeout':
      return ussdTimeout(state, action.appId, config);
    case 'ussd/error':
      return ussdError(state, action.appId, action.message);
    case 'sms/sent':
      return smsSent(state, action);
    case 'sms/reply':
      return smsReply(state, action, config);
    case 'sms/error':
      return smsError(state, action.appId, action.message);
    case 'setMode':
      return setMode(state, action.mode);
    case 'toggleSplit':
      return { ...state, splitView: !state.splitView };
    case 'toggleSound':
      return { ...state, soundOn: !state.soundOn };
    case 'dismissNotice':
      return state.notice ? { ...state, notice: undefined, page: 0 } : state;
    case 'markRead':
      return markMessageRead(state, action.appId ?? state.activeApp, action.msgId);
    case 'reset':
      return resetState(state, config);
  }
}
