import type { MouseEvent } from 'react';
import { handsetConfig } from '../config/handset-config';

/** First focusable element on the page. Moves focus to the phone (`#phone`). */
export function SkipLink() {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    document.getElementById('phone')?.focus();
  };
  return (
    <a className="skip-link" href="#phone" onClick={onClick}>
      {handsetConfig.copy.keyboardHelp.skipToPhone}
    </a>
  );
}
