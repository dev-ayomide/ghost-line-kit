import { describe, expect, it } from 'vitest';
import * as kit from '@ghostline/kit';
import * as app from '../src/index.ts';

describe('oja-ghost smoke', () => {
  it('resolves @ghostline/kit through the workspace and loads its entry point', () => {
    expect(typeof kit).toBe('object');
    expect(typeof app).toBe('object');
  });
});
