/**
 * Tests for stroke-filter.js — decorative stroke detection.
 *
 * Decorative strokes (boxes, underlines, circles) should be separated from
 * text strokes before handing off to MyScript so they are not mis-recognised
 * as emoji/symbols.
 *
 * All geometry is expressed in Ncode units (1 unit = 2.371 mm).  The helpers
 * below convert from mm to Ncode for readability.
 *
 * Coverage:
 *   - filterDecorativeStrokes: empty input, returns textStrokes + decorativeStrokes + stats
 *   - Underline detection: aspect ratio + straightness + width thresholds
 *   - Circle detection: closed, large enough, contains content
 *   - 2-stroke box detection: temporal proximity, contains content, non-overlapping
 *   - detectDecorativeIndices: returns correct indices + stats object
 */

import { describe, it, expect } from 'vitest';
import { filterDecorativeStrokes, detectDecorativeIndices, config } from '../stroke-filter.js';

const { NCODE_TO_MM } = config;

// ---------------------------------------------------------------------------
// Coordinate helpers — all measurements in mm → Ncode
// ---------------------------------------------------------------------------

const mmToNcode = mm => mm / NCODE_TO_MM;

/**
 * Build a simple horizontal stroke of given width (mm), at the specified y position.
 * A tiny y-wobble (0.1mm) is added to ensure bounds.height > 0.01, which is required
 * by detectUnderlines before it calculates aspect ratio.  Real pen strokes are never
 * perfectly flat, so this matches realistic input.
 */
function makeHorizontalStroke(startXmm, yMm, widthMm, dotCount = 20, startTime = 1000) {
  const startX = mmToNcode(startXmm);
  const baseY = mmToNcode(yMm);
  const wobble = mmToNcode(0.1); // tiny vertical variation — keeps aspect ratio >> 50
  const endX = mmToNcode(startXmm + widthMm);
  const dots = Array.from({ length: dotCount }, (_, i) => ({
    x: startX + (endX - startX) * (i / (dotCount - 1)),
    // Alternate slightly above/below baseline to get height > 0 while staying very straight
    y: baseY + (i % 2 === 0 ? wobble : -wobble),
    f: 512,
    timestamp: startTime + i
  }));
  return { pageInfo: {}, startTime, endTime: startTime + dotCount, dotArray: dots };
}

/** Build a simple vertical stroke of given height (mm), at the specified x position */
function makeVerticalStroke(xMm, startYmm, heightMm, dotCount = 20, startTime = 2000) {
  const x = mmToNcode(xMm);
  const startY = mmToNcode(startYmm);
  const endY = mmToNcode(startYmm + heightMm);
  const dots = Array.from({ length: dotCount }, (_, i) => ({
    x,
    y: startY + (endY - startY) * (i / (dotCount - 1)),
    f: 512,
    timestamp: startTime + i
  }));
  return { pageInfo: {}, startTime, endTime: startTime + dotCount, dotArray: dots };
}

/**
 * Build a closed approximately-circular stroke (polygon approximation).
 * diameterMm controls size; centreX/Y are in mm.
 */
function makeCircleStroke(centreMm, diameterMm, dotCount = 60, startTime = 5000) {
  const [cx, cy] = centreMm.map(mmToNcode);
  const r = mmToNcode(diameterMm / 2);
  // Close the loop by repeating the first point at the end
  const dots = Array.from({ length: dotCount + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / dotCount;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      f: 512,
      timestamp: startTime + i
    };
  });
  return { pageInfo: {}, startTime, endTime: startTime + dotCount, dotArray: dots };
}

/**
 * Build a small text-like stroke (a short wiggle) that fits inside a box/circle.
 * cx/cy in mm.
 */
function makeTextStroke(cxMm, cyMm, startTime = 3000) {
  const cx = mmToNcode(cxMm);
  const cy = mmToNcode(cyMm);
  const dots = [
    { x: cx,       y: cy,       f: 512, timestamp: startTime },
    { x: cx + 0.5, y: cy + 0.5, f: 512, timestamp: startTime + 1 },
    { x: cx + 1,   y: cy,       f: 512, timestamp: startTime + 2 },
  ];
  return { pageInfo: {}, startTime, endTime: startTime + 3, dotArray: dots };
}

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
    expect(result.textStrokes).toHaveLength(0);
    expect(result.decorativeStrokes).toHaveLength(0);
    expect(result.stats.boxes).toBe(0);
    expect(result.stats.underlines).toBe(0);
    expect(result.stats.circles).toBe(0);
  });

  it('passes through text strokes with no decorative elements', () => {
    const strokes = [
      makeTextStroke(10, 20, 1000),
      makeTextStroke(15, 25, 2000),
      makeTextStroke(20, 30, 3000)
    ];
    const result = filterDecorativeStrokes(strokes);
    expect(result.textStrokes).toHaveLength(3);
    expect(result.decorativeStrokes).toHaveLength(0);
    expect(result.stats.total).toBe(3);
    expect(result.stats.text).toBe(3);
    expect(result.stats.decorative).toBe(0);
  });

  it('stats fields are always present in result', () => {
    const result = filterDecorativeStrokes([makeTextStroke(10, 10)]);
    expect(result.stats).toMatchObject({
      total: expect.any(Number),
      text: expect.any(Number),
      decorative: expect.any(Number),
      boxes: expect.any(Number),
      underlines: expect.any(Number),
      circles: expect.any(Number)
    });
  });
});

