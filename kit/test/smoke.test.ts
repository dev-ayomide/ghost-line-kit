import { describe, expect, it } from 'vitest';
import * as kit from '../src/index.ts';

describe('@ghostline/kit smoke', () => {
  it('loads the public entry point', () => {
    expect(typeof kit).toBe('object');
  });
});
