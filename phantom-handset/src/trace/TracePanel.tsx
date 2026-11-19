import { useEffect, useRef } from 'react';
import type { HandsetTraceEvent } from '../../shared/api';
import { handsetConfig } from '../config/handset-config';
import { selectTraceForView } from '../state/selectors';
import type { HandsetState } from '../state/reducer';
import { filterTraceEvents } from './guard';
const { trace: copy } = handsetConfig.copy;
export interface TraceGroup {
  id: string;
  current: boolean;
  events: HandsetTraceEvent[];
}
/**
 * The exchanges of the active app, oldest first, each with its validated events. The group for
 * the message on the LCD is marked current. Nothing is invented: no events means no rows.
 */
export function buildTraceGroups(state: HandsetState): TraceGroup[] {
  const currentId = selectTraceForView(state).exchangeId;
  return state.exchanges
    .filter((ex) => ex.appId === state.activeApp)
    .map((ex) => ({
      id: ex.id,
      current: ex.id === currentId,
      events: filterTraceEvents(ex.trace),
    }));
}
/** `+0.4 s` from the first event of the exchange. Never negative. */
export function formatRelative(at: number, first: number): string {
  const seconds = (Math.max(0, at - first) / 1000).toFixed(1);
  return copy.relativeTime.replace('{seconds}', seconds);
}
function Detail({ label, children }: { label: string; children: string }) {
  return (
    <div className="trace__detail">
      <span className="trace__detail-label">{label}</span>
      <code className="trace__code">{children}</code>
    </div>
  );
}
function EventBody({ ev }: { ev: HandsetTraceEvent }) {
  const isCall = ev.type === 'tool_call';
  const isResult = ev.type === 'tool_result';
  const status = ev.ok === undefined ? undefined : ev.ok ? copy.ok : copy.failed;
  return (
    <>
      {ev.tool !== undefined ? <Detail label={copy.tool}>{ev.tool}</Detail> : null}
      {isResult && status !== undefined ? (
        <p className="trace__status">
          {status}
          {ev.durationMs !== undefined
            ? `, ${copy.duration.replace('{ms}', String(Math.round(ev.durationMs)))}`
            : ''}
        </p>
      ) : null}
      {ev.summary !== undefined && ev.summary !== '' ? (
        isCall ? (
          <Detail label={copy.input}>{ev.summary}</Detail>
        ) : isResult ? (
          <Detail label={copy.result}>{ev.summary}</Detail>
        ) : (
          <p className="trace__summary">{ev.summary}</p>
        )
      ) : null}
    </>
  );
}
export interface TracePanelProps {
  groups: TraceGroup[];
  reducedMotion: boolean;
}
/** "Reasoning and tool calls" for the demo video. React text nodes only (R10.8). */
export function TracePanel({ groups, reducedMotion }: TracePanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLLIElement>(null);
  const shown = groups.map((g) => ({ ...g, events: filterTraceEvents(g.events) }));
  const all = shown.flatMap((g) => g.events);
  const current = shown.find((g) => g.current);
  const currentEmpty = shown.length > 0 && (current === undefined || current.events.length === 0);
  const currentKey = current?.id ?? '';
  const count = all.length;
  useEffect(() => {
    const box = scroller.current;
    const row = currentRow.current;
    if (reducedMotion || !box || !row) return;
    box.scrollTo({ top: Math.max(0, row.offsetTop - box.offsetTop - 8), behavior: 'smooth' });
  }, [currentKey, count, reducedMotion]);
  let firstCurrentSeen = false;
  return (
    <section className="trace" aria-labelledby="trace-title">
      <h2 id="trace-title" className="trace__title">
        {copy.panelTitle}
      </h2>
      <div className="trace__scroll" ref={scroller} tabIndex={0} role="region" aria-label={copy.listLabel}>
        {all.length === 0 || currentEmpty ? <p className="trace__empty">{copy.empty}</p> : null}
        {all.length > 0 ? (
          <ol className="trace__list" aria-label={copy.listLabel}>
            {shown.flatMap((g) =>
              g.events.map((ev, i) => {
                // Time is relative to the first event of the same exchange.
                const first = Math.min(...g.events.map((e) => e.at));
                const isFirstCurrent = g.current && !firstCurrentSeen;
                if (isFirstCurrent) firstCurrentSeen = true;
                return (
                  <li
                    key={`${g.id}-${i}`}
                    ref={isFirstCurrent ? currentRow : undefined}
                    className={`trace__event trace__event--${ev.type}${g.current ? ' trace__event--current' : ''}${i === 0 ? ' trace__event--group-start' : ''}`}
                  >
                    <div className="trace__head">
                      <span className="trace__badge">
                        <span aria-hidden="true" className="trace__glyph">
                          {copy.eventGlyphs[ev.type]}
                        </span>
                        {copy.eventTypes[ev.type]}
                      </span>
                      {g.current ? <span className="trace__current">{copy.current}</span> : null}
                      <span className="trace__time">{formatRelative(ev.at, first)}</span>
                    </div>
                    <p className="trace__event-title">{ev.title}</p>
                    <EventBody ev={ev} />
                  </li>
                );
              }),
            )}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
