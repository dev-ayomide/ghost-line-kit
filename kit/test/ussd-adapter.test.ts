import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { UssdAdapter, formatResponse, latestUssdInput } from '../src/channels/ussd-adapter.js';
import { LIMITS } from '../src/limits.js';

describe('ussd adapter pure helpers', () => {
  it('formatResponse prefixes CON or END', () => {
    expect(formatResponse({ to: '+1', text: 'Hi' })).toBe('CON Hi');
    expect(formatResponse({ to: '+1', text: 'Bye', endSession: true })).toBe('END Bye');
    expect(formatResponse({ to: '+1', text: 'Hi', endSession: false })).toBe('CON Hi');
  });

  it('latestUssdInput returns the part after the last star', () => {
    expect(latestUssdInput('')).toBe('');
    expect(latestUssdInput('1')).toBe('1');
    expect(latestUssdInput('1*2*3')).toBe('3');
    expect(latestUssdInput('1*2*')).toBe('');
  });

  it('property: latest input is the last element of the joined list', () => {
    fc.assert(
      fc.property(fc.array(fc.string().filter((s) => !s.includes('*'))), (list) => {
        expect(latestUssdInput(list.join('*'))).toBe(list.length ? list[list.length - 1] : '');
      }),
    );
  });
});

describe('UssdAdapter', () => {
  it('send rejects text over the hard cap', async () => {
    const a = new UssdAdapter({ webhookSecret: 's' });
    const r = await a.send({ to: '+1', text: 'x'.repeat(LIMITS.ussd.screenHardCap + 1) });
    expect(r).toEqual({ ok: false, error: 'USSD screen too long' });
    const ok = await a.send({ to: '+1', text: 'x'.repeat(LIMITS.ussd.screenHardCap) });
    expect(ok.ok).toBe(true);
  });

  it('parseWebhook rejects wrong or missing secret without reading the body', () => {
    const a = new UssdAdapter({ webhookSecret: 's' });
    const body = new Proxy(
      {},
      {
        get() {
          throw new Error('body was read');
        },
      },
    );
    for (const query of [{ secret: 'bad' }, {}]) {
      const r = a.parseWebhook({ body, query, headers: {} });
      expect(r).toEqual({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Request rejected.' } });
    }
  });
});
