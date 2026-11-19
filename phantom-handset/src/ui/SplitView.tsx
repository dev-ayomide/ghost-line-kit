import type { ReactNode } from 'react';
import { handsetConfig } from '../config/handset-config';
export interface SplitViewProps {
  split: boolean;
  onToggle(): void;
  /** Controls shown beside the toggle (Autoplay). */
  controls?: ReactNode;
  phone: ReactNode;
  trace: ReactNode;
}
/** Phone left, trace right. Stacks below 900 px (CSS). The toggle is a real pressed button. */
export function SplitView({ split, onToggle, controls, phone, trace }: SplitViewProps) {
  return (
    <div className={`split${split ? ' split--on' : ''}`}>
      <div className="split__bar">
        <button type="button" className="stage__button" aria-pressed={split} onClick={onToggle}>
          {handsetConfig.copy.trace.splitToggle}
        </button>
        {controls}
      </div>
      <div className="split__body">
        <div className="split__phone">{phone}</div>
        {split ? <div className="split__trace">{trace}</div> : null}
      </div>
    </div>
  );
}
