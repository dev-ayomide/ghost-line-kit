import type { ReactElement } from 'react';
import { handsetConfig } from '../config/handset-config';

type Tombstone = (typeof handsetConfig.copy.landing.tombstones)[number];
type Kind = Tombstone['kind'];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Shape {
  body: Rect & { rx: number };
  screen: Rect;
}

const SHAPES: Record<Kind, Shape> = {
  brick: { body: { x: 22, y: 24, w: 116, h: 196, rx: 16 }, screen: { x: 34, y: 42, w: 92, h: 86 } },
  flip: { body: { x: 12, y: 40, w: 136, h: 180, rx: 14 }, screen: { x: 26, y: 54, w: 108, h: 54 } },
  cracked: { body: { x: 28, y: 10, w: 104, h: 210, rx: 18 }, screen: { x: 35, y: 26, w: 90, h: 162 } },
  pager: { body: { x: 12, y: 70, w: 136, h: 130, rx: 12 }, screen: { x: 24, y: 84, w: 112, h: 56 } },
};

const FONT_SIZE = 14;
const LINE_HEIGHT = 15;
/** Rough advance of the pixel font in em; used only to choose where lines break. */
const CHAR_EM = 0.4;

/** Pure word wrap. Never returns an empty list for a non-empty text, and keeps every word. */
export function wrapEpitaph(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function keyDots(cx: number, y: number, rows: number, gap = 22): ReactElement[] {
  const dots: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c <= 1; c++) {
      dots.push(<circle key={`${r}:${c}`} cx={cx + c * gap} cy={y + r * 20} r={5} className="tomb__key" />);
    }
  }
  return dots;
}

function Details({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'brick':
      return (
        <>
          <rect x={36} y={6} width={9} height={20} rx={3} className="tomb__body" />
          {keyDots(80, 152, 3)}
        </>
      );
    case 'flip':
      return (
        <>
          <line x1={12} y1={124} x2={148} y2={124} className="tomb__hinge" />
          {keyDots(80, 146, 3)}
        </>
      );
    case 'cracked':
      return (
        <>
          <polyline points="108,26 96,62 110,84 90,118 102,140 82,188" className="tomb__crack" />
          <polyline points="96,62 70,70 58,94" className="tomb__crack" />
          <circle cx={80} cy={204} r={7} className="tomb__key" />
        </>
      );
    case 'pager':
      return (
        <>
          <rect x={30} y={158} width={24} height={14} rx={7} className="tomb__key" />
          <rect x={68} y={158} width={24} height={14} rx={7} className="tomb__key" />
          <rect x={106} y={158} width={24} height={14} rx={7} className="tomb__key" />
          <rect x={46} y={178} width={68} height={6} rx={3} className="tomb__key" />
        </>
      );
  }
}

function TombstoneSvg({ stone }: { stone: Tombstone }) {
  const { body, screen } = SHAPES[stone.kind];
  const maxChars = Math.floor((screen.w - 8) / (FONT_SIZE * CHAR_EM));
  const lines = wrapEpitaph(stone.epitaph, maxChars);
  const top = screen.y + (screen.h - lines.length * LINE_HEIGHT) / 2 + LINE_HEIGHT * 0.78;
  return (
    <svg viewBox="0 0 160 240" className="tomb__svg" role="img" aria-label={`${stone.name}. ${stone.epitaph}`} focusable="false">
      <ellipse cx={80} cy={226} rx={72} ry={11} className="tomb__mound" />
      <rect x={body.x} y={body.y} width={body.w} height={body.h} rx={body.rx} className="tomb__body" />
      <rect x={body.x} y={body.y} width={body.w} height={body.h} rx={body.rx} className="tomb__moon" />
      <Details kind={stone.kind} />
      <rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} rx={4} className="tomb__screen" />
      {stone.kind === 'cracked' ? (
        <polyline points="108,26 96,62 110,84 90,118 102,140 82,188" className="tomb__crack-lcd" />
      ) : null}
      <text className="tomb__text" fontSize={FONT_SIZE} textAnchor="middle">
        {lines.map((line, i) => (
          <tspan key={i} x={screen.x + screen.w / 2} y={top + i * LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
}

/** Dead-phone tombstones for one side of the stage. Each one is a figure with a text alternative. */
export function Graveyard({ side }: { side: 'left' | 'right' }) {
  const all = handsetConfig.copy.landing.tombstones;
  const half = Math.ceil(all.length / 2);
  const stones = side === 'left' ? all.slice(0, half) : all.slice(half);
  return (
    <div className={`graveyard graveyard--${side}`}>
      {stones.map((stone, i) => (
        <figure key={stone.kind} className={`tomb tomb--${stone.kind} tomb--${i % 2 === 0 ? 'a' : 'b'}`}>
          <TombstoneSvg stone={stone} />
        </figure>
      ))}
    </div>
  );
}
