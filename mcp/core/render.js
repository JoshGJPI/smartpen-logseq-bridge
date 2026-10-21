/**
 * Full-page SVG / PNG rendering for the MCP server.
 *
 * Geometry matches the Library reader's PageInk.svelte: ink bounds are the page,
 * points project at NCODE_SCALE, rotation is ONE group transform within the page
 * frame. page-svg.js's thumbnail generator cannot do this (fixed 0.3 stroke
 * width, no sketch widths, one stroke set), so this module reuses its pure
 * path helpers and leaves page-svg.js untouched.
 *
 * Two stroke sets: `strokes` in full ink, `context` halftoned underneath.
 */
import { Resvg } from '@resvg/resvg-js';
import {
  NCODE_SCALE, DEFAULT_STROKE_WIDTH, computeStrokeBounds, strokeToPathD, strokeToWidthRuns
} from '../../src/lib/viewer/page-svg.js';
import { DEFAULT_SKETCH_PROFILE } from '../../src/lib/sketch-width.js';
import { rotateFrame, svgRotationTransform, normalizeRotation } from '../../src/lib/page-orientation.js';

export const INK = '#1a1a2e';
export const CONTEXT_INK = '#c3c7d4';   // the grey the reader dims to
const PAD = 8;                          // user units around the ink

function strokePaths(strokes, bounds, color) {
  let out = '';
  for (const s of strokes) {
    if (!s || !s.points || s.points.length < 2) continue;
    if (s.sketch) {
      for (const run of strokeToWidthRuns(s, bounds, DEFAULT_SKETCH_PROFILE)) {
        out += `<path d="${run.d}" stroke="${color}" stroke-width="${run.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    } else {
      out += `<path d="${strokeToPathD(s, bounds)}" stroke="${color}" stroke-width="${DEFAULT_STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  return out;
}

/**
 * @param {Array} strokes   stored strokes drawn in full ink
 * @param {{context?: Array, rotation?: number, bounds?: object}} [opts]
 *   `bounds` fixes the page box (default: ink bounds of strokes + context).
 * @returns {{svg: string, width: number, height: number, strokes: number}|null} null when nothing to draw
 */
export function renderPageSvg(strokes, opts = {}) {
  const context = opts.context || [];
  const rotation = normalizeRotation(opts.rotation || 0);
  const bounds = opts.bounds || computeStrokeBounds([...context, ...strokes]);
  if (!bounds) return null;

  const w = (bounds.maxX - bounds.minX) * NCODE_SCALE;
  const h = (bounds.maxY - bounds.minY) * NCODE_SCALE;
  const frame = { x0: 0, y0: 0, x1: w, y1: h };
  const shown = rotateFrame(frame, rotation);
  const sw = shown.x1 - shown.x0;
  const sh = shown.y1 - shown.y0;
  const turn = svgRotationTransform(rotation, frame);

  const body = strokePaths(context, bounds, CONTEXT_INK) + strokePaths(strokes, bounds, INK);
  const inner = turn ? `<g transform="${turn}">${body}</g>` : body;
  const W = sw + PAD * 2;
  const H = sh + PAD * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" width="${W.toFixed(2)}" height="${H.toFixed(2)}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${PAD} ${PAD})">${inner}</g></svg>`;
  return { svg, width: W, height: H, strokes: strokes.length };
}

/**
 * Rasterise an SVG to PNG at `width` px (height follows the aspect ratio).
 * @returns {{png: Buffer, width: number, height: number}}
 */
export function svgToPng(svg, width = 1000) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.max(64, Math.round(width)) }, background: '#ffffff' });
  const img = r.render();
  return { png: img.asPng(), width: img.width, height: img.height };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Contact sheet: rendered pages in a grid, each with a caption (composite mode). */
export function composeSheet(items, { cols = 3, cell = 360 } = {}) {
  const n = items.length;
  const c = Math.min(cols, n) || 1;
  const rows = Math.ceil(n / c);
  const labelH = 22;
  const cellH = Math.round(cell * 1.3) + labelH;
  let out = '';
  items.forEach((it, i) => {
    const x = (i % c) * cell, y = Math.floor(i / c) * cellH;
    const k = Math.min((cell - 10) / it.width, (cellH - labelH - 10) / it.height);
    const inner = it.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    out += `<g transform="translate(${x + 5} ${y + 5}) scale(${k.toFixed(4)})">${inner}</g>`
      + `<text x="${x + 6}" y="${y + cellH - 6}" font-family="sans-serif" font-size="13" fill="#333">${esc(it.label)}</text>`;
  });
  const W = c * cell, H = rows * cellH;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${out}</svg>`,
    width: W, height: H
  };
}
