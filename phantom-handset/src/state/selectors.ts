/**
 * Pure selectors over HandsetState (design sections 7 and 9). No React, DOM, timers,
 * clock, randomness or I/O. All user-visible text comes from the Handset_Config.
 */
import type { HandsetTraceEvent } from '../../shared/api';
import type { HandsetConfig } from '../config/handset-config';
import { displayText } from '../keypad/multitap';
import { paginate, type Page } from '../lcd/paginate';
import { smsCount, type SmsLimits } from '../sms/counter';
import type { AppSlice, HandsetState, Msg, Screen } from './reducer';

export interface LcdView {
  /** Stable id of screen + page + body hash. The announcer speaks only when it changes. */
  key: string;
  title: string;
  body: string;
  pages: Page[];
  page: number;
  /** Only when there is more than one page, for example '2/4'. */
  position?: string;
  /** Present when the screen shows an input line (empty string = empty input line). */
  input?: string;
  softLeft: string;
  softRight: string;
  statusBar: { appName: string; unread: number; signal: number };
}

/** Full signal bars. The demo has no real radio, so this never varies. */
const SIGNAL_BARS = 4;

export const EMPTY_SLICE: AppSlice = { inbox: [], sent: [], unread: 0 };

export function sliceOf(state: HandsetState, appId: string): AppSlice {
  return state.apps[appId] ?? EMPTY_SLICE;
}

/** Messages of a box, newest first (the order lists show them in). */
export function boxMessages(state: HandsetState, box: 'inbox' | 'sent'): Msg[] {
  return [...sliceOf(state, state.activeApp)[box]].reverse();
}

/** The message open on the 'message' screen, if any. */
export function viewedMessage(state: HandsetState): Msg | undefined {
  if (state.openMessage === undefined) return undefined;
  const s = sliceOf(state, state.activeApp);
  return (
    s.inbox.find((m) => m.id === state.openMessage) ?? s.sent.find((m) => m.id === state.openMessage)
  );
}

function truncate(text: string, max: number): string {
  return Array.from(text)
    .slice(0, Math.max(1, max))
    .join('');
}

function msgLabel(msg: Msg, max: number): string {
  const firstLine = msg.text.split('\n').find((l) => l.trim() !== '') ?? '';
  const flat = firstLine.replace(/\s+/g, ' ').trim();
  const marker = msg.direction === 'in' && !msg.read ? '*' : '';
  return truncate(marker + flat, max);
}

/** Labels of the selectable rows of a list screen, or undefined on other screens. */
export function selectListItems(state: HandsetState, config: HandsetConfig): string[] | undefined {
  const m = config.copy.menus;
  const max = config.lcd.cols - 1;
  const on = (active: boolean): string => (active ? ' *' : '');
  switch (state.screen) {
    case 'home':
      return [m.homeItems.apps, m.homeItems.dial, m.homeItems.messages, m.homeItems.settings].map(
        (s) => truncate(s, max),
      );
    case 'apps':
      return config.apps.map((a) => truncate(a.name, max));
    case 'messages':
      return [m.messagesItems.inbox, m.messagesItems.sent, m.messagesItems.compose].map((s) =>
        truncate(s, max),
      );
    case 'inbox':
      return boxMessages(state, 'inbox').map((x) => msgLabel(x, max));
    case 'sent':
      return boxMessages(state, 'sent').map((x) => msgLabel(x, max));
    case 'settings':
      return [
        m.settingsItems.liveMode + on(state.mode === 'live'),
        m.settingsItems.scriptedMode + on(state.mode === 'scripted'),
        m.settingsItems.splitView + on(state.splitView),
        m.settingsItems.sound + on(state.soundOn),
        m.settingsItems.reset,
      ].map((s) => truncate(s, max));
    default:
      return undefined;
  }
}

function screenTitle(screen: Screen, config: HandsetConfig): string {
  const m = config.copy.menus;
  const titles: Record<Screen, string> = {
    home: m.homeTitle,
    apps: m.appsTitle,
    dial: m.dialTitle,
    ussd: m.ussdTitle,
    messages: m.messagesTitle,
    inbox: m.inboxTitle,
    message: m.messageTitle,
    compose: m.composeTitle,
    sent: m.sentTitle,
    settings: m.settingsTitle,
  };
  return titles[screen];
}

/** True when the viewed incoming message ends with the "Reply MORE" hint. */
export function selectCanMore(state: HandsetState, config: HandsetConfig): boolean {
  if (state.screen !== 'message' || state.busy || state.notice) return false;
  const msg = viewedMessage(state);
  if (!msg || msg.direction !== 'in') return false;
  const text = msg.text.replace(/[\s.!]+$/u, '');
  return text.endsWith(config.moreHint);
}

