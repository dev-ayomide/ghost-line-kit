import { LIMITS } from './limits.js';
import { detectEncoding } from './format/encoding.js';

/**
 * Errors that are safe to show on a phone.
 *
 * `userMessage` is what the user sees. It is validated when the error is
 * built: short, GSM-7, free of stack traces and internal IDs, and it tells the
 * user what to do next. `internalMessage` (also set as `Error.message`) is for
 * logs only and is never sent to a user.
 *
 * This file must not import from store/ or agent/ (they extend KitError).
 */

const UNAVAILABLE_MESSAGE = 'Service briefly unavailable. Try again in a moment.';
const GENERIC_MESSAGE = 'Something went wrong. Try again. Send HELP for options.';
const RATE_LIMITED_MESSAGE = 'Too many messages. Wait 1 min and try again.';
const INVALID_INPUT_MESSAGE = 'That did not work. Send HELP for options.';

/** Patterns that must never appear in a user message. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\n\s+at /,
  /Error:/,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /\b[0-9a-f]{16,}\b/i,
  /arn:/i,
];

const RECOVERY_ACTION = /\b(Try|Send|Wait|Reply)\b/;

/** Throws a plain Error if `text` is not safe to show to a user. */
function assertSafeUserMessage(text: string): void {
  if (text.length > LIMITS.reply.errorMaxLength) {
    throw new Error('KitError userMessage too long');
  }
  if (detectEncoding(text) !== 'GSM-7') {
    throw new Error('KitError userMessage must be GSM-7');
  }
  if (FORBIDDEN_PATTERNS.some((p) => p.test(text))) {
    throw new Error('KitError userMessage contains internal detail');
  }
  if (!RECOVERY_ACTION.test(text)) {
    throw new Error('KitError userMessage needs a recovery action');
  }
}

export interface KitErrorInit {
  code: string;
  userMessage: string;
  internalMessage: string;
  cause?: unknown;
}

export class KitError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly internalMessage: string;
  override readonly cause?: unknown;

  constructor({ code, userMessage, internalMessage, cause }: KitErrorInit) {
    assertSafeUserMessage(userMessage);
    super(internalMessage);
    this.name = 'KitError';
    this.code = code;
    this.userMessage = userMessage;
    this.internalMessage = internalMessage;
    this.cause = cause;
  }

  /** The sender sent too many messages. */
  static rateLimited(): KitError {
    return new KitError({
      code: 'RATE_LIMITED',
      userMessage: RATE_LIMITED_MESSAGE,
      internalMessage: 'Rate limit exceeded',
    });
  }

  /** A dependency (store, model, telco API) is temporarily failing. */
  static unavailable(code: string, internalMessage: string, cause?: unknown): KitError {
    return new KitError({ code, userMessage: UNAVAILABLE_MESSAGE, internalMessage, cause });
  }

  /** The input was not understood or failed validation. */
  static invalidInput(): KitError {
    return new KitError({
      code: 'INVALID_INPUT',
      userMessage: INVALID_INPUT_MESSAGE,
      internalMessage: 'Invalid input',
    });
  }

  /** Fallback for anything else. */
  static generic(internalMessage: string, cause?: unknown): KitError {
    return new KitError({ code: 'GENERIC', userMessage: GENERIC_MESSAGE, internalMessage, cause });
  }
}

/** Shared user message for unavailable dependencies (used by StoreError, LlmError). */
export const UNAVAILABLE_USER_MESSAGE = UNAVAILABLE_MESSAGE;

/**
 * Text that is safe to send to a user. Never derived from a non-KitError
 * error: no message and no stack.
 */
export function toUserMessage(err: unknown): string {
  return err instanceof KitError ? err.userMessage : GENERIC_MESSAGE;
}

/** Error code that is safe to log. */
export function internalErrorCode(err: unknown): string {
  return err instanceof KitError ? err.code : 'UNEXPECTED';
}
