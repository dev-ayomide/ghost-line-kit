// Feature: phantom-handset, task 1.3: a failing trace sink never changes the result
// Validates: phantom-handset 10.9; design Open question 1 (rule "never breaks the pipeline")
// Task 1.4 appends its property to this file; keep shared generators here at the top.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Intent } from '../src/agent/intent.js';
import type { ChannelType, InboundMessage } from '../src/channels/types.js';
import type { MemoryStore } from '../src/store/memory-store.js';
import type { TraceEvent, TraceSink } from '../src/trace.js';
import { makeHarness, PHONE, type Harness } from './processor-helpers.js';

const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);

// ---- Shared generators and helpers ----

const keywords = ['STOP', 'DELETE', 'START', 'MORE', 'HELP', 'stop', 'Delete', 'sTaRt', 'more', ' stop ', 'YES'];

/** Inbound text: keywords in varied case, tool-triggering text, unrecognised text, empty and long text. */
export const inboundText = fc.oneof(
  fc.constantFrom(...keywords),
  fc.constantFrom(...keywords).map((k) => k.toUpperCase()),
  fc.constantFrom(...keywords).map((k) => k.toLowerCase()),
  fc.string({ maxLength: 20 }).map((w) => `echo ${w}`),
  fc.string({ maxLength: 20 }).map((w) => `ECHO ${w}`),
  fc.string({ maxLength: 60 }),
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 500, maxLength: 2000 }),
);

export const channel = fc.constantFrom<ChannelType>('sms', 'web', 'ussd');

/** Fixed messageId and timestamp so two harnesses see identical input. */
export function fixedMessage(text: string, ch: ChannelType): InboundMessage {
  return {
    from: PHONE,
    text,
    channel: ch,
    timestamp: 1_000_000,
    messageId: 'm-fixed',
    ...(ch === 'ussd' ? { sessionId: 'sess-1' } : {}),
  };
}

/** Everything in the store, sorted by key, as plain data. MemoryStore keeps its map private. */
export function storeContents(store: MemoryStore): [string, string][] {
  const data = (store as unknown as { data: Map<string, string> }).data;
  return [...data.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const throwingSink: TraceSink = () => {
  throw new Error('sink exploded');
};

function seeded(onTrace?: TraceSink): Harness {
  const h = makeHarness(onTrace ? { onTrace } : {});
  h.toolOutput.value = 'ok';
  return h;
}

// ---- Task 1.3 ----

describe('trace sink isolation', () => {
  it('a sink that always throws changes neither the replies nor the store', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(inboundText, channel), { minLength: 1, maxLength: 4 }), async (steps) => {
        const plain = seeded();
        const noisy = seeded(throwingSink);
        for (const [text, ch] of steps) {
          const a = await plain.processor.process(fixedMessage(text, ch));
          const b = await noisy.processor.process(fixedMessage(text, ch));
          expect(b).toEqual(a);
        }
        expect(storeContents(noisy.store)).toEqual(storeContents(plain.store));
      }),
      { numRuns },
    );
  });

  it('example: tool-triggering text with a throwing sink still returns the normal reply', async () => {
    // Plain example for the "never breaks the pipeline" rule on the tool path.
    // It did not come from a counterexample, so it is not a regression record.
    const plain = seeded();
    const noisy = seeded(throwingSink);
    const a = await plain.processor.process(fixedMessage('echo hi', 'sms'));
    const b = await noisy.processor.process(fixedMessage('echo hi', 'sms'));
    expect(b).toEqual(a);
    expect(storeContents(noisy.store)).toEqual(storeContents(plain.store));
  });
});

// ---- Task 1.4: summaries are bounded and redacted ----

/** Sender number: 8-15 digits, with or without a leading '+'. */
const senderNumber = fc
  .tuple(fc.boolean(), fc.stringMatching(/^[0-9]{8,15}$/))
  .map(([plus, d]) => (plus ? `+${d}` : d));

function digitsOf(n: string): string {
  return n.replace(/\D/g, '');
}

/** Values that contain the sender number somewhere: text, nested data, long strings, unserialisable values. */
function valueContaining(n: string): fc.Arbitrary<unknown> {
  const d = digitsOf(n);
  const form = fc.constantFrom(n, d);
  const leaf: fc.Arbitrary<unknown> = fc.oneof(
    fc.tuple(fc.string({ maxLength: 30 }), form, fc.string({ maxLength: 30 })).map(([a, f, b]) => `${a}${f}${b}`),
    fc.tuple(fc.integer({ min: 0, max: 600 }), form).map(([k, f]) => `${'x'.repeat(k)}${f}${'y'.repeat(k)}`),
    fc.tuple(fc.integer({ min: 1, max: 40 }), form).map(([k, f]) => `${f} `.repeat(k)),
    form,
    fc.bigInt().map((b) => ({ amount: b, phone: n })),
    fc.constant(null).map(() => {
      const o: Record<string, unknown> = { phone: n, digits: d };
      o.self = o;
      return o;
    }),
    fc.constant({ phone: n, toJSON: () => { throw new Error('nope'); } }),
    fc.constant(undefined),
    fc.integer().map((i) => ({ n: i, phone: n })),
  );
  return fc
    .letrec<{ v: unknown }>((tie) => ({
      v: fc.oneof(
        { depthSize: 'small', maxDepth: 4 },
        leaf,
        fc.array(tie('v'), { maxLength: 4 }),
        fc.tuple(fc.string({ maxLength: 8 }), tie('v'), tie('v')).map(([k, a, b]) => ({ [k]: a, [n]: b, [d]: a })),
      ),
    }))
    .v;
}

function assertEventsSafe(events: TraceEvent[], n: string): void {
  const d = digitsOf(n);
  for (const e of events) {
    expect(e.title.length).toBeLessThanOrEqual(80);
    if (e.summary !== undefined) expect(e.summary.length).toBeLessThanOrEqual(200);
    for (const text of [e.title, e.summary ?? '']) {
      expect(text.includes(n)).toBe(false);
      expect(text.includes(d)).toBe(false);
    }
  }
}

describe('trace summaries are bounded and redacted', () => {
  it('no summary exceeds 200, no title exceeds 80, and the sender number never appears', async () => {
    const scenario = senderNumber.chain((n) =>
      fc.record({
        n: fc.constant(n),
        classParams: valueContaining(n),
        toolInput: valueContaining(n),
        toolOutput: valueContaining(n),
        validInput: fc.boolean(),
      }),
    );
    await fc.assert(
      fc.asyncProperty(scenario, async ({ n, classParams, toolInput, toolOutput, validInput }) => {
        const events: TraceEvent[] = [];
        const h = makeHarness({
          onTrace: (e) => void events.push(e),
          buildToolCall: (_intent, ctx) => ({
            name: 'echo',
            // Without `word` the tool input fails validation, which exercises the userMessage summary.
            input: { ...(validInput ? { word: 'x' } : {}), phoneNumber: ctx.phoneNumber, extra: toolInput },
          }),
          renderOutput: () => 'done',
        });
        h.toolOutput.value = toolOutput;
        h.setClassifier(async (m) => ({ name: 'echo', parameters: classParams, rawMessage: m }) as unknown as Intent);
        await h.processor.process(h.msg('echo hi', 'sms', n));
        expect(events.map((e) => e.type)).toEqual(['reasoning', 'tool_call', 'tool_result']);
        assertEventsSafe(events, n);
      }),
      { numRuns },
    );
  });
});
