/**
 * The box a render lays a page out in.
 *
 * The Library reader fits each page to its ink box, or to the printed sheet when
 * Neo paper is on (`frameToBounds(bg.frame)` in PageInk.svelte). For Claude the
 * paper is the better default: every page of a notebook then renders at the same
 * scale and in the same place, a half-empty page looks half empty, and a stray
 * stroke far off the paper (a pen dragged in a pocket) is simply clipped instead
 * of shrinking the whole page to a corner. Only the manifest's geometry is used;
 * Neo's images are never read here.
 *
 * Without a frame (book never fetched), the box is a robust ink extent: stroke
 * boxes trimmed at the 2nd / 98th percentile, padded, and never larger than the
 * raw ink box. That drops a lone stray stroke on any page with enough ink to
 * tell it is one.
 */
import { isBogusPoint } from '../../src/lib/timeline-feed.js';

/** Ink may sit this far (Ncode units, ~2.4 mm each) outside the printed frame and still be drawn. */
export const FRAME_SLACK = 3;
/** Trim fraction at each end of the stroke-box distribution. */
export const TRIM = 0.02;
/** Padding round a trimmed ink box, in Ncode units. */
export const INK_PAD = 2;

/** One stroke's box, ignoring the SDK's origin dots; null when it has none. */
export function strokeBox(stroke) {
  let b = null;
  for (const p of (stroke && stroke.points) || []) {
    if (isBogusPoint(p)) continue;
    if (!b) b = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] };
    else {
      if (p[0] < b.minX) b.minX = p[0];
      if (p[1] < b.minY) b.minY = p[1];
      if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] > b.maxY) b.maxY = p[1];
    }
  }
  return b;
}

const intersect = (a, b) => ({
  minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY),
  maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY)
});
const grow = (b, d) => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const union = (a, b) => ({
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY)
});
const valid = (b) => b && b.maxX > b.minX && b.maxY > b.minY;

/**
 * Ink extent with outlying strokes trimmed: each edge is the TRIM / 1-TRIM
 * quantile of the stroke boxes' matching edge, padded by `max(INK_PAD, 10% of
 * the span)`, then clipped to the raw ink box. Fewer than 1/TRIM strokes trims
 * nothing (no stroke can be called an outlier on so little ink).
 *
 * @returns {{minX,minY,maxX,maxY}|null}
 */
export function robustInkBounds(strokes) {
  const boxes = (strokes || []).map(strokeBox).filter(Boolean);
  if (!boxes.length) return null;
  const raw = boxes.reduce(union);
  const n = boxes.length;
  const lo = Math.floor(n * TRIM);
  const hi = n - 1 - lo;
  if (lo === 0) return raw;
  const q = (key, i) => boxes.map((b) => b[key]).sort((a, b) => a - b)[i];
  const core = { minX: q('minX', lo), minY: q('minY', lo), maxX: q('maxX', hi), maxY: q('maxY', hi) };
  const pad = Math.max(INK_PAD, 0.1 * Math.max(core.maxX - core.minX, core.maxY - core.minY));
  const out = intersect(raw, grow(core, pad));
  return valid(out) ? out : raw;
}

/**
 * The view box for one render.
 *
 * @param {{strokes: Array, frame?: {x0,y0,x1,y1}|null, fit?: 'paper'|'ink'}} opts
 *   `strokes`: what decides the box (the whole page, or for fit 'ink' the ink to zoom on);
 *   `frame`: the Neo paper frame, when the book has one
 * @returns {{bounds: {minX,minY,maxX,maxY}, source: 'paper'|'ink', clipped: number}|null}
 *   `clipped`: strokes that fall wholly outside the box (not drawn)
 */
export function viewBounds({ strokes, frame = null, fit = 'paper' }) {
  const ink = robustInkBounds(strokes);
  const paper = frame ? { minX: frame.x0, minY: frame.y0, maxX: frame.x1, maxY: frame.y1 } : null;
  let bounds, source;
  if (fit === 'ink') {
    if (!ink) return null;
    bounds = grow(ink, INK_PAD);
    if (paper) {
      const c = intersect(bounds, grow(paper, FRAME_SLACK));
      if (valid(c)) bounds = c;
    }
    source = 'ink';
  } else if (paper) {
    // The sheet, widened to take in ink that runs a little off it.
    bounds = ink ? union(paper, intersect(ink, grow(paper, FRAME_SLACK))) : paper;
    if (!valid(bounds)) bounds = paper;
    source = 'paper';
  } else {
    if (!ink) return null;
    bounds = ink;
    source = 'ink';
  }
  let clipped = 0;
  for (const s of strokes || []) {
    const b = strokeBox(s);
    if (b && (b.maxX < bounds.minX || b.minX > bounds.maxX || b.maxY < bounds.minY || b.minY > bounds.maxY)) clipped++;
  }
  return { bounds, source, clipped };
}

