import { useCallback, useEffect, useRef, useState } from 'react';
import { handsetConfig } from '../config/handset-config';

export interface KeyboardHelpState {
  open: boolean;
  show(): void;
  close(): void;
}

/** Open/close state. Remembers the opener and returns focus to it on close. */
export function useKeyboardHelp(): KeyboardHelpState {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
  }, []);

  return { open, show, close };
}

export interface KeyboardHelpProps {
  open: boolean;
  onClose(): void;
}

/** Native modal dialog listing the key map and its exceptions. */
export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const help = handsetConfig.copy.keyboardHelp;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="kbd-help"
      aria-labelledby="kbd-help-title"
      onClose={onClose}
    >
      <h2 id="kbd-help-title">{help.title}</h2>
      <dl className="kbd-help__rows">
        {help.rows.map((row) => (
          <div key={row.keys} className="kbd-help__row">
            <dt>
              <kbd>{row.keys}</kbd>
            </dt>
            <dd>{row.action}</dd>
          </div>
        ))}
      </dl>
      <h3>{help.exceptionsTitle}</h3>
      <ul>
        {help.exceptions.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <form method="dialog">
        <button type="submit" className="kbd-help__close">
          {help.close}
        </button>
      </form>
    </dialog>
  );
}

export interface KeyboardHelpButtonProps {
  onOpen(): void;
}

/** A visible opener, so help is reachable without the `?` key. */
export function KeyboardHelpButton({ onOpen }: KeyboardHelpButtonProps) {
  return (
    <button type="button" className="kbd-help-open" onClick={onOpen}>
      {handsetConfig.copy.keyboardHelp.openButton}
    </button>
  );
}
