/**
 * Scripted-mode fixtures: types, hand-written validation and step matching.
 * Pure module: no import.meta, no kit runtime import (types only).
 */
import type { HandsetTraceEvent, Limits } from '../../shared/api';
import { isTraceEvent } from '../trace/guard';

export interface FixtureReply {
  text: string;
  endSession?: boolean;
}

export interface FixtureStep {
  when: { kind: 'ussd' | 'sms'; input: string };
  delayMs: number;
  replies: FixtureReply[];
  trace: HandsetTraceEvent[];
}

export interface Fixture {
  version: 1;
  id: string;
  title: string;
  appId: string;
  /** The full Limits shape, so the scripted transport can build a complete ServerConfig. */
  limits: Limits;
  steps: FixtureStep[];
}

export type ParseResult = { ok: true; fixture: Fixture } | { ok: false; error: string };

type Obj = Record<string, unknown>;

class FixtureError extends Error {}

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function fail(name: string, path: string, expected: string): never {
  throw new FixtureError(`${name}: ${path} must be ${expected}`);
}

function str(name: string, o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(name, `${path}${key}`, 'a string');
  return v;
}

function num(name: string, o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(name, `${path}${key}`, 'a finite number');
  return v;
}

function obj(name: string, o: Obj, key: string, path: string): Obj {
  const v = o[key];
  if (!isObj(v)) fail(name, `${path}${key}`, 'an object');
  return v;
}

function arr(name: string, o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(name, `${path}${key}`, 'an array');
  return v;
}

function parseLimits(name: string, raw: Obj): Limits {
  const sms = obj(name, raw, 'sms', 'limits.');
  const gsm7 = obj(name, sms, 'gsm7', 'limits.sms.');
  const ucs2 = obj(name, sms, 'ucs2', 'limits.sms.');
  const ussd = obj(name, raw, 'ussd', 'limits.');
  const reply = obj(name, raw, 'reply', 'limits.');
  const rate = obj(name, raw, 'rateLimit', 'limits.');
  return {
    sms: {
      gsm7: {
        singleSegment: num(name, gsm7, 'singleSegment', 'limits.sms.gsm7.'),
        concatSegment: num(name, gsm7, 'concatSegment', 'limits.sms.gsm7.'),
      },
      ucs2: {
        singleSegment: num(name, ucs2, 'singleSegment', 'limits.sms.ucs2.'),
        concatSegment: num(name, ucs2, 'concatSegment', 'limits.sms.ucs2.'),
      },
    },
    ussd: {
      screenHardCap: num(name, ussd, 'screenHardCap', 'limits.ussd.'),
      screenSoftTarget: num(name, ussd, 'screenSoftTarget', 'limits.ussd.'),
      sessionTimeoutMs: num(name, ussd, 'sessionTimeoutMs', 'limits.ussd.'),
      maxOptionsPerScreen: num(name, ussd, 'maxOptionsPerScreen', 'limits.ussd.'),
    },
    reply: {
      maxPreferredSegments: num(name, reply, 'maxPreferredSegments', 'limits.reply.'),
      nextStepMaxLength: num(name, reply, 'nextStepMaxLength', 'limits.reply.'),
      errorMaxLength: num(name, reply, 'errorMaxLength', 'limits.reply.'),
    },
    rateLimit: {
      windowMs: num(name, rate, 'windowMs', 'limits.rateLimit.'),
      maxInbound: num(name, rate, 'maxInbound', 'limits.rateLimit.'),
      maxOutbound: num(name, rate, 'maxOutbound', 'limits.rateLimit.'),
    },
  } as unknown as Limits;
}

function parseStep(name: string, raw: unknown, i: number, ussdCap: number): FixtureStep {
  const p = `steps[${i}]`;
  if (!isObj(raw)) fail(name, p, 'an object');
  const when = obj(name, raw, 'when', `${p}.`);
  const kind = when.kind;
  if (kind !== 'ussd' && kind !== 'sms') fail(name, `${p}.when.kind`, "'ussd' or 'sms'");
  const input = str(name, when, 'input', `${p}.when.`);
  const delayMs = num(name, raw, 'delayMs', `${p}.`);
  if (delayMs < 0) fail(name, `${p}.delayMs`, 'zero or more');

  const replies = arr(name, raw, 'replies', `${p}.`).map((r, j): FixtureReply => {
    const rp = `${p}.replies[${j}]`;
    if (!isObj(r)) fail(name, rp, 'an object');
    const text = str(name, r, 'text', `${rp}.`);
    if (r.endSession !== undefined && typeof r.endSession !== 'boolean') {
      fail(name, `${rp}.endSession`, 'a boolean');
    }
    if (kind === 'ussd' && [...text].length > ussdCap) {
      fail(name, `${rp}.text`, `at most ${ussdCap} characters for a ussd reply`);
    }
    return r.endSession === undefined ? { text } : { text, endSession: r.endSession };
  });

  const trace = arr(name, raw, 'trace', `${p}.`).map((t, j) => {
    if (!isTraceEvent(t)) fail(name, `${p}.trace[${j}]`, 'a valid trace event');
    return t;
  });

  return { when: { kind, input }, delayMs, replies, trace };
}

export function parseFixture(raw: unknown, name: string): ParseResult {
  try {
    if (!isObj(raw)) fail(name, 'file', 'a JSON object');
    if (raw.version !== 1) fail(name, 'version', '1');
    const id = str(name, raw, 'id', '');
    const title = str(name, raw, 'title', '');
    const appId = str(name, raw, 'appId', '');
    const limits = parseLimits(name, obj(name, raw, 'limits', ''));
    const steps = arr(name, raw, 'steps', '').map((s, i) =>
      parseStep(name, s, i, limits.ussd.screenHardCap),
    );
    return { ok: true, fixture: { version: 1, id, title, appId, limits, steps } };
  } catch (e) {
    if (e instanceof FixtureError) return { ok: false, error: e.message };
    return { ok: false, error: `${name}: could not be read` };
  }
}

/** USSD: exact after trim. SMS: case-insensitive after trim. First match in order. */
export function matchStep(fixture: Fixture, kind: 'ussd' | 'sms', input: string): FixtureStep | undefined {
  const t = input.trim();
  const lower = t.toLowerCase();
  return fixture.steps.find((s) => {
    if (s.when.kind !== kind) return false;
    const w = s.when.input.trim();
    return kind === 'ussd' ? w === t : w.toLowerCase() === lower;
  });
}

/** Unique step inputs in order, for the no-match hint. */
export function acceptedInputs(fixture: Fixture): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of fixture.steps) {
    const k = `${s.when.kind}:${s.when.kind === 'sms' ? s.when.input.trim().toLowerCase() : s.when.input.trim()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.when.input);
  }
  return out;
}
