import { z } from 'zod';
import { Agent } from '../src/agent/agent.js';
import type { Intent } from '../src/agent/intent.js';
import type { LlmProvider } from '../src/agent/llm-provider.js';
import { ToolRegistry } from '../src/agent/tool-registry.js';
import type { InboundMessage, ChannelType } from '../src/channels/types.js';
import type { SafeLogger } from '../src/logger.js';
import { MessageProcessor, type MessageProcessorConfig } from '../src/processor.js';
import { RateLimiter } from '../src/rate-limiter.js';
import { TestClock } from '../src/session/clock.js';
import { SessionStateMachine } from '../src/session/session-state-machine.js';
import { MemoryStore } from '../src/store/memory-store.js';

export const PHONE = '+2348051234567';

export interface Harness {
  store: MemoryStore;
  clock: TestClock;
  session: SessionStateMachine;
  rateLimiter: RateLimiter;
  logs: unknown[];
  processor: MessageProcessor;
  /** Tool output returned by the `echo` tool; set per test. */
  toolOutput: { value: unknown };
  /** Replaces the fake model's classifier. */
  setClassifier(fn: (message: string) => Promise<Intent>): void;
  msg(text: string, channel?: ChannelType, from?: string): InboundMessage;
}

export function makeHarness(extra: Partial<MessageProcessorConfig> = {}): Harness {
  const store = new MemoryStore();
  const clock = new TestClock(1_000_000);
  const session = new SessionStateMachine({ store, clock });
  const rateLimiter = new RateLimiter({ store, clock });
  const logs: unknown[] = [];
  const logger: SafeLogger = {
    info: (e) => void logs.push({ level: 'info', ...e }),
    error: (e) => void logs.push({ level: 'error', ...e }),
  };
  const toolOutput = { value: 'ok' as unknown };
  let classifier: (m: string) => Promise<Intent> = async (m): Promise<Intent> =>
    m.toLowerCase().startsWith('echo')
      ? { name: 'echo', parameters: { word: m.slice(4).trim() || 'x' }, rawMessage: m }
      : { name: 'unrecognized', parameters: {} as Intent['parameters'], rawMessage: m };
  const llm: LlmProvider = {
    complete: async () => '',
    classifyIntent: (m) => classifier(m),
  };
  const tools = new ToolRegistry();
  tools.register({
    name: 'echo',
    description: 'echo',
    inputSchema: z.object({ word: z.string().min(1).max(20), phoneNumber: z.string() }),
    execute: async () => toolOutput.value,
  });
  const agent = new Agent({ llm, tools, intentNames: ['echo'] });
  const processor = new MessageProcessor({
    store,
    session,
    agent,
    clock,
    rateLimiter,
    logger,
    ...extra,
  });
  return {
    store,
    clock,
    session,
    rateLimiter,
    logs,
    processor,
    toolOutput,
    setClassifier: (fn) => {
      classifier = fn;
    },
    msg: (text, channel = 'sms', from = PHONE) => ({
      from,
      text,
      channel,
      timestamp: clock.now(),
      messageId: `m-${Math.random().toString(36).slice(2, 8)}`,
      ...(channel === 'ussd' ? { sessionId: 'sess-1' } : {}),
    }),
  };
}
