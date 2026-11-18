import type { z } from 'zod';
import { LIMITS } from '../limits.js';

/** A tool the agent may call. `execute` receives the validated, parsed input. */
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (input: unknown) => Promise<unknown>;
}

export type ToolResult =
  | { ok: true; output: unknown }
  | { ok: false; userMessage: string };

// Plain GSM-7 text only. Each is a single SMS and has a recovery action.
const UNKNOWN_TOOL_MESSAGE = 'That is not available. Try again or send HELP for options.';
const INVALID_INPUT_MESSAGE =
  'That did not work. Check your message and try again. Send HELP for options.';
const FAILED_MESSAGE = 'Something went wrong. Try again in a moment. Send HELP for options.';

function capped(message: string): string {
  return message.slice(0, LIMITS.reply.errorMaxLength);
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (typeof tool.name !== 'string' || tool.name.trim() === '') {
      throw new Error('Tool name must not be empty.');
    }
    if (this.tools.has(tool.name)) {
      throw new Error('Tool name is already registered.');
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  async invoke(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, userMessage: capped(UNKNOWN_TOOL_MESSAGE) };

    let parsed: unknown;
    try {
      const result = tool.inputSchema.safeParse(input);
      if (!result.success) return { ok: false, userMessage: capped(INVALID_INPUT_MESSAGE) };
      parsed = result.data;
    } catch {
      return { ok: false, userMessage: capped(INVALID_INPUT_MESSAGE) };
    }

    try {
      const output = await tool.execute(parsed);
      return { ok: true, output };
    } catch {
      return { ok: false, userMessage: capped(FAILED_MESSAGE) };
    }
  }
}
