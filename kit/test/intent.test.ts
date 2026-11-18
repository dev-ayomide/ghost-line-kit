import { describe, expect, it } from 'vitest';
import { UNRECOGNIZED_INTENT, parseIntent, serializeIntent } from '../src/agent/intent.js';

describe('intent', () => {
  it('exposes the unrecognized constant', () => {
    expect(UNRECOGNIZED_INTENT).toBe('unrecognized');
  });

  it('round-trips a simple intent', () => {
    const i = { name: 'price', parameters: { item: 'yam', qty: 2, rush: true }, rawMessage: 'yam?' };
    expect(parseIntent(serializeIntent(i))).toEqual(i);
  });

  it('throws a short error that does not echo invalid JSON', () => {
    const input = 'secret message text {';
    let msg = '';
    try {
      parseIntent(input);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe('');
    expect(msg).not.toContain('secret');
    expect(msg.length).toBeLessThan(60);
  });

  it('throws on a missing field without echoing content', () => {
    expect(() => parseIntent('{"name":"x","parameters":{}}')).toThrow(/Invalid intent/);
    expect(() => parseIntent('{"name":"x","parameters":{"k":1},"rawMessage":null}')).toThrow(Error);
  });

  it('rejects a nested object under a __proto__ key and does not pollute', () => {
    const json = '{"name":"x","parameters":{"__proto__":{"polluted":true}},"rawMessage":""}';
    expect(() => parseIntent(json)).toThrow(/Invalid intent/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a string-valued __proto__ key as plain own data', () => {
    const out = parseIntent('{"name":"x","parameters":{"__proto__":"v","constructor":"c"},"rawMessage":""}');
    expect(Object.keys(out.parameters).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.getOwnPropertyDescriptor(out.parameters, '__proto__')?.value).toBe('v');
    expect(Object.getPrototypeOf(out.parameters)).toBe(Object.prototype);
  });

  it('rejects non-finite numbers', () => {
    expect(() => parseIntent('{"name":"x","parameters":{"n":1e999},"rawMessage":""}')).toThrow(Error);
  });
});
