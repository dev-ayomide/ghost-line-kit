/**
 * Pure request handler for the Phantom Handset server.
 *
 * No Node-only objects and no node:* imports here, so the same function can
 * sit behind API Gateway later. Anything that needs Node (random ids, env)
 * is injected through `HandlerDeps` by wire.ts.
 */
import { LIMITS, WebAdapter, verifyWebhookSecret } from '@ghostline/kit';
import type { InboundMessage, OutboundMessage, SafeLogger } from '@ghostline/kit';
import type { ApiError, HandsetTraceEvent, SendResponse, ServerConfig } from '../shared/api.js';

export interface HandlerRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string>;
  body: unknown;
}

export interface HandlerResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** What the handler needs from one app. A MessageProcessor satisfies it. */
export interface HandlerApp {
  id: string;
  name: string;
  processor: { process(inbound: InboundMessage): Promise<OutboundMessage[]> };
}

export interface HandlerDeps {
  apps: ReadonlyMap<string, HandlerApp>;
  /** Trace events per messageId. wire.ts's onTrace pushes into these arrays. */
  collectors: Map<string, HandsetTraceEvent[]>;
  /** Whether trace collection is on (false when HANDSET_TRACE=off). */
  traceEnabled: boolean;
  logger: SafeLogger;
  /** Returns a fresh unique id for one message. */
  newId: () => string;
  /** True when the server is reachable beyond loopback. */
  requireToken: boolean;
  accessToken?: string | undefined;
  /** If set, CORS headers are added for exactly this origin. */
  allowedOrigin?: string | undefined;
}

const FAKE_FROM_RE = /^\+2340\d{9}$/;
const BEARER_RE = /^Bearer\s+(.+)$/i;

const MSG = {
  unknownApp: 'That app is not available. Pick an app from the menu.',
  unauthorized: 'Access token missing or wrong. Add the right token and try again.',
  invalidPayload: 'That request was not valid. Check it and try again.',
  badFrom: 'Use the phone number shown on the handset and try again.',
  notFound: 'That address does not exist. Check it and try again.',
  method: 'That method is not allowed here. Use GET or POST.',
  internal: 'Something went wrong. Try again.',
} as const;

function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function createHandler(deps: HandlerDeps): (req: HandlerRequest) => Promise<HandlerResponse> {
  const corsHeaders = (): Record<string, string> =>
    deps.allowedOrigin
      ? {
          'access-control-allow-origin': deps.allowedOrigin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
          vary: 'Origin',
        }
      : {};

  const reply = (status: number, body: unknown): HandlerResponse => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
    body,
  });

  const log = (event: string, messageId?: string, phoneNumber?: string, messageLength?: number): void => {
    try {
      deps.logger.info({
        event,
        ...(messageId !== undefined ? { messageId } : {}),
        ...(phoneNumber !== undefined ? { phoneNumber } : {}),
        ...(messageLength !== undefined ? { messageLength } : {}),
      });
    } catch {
      // Logging must never break a request.
    }
  };

  async function post(appId: string, req: HandlerRequest, headers: Record<string, string>): Promise<HandlerResponse> {
    // 1. Look up the app.
    const app = deps.apps.get(appId);
    if (!app) return reply(404, errorBody('UNKNOWN_APP', MSG.unknownApp));

    // 2. Access token, when exposed beyond loopback.
    if (deps.requireToken) {
      const match = BEARER_RE.exec(headers['authorization'] ?? '');
      if (!verifyWebhookSecret(match?.[1], deps.accessToken)) {
        log('HANDSET_UNAUTHORIZED');
        return reply(401, errorBody('UNAUTHORIZED', MSG.unauthorized));
      }
    }

    // 3. A new adapter per request: concurrent requests never share handlers.
    const adapter = new WebAdapter();
    const parsed = adapter.parseWebhook({ body: req.body, query: req.query, headers });
    if (!parsed.ok) return reply(400, errorBody('INVALID_PAYLOAD', MSG.invalidPayload));

    // 4. Only the fake number range is accepted.
    if (!FAKE_FROM_RE.test(parsed.inbound.from)) {
      return reply(400, errorBody('INVALID_FROM', MSG.badFrom));
    }

    // 5. Collect replies and trace events for this message.
    const messageId = deps.newId();
    const inbound: InboundMessage = { ...parsed.inbound, messageId };
    const collected: OutboundMessage[] = [];
    adapter.onDeliver((m) => {
      collected.push(m);
    });
    const events: HandsetTraceEvent[] = [];
    if (deps.traceEnabled) deps.collectors.set(messageId, events);
    try {
      log('HANDSET_INBOUND', messageId, inbound.from, inbound.text.length);
      // 6. Run the pipeline, then deliver through the adapter.
      const out = await app.processor.process(inbound);
      for (const m of out) await adapter.send(m);
      // 7. Respond.
      const body: SendResponse = {
        messages: collected.map((m) => ({
          text: m.text,
          ...(m.endSession !== undefined ? { endSession: m.endSession } : {}),
          ...(m.sessionId !== undefined ? { sessionId: m.sessionId } : {}),
        })),
        trace: [...events],
      };
      log('HANDSET_REPLIED', messageId, inbound.from, collected.reduce((n, m) => n + m.text.length, 0));
      return reply(200, body);
    } finally {
      deps.collectors.delete(messageId);
    }
  }

  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    try {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
      const method = req.method.toUpperCase();

      if (method === 'OPTIONS') {
        if (!deps.allowedOrigin) return { status: 204, headers: {}, body: undefined };
        return { status: 204, headers: { ...corsHeaders(), 'access-control-max-age': '600' }, body: undefined };
      }

      if (req.path === '/api/health') {
        return method === 'GET' ? reply(200, { ok: true }) : reply(405, errorBody('METHOD_NOT_ALLOWED', MSG.method));
      }
      if (req.path === '/api/config') {
        if (method !== 'GET') return reply(405, errorBody('METHOD_NOT_ALLOWED', MSG.method));
        const config: ServerConfig = {
          limits: LIMITS,
          apps: [...deps.apps.values()].map((a) => ({ id: a.id, name: a.name })),
          trace: deps.traceEnabled,
        };
        return reply(200, config);
      }
      const m = /^\/api\/web\/([^/]+)$/.exec(req.path);
      if (m) {
        if (method !== 'POST') return reply(405, errorBody('METHOD_NOT_ALLOWED', MSG.method));
        let appId = m[1] ?? '';
        try {
          appId = decodeURIComponent(appId);
        } catch {
          return reply(404, errorBody('UNKNOWN_APP', MSG.unknownApp));
        }
        return await post(appId, req, headers);
      }
      return reply(404, errorBody('NOT_FOUND', MSG.notFound));
    } catch {
      // Never expose stack traces or internal ids.
      return reply(500, errorBody('INTERNAL', MSG.internal));
    }
  };
}
