import { createHash, timingSafeEqual } from 'node:crypto';

/** Query parameter that carries the secret: https://host/hook/sms?secret=... */
export const WEBHOOK_SECRET_PARAM = 'secret';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time secret check. Compares SHA-256 digests so the comparison does
 * not leak length. Fails closed when no secret is configured or none is provided.
 */
export function verifyWebhookSecret(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected === '') return false;
  if (provided === undefined) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
