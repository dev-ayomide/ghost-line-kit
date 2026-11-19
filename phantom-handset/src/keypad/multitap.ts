import type { HandsetKey } from './compose';

export interface MultiTapConfig {
  timeoutMs: number;
  letters: Readonly<Record<HandsetKey, string>>;
  maxLen?: number;
}

export interface MultiTapState {
  text: string;
  /**
   * `letter` is the character currently shown for `index`. It is stored so that
   * `commit` and `displayText` need no config.
   */
  pending?: { key: HandsetKey; index: number; at: number; letter: string };
}

export const initialMultiTap: MultiTapState = { text: '' };

/** Commit the pending letter (if any) into the text. */
export function commit(state: MultiTapState): MultiTapState {
  if (!state.pending) return state;
  return { text: state.text + state.pending.letter };
}

/** Text plus the pending letter, for rendering. */
export function displayText(state: MultiTapState): string {
  return state.text + (state.pending?.letter ?? '');
}

function hasRoom(state: MultiTapState, cfg: MultiTapConfig): boolean {
  return cfg.maxLen === undefined || displayText(state).length < cfg.maxLen;
}

export function step(
  state: MultiTapState,
  event: { key: HandsetKey; at: number },
  cfg: MultiTapConfig,
): MultiTapState {
  const { key, at } = event;

  if (key === 'clear') {
    if (state.pending) return { text: state.text };
    return { text: state.text.slice(0, -1) };
  }

  const letters = cfg.letters[key];
  if (letters.length === 0) return state;

  // Same key, still inside the timeout: advance through the letters.
  const p = state.pending;
  if (p && p.key === key && letters.length > 1 && at <= p.at + cfg.timeoutMs) {
    const index = (p.index + 1) % letters.length;
    return { text: state.text, pending: { key, index, at, letter: letters.charAt(index) } };
  }

  // Different key, or timed out: commit first, then start anew.
  const committed = commit(state);
  if (!hasRoom(committed, cfg)) return committed;

  if (letters.length === 1) {
    return { text: committed.text + letters };
  }
  return { text: committed.text, pending: { key, index: 0, at, letter: letters.charAt(0) } };
}
