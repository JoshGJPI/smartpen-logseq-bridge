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
  computeStrokeBounds,
  strokeToPathD,
  generateThumbnailSVG,
} from '../viewer/page-svg.js';

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
