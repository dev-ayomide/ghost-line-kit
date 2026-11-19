import { handsetConfig } from '../config/handset-config';
import type { LcdView } from '../state/selectors';

export interface LcdProps {
  view: LcdView;
  busy: boolean;
}

const BLANK = ' ';

/** Last `max` code points, so the caret always stays visible on a long input. */
function tail(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(chars.length - max).join('');
}

/**
 * The visible LCD. It is `aria-hidden`: the Announcer carries the same text for
 * screen readers. All text is plain React text nodes, one div per line.
 */
export function Lcd({ view, busy }: LcdProps) {
  const { rows, cols } = handsetConfig.lcd;
  const copy = handsetConfig.copy.phone;
  const lines = view.pages[view.page]?.lines ?? [];
  const grid = Array.from({ length: rows }, (_, i) => lines[i] ?? '');
  const { appName, unread, signal } = view.statusBar;

  return (
    <div className="lcd-bezel">
      <div className="lcd" aria-hidden="true" data-busy={busy ? 'true' : 'false'}>
        <div className="lcd__status">
          <span className="lcd__signal" title={copy.signalLabel}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i < signal ? '' : 'is-off'} />
            ))}
          </span>
          {unread > 0 ? (
            <span className="lcd__mail">
              <svg viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="1" y="1" width="18" height="12" />
                <path d="M1 1l9 7 9-7" />
              </svg>
              <span>{`${copy.lcdUnread} ${unread}`}</span>
            </span>
          ) : null}
          <span className="lcd__app">{appName}</span>
        </div>

        <div className="lcd__title">
          <span>{view.title}</span>
          <span>{view.position ?? BLANK}</span>
        </div>

        <div className="lcd__grid">
          {grid.map((line, i) => (
            <div className="lcd__line" key={i}>
              {line === '' ? BLANK : line}
            </div>
          ))}
        </div>

        {view.input !== undefined ? (
          <div className="lcd__input">
            <span>{tail(view.input, cols - 1)}</span>
            <span className="lcd__caret" />
          </div>
        ) : null}

        <div className="lcd__softs">
          <span>{view.softLeft === '' ? BLANK : view.softLeft}</span>
          <span>{view.softRight === '' ? BLANK : view.softRight}</span>
        </div>
      </div>
    </div>
  );
}