// ---------------------------------------------------------------------------
// Underline detection
// ---------------------------------------------------------------------------

describe('filterDecorativeStrokes — underline detection', () => {
  it('detects a long, straight, horizontal stroke as an underline', () => {
    // 40mm wide (> UNDERLINE_MIN_WIDTH=15), at a y position, very straight
    const underline = makeHorizontalStroke(10, 50, 40, 30, 1000);
    const text1 = makeTextStroke(20, 48, 4000);
    const text2 = makeTextStroke(25, 48, 5000);

    const result = filterDecorativeStrokes([underline, text1, text2]);

    expect(result.stats.underlines).toBe(1);
    expect(result.decorativeStrokes).toHaveLength(1);
    expect(result.decorativeStrokes[0].type).toBe('underline');
  });

  it('does NOT flag a short horizontal stroke as an underline', () => {
    // 5mm wide — below UNDERLINE_MIN_WIDTH=15
    const shortHorizontal = makeHorizontalStroke(10, 50, 5, 15, 1000);
    const result = filterDecorativeStrokes([shortHorizontal]);
    expect(result.stats.underlines).toBe(0);
  });

  it('does NOT flag a vertical stroke as an underline', () => {
    const vertical = makeVerticalStroke(10, 10, 30, 20, 1000);
    const result = filterDecorativeStrokes([vertical]);
    expect(result.stats.underlines).toBe(0);
  });

  it('does NOT flag a stroke with too few dots as an underline', () => {
    // Only 5 dots — below the implicit minimum
    const sparse = makeHorizontalStroke(10, 50, 40, 5, 1000);
    const result = filterDecorativeStrokes([sparse]);
    expect(result.stats.underlines).toBe(0);
  });

  it('underline stroke is excluded from textStrokes', () => {
    const underline = makeHorizontalStroke(10, 50, 40, 30, 1000);
    const textStroke = makeTextStroke(20, 48, 4000);
    const result = filterDecorativeStrokes([underline, textStroke]);
    // textStrokes should contain only the real text stroke
    expect(result.textStrokes).toHaveLength(1);
    expect(result.textStrokes[0]).toBe(textStroke);
  });
});

// ---------------------------------------------------------------------------
// Circle detection
// ---------------------------------------------------------------------------

