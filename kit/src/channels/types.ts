// Channel adapter types. Types only: no runtime imports, so this file can never cause an import cycle.

export type ChannelType = 'sms' | 'ussd' | 'web';

/** A message the kit sends to a user. */
export interface OutboundMessage {
  to: string;
  text: string;
  sessionId?: string;
  /** USSD: true closes the session (END screen). */
  endSession?: boolean;
}

/** A validated message received from a user. */
export interface InboundMessage {
  from: string;
  text: string;
  channel: ChannelType;
  sessionId?: string;
  timestamp: number;
  messageId?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  /** Internal text for logs. Never shown to users and never contains secrets. */
  error?: string;
  /** USSD/web: the text to return in the webhook or HTTP response. */
  responseText?: string;
}

export interface DeliveryStatus {
  messageId: string;
  status: 'delivered' | 'failed' | 'pending';
  phoneNumber: string;
}

/**
 * Everything an adapter needs to authenticate and parse a webhook. The query is
 * included because the secret token arrives in the callback URL query string.
 */
export interface WebhookInput {
  body: unknown;
  query: Record<string, string | undefined>;
  headers: Record<string, string>;
}

/** Error messages are short and never echo the payload or the secret. */
export type WebhookResult =
  | { ok: true; inbound: InboundMessage }
  | { ok: false; error: { code: string; message: string } };

export type DeliveryReportResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

export interface ChannelAdapter {
  /** The channel this adapter serves. */
  readonly channel: ChannelType;
  /** Sends a message to the user. Resolves with ok:false instead of throwing on delivery failure. */
  send(message: OutboundMessage): Promise<SendResult>;
  /** Authenticates and validates an inbound webhook, and maps it to an InboundMessage. */
  parseWebhook(input: WebhookInput): WebhookResult;
  /**
   * Authenticates and validates a delivery-report callback, then emits a
   * DeliveryStatus to subscribed handlers. Adapters without delivery reports
   * return an `UNSUPPORTED` error result.
   */
  receiveDeliveryReport(input: WebhookInput): DeliveryReportResult;
  /** Subscribes to delivery statuses. Returns an unsubscribe function. */
  onDeliveryStatus(handler: (status: DeliveryStatus) => void): () => void;
}
