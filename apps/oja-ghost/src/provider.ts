// OjaRuleProvider: an LlmProvider that never calls a model. Classification is rule-based.
import type { Intent, LlmProvider } from '@ghostline/kit';
import { ojaConfig } from './app.config.ts';
import { routeIntent } from './parse.ts';

export { toolFor } from './parse.ts';

export class OjaRuleProvider implements LlmProvider {
  async classifyIntent(message: string, _intentNames: string[]): Promise<Intent> {
    return { name: routeIntent(message), parameters: {}, rawMessage: message };
  }

  /** Never used in v1: no model is called. Returns a short fixed reply. */
  async complete(_prompt: string): Promise<string> {
    return ojaConfig.copy.en.tryAgain;
  }
}
