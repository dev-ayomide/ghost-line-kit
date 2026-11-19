import type { HandsetKey } from '../keypad/compose';
import { handsetConfig } from '../config/handset-config';

export type KeypadKey = Exclude<HandsetKey, 'clear'>;

export const KEYPAD_ORDER: readonly KeypadKey[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#',
];

/** The classic sub-letters of a key ("ABC"), taken from the multi-tap table. Empty when none. */
export function subLetters(key: KeypadKey): string {
  return handsetConfig.multitap.letters[key].replace(/[^a-z]/g, '').toUpperCase();
}

/** Accessible name such as "2, ABC", "0, space", "*, star". */
export function keyAriaLabel(key: KeypadKey): string {
  const names = handsetConfig.copy.phone.keyNames;
  switch (key) {
    case '*':
      return `*, ${names.star}`;
    case '#':
      return `#, ${names.hash}`;
    case '0':
      return `0, ${names.space}`;
    default: {
      const letters = subLetters(key);
      return letters === '' ? key : `${key}, ${letters}`;
    }
  }
}

export interface KeypadProps {
  onKey(key: HandsetKey): void;
}

export function Keypad({ onKey }: KeypadProps) {
  return (
    <div className="keypad" role="group" aria-label={handsetConfig.copy.phone.keypadLabel}>
      {KEYPAD_ORDER.map((key) => {
        const letters = key === '0' ? '\u2423' : subLetters(key);
        return (
          <button
            key={key}
            type="button"
            className="key"
            aria-label={keyAriaLabel(key)}
            onClick={() => onKey(key)}
          >
            <span className="key__digit" aria-hidden="true">
              {key}
            </span>
            {letters !== '' ? (
              <span className="key__letters" aria-hidden="true">
                {letters}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
