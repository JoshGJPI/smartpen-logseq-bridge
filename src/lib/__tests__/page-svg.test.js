/**
 * Tests for viewer/page-svg.js — pure SVG helpers used by the Book View pane.
 *
 * Coverage:
 *   - computeStrokeBounds (empty, multi-stroke, strokes missing points)
 *   - strokeToPathD (<2 points, scaling, normalisation to bounds origin)
 *   - generateThumbnailSVG (empty placeholder, paths, dimensions)
 */

import { describe, it, expect } from 'vitest';
import {
  NCODE_SCALE,
  DEFAULT_STROKE_WIDTH,
  computeStrokeBounds,
  strokeToPathD,
  strokeToWidthRuns,
  strokePointPressures,
  generateThumbnailSVG,
} from '../viewer/page-svg.js';
import { normalizeProfile, profileFromPreset } from '../sketch-width.js';

let n = 0;
const stroke = (points) => ({ id: 's' + n++, points });

describe('computeStrokeBounds', () => {
  it('returns null for empty / invalid input', () => {
    expect(computeStrokeBounds([])).toBeNull();
    expect(computeStrokeBounds(null)).toBeNull();
  });

  it('computes the bounding box across all points', () => {
    const b = computeStrokeBounds([stroke([[1, 2], [3, 4]]), stroke([[0, 5], [2, 1]])]);
    expect(b).toEqual({ minX: 0, minY: 1, maxX: 3, maxY: 5 });
  });

  it('ignores strokes that have no points', () => {
    const b = computeStrokeBounds([{ id: 'x' }, stroke([[1, 1], [2, 2]])]);
    expect(b).toEqual({ minX: 1, minY: 1, maxX: 2, maxY: 2 });
  });
});

describe('strokeToPathD', () => {
  const origin = { minX: 0, minY: 0 };

  it('returns empty string for fewer than 2 points', () => {
    expect(strokeToPathD(stroke([[1, 1]]), origin)).toBe('');
    expect(strokeToPathD(stroke([]), origin)).toBe('');
  });

  it('builds an M/L path scaled by the given factor', () => {
    expect(strokeToPathD(stroke([[0, 0], [1, 1]]), origin, 2)).toBe('M 0.00 0.00 L 2.00 2.00');
  });

  it('normalises coordinates to the bounds origin', () => {
    expect(strokeToPathD(stroke([[5, 5], [6, 5]]), { minX: 5, minY: 5 }, 1)).toBe(
      'M 0.00 0.00 L 1.00 0.00'
    );
  });
});

describe('generateThumbnailSVG', () => {
  it('renders an "Empty" placeholder when there are no strokes', () => {
    const svg = generateThumbnailSVG([], 240, 180);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Empty');
  });

  it('produces an svg with stroke paths and the requested dimensions', () => {
    const svg = generateThumbnailSVG([stroke([[0, 0], [10, 10], [20, 5]])], 240, 180);
    expect(svg).toContain('<path');
    expect(svg).toContain('width="240"');
    expect(svg).toContain('height="180"');
  });

  it('exposes the Ncode scale constant', () => {
    expect(NCODE_SCALE).toBeCloseTo(2.371);
  });
});

// ---------------------------------------------------------------------------
// strokePointPressures / strokeToWidthRuns — sketch stroke SVG rendering
// ---------------------------------------------------------------------------

const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

/** Storage-format sketch stroke: points are [x, y, timestamp, force]. */
const sketchStroke = (forces) => ({
  id: 'sk' + n++,
  sketch: true,
  points: forces.map((f, i) => [i, 0, 1000 + i, f]),
});

/** Profile with a wide band and no softening, so a ramp shows distinct widths. */
const WIDE = normalizeProfile({
  minWidth: 0.2, maxWidth: 3, gamma: 1,
  pressureFloor: 0, pressureCeil: 1000,
  smoothing: 0, slewLimit: 0, flatWidth: 0.6,
});

const RAMP = [0, 150, 300, 450, 600, 750, 900, 1000];

