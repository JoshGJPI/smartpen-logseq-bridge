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

/** Ncode mm → screen-pixel scale factor (matches canvas-renderer.js). */
export const NCODE_SCALE = 2.371;

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
