// @ghostline/kit public API. This is the ONLY entry point apps may import.
// Explicit named re-exports only (no `export *`): every export is a deliberate choice.
// Internals (splitByLimit, summarizeSegments, classification helpers, webPayloadSchema)
// are intentionally not exported.

// Limits
export { LIMITS } from './limits.js';

// Format
export { detectEncoding, GSM7_CHARS } from './format/encoding.js';
export type { Encoding } from './format/encoding.js';
export { pureSplit, splitMessage } from './format/split.js';
export type { SplitResult } from './format/split.js';
export { renderMenuScreen, renderMenuScreens } from './format/menu.js';
export type { MenuOption, MenuConfig } from './format/menu.js';
export { maskPhoneNumber } from './format/phone.js';
export { formatReply, DEFAULT_NEXT_STEP } from './format/reply.js';
export type { ReplyOpts, ReplyResult } from './format/reply.js';

// Session
export { SystemClock, TestClock } from './session/clock.js';
export type { Clock } from './session/clock.js';
export { SessionStateMachine, sessionTransition } from './session/session-state-machine.js';
export type {
  SessionState,
  SessionStatus,
  SessionEvent,
} from './session/session-state-machine.js';

// Channels
export type {
  ChannelAdapter,
  ChannelType,
  OutboundMessage,
  InboundMessage,
  SendResult,
  WebhookInput,
  WebhookResult,
  DeliveryReportResult,
  DeliveryStatus,
} from './channels/types.js';
export { WebAdapter } from './channels/web-adapter.js';
export { SmsAdapter } from './channels/sms-adapter.js';
export { UssdAdapter, formatResponse, latestUssdInput } from './channels/ussd-adapter.js';
export { WEBHOOK_SECRET_PARAM, verifyWebhookSecret } from './channels/webhook-auth.js';

// Agent
export { IntentSchema, UNRECOGNIZED_INTENT, serializeIntent, parseIntent } from './agent/intent.js';
export type { Intent } from './agent/intent.js';
export { ToolRegistry } from './agent/tool-registry.js';
export type { Tool, ToolResult } from './agent/tool-registry.js';
export { LlmError } from './agent/llm-provider.js';
export type { LlmProvider } from './agent/llm-provider.js';
export { BedrockProvider } from './agent/bedrock-provider.js';
export { Agent } from './agent/agent.js';

// Store
export { StoreError } from './store/store.js';
export type { Store } from './store/store.js';
export { MemoryStore } from './store/memory-store.js';
export { DynamoStore } from './store/dynamo-store.js';

// Errors
export { KitError, toUserMessage, internalErrorCode } from './errors.js';

// Rate limiting
export { checkRateLimit, RateLimiter } from './rate-limiter.js';
export type { RateLimitState, RateLimitConfig } from './rate-limiter.js';

// Logging
export { ProductionLogger, DevLogger, createLogger } from './logger.js';
export type { SafeLogger } from './logger.js';

// Message processor
export { MessageProcessor, DEFAULT_PROCESSOR_COPY } from './processor.js';
export type { ProcessorCopy, ToolContext, MessageProcessorConfig } from './processor.js';
