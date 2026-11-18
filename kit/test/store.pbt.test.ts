import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MemoryStore } from '../src/store/memory-store.js';
import { StoreError, type Store } from '../src/store/store.js';

// Feature: kit-core, Property 11: Store behaves like a key-value map
// **Validates: Requirements 12.1, 12.2, 12.4**

const keyArb = fc.constantFrom('a', 'b', 'c');
// The Store contract is defined on JSON-serialisable values, and JSON does not
// round-trip every JS value: it drops the sign of -0 (at any depth, including
// inside arrays and objects). fc.jsonValue() can generate -0, so normalise each
// generated value through JSON itself. This maps -0 to 0 and changes nothing else.
// fc.jsonValue() already excludes NaN, Infinity, undefined, sparse arrays and
// other non-JSON values; own "__proto__" keys do round-trip (JSON.parse defines
// them as own properties) and stay in play.
const jsonNormalise = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const valueArb = fc.jsonValue().map(jsonNormalise);

type Op =
  | { kind: 'write'; key: string; value: unknown }
  | { kind: 'read'; key: string }
  | { kind: 'delete'; key: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('write' as const), key: keyArb, value: valueArb }),
  fc.record({ kind: fc.constant('read' as const), key: keyArb }),
  fc.record({ kind: fc.constant('delete' as const), key: keyArb }),
);

/** Reusable contract: any Store implementation should pass these properties. */
export function storeContract(name: string, factory: () => Store): void {
  describe(`${name} store contract`, () => {
    it('matches a plain Map oracle over random operation sequences', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { maxLength: 40 }), async (ops) => {
          const store = factory();
          const oracle = new Map<string, unknown>();
          for (const op of ops) {
            if (op.kind === 'write') {
              await store.write(op.key, op.value);
              oracle.set(op.key, structuredClone(op.value));
            } else if (op.kind === 'delete') {
              await store.delete(op.key);
              oracle.delete(op.key);
            } else {
              expect(await store.read(op.key)).toEqual(oracle.get(op.key));
            }
          }
        }),
      );
    });

    it('returns a deep-equal value after write, and last write wins', async () => {
      await fc.assert(
        fc.asyncProperty(keyArb, valueArb, valueArb, async (key, v1, v2) => {
          const store = factory();
          await store.write(key, v1);
          expect(await store.read(key)).toEqual(v1);
          await store.write(key, v2);
          expect(await store.read(key)).toEqual(v2);
        }),
      );
    });

    it('is isolated from mutation of the written or returned object', async () => {
      await fc.assert(
        fc.asyncProperty(keyArb, fc.array(fc.integer(), { minLength: 1 }), async (key, nums) => {
          const store = factory();
          const original = { nums: [...nums] };
          await store.write(key, original);
          original.nums.push(999);
          const first = (await store.read<{ nums: number[] }>(key))!;
          expect(first).toEqual({ nums });
          first.nums.push(123);
          expect(await store.read(key)).toEqual({ nums });
        }),
      );
    });

    it('reads undefined after delete, and delete of a missing key is a no-op', async () => {
      await fc.assert(
        fc.asyncProperty(keyArb, valueArb, async (key, value) => {
          const store = factory();
          await expect(store.delete(key)).resolves.toBeUndefined();
          await store.write(key, value);
          await store.delete(key);
          expect(await store.read(key)).toBeUndefined();
        }),
      );
    });

    it('rejects an unserialisable write with StoreError and keeps the previous value', async () => {
      await fc.assert(
        fc.asyncProperty(keyArb, valueArb, async (key, prev) => {
          const store = factory();
          await store.write(key, prev);
          const circular: Record<string, unknown> = {};
          circular.self = circular;
          await expect(store.write(key, circular)).rejects.toBeInstanceOf(StoreError);
          expect(await store.read(key)).toEqual(prev);
        }),
      );
    });
  });
}

storeContract('MemoryStore', () => new MemoryStore());

describe('MemoryStore unit cases', () => {
  // Regression: found by fast-check (FC_NUM_RUNS=5000), e.g. seed 2057298555,
  // counterexample ["a", [], {"": -0}]. Writing -0 and reading it back gave 0,
  // so toEqual failed intermittently. JSON drops the sign of negative zero, so
  // the Store contract is defined on JSON-serialisable values and the generator
  // normalises -0 to 0.
  it('regression: -0 (bare and nested) reads back as 0 because JSON drops its sign', async () => {
    const store = new MemoryStore();
    await store.write('k', -0);
    expect(Object.is(await store.read('k'), 0)).toBe(true);
    await store.write('k', { '': [-0] });
    expect(await store.read('k')).toEqual({ '': [0] });
    expect(jsonNormalise({ '': [-0] })).toEqual({ '': [0] });
  });

  it('reads undefined for a missing key', async () => {
    expect(await new MemoryStore().read('nope')).toBeUndefined();
  });

  it('rejects undefined and BigInt values with StoreError("write")', async () => {
    const store = new MemoryStore();
    await store.write('k', { ok: 1 });
    await expect(store.write('k', undefined)).rejects.toMatchObject({ name: 'StoreError', operation: 'write', key: 'k' });
    await expect(store.write('k', 10n)).rejects.toBeInstanceOf(StoreError);
    expect(await store.read('k')).toEqual({ ok: 1 });
  });
});
