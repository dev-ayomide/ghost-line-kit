import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { StoreError, type Store } from './store.js';

export interface DynamoStoreOptions {
  /** DynamoDB table name. Required. */
  tableName: string;
  /** Injectable document client (tests pass a fake). */
  client?: DynamoDBDocumentClient;
  /** AWS region used when no client is given. Defaults to `process.env.AWS_REGION`. */
  region?: string;
}

/**
 * Store backed by a single DynamoDB table.
 *
 * Table layout:
 * - partition key: `pk` (string), no sort key. Its value is the store key.
 * - `value` (string): `JSON.stringify(value)` of the stored value.
 *
 * Each write or delete is a single-item Put/Delete, which is atomic, so a
 * failure never changes other items. SDK errors are re-thrown as `StoreError`
 * and never include the stored value. Nothing is logged.
 */
export class DynamoStore implements Store {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: DynamoStoreOptions) {
    if (!options.tableName) {
      throw new Error('DynamoStore requires a table name');
    }
    this.tableName = options.tableName;
    this.client =
      options.client ??
      DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: options.region ?? process.env.AWS_REGION }),
      );
  }

  async read<T>(key: string): Promise<T | undefined> {
    let raw: unknown;
    try {
      const out = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: { pk: key } }),
      );
      raw = out.Item?.value;
    } catch (cause) {
      throw new StoreError('read', key, cause);
    }
    if (raw === undefined) return undefined;
    try {
      if (typeof raw !== 'string') throw new Error('Stored value is not a string');
      return JSON.parse(raw) as T;
    } catch (cause) {
      throw new StoreError('read', key, cause);
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
      if (json === undefined) throw new Error('Value is not serialisable');
    } catch (cause) {
      throw new StoreError('write', key, cause);
    }
    try {
      await this.client.send(
        new PutCommand({ TableName: this.tableName, Item: { pk: key, value: json } }),
      );
    } catch (cause) {
      throw new StoreError('write', key, cause);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: { pk: key } }),
      );
    } catch (cause) {
      throw new StoreError('delete', key, cause);
    }
  }
}
