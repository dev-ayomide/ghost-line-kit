import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, type Tool } from '../src/agent/tool-registry.js';
import { detectEncoding } from '../src/format/encoding.js';
import { LIMITS } from '../src/limits.js';

function makeTool(over: Partial<Tool> = {}): Tool {
  return {
    name: 'add',
    description: 'adds',
    inputSchema: z.object({ n: z.coerce.number(), step: z.number().default(5) }),
    execute: async (i) => i,
    ...over,
  };
}

function expectGoodMessage(msg: string): void {
  expect(msg.length).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
  expect(detectEncoding(msg)).toBe('GSM-7');
  expect(msg).toMatch(/Try|Send/);
}

describe('ToolRegistry (Requirements 10.1-10.4)', () => {
  it('registers and retrieves tools', () => {
    const r = new ToolRegistry();
    const t = makeTool();
    r.register(t);
    expect(r.has('add')).toBe(true);
    expect(r.get('add')).toBe(t);
    expect(r.has('nope')).toBe(false);
    expect(r.get('nope')).toBeUndefined();
    expect(r.list()).toEqual([t]);
  });

  it('rejects duplicate and empty names', () => {
    const r = new ToolRegistry();
    r.register(makeTool());
    expect(() => r.register(makeTool())).toThrow(Error);
    expect(() => r.register(makeTool({ name: '' }))).toThrow(Error);
    expect(r.list()).toHaveLength(1);
  });

  it('executes with the parsed value', async () => {
    const r = new ToolRegistry();
    const execute = vi.fn(async (i: unknown) => i);
    r.register(makeTool({ execute }));
    const res = await r.invoke('add', { n: '7' });
    expect(res).toEqual({ ok: true, output: { n: 7, step: 5 } });
    expect(execute).toHaveBeenCalledWith({ n: 7, step: 5 });
  });

  it('does not execute on invalid input and hides zod text', async () => {
    const r = new ToolRegistry();
    const execute = vi.fn(async () => 1);
    r.register(makeTool({ execute }));
    const res = await r.invoke('add', { n: 'abc', step: 'secret-input' });
    expect(execute).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expectGoodMessage(res.userMessage);
      expect(res.userMessage).not.toMatch(/zod|invalid|expected|number|add|secret-input/i);
    }
  });

  it('returns an error for unknown tools and executes nothing', async () => {
    const r = new ToolRegistry();
    const execute = vi.fn(async () => 1);
    r.register(makeTool({ execute }));
    const res = await r.invoke('missing', { n: 1 });
    expect(execute).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expectGoodMessage(res.userMessage);
      expect(res.userMessage).not.toContain('missing');
    }
  });

  it('hides errors thrown or rejected by a tool', async () => {
    const r = new ToolRegistry();
    r.register(
      makeTool({
        name: 'boom',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('db password=hunter2 at /srv/app.ts:12');
        },
      }),
    );
    r.register(
      makeTool({
        name: 'sync',
        inputSchema: z.object({}),
        execute: () => {
          throw new Error('internal-id-99');
        },
      }),
    );
    for (const name of ['boom', 'sync']) {
      const res = await r.invoke(name, {});
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expectGoodMessage(res.userMessage);
        expect(res.userMessage).not.toMatch(/hunter2|internal-id|srv|boom|sync/);
      }
    }
  });
});
