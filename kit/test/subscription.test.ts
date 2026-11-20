import { describe, expect, it, vi } from 'vitest';
import { isSubscribed } from '../src/subscription.js';
import { makeHarness, PHONE } from './processor-helpers.js';

describe('isSubscribed', () => {
  it('follows the subscription lifecycle driven by the processor', async () => {
    const h = makeHarness();
    expect(await isSubscribed(h.store, PHONE)).toBe(false);

    await h.processor.process(h.msg('echo hi'));
    expect(await isSubscribed(h.store, PHONE)).toBe(true);

    await h.processor.process(h.msg('STOP'));
    expect(await isSubscribed(h.store, PHONE)).toBe(false);

    await h.processor.process(h.msg('START'));
    expect(await isSubscribed(h.store, PHONE)).toBe(true);

    await h.processor.process(h.msg('DELETE'));
    expect(await isSubscribed(h.store, PHONE)).toBe(false);
  });

  it('rejects with the same error when the store read rejects', async () => {
    const h = makeHarness();
    const boom = new Error('store down');
    vi.spyOn(h.store, 'read').mockRejectedValue(boom);
    await expect(isSubscribed(h.store, PHONE)).rejects.toBe(boom);
  });

  it('never writes to the store', async () => {
    const h = makeHarness();
    const write = vi.spyOn(h.store, 'write');
    await isSubscribed(h.store, PHONE);
    await h.store.write(`user:${PHONE}`, { subscribed: true });
    write.mockClear();
    await isSubscribed(h.store, PHONE);
    expect(write).not.toHaveBeenCalled();
  });
});
