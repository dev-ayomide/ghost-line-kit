import { useState } from 'react';
import type { LcdView } from '../state/selectors';

export interface AnnouncerProps {
  polite: string;
  alert: string;
}

/**
 * Two visually hidden live regions. The visible LCD is aria-hidden, so screen readers
 * hear each change once, from here. `alert` is for errors only.
 */
export function Announcer({ polite, alert }: AnnouncerProps) {
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert">
        {alert}
      </div>
    </>
  );
}

/** Title plus the lines of the current page, as one sentence-like string. */
export function announcementFor(view: LcdView): string {
  const lines = (view.pages[view.page]?.lines ?? []).map((l) => l.trim()).filter((l) => l !== '');
  return [view.title, ...lines].join('. ');
}

/**
 * The polite text for a view. It changes only when `view.key` changes, so a re-render
 * with the same content never re-announces it (R13.6).
 */
export function useAnnouncement(view: LcdView): string {
  const [state, setState] = useState(() => ({ key: view.key, text: announcementFor(view) }));
  if (state.key !== view.key) {
    setState({ key: view.key, text: announcementFor(view) });
  }
  return state.text;
}
