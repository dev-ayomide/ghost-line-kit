import type { Clock, LlmProvider, MessageProcessorConfig, ProcessorCopy, Store, Tool } from '@ghostline/kit';
import { createOjaGhost } from '@ghostline/oja-ghost';
import { STAND_IN_APPS } from './stand-in.js';

/** What the server loads from each app (design Open question 4). */
export interface HandsetApp {
  id: string;
  name: string;
  tools: Tool[];
  intentNames: string[];
  copy?: Partial<ProcessorCopy>;
  buildToolCall?: MessageProcessorConfig['buildToolCall'];
  renderOutput?: MessageProcessorConfig['renderOutput'];
  eraseUserData?: (phoneNumber: string) => Promise<void>;
  /** Optional classifier. When set, wire.ts uses it instead of the handset-wide provider. */
  llm?: LlmProvider;
  /** Optional text appended to menu replies (kit `nextStep` option). */
  nextStep?: string;
}

/**
 * The apps served by the handset. Oja Ghost is the real app and must share the
 * handler's store and clock. Blackout Line stays a stand-in until its own spec.
 */
export function getApps(shared: { store: Store; clock: Clock }): HandsetApp[] {
  const blackout = STAND_IN_APPS.filter((a) => a.id === 'blackout-line');
  return [createOjaGhost({ store: shared.store, clock: shared.clock }), ...blackout];
}