describe('filterDecorativeStrokes — circle detection', () => {
  it('detects a closed circle that contains content strokes', () => {
    const circle = makeCircleStroke([50, 50], 20, 60, 10000);
    // Place text inside the circle (50mm centre, 10mm radius → 45-55mm)
    const insideText1 = makeTextStroke(48, 49, 20000);
    const insideText2 = makeTextStroke(51, 51, 21000);

    const result = filterDecorativeStrokes([circle, insideText1, insideText2]);
    expect(result.stats.circles).toBe(1);
    expect(result.decorativeStrokes[0].type).toBe('circle');
  });

  it('does NOT detect a circle with no content inside', () => {
    const circle = makeCircleStroke([50, 50], 20, 60, 10000);
    // No strokes inside
    const result = filterDecorativeStrokes([circle]);
    expect(result.stats.circles).toBe(0);
    expect(result.textStrokes).toHaveLength(1); // circle kept as text stroke
  });

  it('does NOT detect a very small circle (smaller than a letter)', () => {
    // 2mm — below CIRCLE_MIN_SIZE=4mm
    const tiny = makeCircleStroke([50, 50], 2, 60, 10000);
    const inside = makeTextStroke(50, 50, 20000);
    const result = filterDecorativeStrokes([tiny, inside]);
    expect(result.stats.circles).toBe(0);
  });

  it('does NOT detect an open curve as a circle', () => {
    // Create a stroke that is circular in shape but not closed
    const cx = mmToNcode(50);
    const cy = mmToNcode(50);
    const r = mmToNcode(10);
    const dots = Array.from({ length: 60 }, (_, i) => {
      // Only go 270 degrees — leave a gap
      const angle = (1.5 * Math.PI * i) / 59;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), f: 512, timestamp: 10000 + i };
    });
    const openCurve = { pageInfo: {}, startTime: 10000, endTime: 10060, dotArray: dots };
    const inside = makeTextStroke(50, 50, 20000);
    const result = filterDecorativeStrokes([openCurve, inside]);
    expect(result.stats.circles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2-stroke box detection
// ---------------------------------------------------------------------------

describe('filterDecorativeStrokes — 2-stroke box detection', () => {
  it('detects a horizontal+vertical pair drawn close in time with content inside', () => {
    // A 20mm × 20mm box drawn as two strokes
    // Horizontal top: from (10,10) to (30,10) in mm
    const hStroke = makeHorizontalStroke(10, 10, 20, 20, 1000);
    // Vertical side: from (10,10) to (10,30) in mm — drawn immediately after
    const vStroke = makeVerticalStroke(10, 10, 20, 20, 1500);
    // Content inside the box
    const text1 = makeTextStroke(15, 15, 5000);
    const text2 = makeTextStroke(20, 18, 6000);

    const result = filterDecorativeStrokes([hStroke, vStroke, text1, text2]);
    expect(result.stats.boxes).toBeGreaterThanOrEqual(1);
    expect(result.decorativeStrokes.some(d => d.type === 'box')).toBe(true);
  });

  it('does NOT detect a box when no content strokes are inside', () => {
    const hStroke = makeHorizontalStroke(10, 10, 20, 20, 1000);
    const vStroke = makeVerticalStroke(10, 10, 20, 20, 1500);
    // No content inside
    const result = filterDecorativeStrokes([hStroke, vStroke]);
    expect(result.stats.boxes).toBe(0);
  });

  it('does NOT detect a box when strokes are too far apart in time', () => {
    const hStroke = makeHorizontalStroke(10, 10, 20, 20, 1000);
    // 10 seconds later — above BOX_TIME_THRESHOLD=5000ms
    const vStroke = makeVerticalStroke(10, 10, 20, 20, 11000);
    const text1 = makeTextStroke(15, 15, 20000);
    const text2 = makeTextStroke(20, 18, 21000);
    const result = filterDecorativeStrokes([hStroke, vStroke, text1, text2]);
    expect(result.stats.boxes).toBe(0);
  });

  it('does NOT detect a box when dimensions are too small', () => {
    // 3mm × 3mm — below BOX_MIN_SIZE=5mm
    const hStroke = makeHorizontalStroke(10, 10, 3, 20, 1000);
    const vStroke = makeVerticalStroke(10, 10, 3, 20, 1500);
    const text1 = makeTextStroke(11, 11, 5000);
    const text2 = makeTextStroke(12, 12, 6000);
    const result = filterDecorativeStrokes([hStroke, vStroke, text1, text2]);
    expect(result.stats.boxes).toBe(0);
  });

  it('box strokes are removed from textStrokes', () => {
    const hStroke = makeHorizontalStroke(10, 10, 20, 20, 1000);
    const vStroke = makeVerticalStroke(10, 10, 20, 20, 1500);
    const text1 = makeTextStroke(15, 15, 5000);
    const text2 = makeTextStroke(20, 18, 6000);

    const result = filterDecorativeStrokes([hStroke, vStroke, text1, text2]);
    // textStrokes should only contain the actual content strokes
    expect(result.textStrokes).toHaveLength(2);
    expect(result.textStrokes).toContain(text1);
    expect(result.textStrokes).toContain(text2);
  });
});

// ---------------------------------------------------------------------------
// detectDecorativeIndices
// ---------------------------------------------------------------------------

describe('detectDecorativeIndices', () => {
  it('returns empty indices and zero stats for null/empty input', () => {
    expect(detectDecorativeIndices(null)).toEqual({
      indices: [],
      stats: { boxes: 0, underlines: 0, circles: 0 }
    });
    expect(detectDecorativeIndices([])).toEqual({
      indices: [],
      stats: { boxes: 0, underlines: 0, circles: 0 }
    });
  });

  it('returns correct indices for detected underlines', () => {
    const underline = makeHorizontalStroke(10, 50, 40, 30, 1000);
    const text1 = makeTextStroke(20, 20, 4000);
    const text2 = makeTextStroke(25, 25, 5000);

    const result = detectDecorativeIndices([underline, text1, text2]);
    // Index 0 should be the underline
    expect(result.indices).toContain(0);
    expect(result.stats.underlines).toBe(1);
  });

  it('stats object has boxes, underlines, and circles fields', () => {
    const result = detectDecorativeIndices([makeTextStroke(10, 10)]);
    expect(result.stats).toMatchObject({
      boxes: expect.any(Number),
      underlines: expect.any(Number),
      circles: expect.any(Number)
    });
  });

  it('returns indices that match filterDecorativeStrokes decorativeStrokes', () => {
    const underline = makeHorizontalStroke(10, 50, 40, 30, 1000);
    const text1 = makeTextStroke(20, 20, 4000);

    const filterResult = filterDecorativeStrokes([underline, text1]);
    const indexResult = detectDecorativeIndices([underline, text1]);

    const decorativeIndicesFromFilter = filterResult.decorativeStrokes.map(d => d.index);
    // Both APIs should agree on which indices are decorative
    decorativeIndicesFromFilter.forEach(idx => {
      expect(indexResult.indices).toContain(idx);
    });
  });

  it('returns no indices when all strokes are plain text', () => {
    const strokes = [
      makeTextStroke(10, 20, 1000),
      makeTextStroke(15, 25, 2000)
    ];
    const result = detectDecorativeIndices(strokes);
    expect(result.indices).toHaveLength(0);
  });
});
