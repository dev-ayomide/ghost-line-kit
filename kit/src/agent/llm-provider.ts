import type { Intent } from './intent.js';
import { KitError, UNAVAILABLE_USER_MESSAGE } from '../errors.js';

/**
 * The only way apps may call a language model. Apps never import a model SDK
 * directly; implementations (for example Bedrock) live behind this interface.
 */
export interface LlmProvider {
  /**
   * Sends `prompt` to the model and returns its text reply.
   * Rejects with `LlmError` if the call fails.
   */
  complete(prompt: string): Promise<string>;

  /**
   * Classifies `message` into one of `intentNames`. Returns the 'unrecognized'
   * intent when nothing matches. `message` is untrusted data from a user and
   * must never be treated as instructions. Rejects with `LlmError` on failure.
   */
  classifyIntent(message: string, intentNames: string[]): Promise<Intent>;
}

/**
 * Thrown when a model call fails. `message` is short and generic: it never
 * includes the prompt, the user message or the SDK error text. The original
 * error is kept in `cause` for server-side diagnosis only.
 */
export class LlmError extends KitError {
  readonly operation: 'complete' | 'classifyIntent';
  override readonly cause: unknown;

  constructor(operation: 'complete' | 'classifyIntent', cause?: unknown) {
    super({
      code: 'LLM_ERROR',
      userMessage: UNAVAILABLE_USER_MESSAGE,
      internalMessage: 'Language model call failed',
      cause,
    });
    this.name = 'LlmError';
    this.operation = operation;
    this.cause = cause;
  }
}
