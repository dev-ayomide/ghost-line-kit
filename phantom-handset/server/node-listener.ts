/**
 * Adapts Node's http objects to the pure handler. Plain node:http types only.
 * Reads at most MAX_BODY_BYTES of body, never throws to the socket.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HandlerRequest, HandlerResponse } from './handler.js';

export const MAX_BODY_BYTES = 8 * 1024;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;
const TOO_LARGE = JSON.stringify({
  error: { code: 'PAYLOAD_TOO_LARGE', message: 'That message is too long. Send a shorter one.' },
});
const INTERNAL = JSON.stringify({
  error: { code: 'INTERNAL', message: 'Something went wrong. Try again.' },
});

type Handle = (req: HandlerRequest) => Promise<HandlerResponse>;

/** Reads the body up to the cap. Resolves null when the cap is exceeded (and stops reading). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      req.off('data', onData);
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        finish(null);
        return;
      }
      chunks.push(buf);
    };
    req.on('data', onData);
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

function parseJson(raw: string): unknown {
  if (raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, payload: string | undefined): void {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, headers);
  res.end(payload);
}

export function createNodeListener(handle: Handle): (req: IncomingMessage, res: ServerResponse) => void {
  const run = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase();
    let body: unknown;
    if (method === 'POST') {
      const raw = await readBody(req);
      if (raw === null) {
        send(res, 413, { ...JSON_HEADERS, connection: 'close' }, TOO_LARGE);
        return;
      }
      body = parseJson(raw);
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    }
    const out = await handle({ method, path: url.pathname, query, headers, body });
    if (out.body === undefined) {
      send(res, out.status, { ...out.headers }, undefined);
      return;
    }
    send(res, out.status, { ...JSON_HEADERS, ...out.headers }, JSON.stringify(out.body));
  };
  return (req, res) => {
    run(req, res).catch(() => {
      try {
        send(res, 500, { ...JSON_HEADERS }, INTERNAL);
        if (!res.writableEnded) res.end();
      } catch {
        res.destroy();
      }
    });
  };
}
