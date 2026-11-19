import type { SendRequest, SendResponse, ServerConfig } from '../../shared/api';
import { parseSendResponse, parseServerConfig } from './guards';
import { TransportError, type HandsetTransport } from './types';

export interface LiveTransportOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function defaultBase(): string {
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env;
    const v = env?.VITE_API_BASE;
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** Parses `#token=...`. The token is for memory only: never store it. */
export function readTokenFromHash(hash: string): string | undefined {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i) !== 'token') continue;
    try {
      const v = decodeURIComponent(part.slice(i + 1));
      return v === '' ? undefined : v;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class LiveTransport implements HandsetTransport {
  readonly mode = 'live' as const;
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: LiveTransportOptions = {}) {
    this.base = (opts.baseUrl ?? defaultBase()).replace(/\/+$/, '');
    this.token = opts.token || undefined;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getConfig(): Promise<ServerConfig> {
    const body = await this.request('/api/config', { method: 'GET' });
    const parsed = parseServerConfig(body);
    if (!parsed) throw new TransportError('server');
    return parsed;
  }

  async send(req: SendRequest): Promise<SendResponse> {
    const payload: Record<string, unknown> = { from: req.from, text: req.text };
    if (req.sessionId !== undefined) payload.sessionId = req.sessionId;
    if (req.channel !== undefined) payload.channel = req.channel;
    const body = await this.request(`/api/web/${encodeURIComponent(req.appId)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const parsed = parseSendResponse(body);
    if (!parsed) throw new TransportError('server');
    return parsed;
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, {
          method: init.method,
          headers,
          body: init.body,
          signal: controller.signal,
        });
      } catch {
        throw new TransportError('offline');
      }
      if (res.status === 400 || res.status === 401 || res.status === 404) {
        throw new TransportError('rejected');
      }
      if (!res.ok) throw new TransportError('server');
      try {
        return await res.json();
      } catch {
        throw new TransportError('server');
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
