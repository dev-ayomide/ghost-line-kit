import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/limits';
import { renderMenuScreen, renderMenuScreens, type MenuOption } from '../src/format/menu';

const opts = (...labels: string[]): MenuOption[] => labels.map((l, i) => ({ label: l, value: String(i) }));

describe('menu rendering', () => {
  it('renders 5 short options with Back and Menu footer (Req 6.1)', () => {
    const screen = renderMenuScreen(opts('Prices', 'Debts', 'Remind', 'Help', 'Quit'), 0);
    expect(screen).toBe('1 Prices\n2 Debts\n3 Remind\n4 Help\n5 Quit\n0 Back\n00 Menu');
  });

  it('includes title and custom footer labels', () => {
    const screen = renderMenuScreen(opts('A'), 0, { title: 'Main', backLabel: 'Baya', menuLabel: 'Fara' });
    expect(screen).toBe('Main\n1 A\n0 Baya\n00 Fara');
  });

  it('content fitting in the soft target renders within it (Req 6.5)', () => {
    const screen = renderMenuScreen(opts('Check prices', 'Add debt', 'Reminders'), 0, { title: 'Oja' });
    expect(screen.length).toBeLessThanOrEqual(LIMITS.ussd.screenSoftTarget);
  });

  it('splits more than 5 options across screens, numbering restarts (Req 6.6)', () => {
    const screens = renderMenuScreens(opts('a', 'b', 'c', 'd', 'e', 'f', 'g'));
    expect(screens).toHaveLength(2);
    expect(screens[0]).toContain('5 e');
    expect(screens[1]).toBe('1 f\n2 g\n0 Back\n00 Menu');
    for (const s of screens) {
      expect(s.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
      expect(s.split('\n').filter((l) => /^[1-9] /.test(l)).length).toBeLessThanOrEqual(5);
    }
  });

  it('spreads long options over more screens instead of overflowing the soft target', () => {
    const long = 'word '.repeat(10).trim(); // 49 chars
    const screens = renderMenuScreens(opts(long, long, long, long, long));
    expect(screens.length).toBeGreaterThan(1);
    expect(screens.every((s) => s.length <= LIMITS.ussd.screenHardCap)).toBe(true);
  });

  it('renderMenuScreen renders the screen at the given offset', () => {
    expect(renderMenuScreen(opts('a', 'b', 'c', 'd', 'e', 'f'), 5)).toBe('1 f\n0 Back\n00 Menu');
  });

  it('empty options: title+footer screen, but no screens from renderMenuScreens', () => {
    expect(renderMenuScreen([], 0, { title: 'Empty' })).toBe('Empty\n0 Back\n00 Menu');
    expect(renderMenuScreens([])).toEqual([]);
  });

  it('truncates a too-long label at a word boundary with "..."', () => {
    const label = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const [screen] = renderMenuScreens(opts(label));
    expect(screen!.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
    const line = screen!.split('\n')[0]!;
    expect(line.endsWith('...')).toBe(true);
    const kept = line.slice(2, -3);
    expect(label.startsWith(kept + ' ')).toBe(true);
  });

  it('hard-cuts a single word that is too long', () => {
    const [screen] = renderMenuScreens(opts('x'.repeat(300)));
    expect(screen!.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
    expect(screen!.split('\n')[0]!.endsWith('...')).toBe(true);
  });

  it('normalises whitespace in labels', () => {
    expect(renderMenuScreen(opts('  a \n  b  '), 0)).toBe('1 a b\n0 Back\n00 Menu');
  });

  it('trims an overlong title so an option still fits', () => {
    const screen = renderMenuScreen(opts('Pick me'), 0, { title: 'long '.repeat(60) });
    expect(screen.length).toBeLessThanOrEqual(LIMITS.ussd.screenHardCap);
    expect(screen).toContain('1 Pick me');
  });
});
