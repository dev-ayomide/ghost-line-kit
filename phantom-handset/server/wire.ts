/**
 * Builds the handler's dependencies from environment variables.
 * The only file in server/ that may use node:* (for randomUUID).
 */
import { randomUUID } from 'node:crypto';
import {
  Agent,
  BedrockProvider,
  DynamoStore,
  MemoryStore,
  MessageProcessor,
  RateLimiter,
  SessionStateMachine,
  SystemClock,
  ToolRegistry,
  createLogger,
} from '@ghostline/kit';
import type { Clock, LlmProvider, Store, TraceEvent } from '@ghostline/kit';
import type { HandsetTraceEvent } from '../shared/api.js';
import { getApps } from './apps.js';
import type { HandlerApp, HandlerDeps } from './handler.js';
import { KeywordLlmProvider } from './stand-in.js';

/** True for 127.0.0.1, ::1 and localhost. An unset or empty host means the default (loopback). */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const h = host.trim().toLowerCase();
  return h === '' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'localhost';
}

/** Optional overrides, used by tests to observe the shared store and clock. */
export interface SharedDeps {
  store?: Store;
  clock?: Clock;
}
export function createDeps(env: Record<string, string | undefined>, shared: SharedDeps = {}): HandlerDeps {
  let store: Store;
  if (shared.store) {
    store = shared.store;
  } else if (env['HANDSET_STORE'] === 'dynamo') {
    const tableName = env['DYNAMO_TABLE_NAME'];
    if (!tableName) throw new Error('DYNAMO_TABLE_NAME is required when HANDSET_STORE=dynamo');
    const region = env['AWS_REGION'];
    store = new DynamoStore({ tableName, ...(region ? { region } : {}) });
  } else {
    store = new MemoryStore();
  }
  const clock: Clock = shared.clock ?? new SystemClock();
  const logger = createLogger(env['NODE_ENV']);
  const session = new SessionStateMachine({ store, clock });
  const rateLimiter = new RateLimiter({ store, clock });
  const llm: LlmProvider = env['HANDSET_LLM'] === 'bedrock' ? new BedrockProvider() : new KeywordLlmProvider();

  const traceEnabled = env['HANDSET_TRACE'] !== 'off';
  const collectors = new Map<string, HandsetTraceEvent[]>();
  const onTrace = (event: TraceEvent): void => {
    const { messageId, ...rest } = event;
    collectors.get(messageId)?.push(rest);
  };

  const apps = new Map<string, HandlerApp>();
  for (const app of getApps({ store, clock })) {
    const tools = new ToolRegistry();
    app.tools.forEach((t) => tools.register(t));
    const agent = new Agent({ llm: app.llm ?? llm, tools, intentNames: app.intentNames });
    const processor = new MessageProcessor({
      store,
      session,
      agent,
      clock,
      rateLimiter,
      logger,
      ...(app.nextStep ? { nextStep: app.nextStep } : {}),
      ...(app.copy ? { copy: app.copy } : {}),
      ...(app.buildToolCall ? { buildToolCall: app.buildToolCall } : {}),
      ...(app.renderOutput ? { renderOutput: app.renderOutput } : {}),
      ...(app.eraseUserData ? { eraseUserData: app.eraseUserData } : {}),
      ...(traceEnabled ? { onTrace } : {}),
    });
    apps.set(app.id, { id: app.id, name: app.name, processor });
  }

  const host = env['HOST'];
  return {
    apps,
    collectors,
    traceEnabled,
    logger,
    newId: () => randomUUID(),
    requireToken: host !== undefined && host.trim() !== '' && !isLoopbackHost(host),
    accessToken: env['HANDSET_ACCESS_TOKEN'],
    allowedOrigin: env['HANDSET_ALLOWED_ORIGIN'] || undefined,
  };
}
