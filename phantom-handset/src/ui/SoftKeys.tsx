import { handsetConfig } from '../config/handset-config';

export interface SoftKeysProps {
  /** Current LCD labels, used so the button name says what the key does now. */
  left: string;
  right: string;
  onLeft(): void;
  onRight(): void;
}

function name(base: string, label: string): string {
  return label === '' ? base : `${base}, ${label}`;
}

/** The two soft keys. Rendered as grid children of the phone's control area. */
export function SoftKeys({ left, right, onLeft, onRight }: SoftKeysProps) {
  const copy = handsetConfig.copy.phone;
  return (
    <>
      <button
        type="button"
        className="key key--soft"
        aria-label={name(copy.softLeftName, left)}
        onClick={onLeft}
      />
      <button
        type="button"
        className="key key--soft key--soft-right"
        aria-label={name(copy.softRightName, right)}
        onClick={onRight}
      />
    </>
  );
}
