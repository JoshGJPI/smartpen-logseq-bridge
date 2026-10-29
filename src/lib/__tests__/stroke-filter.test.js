/**
 * Tests for stroke-filter.js — decorative stroke detection.
 *
 * Detection types:
 *   1. Underlines — straight, near-horizontal; short ones only with writing on them; strike-throughs kept
 *   2. Loops — one closed stroke (overshoot allowed) round content: ovals, circled numbers, boxes
 *   3. Multi-stroke boxes — 2-4 strokes drawn back to back tracing four sides round content
 * Task boxes (☐ / ☑) are never decorative; detection runs per page.
 *
 * All geometry is expressed in Ncode units (1 unit = 2.371 mm).
 * Helpers convert from mm → Ncode for readability.
 */

import { describe, it, expect } from 'vitest';
import { filterDecorativeStrokes, detectDecorativeIndices, config } from '../stroke-filter.js';

const { NCODE_TO_MM } = config;

// ---------------------------------------------------------------------------
// Coordinate helpers — all measurements in mm → Ncode
// ---------------------------------------------------------------------------

const mmToNcode = mm => mm / NCODE_TO_MM;

/** Stroke through the given mm points, in order. */
function makeStroke(pointsMm, startTime = 1000, pageInfo = {}) {
  const dotArray = pointsMm.map(([x, y], i) => ({ x: mmToNcode(x), y: mmToNcode(y), f: 512, timestamp: startTime + i }));
  return { pageInfo, startTime, endTime: startTime + dotArray.length, dotArray };
}

/** Points along a straight segment, both ends included. */
function seg(ax, ay, bx, by, n = 15) {
  return Array.from({ length: n }, (_, i) => [ax + (bx - ax) * i / (n - 1), ay + (by - ay) * i / (n - 1)]);
}

/**
 * Horizontal line of given width (mm), rising `riseMm` over its length.
 * A tiny y-wobble (0.1 mm) — real handwriting is never perfectly flat.
 */
function makeLine(startXmm, yMm, widthMm, dotCount = 20, startTime = 1000, riseMm = 0) {
  return makeStroke(Array.from({ length: dotCount }, (_, i) => {
    const f = i / (dotCount - 1);
    return [startXmm + widthMm * f, yMm - riseMm * f + (i % 2 ? -0.1 : 0.1)];
  }), startTime);
}

/** Ellipse round (cx, cy), optionally carrying on `overshootDeg` past the start. */
function makeOval(cx, cy, wMm, hMm, { dotCount = 60, overshootDeg = 0, startTime = 5000, pageInfo = {} } = {}) {
  const total = 2 * Math.PI * (1 + overshootDeg / 360);
  return makeStroke(Array.from({ length: dotCount + 1 }, (_, i) => {
    const a = total * i / dotCount;
    return [cx + (wMm / 2) * Math.cos(a), cy + (hMm / 2) * Math.sin(a)];
  }), startTime, pageInfo);
}

/** Closed single-stroke rectangle, top-left at (x0, y0). */
function makeRect(x0, y0, wMm, hMm, startTime = 8000, pageInfo = {}) {
  const x1 = x0 + wMm, y1 = y0 + hMm, xm = (x0 + x1) / 2;
  return makeStroke([
    ...seg(xm, y0, x1, y0), ...seg(x1, y0, x1, y1), ...seg(x1, y1, x0, y1),
    ...seg(x0, y1, x0, y0), ...seg(x0, y0, xm, y0)
  ], startTime, pageInfo);
}

/** A letter-like zigzag `hMm` tall, 1.5 mm wide, top at topMm. */
function makeLetter(xMm, topMm, hMm = 3, startTime = 3000, pageInfo = {}) {
  return makeStroke(Array.from({ length: 8 }, (_, i) => [xMm + (i % 2) * 1.5, topMm + hMm * i / 7]), startTime, pageInfo);
}

/** Small text-like mark at a given position (mm). */
function makeTextStroke(cxMm, cyMm, startTime = 3000, pageInfo = {}) {
  return makeStroke([[cxMm, cyMm], [cxMm + 1.2, cyMm + 1.2], [cxMm + 2.4, cyMm]], startTime, pageInfo);
}

const types = strokes => filterDecorativeStrokes(strokes).decorativeStrokes.map(d => [d.index, d.type]);

// ---------------------------------------------------------------------------
// filterDecorativeStrokes — empty / passthrough
// ---------------------------------------------------------------------------

