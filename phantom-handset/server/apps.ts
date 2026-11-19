import type { MessageProcessorConfig, ProcessorCopy, Tool } from '@ghostline/kit';
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
}

/**
 * The apps served by the handset.
 * TODO(app specs): replace the stand-ins with the real apps, for example
 * `[ojaGhost, blackoutLine]` from their `app.config.ts`, once they satisfy HandsetApp.
 */
export function getApps(): HandsetApp[] {
  return STAND_IN_APPS;
}
