import { randomUUID } from 'node:crypto';
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

/**
 * Payload the Phantom Handset posts. Unknown extra fields are ignored.
 * `channel` is optional and says which channel the handset is emulating:
 * 'web' (default) or 'ussd'. Any other value is rejected.
 */
export const webPayloadSchema = z.object({
  from: z.string().min(1),
  text: z.string(),
  sessionId: z.string().optional(),
  channel: z.enum(['web', 'ussd']).optional(),
});

export interface WebAdapterOptions {
  clock?: Clock;
}

type DeliverHandler = (message: OutboundMessage) => void | Promise<void>;

/**
 * Channel for the Phantom Handset browser emulator. No telco and no SIM.
 *
 * Authentication: none. The Phantom Handset route is for development and demo
 * and must not expose private data. The deployment decides how to protect it.
 *
 * The adapter's own `channel` is always 'web'. An inbound message carries the
 * channel named in the payload ('web' or 'ussd', default 'web'), so the handset
 * can emulate USSD sessions through this adapter.
 *
 * This adapter never logs.
 */
export class WebAdapter implements ChannelAdapter {
  readonly channel = 'web' as const;

  private readonly clock: Clock;
  private readonly deliverHandlers = new Set<DeliverHandler>();
  private readonly statusHandlers = new Set<(status: DeliveryStatus) => void>();

  constructor(options: WebAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  /** Registers the callback that pushes messages to the connected browser. */
  onDeliver(handler: DeliverHandler): () => void {
    // Wrap so registering the same function twice yields independent subscriptions.
    const entry: DeliverHandler = (m) => handler(m);
    this.deliverHandlers.add(entry);
    return () => {
      this.deliverHandlers.delete(entry);
    };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.deliverHandlers.size === 0) {
      return { ok: false, error: 'No web client connected' };
    }
    try {
      for (const handler of [...this.deliverHandlers]) {
        await handler(message);
      }
    } catch {
      return { ok: false, error: 'Web delivery failed' };
    }
    const messageId = randomUUID();
    this.emit({ messageId, status: 'delivered', phoneNumber: message.to });
    return { ok: true, messageId };
  }

  parseWebhook(input: WebhookInput): WebhookResult {
    const parsed = webPayloadSchema.safeParse(input.body);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid request.' } };
    }
    const { from, text, sessionId } = parsed.data;
    const channel = parsed.data.channel ?? 'web';
    return {
      ok: true,
      inbound: {
        from,
        text,
        channel,
        ...(sessionId !== undefined ? { sessionId } : {}),
        timestamp: this.clock.now(),
      },
    };
  }

  receiveDeliveryReport(_input: WebhookInput): DeliveryReportResult {
    return { ok: false, error: { code: 'UNSUPPORTED', message: 'Not supported.' } };
  }

  onDeliveryStatus(handler: (status: DeliveryStatus) => void): () => void {
    const entry = (s: DeliveryStatus): void => handler(s);
    this.statusHandlers.add(entry);
    return () => {
      this.statusHandlers.delete(entry);
    };
  }

  private emit(status: DeliveryStatus): void {
    for (const handler of [...this.statusHandlers]) {
      try {
        handler(status);
      } catch {
        // A failing subscriber must not affect others or send().
      }
    }
  }
}