describe('filterDecorativeStrokes — empty / passthrough', () => {
  it('returns empty arrays and zero stats for null input', () => {
    const result = filterDecorativeStrokes(null);
    expect(result.textStrokes).toHaveLength(0);
    expect(result.decorativeStrokes).toHaveLength(0);
    expect(result.stats.total).toBe(0);
  });

  it('returns empty arrays and zero stats for empty array', () => {
    const result = filterDecorativeStrokes([]);
    expect(result.stats).toMatchObject({ boxes: 0, underlines: 0, circles: 0 });
  });

  it('passes through plain text strokes unchanged', () => {
    const strokes = [makeTextStroke(10, 20), makeTextStroke(15, 25), makeTextStroke(20, 30)];
    const result = filterDecorativeStrokes(strokes);
    expect(result.textStrokes).toHaveLength(3);
    expect(result.decorativeStrokes).toHaveLength(0);
    expect(result.stats).toMatchObject({ total: 3, text: 3, decorative: 0 });
  });

  it('ignores strokes with fewer than 2 dots', () => {
    const dot = makeStroke([[10, 10]]);
    expect(filterDecorativeStrokes([dot]).textStrokes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Underlines
// ---------------------------------------------------------------------------

describe('underlines', () => {
  it('detects a long, straight, horizontal stroke', () => {
    const result = filterDecorativeStrokes([makeLine(10, 50, 40, 30), makeTextStroke(20, 47), makeTextStroke(25, 47)]);
    expect(result.stats.underlines).toBe(1);
    expect(result.decorativeStrokes[0].type).toBe('underline');
    expect(result.textStrokes).toHaveLength(2);
  });

  it('detects a line drawn on a slope (5°) — measured along its own axis', () => {
    const sloped = makeLine(10, 50, 30, 30, 1000, 30 * Math.tan(5 * Math.PI / 180));
    expect(filterDecorativeStrokes([sloped]).stats.underlines).toBe(1);
  });

  it('does NOT flag a line steeper than the slope limit', () => {
    const steep = makeLine(10, 50, 30, 30, 1000, 30 * Math.tan(20 * Math.PI / 180));
    expect(filterDecorativeStrokes([steep]).stats.underlines).toBe(0);
  });

  it('detects a short (7 mm) underline with writing sitting on it', () => {
    const strokes = [makeLine(10, 50, 7, 15), makeLetter(11, 46.5), makeLetter(14, 46.5)];
    expect(types(strokes)).toEqual([[0, 'underline']]);
    expect(filterDecorativeStrokes(strokes).textStrokes).toHaveLength(2);
  });

  it('does NOT flag a short line with nothing on it (a hyphen or dash)', () => {
    expect(filterDecorativeStrokes([makeLine(10, 50, 7, 15)]).stats.underlines).toBe(0);
  });

  it('does NOT flag a line under 5 mm even with writing on it', () => {
    expect(filterDecorativeStrokes([makeLine(10, 50, 4, 15), makeLetter(10.5, 46.5), makeLetter(12, 46.5)])
      .stats.underlines).toBe(0);
  });

  it('leaves a strike-through selected (the line cuts through the writing)', () => {
    const strike = makeLine(10, 50, 20, 30);
    const letters = [12, 16, 20, 24].map((x, i) => makeLetter(x, 48.5, 3, 3000 + i));
    expect(filterDecorativeStrokes([strike, ...letters]).stats.underlines).toBe(0);
  });

  it('still detects an underline that a descender crosses', () => {
    const line = makeLine(10, 50, 20, 30);
    const onTop = [12, 16, 20].map((x, i) => makeLetter(x, 46.7, 3, 3000 + i));
    const descender = makeLetter(24, 47.5, 4, 3100);   // a "g" tail through the line
    expect(filterDecorativeStrokes([line, ...onTop, descender]).stats.underlines).toBe(1);
  });

  it('does NOT flag a wobbly stroke (not straight)', () => {
    const wavy = makeStroke(Array.from({ length: 30 }, (_, i) => [10 + i, 50 + 2 * Math.sin(i / 2)]));
    expect(filterDecorativeStrokes([wavy]).stats.underlines).toBe(0);
  });

  it('does NOT flag a stroke with too few dots', () => {
    expect(filterDecorativeStrokes([makeLine(10, 50, 40, 5)]).stats.underlines).toBe(0);
  });

  it('does NOT flag a vertical stroke', () => {
    const vertical = makeStroke(seg(10, 10, 10, 40, 20));
    expect(filterDecorativeStrokes([vertical]).decorativeStrokes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Loops: ovals, circles, single-stroke boxes
// ---------------------------------------------------------------------------

describe('loops', () => {
  it('detects a closed circle that contains content', () => {
    const result = filterDecorativeStrokes([makeOval(50, 50, 20, 20), makeTextStroke(46, 49), makeTextStroke(50, 51)]);
    expect(result.stats.circles).toBe(1);
    expect(result.decorativeStrokes[0].type).toBe('circle');
  });

  it('detects a wide oval round a date that overshoots its start', () => {
    // 20 × 5 mm (4:1), carries on 60° past where it began — the usual date oval
    const oval = makeOval(30, 20, 20, 5, { overshootDeg: 60 });
    const digits = [23, 27, 31, 35].map((x, i) => makeLetter(x, 18.8, 2.4, 3000 + i));
    expect(types([oval, ...digits])).toEqual([[0, 'circle']]);
  });

  it('detects a small (3 mm) circled number', () => {
    const ring = makeOval(20, 20, 3, 3.2, { dotCount: 24 });
    const digit = makeLetter(19.3, 18.9, 2.2);
    expect(types([ring, digit])).toEqual([[0, 'circle']]);
  });

  it('does NOT detect a small loop holding only a stray mark (a letter with a dot in it)', () => {
    const loop = makeOval(20, 20, 3, 3, { dotCount: 24 });
    const speck = makeStroke([[19.9, 19.9], [20.1, 20.0]]);
    expect(filterDecorativeStrokes([loop, speck]).decorativeStrokes).toHaveLength(0);
  });

  it('does NOT detect a circle with no content inside', () => {
    expect(filterDecorativeStrokes([makeOval(50, 50, 20, 20)]).decorativeStrokes).toHaveLength(0);
  });

  it('does NOT detect a loop below the minimum size', () => {
    expect(filterDecorativeStrokes([makeOval(50, 50, 2, 2), makeTextStroke(49.5, 49.5)]).decorativeStrokes).toHaveLength(0);
  });

  it('does NOT detect an open curve (270° arc)', () => {
    const arc = makeStroke(Array.from({ length: 60 }, (_, i) => {
      const a = 1.5 * Math.PI * i / 59;
      return [50 + 10 * Math.cos(a), 50 + 10 * Math.sin(a)];
    }), 10000);
    expect(filterDecorativeStrokes([arc, makeTextStroke(49, 49)]).decorativeStrokes).toHaveLength(0);
  });

  it('detects a closed single-stroke rectangle round content as a box', () => {
    const result = filterDecorativeStrokes([makeRect(10, 10, 25, 7), makeTextStroke(15, 12), makeTextStroke(22, 12)]);
    expect(result.stats.boxes).toBe(1);
    expect(result.decorativeStrokes[0].type).toBe('box');
    expect(result.textStrokes).toHaveLength(2);
  });

  it('detects a box traced twice round', () => {
    const r = makeRect(10, 10, 30, 12);
    const twice = { ...r, dotArray: [...r.dotArray, ...r.dotArray.map(d => ({ ...d, x: d.x + 0.05, y: d.y + 0.05 }))] };
    expect(filterDecorativeStrokes([twice, makeTextStroke(18, 14)]).stats.boxes).toBe(1);
  });

  it('keeps a task box (☑): small, square, with a tick inside', () => {
    const box = makeRect(10, 10, 5, 5);
    const tick = makeStroke([[11, 12.5], [12, 13.8], [14, 11]], 9000);
    expect(filterDecorativeStrokes([box, tick]).decorativeStrokes).toHaveLength(0);
  });

  it('still detects a small circled number the size of a task box (no corners inked)', () => {
    expect(types([makeOval(20, 20, 5, 5), makeLetter(19.2, 18.5, 3)])).toEqual([[0, 'circle']]);
  });
});

// ---------------------------------------------------------------------------
// Multi-stroke boxes
// ---------------------------------------------------------------------------

describe('multi-stroke boxes', () => {
  // Box 10..35 × 10..17 mm drawn as two L shapes: top + right, then left + bottom
  const topRight = (t = 1000, pageInfo = {}) => makeStroke([...seg(10, 10, 35, 10, 25), ...seg(35, 10, 35, 17, 8)], t, pageInfo);
  const leftBottom = (t = 1500, pageInfo = {}) => makeStroke([...seg(10, 10, 10, 17, 8), ...seg(10, 17, 35, 17, 25)], t, pageInfo);
  const inside = (pageInfo = {}) => [makeLetter(14, 12, 3, 5000, pageInfo), makeLetter(20, 12, 3, 5100, pageInfo)];

  it('detects two strokes drawn back to back that trace all four sides round content', () => {
    const result = filterDecorativeStrokes([topRight(), leftBottom(), ...inside()]);
    expect(result.stats.boxes).toBe(2);
    expect(result.decorativeStrokes.map(d => d.type)).toEqual(['box', 'box']);
    expect(result.textStrokes).toHaveLength(2);
  });

  it('detects a box drawn as four separate sides', () => {
    const sides = [
      makeStroke(seg(10, 10, 35, 10, 25), 1000), makeStroke(seg(35, 10, 35, 17, 8), 1300),
      makeStroke(seg(35, 17, 10, 17, 25), 1600), makeStroke(seg(10, 17, 10, 10, 8), 1900)
    ];
    expect(filterDecorativeStrokes([...sides, ...inside()]).stats.boxes).toBe(4);
  });

  it('does NOT group strokes drawn far apart in time', () => {
    expect(filterDecorativeStrokes([topRight(1000), leftBottom(30000), ...inside()]).stats.boxes).toBe(0);
  });

  it('does NOT treat an L-shaped pair (only two sides) as a box', () => {
    const top = makeStroke(seg(10, 10, 35, 10, 25), 1000);
    const left = makeStroke(seg(10, 10, 10, 17, 8), 1500);
    expect(filterDecorativeStrokes([top, left, ...inside()]).stats.boxes).toBe(0);
  });

  it('does NOT detect an empty multi-stroke box', () => {
    expect(filterDecorativeStrokes([topRight(), leftBottom()]).stats.boxes).toBe(0);
  });

  it('does NOT detect a box smaller than the multi-stroke minimum (letters like 4 or D)', () => {
    const a = makeStroke([...seg(10, 10, 13, 10, 8), ...seg(13, 10, 13, 13, 8)], 1000);
    const b = makeStroke([...seg(10, 10, 10, 13, 8), ...seg(10, 13, 13, 13, 8)], 1200);
    const c = makeStroke([[11, 11.2], [11.6, 12.2], [12.2, 11.2]], 1400);
    expect(filterDecorativeStrokes([a, b, c]).decorativeStrokes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Per page
// ---------------------------------------------------------------------------

describe('per-page detection', () => {
  const page1 = { section: 3, owner: 1012, book: '388', page: 1 };
  const page2 = { section: 3, owner: 1012, book: '388', page: 2 };

  it('does NOT count another page\'s ink as content (pages share coordinates)', () => {
    const box = makeRect(10, 10, 25, 7, 8000, page1);
    const elsewhere = [makeTextStroke(15, 12, 3000, page2), makeTextStroke(22, 12, 3100, page2)];
    expect(filterDecorativeStrokes([box, ...elsewhere]).decorativeStrokes).toHaveLength(0);
  });

  it('detects the same box when its content is on its own page', () => {
    const box = makeRect(10, 10, 25, 7, 8000, page1);
    const own = [makeTextStroke(15, 12, 3000, page1), makeTextStroke(22, 12, 3100, page1)];
    expect(types([box, ...own])).toEqual([[0, 'box']]);
  });
});

// ---------------------------------------------------------------------------
// detectDecorativeIndices
// ---------------------------------------------------------------------------

describe('detectDecorativeIndices', () => {
  it('returns empty indices and zero stats for null/empty input', () => {
    const empty = { indices: [], stats: { boxes: 0, underlines: 0, circles: 0 } };
    expect(detectDecorativeIndices(null)).toEqual(empty);
    expect(detectDecorativeIndices([])).toEqual(empty);
  });

  it('returns indices into the input array, sorted, with per-type stats', () => {
    const strokes = [
      makeTextStroke(46, 49), makeOval(50, 50, 20, 20), makeLine(10, 80, 40, 30), makeTextStroke(50, 51)
    ];
    expect(detectDecorativeIndices(strokes)).toEqual({ indices: [1, 2], stats: { boxes: 0, underlines: 1, circles: 1 } });
  });

  it('agrees with filterDecorativeStrokes', () => {
    const strokes = [makeLine(10, 50, 40, 30), makeTextStroke(20, 20), makeRect(10, 60, 25, 7), makeTextStroke(15, 62)];
    const fromFilter = filterDecorativeStrokes(strokes).decorativeStrokes.map(d => d.index);
    expect(detectDecorativeIndices(strokes).indices).toEqual(fromFilter);
  });

  it('returns no indices when all strokes are plain text', () => {
    expect(detectDecorativeIndices([makeTextStroke(10, 20), makeTextStroke(15, 25)]).indices).toHaveLength(0);
  });
});
