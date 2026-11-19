import type { HandsetKey } from '../keypad/compose';
import type { LcdSize } from '../lcd/paginate';

/**
 * Handset_Config: every user-visible string, the LCD size, the multi-tap table
 * and the App_Profiles live here (R2.2, R7, R15).
 *
 * Rules for copy:
 * - Anything shown on the LCD (menus, errors, soft keys, hints) is short, plain,
 *   says what to do next, and has no spooky wording and no emoji.
 * - Halloween wording is allowed only in `copy.landing`.
 * - No stack traces or internal IDs in any message.
 */

export interface AppProfile {
  /** A string, so a third app is a config entry and needs no UI change. */
  id: 'oja-ghost' | 'blackout-line' | (string & {});
  name: string;
  /** Placeholder, confirm with the app specs. */
  ussdCode: string;
  /** Text sent when only the bare service code is dialled. */
  ussdOpenText: string;
  /** Placeholder, confirm with the app specs. */
  smsShortCode: string;
  tagline: string;
  /** Sample first message shown in "try this". */
  helloSms: string;
}

export interface HandsetConfig {
  lcd: LcdSize;
  dialMaxLen: number;
  multitap: { timeoutMs: number; letters: Record<HandsetKey, string> };
  fakeFrom: string;
  fakeFromMasked: string;
  moreHint: string;
  apps: readonly AppProfile[];
  copy: {
    demoLabel: string;
    scriptedLabel: string;
    errors: {
      offline: string;
      server: string;
      rejected: string;
      unknownCode: string;
      sessionEnded: string;
      rateLimited: string;
      fixtureInvalid: string;
      noMatch: string;
    };
    menus: {
      homeTitle: string;
      appsTitle: string;
      dialTitle: string;
      ussdTitle: string;
      messagesTitle: string;
      inboxTitle: string;
      messageTitle: string;
      composeTitle: string;
      sentTitle: string;
      settingsTitle: string;
      messagesItems: { inbox: string; sent: string; compose: string };
      homeItems: { apps: string; dial: string; messages: string; settings: string };
      settingsItems: { liveMode: string; scriptedMode: string; splitView: string; sound: string; reset: string };
      empty: { inbox: string; sent: string };
      busy: string;
      sending: string;
      newMessage: string;
    };
    softKeys: {
      select: string;
      back: string;
      menu: string;
      options: string;
      send: string;
      more: string;
      ok: string;
      reply: string;
      clear: string;
      call: string;
      end: string;
    };
    keyboardHelp: {
      title: string;
      close: string;
      openButton: string;
      skipToPhone: string;
      rows: readonly { keys: string; action: string }[];
      exceptionsTitle: string;
      exceptions: readonly string[];
    };
    landing: {
      title: string;
      pitch: string;
      tryIt: string;
      stats: { text: string; ownPercent: number; usePercent: number; source: string };
      graveyardTitle: string;
      epitaphs: readonly string[];
      whyTitle: string;
      cards: readonly { id: string; title: string; text: string }[];
      footer: {
        repoLabel: string;
        repoUrl: string;
        quickStartLabel: string;
        quickStartUrl: string;
        licenseNote: string;
      };
    };
    trace: {
      panelTitle: string;
      empty: string;
      splitToggle: string;
      activeMarker: string;
      eventTypes: { reasoning: string; tool_call: string; tool_result: string };
    };
  };
}

/** Repo URL from `git remote origin`. Change here if the repo moves. */
const REPO_URL = 'https://github.com/dev-ayomide/ghost-line-kit';

