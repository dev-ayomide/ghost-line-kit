import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../src/agent/agent.js';
import { LlmError, type LlmProvider } from '../src/agent/llm-provider.js';
import { ToolRegistry } from '../src/agent/tool-registry.js';
import type { Intent } from '../src/agent/intent.js';
import { LIMITS } from '../src/limits.js';

function fakeLlm(impl: (message: string, names: string[]) => Promise<Intent>) {
  const classifyIntent = vi.fn(impl);
  const llm: LlmProvider = { complete: async () => '', classifyIntent };
  return { llm, classifyIntent };
}

function makeAgent(impl: (m: string, n: string[]) => Promise<Intent>, names = ['price', 'debt']) {
  const { llm, classifyIntent } = fakeLlm(impl);
  const tools = new ToolRegistry();
  const execute = vi.fn(async (input: unknown) => ({ got: input }));
  tools.register({
    name: 'add',
    description: 'adds',
    inputSchema: z.object({ n: z.coerce.number() }),
    execute,
  });
  return { agent: new Agent({ llm, tools, intentNames: names }), classifyIntent, execute };
}

describe('Agent.classify', () => {
  it('returns unrecognized when the provider returns an unknown name', async () => {
    const { agent } = makeAgent(async (m) => ({ name: 'hack', parameters: {}, rawMessage: m }));
    expect(await agent.classify('hi')).toEqual({
      name: 'unrecognized',
      parameters: {},
      rawMessage: 'hi',
    });
  });

  it('returns unrecognized for blank input without calling the model', async () => {
    const { agent, classifyIntent } = makeAgent(async (m) => ({
      name: 'price',
      parameters: {},
      rawMessage: m,
    }));
    for (const blank of ['', '   ', '\n\t ']) {
      expect((await agent.classify(blank)).name).toBe('unrecognized');
    }
    expect(classifyIntent).not.toHaveBeenCalled();
  });

  it('passes a valid intent through with the real rawMessage', async () => {
    const { agent, classifyIntent } = makeAgent(async () => ({
      name: 'price',
      parameters: { item: 'rice' },
      rawMessage: 'something else',
    }));
    expect(await agent.classify('price of rice')).toEqual({
      name: 'price',
      parameters: { item: 'rice' },
      rawMessage: 'price of rice',
    });
    expect(classifyIntent).toHaveBeenCalledWith('price of rice', ['price', 'debt']);
  });

  it('propagates provider errors unchanged', async () => {
    const err = new LlmError('classifyIntent');
    const { agent } = makeAgent(async () => {
      throw err;
    });
    await expect(agent.classify('hi')).rejects.toBe(err);
  });
});

describe('Agent.invokeTool', () => {
  it('returns an actionable capped message and does not execute on invalid input', async () => {
    const { agent, execute } = makeAgent(async (m) => ({ name: 'price', parameters: {}, rawMessage: m }));
    const result = await agent.invokeTool('add', { n: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userMessage.length).toBeGreaterThan(0);
      expect(result.userMessage.length).toBeLessThanOrEqual(LIMITS.reply.errorMaxLength);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns an error for an unregistered tool and executes nothing', async () => {
    const { agent, execute } = makeAgent(async (m) => ({ name: 'price', parameters: {}, rawMessage: m }));
    const result = await agent.invokeTool('nope', { n: 1 });
    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes a valid call with the parsed input', async () => {
    const { agent, execute } = makeAgent(async (m) => ({ name: 'price', parameters: {}, rawMessage: m }));
    const result = await agent.invokeTool('add', { n: '5' });
    expect(result).toEqual({ ok: true, output: { got: { n: 5 } } });
    expect(execute).toHaveBeenCalledWith({ n: 5 });
  });
});

describe('Agent intent names', () => {
  it('drops reserved, empty and duplicate names', () => {
    const { agent } = makeAgent(async (m) => ({ name: 'x', parameters: {}, rawMessage: m }), [
      'price',
      '',
      'unrecognized',
      'price',
      'debt',
    ]);
    expect(agent.intentNames).toEqual(['price', 'debt']);
  });

  it('copies the input list and exposes a copy', () => {
    const names = ['price'];
    const { agent } = makeAgent(async (m) => ({ name: 'x', parameters: {}, rawMessage: m }), names);
    names.push('debt');
    (agent.intentNames as string[]).push('evil');
    expect(agent.intentNames).toEqual(['price']);
  });
});