export function selectSmsCount(
  state: HandsetState,
  limits: SmsLimits,
): { chars: number; segments: number } {
  return smsCount(displayText(state.compose), limits);
}

/** The exchange whose trace the panel should highlight for what is on the LCD. */
export function selectTraceForView(state: HandsetState): {
  exchangeId?: string;
  events: HandsetTraceEvent[];
} {
  let id: string | undefined;
  if (!state.notice) {
    if (state.screen === 'message') {
      id = viewedMessage(state)?.exchangeId;
    } else if (state.screen === 'inbox' || state.screen === 'sent') {
      id = boxMessages(state, state.screen)[state.cursor]?.exchangeId;
    }
  }
  if (id === undefined) {
    for (let i = state.exchanges.length - 1; i >= 0; i--) {
      const ex = state.exchanges[i];
      if (ex && ex.appId === state.activeApp) {
        id = ex.id;
        break;
      }
    }
  }
  const ex = id === undefined ? undefined : state.exchanges.find((e) => e.id === id);
  return ex ? { exchangeId: ex.id, events: ex.trace } : { events: [] };
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

function chunkLines(lines: string[], rows: number): Page[] {
  const pages: Page[] = [];
  for (let i = 0; i < lines.length; i += rows) pages.push({ lines: lines.slice(i, i + rows) });
  return pages.length > 0 ? pages : [{ lines: [] }];
}

export function selectLcdView(state: HandsetState, config: HandsetConfig): LcdView {
  const m = config.copy.menus;
  const sk = config.copy.softKeys;
  const size = config.lcd;
  const slice = sliceOf(state, state.activeApp);
  const title = screenTitle(state.screen, config);

  let body = '';
  let input: string | undefined;
  let softLeft = '';
  let softRight = state.screen === 'home' ? '' : sk.back;
  let pages: Page[] | undefined;
  let page: number | undefined;

  const items = selectListItems(state, config);
  const u = slice.ussd;

  if (state.notice) {
    body = state.notice.text;
    softLeft = sk.ok;
    softRight = '';
  } else if (state.busy) {
    body = state.pending?.kind === 'sms' ? m.sending : m.busy;
    softRight = sk.end;
  } else if (items !== undefined) {
    softLeft = sk.select;
    let lines: string[];
    let cursor = 0;
    if (items.length === 0) {
      body = state.screen === 'sent' ? m.empty.sent : m.empty.inbox;
      lines = [];
    } else {
      cursor = clamp(state.cursor, 0, items.length - 1);
      lines = items.map((label, i) => (i === cursor ? '>' : ' ') + label);
      if (state.screen === 'settings' && state.fixtureErrors.length > 0) {
        const extra = [config.copy.errors.fixtureInvalid, ...state.fixtureErrors].join('\n');
        lines.push(...paginate(extra, size).flatMap((p) => p.lines));
      }
      body = lines.join('\n');
      pages = chunkLines(lines, size.rows);
      page = Math.floor(cursor / size.rows);
    }
    if (items.length === 0) softLeft = '';
  } else {
    switch (state.screen) {
      case 'dial':
        input = state.dial;
        softLeft = sk.call;
        softRight = state.dial === '' ? sk.back : sk.clear;
        break;
      case 'ussd':
        body = u?.text ?? '';
        if (u?.ended) {
          softLeft = sk.ok;
          softRight = '';
        } else {
          input = u?.replyBuffer ?? '';
          softLeft = sk.send;
          softRight = input === '' ? sk.end : sk.clear;
        }
        break;
      case 'message':
        body = viewedMessage(state)?.text ?? '';
        softLeft = selectCanMore(state, config) ? sk.more : '';
        break;
      case 'compose': {
        input = displayText(state.compose);
        softLeft = sk.send;
        softRight = input === '' ? sk.back : sk.clear;
        break;
      }
      default:
        break;
    }
  }

  const finalPages = pages ?? paginate(body, size);
  const finalPage = page ?? clamp(state.page, 0, finalPages.length - 1);
  const view: LcdView = {
    key: `${state.screen}${state.notice ? '!' : ''}:${finalPage}:${hash(body)}`,
    title,
    body,
    pages: finalPages,
    page: finalPage,
    softLeft,
    softRight,
    statusBar: {
      appName: config.apps.find((a) => a.id === state.activeApp)?.name ?? state.activeApp,
      unread: slice.unread,
      signal: SIGNAL_BARS,
    },
  };
  if (finalPages.length > 1) view.position = `${finalPage + 1}/${finalPages.length}`;
  if (input !== undefined) view.input = input;
  return view;
}
