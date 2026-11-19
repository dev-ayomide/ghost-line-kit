import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DevLogger, ProductionLogger, createLogger } from '../src/logger.js';

const ALLOWED = new Set(['level', 'time', 'event', 'error', 'messageId', 'messageLength', 'phone']);

function capture() {
  const lines: string[] = [];
  const sink = (l: string) => void lines.push(l);
  return { lines, opts: { info: sink, error: sink } };
}

describe('logger safety', () => {
  // Feature: kit-core, Property 14: logs never contain message bodies or full phone numbers
  // **Validates: Requirements 14.2, 18.1, 18.2, 18.3**
  it('Property 14: logs never contain message bodies or full phone numbers', () => {
    const digits = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 15 })
      .map((a) => a.join(''));
    fc.assert(
      fc.property(
        digits,
        fc.boolean(),
        fc.stringMatching(/^[a-z0-9]{6,12}$/),
        fc.string(),
        fc.integer({ min: 0, max: 1000 }),
        (phoneDigits, plus, rnd, junk, len) => {
          const markers = [`BODYMARK${rnd}`, `TEXTMARK${rnd}`, `MSGMARK${rnd}`];
          const extra = {
            body: markers[0] + junk,
            text: markers[1],
            message: markers[2],
          };
          const phoneNumber = (plus ? '+' : '') + phoneDigits;
          for (const mk of [
            (c: ReturnType<typeof capture>) => new ProductionLogger(c.opts),
            (c: ReturnType<typeof capture>) => new DevLogger(c.opts),
          ]) {
            const c = capture();
            const logger = mk(c);
            logger.info({ event: 'inbound', messageId: 'm-1', phoneNumber, messageLength: len, ...extra } as never);
            logger.error({ error: 'AT_API_ERROR', messageId: 'm-1', phoneNumber, messageLength: len, ...extra } as never);
            // Extra props that smuggle text through the code fields are replaced.
            logger.info({ event: `${markers[0]} free text`, phoneNumber, ...extra } as never);
            expect(c.lines).toHaveLength(3);
            for (const line of c.lines) {
              for (const m of markers) expect(line).not.toContain(m);
              expect(line).not.toContain(phoneDigits);
              const parsed = JSON.parse(line) as Record<string, unknown>;
              for (const k of Object.keys(parsed)) expect(ALLOWED.has(k)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('production line has only allowed keys', () => {
    const c = capture();
    new ProductionLogger(c.opts).info({
      event: 'inbound',
      messageId: 'abc-1',
      phoneNumber: '+2348012344567',
      messageLength: 12,
      body: 'secret',
    } as never);
    const parsed = JSON.parse(c.lines[0]!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['event', 'level', 'messageId', 'messageLength', 'phone']);
    expect(c.lines[0]).not.toContain('secret');
  });

  it('masks phone like +234******4567', () => {
    const c = capture();
    new ProductionLogger(c.opts).info({ event: 'x', phoneNumber: '+2348012344567' });
    expect((JSON.parse(c.lines[0]!) as { phone: string }).phone).toBe('+234******4567');
  });

  it('replaces weird event/error strings and short phones', () => {
    const c = capture();
    const l = new ProductionLogger(c.opts);
    l.info({ event: 'hello world, free text!', phoneNumber: '12' });
    l.error({ error: '', messageId: 'bad id!', messageLength: -1 });
    const a = JSON.parse(c.lines[0]!) as Record<string, unknown>;
    const b = JSON.parse(c.lines[1]!) as Record<string, unknown>;
    expect(a.event).toBe('EVENT');
    expect(a.phone).toBe('***');
    expect(b.error).toBe('ERROR');
    expect(b).not.toHaveProperty('messageId');
    expect(b).not.toHaveProperty('messageLength');
  });

  it('a throwing sink does not throw', () => {
    const boom = () => {
      throw new Error('sink down');
    };
    for (const l of [new ProductionLogger({ info: boom, error: boom }), new DevLogger({ info: boom, error: boom })]) {
      expect(() => l.info({ event: 'x' })).not.toThrow();
      expect(() => l.error({ error: 'x' })).not.toThrow();
    }
  });

  it('createLogger picks the right class', () => {
    expect(createLogger('production')).toBeInstanceOf(ProductionLogger);
    expect(createLogger('development')).toBeInstanceOf(DevLogger);
    expect(createLogger(undefined)).toBeInstanceOf(DevLogger);
  });

  it('DevLogger adds time from the injected clock and is pretty-printed', () => {
    const c = capture();
    new DevLogger({ ...c.opts, now: () => 0 }).info({ event: 'x' });
    expect(c.lines[0]).toContain('\n  "time": "1970-01-01T00:00:00.000Z"');
  });

  it('does not log on construction', () => {
    const c = capture();
    new ProductionLogger(c.opts);
    new DevLogger(c.opts);
    expect(c.lines).toHaveLength(0);
  });
});
