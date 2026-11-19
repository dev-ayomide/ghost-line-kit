import type { SendRequest, SendResponse, ServerConfig } from '../../shared/api';
import { handsetConfig } from '../config/handset-config';
import { acceptedInputs, matchStep, type Fixture } from '../fixtures/schema';
import { TransportError, type HandsetTransport } from './types';

export interface ScriptedTransportOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Returns 0 under reduced motion so delays are skipped. */
  delayScale?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class ScriptedTransport implements HandsetTransport {
  readonly mode = 'scripted' as const;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delayScale: () => number;

  constructor(
    private readonly fixtures: Fixture[],
    opts: ScriptedTransportOptions = {},
  ) {
    this.sleep = opts.sleep ?? defaultSleep;
    this.delayScale = opts.delayScale ?? (() => 1);
  }

  async getConfig(): Promise<ServerConfig> {
    const first = this.fixtures[0];
    if (!first) throw new TransportError('server');
    const seen = new Set<string>();
    const apps: ServerConfig['apps'] = [];
    for (const f of this.fixtures) {
      if (seen.has(f.appId)) continue;
      seen.add(f.appId);
      const profile = handsetConfig.apps.find((a) => a.id === f.appId);
      apps.push({ id: f.appId, name: profile?.name ?? f.appId });
    }
    return { limits: first.limits, apps, trace: true };
  }

  async send(req: SendRequest): Promise<SendResponse> {
    const fixture = this.fixtures.find((f) => f.appId === req.appId);
    if (!fixture) throw new TransportError('rejected');
    const kind = req.channel === 'ussd' ? 'ussd' : 'sms';
    const step = matchStep(fixture, kind, req.text);

    if (!step) {
      return { messages: [{ text: hintText(fixture), sessionId: req.sessionId }], trace: [] };
    }

    const wait = step.delayMs * Math.max(0, this.delayScale());
    if (wait > 0) await this.sleep(wait);
    return {
      messages: step.replies.map((r) => {
        const m: SendResponse['messages'][number] = { text: r.text, sessionId: req.sessionId };
        if (r.endSession !== undefined) m.endSession = r.endSession;
        return m;
      }),
      trace: step.trace,
    };
  }
}

/** noMatch copy plus accepted inputs, cut on whole items to fit one USSD screen. */
function hintText(fixture: Fixture): string {
  const cap = fixture.limits.ussd.screenHardCap;
  const head = handsetConfig.copy.errors.noMatch;
  const inputs = acceptedInputs(fixture).filter((i) => i.trim() !== '');
  let text: string = head;
  for (const input of inputs) {
    const next = `${text} ${input}`;
    if ([...next].length > cap) break;
    text = next;
  }
  return text;
}
