/**
 * LCD paginator (Req 3). Pure and deterministic: no React, no DOM, no imports.
 *
 * Whitespace normalisation (R3.2): `\n` is a hard line break. Inside a line,
 * runs of whitespace (spaces, tabs, other Unicode whitespace, `/\s/u`) collapse
 * to a single space, and are dropped at line edges. Non-whitespace code points
 * are never dropped, duplicated or reordered. A token (a maximal run of
 * non-whitespace code points, such as "₦1,500" or "+2348012345678") is never
 * split unless it is longer than `cols`, in which case it is cut on code-point
 * boundaries. Lengths are counted in code points.
 *
 * Blank lines at the start or end of a page are dropped, and pages left with no
 * lines are omitted. Empty or whitespace-only input gives one page with no lines.
 *
 * @throws RangeError when `rows` or `cols` is not an integer >= 1.
 */

export interface LcdSize {
  rows: number;
  cols: number;
}

export interface Page {
  lines: string[];
}

const WHITESPACE_RUN = /\s+/u;

function assertSize(size: LcdSize): void {
  const { rows, cols } = size;
  if (!Number.isInteger(rows) || rows < 1) {
    throw new RangeError(`LCD rows must be an integer >= 1, got ${rows}`);
  }
  if (!Number.isInteger(cols) || cols < 1) {
    throw new RangeError(`LCD cols must be an integer >= 1, got ${cols}`);
  }
}

/** Wrap one hard line (no `\n`) into lines of at most `cols` code points. */
function wrapLine(source: string, cols: number, out: string[]): void {
  const tokens = source.split(WHITESPACE_RUN).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    out.push('');
    return;
  }

  let current = '';
  let currentLen = 0;

  for (const token of tokens) {
    const cps = Array.from(token);
    const len = cps.length;

    if (len > cols) {
      if (currentLen > 0) {
        out.push(current);
      }
      let i = 0;
      while (len - i > cols) {
        out.push(cps.slice(i, i + cols).join(''));
        i += cols;
      }
      current = cps.slice(i).join('');
      currentLen = len - i;
      continue;
    }

    if (currentLen === 0) {
      current = token;
      currentLen = len;
    } else if (currentLen + 1 + len <= cols) {
      current += ' ' + token;
      currentLen += 1 + len;
    } else {
      out.push(current);
      current = token;
      currentLen = len;
    }
  }

  if (currentLen > 0) {
    out.push(current);
  }
}

export function paginate(text: string, size: LcdSize): Page[] {
  assertSize(size);
  const { rows, cols } = size;

  const lines: string[] = [];
  for (const hardLine of text.split('\n')) {
    wrapLine(hardLine, cols, lines);
  }

  const pages: Page[] = [];
  for (let start = 0; start < lines.length; start += rows) {
    const chunk = lines.slice(start, start + rows);
    let first = 0;
    let last = chunk.length;
    while (first < last && chunk[first] === '') first++;
    while (last > first && chunk[last - 1] === '') last--;
    if (last > first) {
      pages.push({ lines: chunk.slice(first, last) });
    }
  }

  return pages.length > 0 ? pages : [{ lines: [] }];
}
