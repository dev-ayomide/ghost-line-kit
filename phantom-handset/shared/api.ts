/**
 * Wire shapes shared by the browser (src/) and the server (server/).
 * Types only: nothing here exists at runtime.
 */
import type { LIMITS, OutboundMessage, TraceEvent } from '@ghostline/kit';

export type Limits = typeof LIMITS;

/** What `GET /api/config` returns. */
export interface ServerConfig {
  limits: Limits;
  apps: { id: string; name: string }[];
  /** False when the server runs with HANDSET_TRACE=off. */
  trace: boolean;
}

/** Body of `POST /api/web/:appId`. */
export interface SendRequest {
  appId: string;
  from: string;
  text: string;
  sessionId?: string;
  channel?: 'web' | 'ussd';
}

/** A trace event as the browser sees it: the message id is stripped. */
export type HandsetTraceEvent = Omit<TraceEvent, 'messageId'>;

export interface SendResponse {
  messages: Pick<OutboundMessage, 'text' | 'endSession' | 'sessionId'>[];
  trace: HandsetTraceEvent[];
}

export interface ApiError {
  error: { code: string; message: string };
}
