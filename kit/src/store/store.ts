import { KitError, UNAVAILABLE_USER_MESSAGE } from '../errors.js';

/**
 * Key-value persistence used for session state, user preferences and app data.
 *
 * Every operation is keyed by a string identifier. If an operation fails, the
 * returned promise rejects with an error (implementations use `StoreError`)
 * and previously persisted data is left untouched.
 *
 * This file must stay free of any AWS SDK import. SDK code lives only in
 * implementation files such as `dynamo-store.ts`.
 */
export interface Store {
  /** Resolves the value stored under `key`, or `undefined` if the key is missing. */
  read<T>(key: string): Promise<T | undefined>;

  /** Stores `value` under `key`, replacing any existing value. */
  write<T>(key: string, value: T): Promise<void>;

  /** Removes `key`. Resolves without error if the key does not exist. */
  delete(key: string): Promise<void>;
}

/**
 * Error raised when a store operation fails.
 *
 * The message is short and never contains the stored value. The original
 * error is kept in `cause` for logs.
 */
export class StoreError extends KitError {
  readonly operation: 'read' | 'write' | 'delete';
  readonly key: string;
  override readonly cause: unknown;

  constructor(operation: 'read' | 'write' | 'delete', key: string, cause?: unknown) {
    super({
      code: 'STORE_ERROR',
      userMessage: UNAVAILABLE_USER_MESSAGE,
      internalMessage: `Store ${operation} failed`,
      cause,
    });
    this.name = 'StoreError';
    this.operation = operation;
    this.key = key;
    this.cause = cause;
  }
}
