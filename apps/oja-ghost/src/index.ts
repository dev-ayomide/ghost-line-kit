// oja-ghost entry point: createOjaGhost builds the app object the Phantom Handset loads.
// Apps import only from '@ghostline/kit', never from kit internals.
import {
  MemoryStore,
  SystemClock,
  type Clock,
  type LlmProvider,
  type MessageProcessorConfig,
  type ProcessorCopy,
  type Store,
  type Tool,
} from '@ghostline/kit';
import { ojaConfig } from './app.config.ts';
import { eraseUserData } from './erase.ts';
import { OjaRuleProvider, toolFor } from './provider.ts';
import { makeEnsureSeeded } from './seed.ts';
import { coreTools } from './tools.ts';

export { dispatchDueReminders } from './dispatch.ts';
export type { DispatchDeps, DispatchSummary } from './dispatch.ts';

export interface OjaGhostDeps {
  /**
   * Defaults to a fresh MemoryStore. The Phantom Handset must pass the SAME store it gives
   * the MessageProcessor, so isSubscribed reads the right `user:<phone>` record.
   */
  store?: Store;
  clock?: Clock;
  /** Demo mode: seeds sample data and shows the demo notice. Default true. */
  demo?: boolean;
}

export interface OjaGhostApp {
  id: 'oja-ghost';
  name: 'Oja Ghost';
  tools: Tool[];
  intentNames: string[];
  copy: Partial<ProcessorCopy>;
  nextStep: string;
  buildToolCall: NonNullable<MessageProcessorConfig['buildToolCall']>;
  eraseUserData: (phoneNumber: string) => Promise<void>;
  llm: LlmProvider;
}

export function createOjaGhost(deps: OjaGhostDeps = {}): OjaGhostApp {
  const store = deps.store ?? new MemoryStore();
  const clock = deps.clock ?? new SystemClock();
  const demo = deps.demo ?? true;

  const tools = coreTools({ store, clock, demo, ensureSeeded: makeEnsureSeeded(store, clock, demo) });

  const toolNames = new Set(tools.map((t) => t.name));
  for (const [intent, tool] of Object.entries(ojaConfig.intentTool)) {
    if (!toolNames.has(tool)) throw new Error(`oja-ghost: intent ${intent} targets missing tool ${tool}`);
  }
  for (const name of ojaConfig.intentNames) {
    const tool = (ojaConfig.intentTool as Readonly<Record<string, string>>)[name];
    if (tool === undefined || !toolNames.has(tool)) {
      throw new Error(`oja-ghost: intent ${name} has no tool`);
    }
  }

  return {
    id: 'oja-ghost',
    name: 'Oja Ghost',
    tools,
    intentNames: [...ojaConfig.intentNames],
    copy: { ...ojaConfig.processorCopy },
    nextStep: ojaConfig.nextStep,
    buildToolCall: (intent, ctx) => ({
      name: toolFor(intent.name),
      input: { phoneNumber: ctx.phoneNumber, channel: ctx.channel, text: intent.rawMessage },
    }),
    eraseUserData: (phone) => eraseUserData(store, phone),
    llm: new OjaRuleProvider(),
  };
}
