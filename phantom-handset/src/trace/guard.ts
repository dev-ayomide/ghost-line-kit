/**
 * Runtime guards for trace events coming from the server or from fixtures.
 * Pure module: no DOM, no kit runtime import.
 */
import type { HandsetTraceEvent } from '../../shared/api';

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isTraceEvent(x: unknown): x is HandsetTraceEvent {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  if (e.type !== 'reasoning' && e.type !== 'tool_call' && e.type !== 'tool_result') return false;
  if (!isFiniteNumber(e.at)) return false;
  if (typeof e.title !== 'string' || e.title.length > 120) return false;
  if (e.tool !== undefined && typeof e.tool !== 'string') return false;
  if (e.ok !== undefined && typeof e.ok !== 'boolean') return false;
  if (e.summary !== undefined && typeof e.summary !== 'string') return false;
  if (e.durationMs !== undefined && !isFiniteNumber(e.durationMs)) return false;
  return true;
}

/** Keeps only valid events. A non-array gives []. */
export function filterTraceEvents(x: unknown): HandsetTraceEvent[] {
  return Array.isArray(x) ? x.filter(isTraceEvent) : [];
}