export const handsetConfig = {
  lcd: { rows: 6, cols: 16 },
  dialMaxLen: 40,
  multitap: {
    timeoutMs: 1000,
    // Standard keypad. Every character is GSM-7.
    letters: {
      '1': ".,?!'1",
      '2': 'abc2',
      '3': 'def3',
      '4': 'ghi4',
      '5': 'jkl5',
      '6': 'mno6',
      '7': 'pqrs7',
      '8': 'tuv8',
      '9': 'wxyz9',
      '0': ' 0',
      '*': '*',
      '#': '#',
      clear: '',
    },
  },
  // Not a real subscriber: Nigerian numbers have no leading 0 after +234.
  fakeFrom: '+2340000005678',
  fakeFromMasked: '+234******5678',
  moreHint: 'Reply MORE',

  apps: [
    {
      id: 'oja-ghost',
      name: 'Oja Ghost',
      // placeholder, confirm with the app specs
      ussdCode: '*384#',
      ussdOpenText: 'MENU',
      // placeholder, confirm with the app specs
      smsShortCode: '38400',
      tagline: 'Prices, your debt book and reminders.',
      helloSms: 'Hi',
    },
    {
      id: 'blackout-line',
      name: 'Blackout Line',
      // placeholder, confirm with the app specs
      ussdCode: '*385#',
      ussdOpenText: 'MENU',
      // placeholder, confirm with the app specs
      smsShortCode: '38500',
      tagline: 'Official alerts, shelters and I\'m OK check-ins.',
      helloSms: 'ALERTS',
    },
  ],

  copy: {
    demoLabel: 'Demo: no SIM, no real telco',
    scriptedLabel: 'Scripted replay',

    errors: {
      offline: "Can't reach the server. Try again, or use scripted mode.",
      server: 'Something went wrong. Try again.',
      rejected: 'Message not accepted. Check it and try again.',
      unknownCode: 'Code not recognised. Check the number and dial again.',
      sessionEnded: 'Session ended. Dial the code again to restart.',
      rateLimited: 'Too many messages. Wait 1 min and try again.',
      fixtureInvalid: 'Replay file is not valid. Fix it or use live mode.',
      noMatch: 'No scripted reply for that. Try one of these:',
    },

    menus: {
      homeTitle: 'Home',
      appsTitle: 'Apps',
      dialTitle: 'Dial',
      ussdTitle: 'Service',
      messagesTitle: 'Messages',
      inboxTitle: 'Inbox',
      messageTitle: 'Message',
      composeTitle: 'Write',
      sentTitle: 'Sent',
      settingsTitle: 'Settings',
      messagesItems: { inbox: 'Inbox', sent: 'Sent', compose: 'Write message' },
      homeItems: { apps: 'Apps', dial: 'Dial a code', messages: 'Messages', settings: 'Settings' },
      settingsItems: {
        liveMode: 'Live mode',
        scriptedMode: 'Scripted mode',
        splitView: 'Split view',
        sound: 'Sound',
        reset: 'Reset phone',
      },
      empty: { inbox: 'No messages', sent: 'Nothing sent' },
      busy: 'Please wait',
      sending: 'Sending',
      newMessage: 'New',
    },

    softKeys: {
      select: 'Select',
      back: 'Back',
      menu: 'Menu',
      options: 'Options',
      send: 'Send',
      more: 'MORE',
      ok: 'OK',
      reply: 'Reply',
      clear: 'Clear',
      call: 'Call',
      end: 'End',
    },

    keyboardHelp: {
      title: 'Keyboard help',
      close: 'Close',
      openButton: 'Keyboard help',
      skipToPhone: 'Skip to phone',
      rows: [
        { keys: '0-9, *, #', action: 'Press a keypad key' },
        { keys: 'Enter', action: 'Call, or the middle soft key' },
        { keys: 'Escape', action: 'End' },
        { keys: 'Backspace', action: 'Clear' },
        { keys: 'Arrow keys', action: 'Navigation key' },
        { keys: 'F1 / F2', action: 'Left / right soft key' },
        { keys: 'F4', action: 'Toggle split view' },
        { keys: '?', action: 'Show this help' },
      ],
      exceptionsTitle: 'Exceptions',
      exceptions: [
        'Enter or Space on a focused button presses that button.',
        'On the Write screen, the keyboard types the characters you press. Keypad buttons use multi-tap.',
        'F4 toggles the split view.',
      ],
    },

    landing: {
      title: 'Ghost Line Kit',
      pitch: 'Any phone, any outage, no one left behind',
      tryIt: 'Try it',
      stats: {
        text: 'In Africa, 63% of people own a mobile phone, but only 37% use the internet.',
        ownPercent: 63,
        usePercent: 37,
        source: 'ITU 2023',
      },
      graveyardTitle: 'The graveyard of dead phones',
      epitaphs: [
        'Here lies the feature phone. Still working.',
        'Here lies the data plan. Gone at midnight.',
        'Here lies Wi-Fi. Lost in the storm.',
        'Here lies the app store. Never had signal.',
      ],
      whyTitle: 'Why this exists',
      cards: [
        {
          id: 'oja-ghost',
          title: 'Oja Ghost',
          text: 'A Lagos market trader assistant. Prices, a debt book and reminders, in English and Nigerian Pidgin.',
        },
        {
          id: 'blackout-line',
          title: 'Blackout Line',
          text: 'A disaster-mode line. Official alerts with their source, shelters and family check-ins.',
        },
        {
          id: 'kit',
          title: 'The kit',
          text: 'An open-source skeleton for SMS and USSD agents. A new app needs about 300 lines.',
        },
      ],
      footer: {
        repoLabel: 'Source on GitHub',
        repoUrl: REPO_URL,
        quickStartLabel: 'Quick start',
        quickStartUrl: `${REPO_URL}#readme`,
        licenseNote: 'MIT licence. Built for Kiroween 2026.',
      },
    },

    trace: {
      panelTitle: 'Agent trace',
      empty: 'No trace for this message',
      splitToggle: 'Split view',
      activeMarker: 'Shown on phone',
      eventTypes: { reasoning: 'Reasoning', tool_call: 'Tool call', tool_result: 'Tool result' },
    },
  },
} as const satisfies HandsetConfig;
