/**
 * Trace events: an opt-in, read-only view of what the MessageProcessor decided.
 * Types only. The processor builds and redacts the events; see processor.ts.
 */
export type TraceEventType = 'reasoning' | 'tool_call' | 'tool_result';

export interface TraceEvent {
  type: TraceEventType;
  /** The id the processor uses for this message (inbound.messageId, or its `in-<timestamp>` fallback). */
  messageId: string;
  /** Epoch ms from the injected Clock. */
  at: number;
  /** Short plain-English title, at most 80 characters. */
  title: string;
  /** tool_call and tool_result: the tool name. */
  tool?: string;
  /** tool_result only. */
  ok?: boolean;
  /** Redacted single line, at most 200 characters. */
  summary?: string;
  /** tool_result only. */
  durationMs?: number;
}

export type TraceSink = (event: TraceEvent) => void;
