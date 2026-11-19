import { maskPhoneNumber } from './format/phone.js';

/**
 * Privacy-safe logging (Requirements 14, 18).
 *
 * The event types have deliberately NO field for a message body. Output is
 * built from an allowlist: each permitted field is copied one by one, so any
 * extra property on the event object (cast, or from JS callers) never reaches
 * the sink.
 */

export interface LogInfo {
  event: string;
  messageId?: string;
  phoneNumber?: string;
  messageLength?: number;
}

export interface LogError {
  error: string;
  messageId?: string;
  phoneNumber?: string;
  messageLength?: number;
}

export interface SafeLogger {
  info(event: LogInfo): void;
  error(event: LogError): void;
}

export interface LoggerOptions {
  /** Receives one line per info event. Default: console.log. */
  info?: (line: string) => void;
  /** Receives one line per error event. Default: console.error. */
  error?: (line: string) => void;
}

export interface DevLoggerOptions extends LoggerOptions {
  /** Clock in epoch milliseconds. Default: Date.now. */
  now?: () => number;
}

const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const PHONE_RE = /^[0-9+\-() ]{3,32}$/;

function code(v: unknown, fallback: string): string {
  return typeof v === 'string' && CODE_RE.test(v) ? v : fallback;
}

function maskedPhone(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length < 3 || !PHONE_RE.test(v)) return '***';
  try {
    const m = maskPhoneNumber(v);
    return m.length >= 3 ? m : '***';
  } catch {
    return '***';
  }
}

/** Build the allowlisted record. Never copies unknown properties. */
function sanitise(
  level: 'info' | 'error',
  codeKey: 'event' | 'error',
  raw: unknown,
): Record<string, unknown> {
  const e = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  out.level = level;
  out[codeKey] = code(e[codeKey], codeKey === 'event' ? 'EVENT' : 'ERROR');
  const id = e.messageId;
  if (typeof id === 'string' && ID_RE.test(id)) out.messageId = id;
  const len = e.messageLength;
  if (typeof len === 'number' && Number.isInteger(len) && len >= 0) out.messageLength = len;
  const phone = maskedPhone(e.phoneNumber);
  if (phone !== undefined) out.phone = phone;
  return out;
}

function emit(sink: (line: string) => void, line: () => string): void {
  try {
    sink(line());
  } catch {
    // Logging must never break message handling.
  }
}

/** Compact one-line JSON with only allowlisted fields. */
export class ProductionLogger implements SafeLogger {
  private readonly infoSink: (line: string) => void;
  private readonly errorSink: (line: string) => void;

  constructor(opts: LoggerOptions = {}) {
    this.infoSink = opts.info ?? ((l) => console.log(l));
    this.errorSink = opts.error ?? ((l) => console.error(l));
  }

  info(event: LogInfo): void {
    emit(this.infoSink, () => JSON.stringify(sanitise('info', 'event', event)));
  }

  error(event: LogError): void {
    emit(this.errorSink, () => JSON.stringify(sanitise('error', 'error', event)));
  }
}

/**
 * Same allowlist and masking as ProductionLogger. "Verbose" means formatting
 * only (pretty-printed JSON plus an ISO `time` field), never more data.
 */
export class DevLogger implements SafeLogger {
  private readonly infoSink: (line: string) => void;
  private readonly errorSink: (line: string) => void;
  private readonly now: () => number;

  constructor(opts: DevLoggerOptions = {}) {
    this.infoSink = opts.info ?? ((l) => console.log(l));
    this.errorSink = opts.error ?? ((l) => console.error(l));
    this.now = opts.now ?? Date.now;
  }

  private render(rec: Record<string, unknown>): string {
    const { level, ...rest } = rec;
    let time: string | undefined;
    try {
      time = new Date(this.now()).toISOString();
    } catch {
      time = undefined;
    }
    return JSON.stringify(time ? { level, time, ...rest } : { level, ...rest }, null, 2);
  }

  info(event: LogInfo): void {
    emit(this.infoSink, () => this.render(sanitise('info', 'event', event)));
  }

  error(event: LogError): void {
    emit(this.errorSink, () => this.render(sanitise('error', 'error', event)));
  }
}

/** Production logger when env === 'production', otherwise the dev logger. */
export function createLogger(env: string | undefined, opts: DevLoggerOptions = {}): SafeLogger {
  return env === 'production' ? new ProductionLogger(opts) : new DevLogger(opts);
}
