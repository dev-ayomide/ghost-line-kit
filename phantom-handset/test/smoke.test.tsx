import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { handsetConfig } from '../src/config/handset-config.ts';

describe('phantom-handset smoke', () => {
  const html = renderToString(<App />);

  it('renders the landing title, demo label and skip link', () => {
    expect(html).toContain(handsetConfig.copy.landing.title);
    expect(html).toContain(handsetConfig.copy.demoLabel);
    expect(html).toContain(handsetConfig.copy.keyboardHelp.skipToPhone);
    expect(html.indexOf('skip-link')).toBeLessThan(html.indexOf('<button'));
  });

  it('has exactly one h1', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  });
});
