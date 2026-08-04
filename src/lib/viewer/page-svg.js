/**
 * page-svg — pure SVG helpers for the Book View pane.
 *
 * The viewer renders a single page's strokes as self-contained SVG paths
 * (one `<path>` per stroke), which fits the flex spread layout cleanly and
 * keeps the viewer independent of the world-space capture canvas
 * (`canvas-renderer.js`). Strokes use the PageDoc storage format:
 *   { id, points: [[x, y, timestamp?], ...] }   // x,y in Ncode mm
 *
 * Ported from the reference LogSeq plugin's svg-generator.ts.
 */

import { widthsForStrokeSeries, normalizeProfile } from '../sketch-width.js';

/** Ncode mm → screen-pixel scale factor (matches canvas-renderer.js). */
export const NCODE_SCALE = 2.371;

/** Default `stroke-width` (user units) for ordinary handwriting strokes. */
export const DEFAULT_STROKE_WIDTH = 0.5;

/**
 * Quantisation step for sketch run widths, in user units. Coarser than the
 * canvas equivalent because SVG has no frame budget to protect — the aim here is
 * only to keep the DOM node count sane on a dense page.
 */
const SVG_WIDTH_QUANTUM = 0.05;

/**
 * Compute the tight bounding box (in Ncode coordinates) of a stroke array.
 * @param {Array<{points: number[][]}>} strokes
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null} null when empty
 */
export function computeStrokeBounds(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    const points = stroke && stroke.points;
    if (!points) continue;
    for (const p of points) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Build the SVG path `d` attribute for one stroke, normalised so the page's
 * `bounds.minX/minY` map to the SVG origin and scaled by `scale`.
 * Strokes with fewer than 2 points produce an empty string (nothing to draw).
 * @param {{points: number[][]}} stroke
 * @param {{minX:number,minY:number}} bounds
 * @param {number} [scale]
 * @returns {string}
 */
export function strokeToPathD(stroke, bounds, scale = NCODE_SCALE) {
  const points = stroke && stroke.points;
  if (!bounds || !points || points.length < 2) return '';
  return points
    .map((p, i) => {
      const x = (p[0] - bounds.minX) * scale;
      const y = (p[1] - bounds.minY) * scale;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

/**
 * Pull the per-point pen force out of a storage-format stroke.
 *
 * Point tuples are `[x, y, timestamp?, force?]`. Pages written before pressure
 * was persisted have no 4th element, which comes back as NaN — the "missing"
 * marker `widthsForStrokeSeries` expects.
 *
 * @param {{points?: number[][]}} stroke
 * @returns {number[]}
 */
export function strokePointPressures(stroke) {
  const points = (stroke && stroke.points) || [];
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const f = points[i] && points[i][3];
    out[i] = typeof f === 'number' && Number.isFinite(f) ? f : NaN;
  }
  return out;
}

/**
 * Split a sketch stroke into constant-width runs for SVG rendering.
 *
 * A single SVG `<path>` has one `stroke-width` for its whole length — the same
 * constraint Canvas2D imposes — so a line whose thickness follows pressure has to
 * become several paths. Each run covers a maximal span of segments whose widths
 * quantise to the same value; consecutive runs share a boundary vertex and rely
 * on `stroke-linecap="round"` to join seamlessly.
 *
 * Returns `[]` for strokes with fewer than 2 points (nothing to draw).
 *
 * @param {{points?: number[][]}} stroke
 * @param {{minX:number,minY:number}} bounds
 * @param {Partial<import('../sketch-width.js').SketchProfile>} profile
 * @param {number} [scale]
 * @returns {Array<{d: string, width: number}>}
 */
export function strokeToWidthRuns(stroke, bounds, profile, scale = NCODE_SCALE) {
  const points = (stroke && stroke.points) || [];
  if (!bounds || points.length < 2) return [];

  const p = normalizeProfile(profile);
  const widthsMm = widthsForStrokeSeries(strokePointPressures(stroke), p);

  // Project once; runs reference these by index.
  const xs = new Array(points.length);
  const ys = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    xs[i] = ((points[i][0] - bounds.minX) * scale).toFixed(2);
    ys[i] = ((points[i][1] - bounds.minY) * scale).toFixed(2);
  }

  const segmentCount = points.length - 1;
  const widthAt = (segment) => {
    // Widths are per-vertex; a segment takes the mean of its two endpoints.
    const mm = (widthsMm[segment] + widthsMm[segment + 1]) / 2;
    const units = mm * scale;
    return Math.max(SVG_WIDTH_QUANTUM, Math.round(units / SVG_WIDTH_QUANTUM) * SVG_WIDTH_QUANTUM);
  };

  const runFor = (a, b, width) => {
    let d = `M ${xs[a]} ${ys[a]}`;
    for (let i = a + 1; i <= b; i++) d += ` L ${xs[i]} ${ys[i]}`;
    // Rounded because the quantum multiply reintroduces float noise
    // (0.05 * 7 = 0.35000000000000003) which would bloat the markup.
    return { d, width: Math.round(width * 1000) / 1000 };
  };

  const runs = [];
  let runStart = 0;
  let runWidth = widthAt(0);

  for (let i = 1; i < segmentCount; i++) {
    const w = widthAt(i);
    if (w !== runWidth) {
      runs.push(runFor(runStart, i, runWidth));
      runStart = i;
      runWidth = w;
    }
  }
  runs.push(runFor(runStart, segmentCount, runWidth));

  return runs;
}

/**
 * Generate a small, self-fitting thumbnail SVG string for page cards.
 * The strokes are scaled to fit within maxWidth × maxHeight preserving aspect.
 * @param {Array<{points:number[][]}>} strokes
 * @param {number} [maxWidth]
 * @param {number} [maxHeight]
 * @param {string} [strokeColor]
 * @returns {string} an `<svg>…</svg>` string (renders "Empty" when no strokes)
 */
export function generateThumbnailSVG(strokes, maxWidth = 240, maxHeight = 200, strokeColor = '#1a1a2e') {
  const bounds = computeStrokeBounds(strokes);
  if (!bounds) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxWidth} ${maxHeight}" width="${maxWidth}" height="${maxHeight}"><text x="${maxWidth / 2}" y="${maxHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#bbb">Empty</text></svg>`;
  }

  const ncodeWidth = bounds.maxX - bounds.minX;
  const ncodeHeight = bounds.maxY - bounds.minY;
  if (ncodeWidth === 0 && ncodeHeight === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxWidth} ${maxHeight}" width="${maxWidth}" height="${maxHeight}"></svg>`;
  }

  const padding = 4;
  const availW = maxWidth - padding * 2;
  const availH = maxHeight - padding * 2;
  const scaleX = ncodeWidth > 0 ? availW / ncodeWidth : 1;
  const scaleY = ncodeHeight > 0 ? availH / ncodeHeight : 1;
  const fitScale = Math.min(scaleX, scaleY);

  const svgW = ncodeWidth * fitScale + padding * 2;
  const svgH = ncodeHeight * fitScale + padding * 2;

  let paths = '';
  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;
    const d = stroke.points
      .map((p, i) => {
        const x = (p[0] - bounds.minX) * fitScale + padding;
        const y = (p[1] - bounds.minY) * fitScale + padding;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    paths += `<path d="${d}" stroke="${strokeColor}" stroke-width="0.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW.toFixed(1)} ${svgH.toFixed(1)}" width="${maxWidth}" height="${maxHeight}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}
