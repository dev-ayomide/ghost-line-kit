import { useEffect, useRef } from 'react';
import type { HandsetKey } from '../keypad/compose';
import { keyFromKeyboardEvent } from '../keypad/keymap';

export type NavDir = 'up' | 'down' | 'left' | 'right';

export type KeyIntent =
  | { kind: 'key'; key: HandsetKey }
  | { kind: 'type'; char: string }
  | { kind: 'call' }
  | { kind: 'end' }
  | { kind: 'nav'; dir: NavDir }
  | { kind: 'softLeft' }
  | { kind: 'softRight' }
  | { kind: 'toggleSplit' }
  | { kind: 'help' };

/** The parts of an event target the classifier reads. A DOM Element satisfies it. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?(selector: string): unknown;
}

export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: TargetLike | null;
}

export interface KeyContext {
  /** True on the Compose screen: printable characters are typed, not mapped to keypad keys. */
  literalTyping: boolean;
}

const NAV_KEYS: Readonly<Record<string, NavDir>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableOutsidePhone(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  const editable =
    (t.tagName !== undefined && EDITABLE_TAGS.has(t.tagName.toUpperCase())) || t.isContentEditable === true;
  if (!editable) return false;
  return !t.closest?.('#phone');
}

function isButton(t: TargetLike | null | undefined): boolean {
  return t?.tagName?.toUpperCase() === 'BUTTON';
}

/**
 * Pure mapping from a keyboard event to a phone action, or undefined when the event
 * must be left alone (browser shortcuts, text fields, native button activation).
 */
export function classifyKeyEvent(e: KeyEventLike, ctx: KeyContext): KeyIntent | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  if (isEditableOutsidePhone(e.target)) return undefined;
  // A focused button handles Enter and Space itself, so the global handler must not press twice.
  if (isButton(e.target) && (e.key === 'Enter' || e.key === ' ')) return undefined;

  const nav = NAV_KEYS[e.key];
  if (nav) return { kind: 'nav', dir: nav };

  switch (e.key) {
    case 'Enter':
      return { kind: 'call' };
    case 'Escape':
      return { kind: 'end' };
    case 'Backspace':
      return { kind: 'key', key: 'clear' };
    case 'F1':
      return { kind: 'softLeft' };
    case 'F2':
      return { kind: 'softRight' };
    case 'F4':
      return { kind: 'toggleSplit' };
    default:
      break;
  }

  if (ctx.literalTyping) {
    if (Array.from(e.key).length === 1) return { kind: 'type', char: e.key };
    return undefined;
  }

  if (e.key === '?') return { kind: 'help' };

  const key = keyFromKeyboardEvent(e);
  return key === undefined ? undefined : { kind: 'key', key };
}

export interface KeyboardHandlers {
  onKey(key: HandsetKey): void;
  onType(char: string): void;
  onNav(dir: NavDir): void;
  onSoftLeft(): void;
  onSoftRight(): void;
  onCall(): void;
  onEnd(): void;
  onToggleSplit(): void;
  onHelp(): void;
}

export interface UseKeyboardOptions {
  enabled: boolean;
  literalTyping?: boolean;
}

export function dispatchIntent(intent: KeyIntent, h: KeyboardHandlers): void {
  switch (intent.kind) {
    case 'key':
      return h.onKey(intent.key);
    case 'type':
      return h.onType(intent.char);
    case 'nav':
      return h.onNav(intent.dir);
    case 'call':
      return h.onCall();
    case 'end':
      return h.onEnd();
    case 'softLeft':
      return h.onSoftLeft();
    case 'softRight':
      return h.onSoftRight();
    case 'toggleSplit':
      return h.onToggleSplit();
    case 'help':
      return h.onHelp();
  }
}

/** One window `keydown` listener. preventDefault is called only for handled keys. */
export function useKeyboard(handlers: KeyboardHandlers, options: UseKeyboardOptions): void {
  const latest = useRef({ handlers, literalTyping: options.literalTyping ?? false });
  latest.current = { handlers, literalTyping: options.literalTyping ?? false };
  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const intent = classifyKeyEvent(
        { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target },
        { literalTyping: latest.current.literalTyping },
      );
      if (!intent) return;
      e.preventDefault();
      dispatchIntent(intent, latest.current.handlers);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
}
