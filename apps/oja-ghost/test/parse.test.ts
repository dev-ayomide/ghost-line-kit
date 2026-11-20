import { describe, expect, it } from 'vitest';
import { parseCommand, routeIntent } from '../src/parse.ts';

describe('balance questions', () => {
  // Regression: "how much does bola owe" was read as a price lookup ("how much" command word).
  const phrases = [
    'how much does bola owe',
    'How much does Bola owe?',
    'how much bola owe me',
    'how much bola dey owe me',
    'wetin bola owe',
    'wetin bola dey owe me',
    'bola balance',
  ];
  it.each(phrases)('%s reads one debtor from the book', (text) => {
    expect(parseCommand(text)).toMatchObject({ kind: 'book', name: expect.stringMatching(/^bola$/i) });
  });
  it.each(phrases.filter((p) => !p.endsWith('balance')))('%s routes to the book tool', (text) => {
    expect(routeIntent(text)).toBe('book');
  });
  it('keeps a two-word name', () => {
    expect(parseCommand('how much does Aunty Bola owe me')).toEqual({ kind: 'book', name: 'Aunty Bola' });
  });
});

describe('price questions still work', () => {
  it.each(['how much rice mile12', 'how much is rice at ketu', 'wetin be price rice mile12', 'price rice mile12'])(
    '%s',
    (text) => {
      expect(parseCommand(text).kind).toBe('price');
      expect(routeIntent(text)).toBe('price');
    },
  );
  it('keeps the commodity and market', () => {
    expect(parseCommand('how much rice mile12')).toEqual({ kind: 'price', commodity: 'rice', market: 'mile12' });
  });
  it('price of garri with no market has a commodity and no market', () => {
    expect(parseCommand('price of garri')).toEqual({ kind: 'price', commodity: 'garri' });
  });
});

describe('debt sentences still work', () => {
  it('Bola owes 4500', () => {
    expect(parseCommand('Bola owes 4500')).toEqual({ kind: 'owe', name: 'Bola', amount: 4500 });
  });
});
