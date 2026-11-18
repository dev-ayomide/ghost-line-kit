import { UNRECOGNIZED_INTENT, type Intent } from './intent.js';
import type { LlmProvider } from './llm-provider.js';
import type { ToolRegistry, ToolResult } from './tool-registry.js';

export interface AgentOptions {
  llm: LlmProvider;
  tools: ToolRegistry;
  intentNames: string[];
}

/**
 * Classifies messages and invokes tools. Never trusts the provider: an intent
 * name outside `intentNames` is treated as unrecognized (Req 9.5).
 */
export class Agent {
  private readonly llm: LlmProvider;
  private readonly tools: ToolRegistry;
  private readonly names: readonly string[];

  constructor(options: AgentOptions) {
    this.llm = options.llm;
    this.tools = options.tools;
    const cleaned = new Set<string>();
    for (const name of options.intentNames) {
      if (typeof name === 'string' && name !== '' && name !== UNRECOGNIZED_INTENT) {
        cleaned.add(name);
      }
    }
    this.names = Object.freeze([...cleaned]);
  }

  /** A copy of the allowed intent names; changing it does not affect the agent. */
  get intentNames(): readonly string[] {
    return [...this.names];
  }

  async classify(message: string): Promise<Intent> {
    if (message.trim() === '') return unrecognized(message);
    // Provider errors (LlmError included) propagate unchanged.
    const intent = await this.llm.classifyIntent(message, [...this.names]);
    if (!intent || typeof intent.name !== 'string' || !this.names.includes(intent.name)) {
      return unrecognized(message);
    }
    return { name: intent.name, parameters: intent.parameters ?? {}, rawMessage: message };
  }

  invokeTool(name: string, input: unknown): Promise<ToolResult> {
    return this.tools.invoke(name, input);
  }
}

function unrecognized(message: string): Intent {
  return { name: UNRECOGNIZED_INTENT, parameters: {}, rawMessage: message };
}
