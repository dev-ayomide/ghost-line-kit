import { z } from 'zod';
import { SystemClock, type Clock } from '../session/clock.js';
import type {
  ChannelAdapter,
  DeliveryReportResult,
  DeliveryStatus,
  OutboundMessage,
  SendResult,
  WebhookInput,
  WebhookResult,
} from './types.js';
import { WEBHOOK_SECRET_PARAM, verifyWebhookSecret } from './webhook-auth.js';

const SANDBOX_URL = 'https://api.sandbox.africastalking.com/version1/messaging';
const LIVE_URL = 'https://api.africastalking.com/version1/messaging';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SmsAdapterOptions {
  username?: string;
  apiKey?: string;
  shortcode?: string;
  webhookSecret?: string;
  fetch?: typeof fetch;
  clock?: Clock;
  timeoutMs?: number;
}

const sendReplySchema = z.object({
  SMSMessageData: z.object({
    Recipients: z
      .array(
        z.object({
          statusCode: z.number(),
          status: z.string().optional(),
          messageId: z.string().optional(),
        }),
      )
      .min(1),
  }),
});

const inboundSchema = z.object({
  from: z.string().min(1),
  to: z.string(),
  text: z.string(),
  date: z.string().optional(),
  id: z.string().optional(),
  linkId: z.string().optional(),
});

const deliverySchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  phoneNumber: z.string().min(1),
  networkCode: z.string().optional(),
  failureReason: z.string().optional(),
  retryCount: z.union([z.string(), z.number()]).optional(),
});

const UNAUTHORIZED = {
  ok: false as const,
  error: { code: 'UNAUTHORIZED', message: 'Request rejected.' },
};
const INVALID = {
  ok: false as const,
  error: { code: 'INVALID_PAYLOAD', message: 'Invalid request.' },
};

function mapStatus(status: string): DeliveryStatus['status'] {
  if (status === 'Success') return 'delivered';
  if (status === 'Failed' || status === 'Rejected') return 'failed';
  return 'pending';
}

/**
 * Africa's Talking SMS adapter using the built-in `fetch`.
 * Webhook auth is a shared secret in the callback URL query string. Optional
 * IP allowlisting is left to deployment (reverse proxy or load balancer).
 */
export class SmsAdapter implements ChannelAdapter {
  readonly channel = 'sms' as const;

  private readonly username: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly shortcode: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly handlers = new Set<(status: DeliveryStatus) => void>();

  constructor(options: SmsAdapterOptions = {}) {
    this.username = options.username ?? process.env.AT_USERNAME;
    this.apiKey = options.apiKey ?? process.env.AT_API_KEY;
    this.shortcode = options.shortcode ?? process.env.AT_SHORTCODE;
    this.webhookSecret = options.webhookSecret ?? process.env.WEBHOOK_SECRET;
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
    this.clock = options.clock ?? new SystemClock();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.username || !this.apiKey) {
      return { ok: false, error: 'SMS adapter is not configured' };
    }
    try {
      const body = new URLSearchParams({
        username: this.username,
        to: message.to,
        message: message.text,
      });
      if (this.shortcode) body.set('from', this.shortcode);

      const res = await this.fetchFn(this.username === 'sandbox' ? SANDBOX_URL : LIVE_URL, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { ok: false, error: `AT status ${res.status}` };

      const parsed = sendReplySchema.safeParse(await res.json());
      if (!parsed.success) return { ok: false, error: 'AT reply not understood' };

      const recipient = parsed.data.SMSMessageData.Recipients[0]!;
      if ([100, 101, 102].includes(recipient.statusCode)) {
        return recipient.messageId === undefined
          ? { ok: true }
          : { ok: true, messageId: recipient.messageId };
      }
      return { ok: false, error: `AT recipient code ${recipient.statusCode}` };
    } catch {
      // Never include the caught error: it could carry URL or request details.
      return { ok: false, error: 'AT request failed' };
    }
  }

  parseWebhook(input: WebhookInput): WebhookResult {
    if (!verifyWebhookSecret(input.query[WEBHOOK_SECRET_PARAM], this.webhookSecret)) {
      return UNAUTHORIZED;
    }
    const parsed = inboundSchema.safeParse(input.body);
    if (!parsed.success) return INVALID;
    const { from, text, id } = parsed.data;
    return {
      ok: true,
      inbound: {
        from,
        text,
        channel: 'sms',
        timestamp: this.clock.now(),
        ...(id !== undefined ? { messageId: id } : {}),
      },
    };
  }

  receiveDeliveryReport(input: WebhookInput): DeliveryReportResult {
    if (!verifyWebhookSecret(input.query[WEBHOOK_SECRET_PARAM], this.webhookSecret)) {
      return UNAUTHORIZED;
    }
    const parsed = deliverySchema.safeParse(input.body);
    if (!parsed.success) return INVALID;
    const status: DeliveryStatus = {
      messageId: parsed.data.id,
      status: mapStatus(parsed.data.status),
      phoneNumber: parsed.data.phoneNumber,
    };
    for (const handler of [...this.handlers]) {
      try {
        handler(status);
      } catch {
        // A throwing subscriber must not break the others.
      }
    }
    return { ok: true };
  }

  onDeliveryStatus(handler: (status: DeliveryStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
