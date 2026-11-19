/**
 * Hand-written response guards (no zod in the browser).
 * Unexpected shapes give undefined.
 */
import type { SendResponse, ServerConfig } from '../../shared/api';
import { filterTraceEvents } from '../trace/guard';

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const hasNumbers = (o: unknown, keys: string[]): o is Obj =>
  isObj(o) && keys.every((k) => isFiniteNumber(o[k]));

function isLimits(x: unknown): x is ServerConfig['limits'] {
  if (!isObj(x)) return false;
  const { sms, ussd, reply, rateLimit } = x;
  if (!isObj(sms) || !hasNumbers(sms.gsm7, ['singleSegment', 'concatSegment'])) return false;
  if (!hasNumbers(sms.ucs2, ['singleSegment', 'concatSegment'])) return false;
  if (
    !hasNumbers(ussd, ['screenHardCap', 'screenSoftTarget', 'sessionTimeoutMs', 'maxOptionsPerScreen'])
  ) {
    return false;
  }
  if (!hasNumbers(reply, ['maxPreferredSegments', 'nextStepMaxLength', 'errorMaxLength'])) return false;
  return hasNumbers(rateLimit, ['windowMs', 'maxInbound', 'maxOutbound']);
}

export function parseServerConfig(raw: unknown): ServerConfig | undefined {
  if (!isObj(raw)) return undefined;
  if (!isLimits(raw.limits)) return undefined;
  if (typeof raw.trace !== 'boolean') return undefined;
  if (!Array.isArray(raw.apps)) return undefined;
  const apps: ServerConfig['apps'] = [];
  for (const a of raw.apps) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.name !== 'string') return undefined;
    apps.push({ id: a.id, name: a.name });
  }
  return { limits: raw.limits, apps, trace: raw.trace };
}

export function parseSendResponse(raw: unknown): SendResponse | undefined {
  if (!isObj(raw) || !Array.isArray(raw.messages)) return undefined;
  const messages: SendResponse['messages'] = [];
  for (const m of raw.messages) {
    if (!isObj(m) || typeof m.text !== 'string') return undefined;
    if (m.endSession !== undefined && typeof m.endSession !== 'boolean') return undefined;
    if (m.sessionId !== undefined && typeof m.sessionId !== 'string') return undefined;
    const msg: SendResponse['messages'][number] = { text: m.text };
    if (m.endSession !== undefined) msg.endSession = m.endSession;
    if (m.sessionId !== undefined) msg.sessionId = m.sessionId;
    messages.push(msg);
  }
  return { messages, trace: filterTraceEvents(raw.trace) };
}
