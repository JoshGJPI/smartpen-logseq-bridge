/**
 * Full-page SVG / PNG rendering for the MCP server.
 *
 * Geometry matches the Library reader's PageInk.svelte: points project at
 * NCODE_SCALE from the view box's top-left, and rotation is ONE group transform
 * within that box (the paper frame by default, see bounds.js). page-svg.js's
 * thumbnail generator cannot do this (fixed 0.3 stroke width, no sketch widths,
 * one stroke set), so this module reuses its pure path helpers and leaves
 * page-svg.js untouched.
 *
 * Two stroke sets: `strokes` in full ink, `context` halftoned underneath.
 *
 * PNGs come from resvg's WebAssembly build: no native file for Windows to lock
 * while the server runs (the native @resvg/resvg-js .node file made `npm install`
 * fail with EBUSY), and the same pixels at a few hundred ms per page.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import {
  NCODE_SCALE, DEFAULT_STROKE_WIDTH, computeStrokeBounds, strokeToPathD, strokeToWidthRuns
} from '../../src/lib/viewer/page-svg.js';
import { DEFAULT_SKETCH_PROFILE } from '../../src/lib/sketch-width.js';
import { rotateFrame, svgRotationTransform, normalizeRotation } from '../../src/lib/page-orientation.js';
import { strokeBox } from './bounds.js';

// Once per process; the module-level await keeps every render synchronous.
const wasmFile = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
try {
  await initWasm(fs.readFileSync(wasmFile));
} catch (e) {
  if (!/Already initialized/.test(e.message)) throw e;
}

export const INK = '#1a1a2e';
export const CONTEXT_INK = '#c3c7d4';   // the grey the reader dims to
const PAD = 8;                          // user units around the page

/** Longest edge of any image the server returns, px. */
export const MAX_EDGE = 1500;
/** Visual tokens per image, at most: 4 per call stay under Claude Code's 10,000-token warning with room for text. */
export const MAX_IMAGE_TOKENS = 2000;

/** Claude's image cost: one visual token per 28 x 28 px tile. */
export const visualTokens = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);

/**
 * The width to render an image of this aspect (height / width) at: the asked
 * width, lowered until the long edge is within MAX_EDGE and the image within
 * MAX_IMAGE_TOKENS. A square page at 1500 px would be 2,916 tokens, so the long
 * edge alone does not hold 4 images under the warning.
 */
export function fitWidth(aspect, width) {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  let w = Math.min(Math.round(width), Math.floor(MAX_EDGE / Math.max(1, a)));
  while (w > 64 && visualTokens(w, Math.ceil(w * a)) > MAX_IMAGE_TOKENS) w = Math.floor(w * 0.98);
  return w;
}

const outside = (b, v) => b.maxX < v.minX || b.minX > v.maxX || b.maxY < v.minY || b.minY > v.maxY;

function strokePaths(strokes, bounds, color) {
  let out = '';
  for (const s of strokes) {
    if (!s || !s.points || s.points.length < 2) continue;
    const box = strokeBox(s);
    if (!box || outside(box, bounds)) continue;   // off the page: clipped anyway, skip the markup
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
 *   `bounds` is the view box (bounds.js viewBounds); default: ink bounds of strokes + context.
 *   Ink outside it is clipped.
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
  const clipped = `<clipPath id="page"><rect width="${w.toFixed(2)}" height="${h.toFixed(2)}"/></clipPath><g clip-path="url(#page)">${body}</g>`;
  const inner = turn ? `<g transform="${turn}">${clipped}</g>` : clipped;
  const W = sw + PAD * 2;
  const H = sh + PAD * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" width="${W.toFixed(2)}" height="${H.toFixed(2)}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${PAD} ${PAD})">${inner}</g></svg>`;
  return { svg, width: W, height: H, strokes: strokes.length };
}

/**
 * Rasterise an SVG to a PNG `width` px wide (height follows the aspect ratio).
 * Fonts stay off: these SVGs are ink only, with no text to shape.
 * @returns {{png: Buffer, width: number, height: number}}
 */
export function svgToPng(svg, width = 1000) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(64, Math.round(width)) }, background: '#ffffff',
    font: { loadSystemFonts: false }
  });
  const img = r.render();
  try {
    return { png: Buffer.from(img.asPng()), width: img.width, height: img.height };
  } finally {
    img.free();
    r.free();
  }
}