describe('strokePointPressures', () => {
  it('reads the 4th tuple element as force', () => {
    expect(strokePointPressures(sketchStroke([100, 500]))).toEqual([100, 500]);
  });

  it('returns NaN for legacy tuples with no force recorded', () => {
    const out = strokePointPressures(stroke([[1, 2, 1000], [3, 4]]));
    expect(out).toHaveLength(2);
    out.forEach((f) => expect(f).toBeNaN());
  });

  it('handles missing / empty input', () => {
    expect(strokePointPressures(null)).toEqual([]);
    expect(strokePointPressures({ points: [] })).toEqual([]);
  });
});

describe('strokeToWidthRuns', () => {
  it('returns nothing to draw for <2 points or missing bounds', () => {
    expect(strokeToWidthRuns(sketchStroke([500]), BOUNDS, WIDE)).toEqual([]);
    expect(strokeToWidthRuns(sketchStroke([500, 600]), null, WIDE)).toEqual([]);
  });

  it('splits a pressure ramp into multiple differently-sized runs', () => {
    // A single <path> can only carry one stroke-width, so variation must appear
    // as separate runs.
    const runs = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE);
    expect(runs.length).toBeGreaterThan(1);
    expect(new Set(runs.map((r) => r.width)).size).toBeGreaterThan(1);
  });

  it('increases run width monotonically for a rising ramp', () => {
    const widths = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE).map((r) => r.width);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0]);
  });

  it('covers every segment exactly once across its runs', () => {
    // Runs share boundary vertices, so segments = sum of (vertices - 1).
    const runs = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE);
    const segments = runs.reduce((sum, r) => sum + (r.d.match(/L /g) || []).length, 0);
    expect(segments).toBe(RAMP.length - 1);
  });

  it('collapses constant pressure to a single run', () => {
    const runs = strokeToWidthRuns(sketchStroke([500, 500, 500, 500, 500]), BOUNDS, WIDE);
    expect(runs).toHaveLength(1);
    expect((runs[0].d.match(/L /g) || []).length).toBe(4);
  });

  it('starts each run with a moveto and normalises to the bounds origin', () => {
    const offset = { minX: 10, minY: 20, maxX: 100, maxY: 100 };
    const s = { id: 'x', sketch: true, points: [[10, 20, 1, 500], [11, 20, 2, 500]] };
    const runs = strokeToWidthRuns(s, offset, WIDE, 2);
    expect(runs[0].d).toBe('M 0.00 0.00 L 2.00 0.00');
  });

  it('emits round decimal widths rather than float noise', () => {
    const runs = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE);
    runs.forEach((r) => expect(String(r.width)).not.toMatch(/\d{6,}/));
  });

  it('scales width with the scale factor, like the coordinates', () => {
    const narrow = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE, 1);
    const wide = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, WIDE, 4);
    expect(Math.max(...wide.map((r) => r.width))).toBeGreaterThan(
      Math.max(...narrow.map((r) => r.width))
    );
  });

  it('uses a constant flatWidth for legacy strokes with no force data', () => {
    // Same rule as the canvas: no data means one honest width, not a hairline.
    const legacy = { id: 'L', sketch: true, points: [[0, 0, 1], [1, 0, 2], [2, 0, 3]] };
    const runs = strokeToWidthRuns(legacy, BOUNDS, WIDE);
    expect(runs).toHaveLength(1);
    expect(runs[0].width).toBeCloseTo(WIDE.flatWidth * NCODE_SCALE, 1);
  });

  it('honours the profile — pen varies less than brush', () => {
    const spread = (preset) => {
      const w = strokeToWidthRuns(sketchStroke(RAMP), BOUNDS, profileFromPreset(preset)).map((r) => r.width);
      return Math.max(...w) - Math.min(...w);
    };
    expect(spread('pen')).toBeLessThan(spread('brush'));
  });

  it('never emits a zero or negative width', () => {
    const runs = strokeToWidthRuns(
      sketchStroke(RAMP),
      BOUNDS,
      normalizeProfile({ minWidth: 0.01, maxWidth: 0.02 }),
      0.01
    );
    runs.forEach((r) => expect(r.width).toBeGreaterThan(0));
  });

  it('exports a default width for ordinary handwriting strokes', () => {
    expect(DEFAULT_STROKE_WIDTH).toBeGreaterThan(0);
  });
});
