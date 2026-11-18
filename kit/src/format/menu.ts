import { LIMITS } from '../limits';

export interface MenuOption {
  label: string;
  value: string;
}

export interface MenuConfig {
  title: string;
  backLabel: string;
  menuLabel: string;
}

const DEFAULT_CONFIG: MenuConfig = { title: '', backLabel: 'Back', menuLabel: 'Menu' };

/** Minimum label room kept for the first option when the title has to be trimmed. */
const MIN_LABEL_ROOM = 20;

const ELLIPSIS = '...';

/** Collapse whitespace runs (including newlines) so words are the atomic units. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cut a string to `max` UTF-16 units without leaving half of a surrogate pair. */
function hardCut(text: string, max: number): string {
  if (max <= 0) return '';
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/**
 * Fit `text` into `max` chars. Whole text if it fits; otherwise as many whole words as
 * fit followed by "...". If not even the first word fits, that word is hard-cut.
 */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return hardCut(text, max);
  const room = max - ELLIPSIS.length;
  const words = text.split(' ');
  let out = '';
  for (const word of words) {
    const next = out === '' ? word : `${out} ${word}`;
    if (next.length > room) break;
    out = next;
  }
  if (out === '') out = hardCut(words[0] ?? '', room);
  return out + ELLIPSIS;
}

function resolve(config?: Partial<MenuConfig>): MenuConfig {
  return { ...DEFAULT_CONFIG, ...config };
}

function build(title: string, optionLines: string[], cfg: MenuConfig): string {
  const footer = [`0 ${normalise(cfg.backLabel)}`, `00 ${normalise(cfg.menuLabel)}`];
  return [...(title ? [title] : []), ...optionLines, ...footer].join('\n');
}

/**
 * Renders the screen starting at option index `offset`. Returns the text and how many
 * options it consumed (at least 1 when `offset` is in range, so callers always advance).
 */
function renderScreen(
  options: MenuOption[],
  offset: number,
  config?: Partial<MenuConfig>,
): { text: string; consumed: number } {
  const { screenHardCap, screenSoftTarget, maxOptionsPerScreen } = LIMITS.ussd;
  const cfg = resolve(config);
  let title = normalise(cfg.title);
  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;

  // Trim the title so at least one option keeps some room.
  if (title !== '') {
    const overhead = build('', ['1 '], cfg).length + 1; // +1 for the title's newline
    const maxTitle = screenHardCap - overhead - MIN_LABEL_ROOM;
    title = maxTitle > 0 ? truncateAtWord(title, maxTitle) : '';
  }

  if (start >= options.length) {
    return { text: build(title, [], cfg), consumed: 0 };
  }

  const lines: string[] = [];
  for (let i = start; i < options.length && lines.length < maxOptionsPerScreen; i++) {
    const label = normalise(options[i]?.label ?? '');
    const line = `${lines.length + 1} ${label}`;
    const first = lines.length === 0;
    const limit = first ? screenHardCap : screenSoftTarget;
    if (build(title, [...lines, line], cfg).length <= limit) {
      lines.push(line);
    } else if (first) {
      const room = screenHardCap - build(title, ['1 '], cfg).length;
      lines.push(`1 ${truncateAtWord(label, room)}`);
      break;
    } else {
      break;
    }
  }
  return { text: build(title, lines, cfg), consumed: lines.length };
}

/** Renders the single USSD screen that starts at option index `offset` (numbering restarts at 1). */
export function renderMenuScreen(
  options: MenuOption[],
  offset: number,
  config?: Partial<MenuConfig>,
): string {
  return renderScreen(options, offset, config).text;
}

/**
 * Renders every screen of a menu. An empty options array yields `[]` (nothing to show);
 * `renderMenuScreen` on an empty list still returns a title-plus-footer screen.
 */
export function renderMenuScreens(options: MenuOption[], config?: Partial<MenuConfig>): string[] {
  const screens: string[] = [];
  let offset = 0;
  while (offset < options.length) {
    const { text, consumed } = renderScreen(options, offset, config);
    screens.push(text);
    offset += Math.max(1, consumed);
  }
  return screens;
}
