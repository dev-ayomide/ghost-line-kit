import { useId, useRef, useState } from 'react';
import { handsetConfig } from '../config/handset-config';
import type { Fixture } from '../fixtures/schema';
import type { Mode } from '../state/reducer';
import type { UseAutoplay } from '../state/useAutoplay';
const { autoplay: copy } = handsetConfig.copy;
const SPEEDS = [0.5, 1, 2, 4] as const;
type Status = 'idle' | 'running' | 'stopped' | 'done';
const STATUS_TEXT: Record<Status, string> = {
  idle: copy.statusIdle,
  running: copy.statusRunning,
  stopped: copy.statusStopped,
  done: copy.statusDone,
};
export interface AutoplayControlsProps {
  mode: Mode;
  autoplay: UseAutoplay;
  fixtures: Fixture[];
  /** Preselects the first fixture of this app. */
  activeApp: string;
  onSwitchToScripted(): void;
}
/** Start/Stop, speed and fixture picker. Only offered in scripted mode. */
export function AutoplayControls({ mode, autoplay, fixtures, activeApp, onSwitchToScripted }: AutoplayControlsProps) {
  const uid = useId();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>('idle');
  const run = useRef(0);
  if (mode !== 'scripted') {
    return (
      <div className="autoplay" role="group" aria-label={copy.groupLabel}>
        <p className="autoplay__hint">{copy.liveHint}</p>
        <button type="button" className="stage__button" onClick={onSwitchToScripted}>
          {copy.switchToScripted}
        </button>
      </div>
    );
  }
  if (fixtures.length === 0) {
    return (
      <div className="autoplay" role="group" aria-label={copy.groupLabel}>
        <p className="autoplay__hint">{copy.noFixtures}</p>
      </div>
    );
  }
  const fixtureId =
    picked !== undefined && fixtures.some((f) => f.id === picked)
      ? picked
      : (fixtures.find((f) => f.appId === activeApp) ?? fixtures[0])!.id;
  const start = (): void => {
    const mine = ++run.current;
    setStatus('running');
    void autoplay.start(fixtureId).then(() => {
      if (run.current === mine) setStatus((s) => (s === 'running' ? 'done' : s));
    });
  };
  const stop = (): void => {
    run.current++;
    autoplay.stop();
    setStatus('stopped');
  };
  return (
    <div className="autoplay" role="group" aria-label={copy.groupLabel}>
      <div className="autoplay__field">
        <label htmlFor={`${uid}-fixture`}>{copy.fixture}</label>
        <select
          id={`${uid}-fixture`}
          value={fixtureId}
          disabled={autoplay.running}
          onChange={(e) => setPicked(e.target.value)}
        >
          {fixtures.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </div>
      <div className="autoplay__field">
        <label htmlFor={`${uid}-speed`}>{copy.speed}</label>
        <select
          id={`${uid}-speed`}
          value={String(autoplay.speed)}
          onChange={(e) => autoplay.setSpeed(Number(e.target.value))}
        >
          {SPEEDS.map((v) => (
            <option key={v} value={String(v)}>
              {copy.speedValue.replace('{speed}', String(v))}
            </option>
          ))}
        </select>
      </div>
      {autoplay.running ? (
        <button type="button" className="stage__button" onClick={stop}>
          {copy.stop}
        </button>
      ) : (
        <button type="button" className="stage__button" onClick={start}>
          {copy.start}
        </button>
      )}
      <p className="autoplay__status" role="status" aria-live="polite">
        {STATUS_TEXT[autoplay.running ? 'running' : status === 'running' ? 'done' : status]}
      </p>
    </div>
  );
}
