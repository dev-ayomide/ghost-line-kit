import { StoreError, type Store } from './store.js';

/**
 * In-memory `Store` for tests and local development.
 *
 * Values must be JSON-serialisable. They are held as JSON strings, like
 * DynamoStore, so callers cannot change stored data through a reference they
 * hold, and every `read` returns a fresh copy.
 */
export class MemoryStore implements Store {
  private readonly data = new Map<string, string>();

  async read<T>(key: string): Promise<T | undefined> {
    const json = this.data.get(key);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  }

  async write<T>(key: string, value: T): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch (cause) {
      throw new StoreError('write', key, cause);
    }
    if (json === undefined) {
      throw new StoreError('write', key, new Error('Value is not JSON-serialisable'));
    }
    this.data.set(key, json);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}
