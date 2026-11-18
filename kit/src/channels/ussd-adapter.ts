/**
 * UssdAdapter: Africa's Talking USSD over the callback protocol.
 *
 * Africa's Talking POSTs `sessionId`, `serviceCode`, `phoneNumber`, optional
 * `networkCode` and `text` to the app's URL. The HTTP response body is the next
 * screen, prefixed `CON ` (session continues) or `END ` (session ends).
 *
 * DEVIATION FROM THE LITERAL WORDING OF REQUIREMENTS 3.2 / 3.3: there is no
 * outbound "initiate session" REST call in this protocol. The first callback
 * (empty `text`) IS the session initiation and carries the sessionId. Replying
 * with a `CON` body continues the session. `send` therefore only builds the
 * response text; it never calls the AT API.
 *
 * Requirement 3.4 (sandbox vs live): this adapter never makes a live telco
 * call, so there is no username/apiKey or fetch here. Sandbox vs live is only
 * a question of which Africa's Talking account points its callback URL at the
 * app.
 *
 * Security: the secret in the callback URL query string is verified before the
 * body is read. Nothing is logged here.
 */
import { z } from 'zod';
import { LIMITS } from '../limits.js';
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

export interface UssdAdapterOptions {
  /** Defaults to `process.env.WEBHOOK_SECRET`. */
  webhookSecret?: string;
  clock?: Clock;
}

const ussdBodySchema = z.object({
  sessionId: z.string().min(1),
  phoneNumber: z.string().min(1),
  text: z.string(),
  serviceCode: z.string(),
  networkCode: z.string().optional(),
});

/** Builds the webhook response body: `CON <text>` or `END <text>`. */
export function formatResponse(message: OutboundMessage): string {
  return (message.endSession === true ? 'END ' : 'CON ') + message.text;
}

/**
 * AT sends the cumulative input joined by `*` (for example "1*2*3").
 * Returns the part after the last `*`, or '' for empty text.
 */
export function latestUssdInput(text: string): string {
  const i = text.lastIndexOf('*');
  return i === -1 ? text : text.slice(i + 1);
}

export class UssdAdapter implements ChannelAdapter {
  readonly channel = 'ussd' as const;
  private readonly webhookSecret: string | undefined;
  private readonly clock: Clock;

  constructor(options: UssdAdapterOptions = {}) {
    this.webhookSecret = options.webhookSecret ?? process.env.WEBHOOK_SECRET;
    this.clock = options.clock ?? new SystemClock();
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (message.text.length > LIMITS.ussd.screenHardCap) {
      return { ok: false, error: 'USSD screen too long' };
    }
    return { ok: true, responseText: formatResponse(message) };
  }

  parseWebhook(input: WebhookInput): WebhookResult {
    if (!verifyWebhookSecret(input.query[WEBHOOK_SECRET_PARAM], this.webhookSecret)) {
      return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Request rejected.' } };
    }
    const parsed = ussdBodySchema.safeParse(input.body);
    if (!parsed.success) {
      return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid request.' } };
    }
    const { sessionId, phoneNumber, text } = parsed.data;
    return {
      ok: true,
      inbound: {
        from: phoneNumber,
        text: latestUssdInput(text),
        channel: 'ussd',
        sessionId,
        timestamp: this.clock.now(),
      },
    };
  }

  receiveDeliveryReport(_input: WebhookInput): DeliveryReportResult {
    return { ok: false, error: { code: 'UNSUPPORTED', message: 'Not supported.' } };
  }

  onDeliveryStatus(_handler: (status: DeliveryStatus) => void): () => void {
    return () => {};
  }
}
