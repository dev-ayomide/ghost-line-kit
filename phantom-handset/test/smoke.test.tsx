import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';

describe('phantom-handset smoke', () => {
  it('renders the placeholder page', () => {
    expect(renderToString(<App />)).toContain('Phantom Handset coming soon');
  });
});
