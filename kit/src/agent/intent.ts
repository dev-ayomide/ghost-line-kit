import { z } from 'zod';

/** A classified user request. Names are checked against allowed names elsewhere. */
export type Intent = {
  name: string;
  parameters: Record<string, string | number | boolean>;
  rawMessage: string;
};

/** Intent name used when a message matches no known intent (Req 9.5). */
export const UNRECOGNIZED_INTENT = 'unrecognized';

const ParameterValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const IntentSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), ParameterValueSchema),
  rawMessage: z.string(),
});

export function serializeIntent(intent: Intent): string {
  return JSON.stringify(intent);
}

/**
 * Parses untrusted JSON into an Intent. Errors are short and never echo the
 * input, because model output may contain user message text.
 */
export function parseIntent(json: string): Intent {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid intent: not valid JSON');
  }
  const result = IntentSchema.safeParse(raw);
  if (!result.success) {
    throw new Error('Invalid intent: unexpected shape');
  }
  // Rebuild parameters from the raw own entries with Object.fromEntries, which
  // defines data properties (no __proto__ setter), so keys such as "__proto__"
  // stay plain data and no prototype changes. The schema already vetted values.
  // zod's record skips an own "__proto__" key, so vet every raw entry directly.
  const rawParams = (raw as { parameters: Record<string, unknown> }).parameters;
  const entries = Object.entries(rawParams);
  for (const [, value] of entries) {
    if (!ParameterValueSchema.safeParse(value).success) {
      throw new Error('Invalid intent: unexpected shape');
    }
  }
  return {
    name: result.data.name,
    parameters: Object.fromEntries(entries) as Intent['parameters'],
    rawMessage: result.data.rawMessage,
  };
}
