import { useEffect, useMemo, useRef } from 'react';
import { handsetConfig } from '../config/handset-config';
import type { HandsetKey } from '../keypad/compose';
import { paginate } from '../lcd/paginate';
import { selectSmsCount, type LcdView } from '../state/selectors';
import type { UseHandset } from '../state/useHandset';
import { useAnnouncement } from './Announcer';
import { createBeeper } from './beep';
import { KeyboardHelp, KeyboardHelpButton, useKeyboardHelp } from './KeyboardHelp';
import { Phone, type NavDirection } from './Phone';
import { useKeyboard } from './useKeyboard';

const { copy } = handsetConfig;

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k] ?? ''));
}

/**
 * Connects the presentational Phone to the handset state. The caller owns `useHandset()`, so
 * the Stage can share the same state with the trace panel and Autoplay. Plain text only.
 */
export function PhoneContainer({ handset }: { handset: UseHandset }) {
  const { state, view, serverConfig, configError, act, switchMode, lastError } = handset;
  const help = useKeyboardHelp();
  const beeper = useMemo(createBeeper, []);

  const scripted = state.mode === 'scripted';
  const composing = state.screen === 'compose';
  const offline = lastError?.kind === 'offline';
  // The offline notice offers a way out on the right soft key (R9.3).
  const offlineNotice = state.notice?.kind === 'error' && offline && !scripted;

  const press = {
    key: (key: HandsetKey) => {
      beeper.unlock();
      void act({ type: 'key', key });
    },
    type: (char: string) => {
      beeper.unlock();
      void act({ type: 'type', char });
    },
    nav: (dir: NavDirection) => {
      beeper.unlock();
      void act({ type: 'nav', dir });
    },
    softLeft: () => {
      beeper.unlock();
      void act({ type: 'softLeft' });
    },
    softRight: () => {
      beeper.unlock();
      if (offlineNotice) {
        switchMode('scripted');
        void act({ type: 'dismissNotice' });
        return;
      }
      void act({ type: 'softRight' });
    },
    call: () => {
      beeper.unlock();
      void act({ type: 'call' });
    },
    end: () => {
      beeper.unlock();
      void act({ type: 'end' });
    },
    toggleSplit: () => void act({ type: 'toggleSplit' }),
  };

  useKeyboard(
    {
      onKey: press.key,
      onType: press.type,
      onNav: press.nav,
      onSoftLeft: press.softLeft,
      onSoftRight: press.softRight,
      onCall: press.call,
      onEnd: press.end,
      onToggleSplit: press.toggleSplit,
      onHelp: help.show,
    },
    { enabled: !help.open, literalTyping: composing },
  );

  // Sound: beep when the total unread count rises, and only if the user turned sound on.
  const unreadTotal = Object.values(state.apps).reduce((n, s) => n + s.unread, 0);
  const prevUnread = useRef(unreadTotal);
  useEffect(() => {
    if (unreadTotal > prevUnread.current && state.soundOn) beeper.beep();
    prevUnread.current = unreadTotal;
  }, [unreadTotal, state.soundOn, beeper]);

  // Announcements: LCD text is polite (it also carries info notices). Errors use the alert region.
  const announced = useAnnouncement(view);
  const errorNotice = state.notice?.kind === 'error' ? state.notice.text : '';
  const alertText = errorNotice !== '' ? errorNotice : (configError ?? '');
  const polite = errorNotice !== '' ? '' : announced;

  // What the LCD draws: the live counter on Compose and the offline soft key.
  const shown = useMemo<LcdView>(() => {
    let v = view;
    if (composing && !state.notice && !state.busy && serverConfig) {
      const { chars, segments } = selectSmsCount(state, serverConfig.limits.sms);
      const text = fill(copy.menus.counter, { chars, segments });
      v = { ...v, pages: paginate(text, handsetConfig.lcd), page: 0 };
    }
    if (offlineNotice) v = { ...v, softRight: copy.softKeys.scripted };
    return v;
  }, [view, composing, state, serverConfig, offlineNotice]);

  const items = copy.menus.settingsItems;
  return (
    <div className="handset">
      <Phone
        view={shown}
        scripted={scripted}
        busy={state.busy}
        onKey={press.key}
        onNav={press.nav}
        onSoftLeft={press.softLeft}
        onSoftRight={press.softRight}
        onCall={press.call}
        onEnd={press.end}
        announce={{ polite, alert: alertText }}
      />
      <div className="handset__tools" role="group" aria-label={copy.toolbar.label}>
        {offline || configError ? (
          <p className="handset__status">{lastError?.message ?? configError}</p>
        ) : null}
        {offline && !scripted ? (
          <button type="button" onClick={() => switchMode('scripted')}>
            {copy.toolbar.useScripted}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={scripted}
          onClick={() => switchMode(scripted ? 'live' : 'scripted')}
        >
          {copy.toolbar.scriptedMode}
        </button>
        <button
          type="button"
          aria-pressed={state.soundOn}
          onClick={() => {
            beeper.unlock();
            void act({ type: 'toggleSound' });
          }}
        >
          {copy.toolbar.sound}
        </button>
        <button type="button" onClick={() => void act({ type: 'reset' })}>
          {copy.toolbar.reset}
        </button>
        <KeyboardHelpButton onOpen={help.show} />
      </div>
      <KeyboardHelp open={help.open} onClose={help.close} />
    </div>
  );
}
