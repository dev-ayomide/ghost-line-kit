import type { Ref } from 'react';
import { handsetConfig } from '../config/handset-config';
import type { HandsetKey } from '../keypad/compose';
import type { LcdView } from '../state/selectors';
import { Announcer } from './Announcer';
import { Keypad } from './Keypad';
import { Lcd } from './Lcd';
import { SoftKeys } from './SoftKeys';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

export interface PhoneProps {
  view: LcdView;
  /** True in scripted mode: adds the scripted label next to the demo label. */
  scripted: boolean;
  busy: boolean;
  onKey(key: HandsetKey): void;
  onNav(dir: NavDirection): void;
  onSoftLeft(): void;
  onSoftRight(): void;
  onCall(): void;
  onEnd(): void;
  announce: { polite: string; alert: string };
  phoneRef?: Ref<HTMLElement>;
}

const NAV: readonly NavDirection[] = ['up', 'left', 'right', 'down'];

function HandsetGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" />
    </svg>
  );
}

function EndGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9c-3 0-5.7.7-8 2.2a1.6 1.6 0 0 0-.5 2.1l1.2 1.9a1.2 1.2 0 0 0 1.6.4l2.3-1.2a1.2 1.2 0 0 0 .65-1.05V11.4a14 14 0 0 1 5.5 0v.95a1.2 1.2 0 0 0 .65 1.05l2.3 1.2a1.2 1.2 0 0 0 1.6-.4l1.2-1.9a1.6 1.6 0 0 0-.5-2.1C17.7 9.7 15 9 12 9z" />
    </svg>
  );
}

/** The candybar phone. Presentational only: all state lives in the parent. */
export function Phone({
  view,
  scripted,
  busy,
  onKey,
  onNav,
  onSoftLeft,
  onSoftRight,
  onCall,
  onEnd,
  announce,
  phoneRef,
}: PhoneProps) {
  const { copy } = handsetConfig;
  const names = copy.phone.navNames;

  return (
    <section
      id="phone"
      ref={phoneRef}
      tabIndex={-1}
      className="phone"
      aria-label={copy.phone.phoneLabel}
      aria-busy={busy}
    >
      <div className="phone__strip">
        <span>{copy.demoLabel}</span>
        {scripted ? <span className="phone__strip-scripted">{copy.scriptedLabel}</span> : null}
      </div>

      <div className="phone__top">
        <div className="phone__earpiece" aria-hidden="true" />
        <p className="phone__brand">{copy.phone.brand}</p>
      </div>

      <Lcd view={view} busy={busy} />

      <div className="phone__controls">
        <SoftKeys left={view.softLeft} right={view.softRight} onLeft={onSoftLeft} onRight={onSoftRight} />

        <div className="nav" role="group" aria-label={copy.phone.navLabel}>
          {NAV.map((dir) => (
            <button
              key={dir}
              type="button"
              className={`key nav__${dir}`}
              aria-label={names[dir]}
              onClick={() => onNav(dir)}
            >
              <span className={`key__arrow key__arrow--${dir}`} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="key nav__select" aria-label={names.select} onClick={onCall}>
            <span className="key__dot" aria-hidden="true" />
          </button>
        </div>

        <button type="button" className="key key--call" aria-label={copy.softKeys.call} onClick={onCall}>
          <span className="key__disc">
            <HandsetGlyph />
          </span>
        </button>
        <button type="button" className="key key--end" aria-label={copy.softKeys.end} onClick={onEnd}>
          <span className="key__disc">
            <EndGlyph />
          </span>
        </button>
      </div>

      <Keypad onKey={onKey} />

      <Announcer polite={announce.polite} alert={announce.alert} />
    </section>
  );
}
