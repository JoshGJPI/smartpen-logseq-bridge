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
 * PNGs are grayscale (png.js): line art loses nothing and the bytes drop ~4x.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  NCODE_SCALE, DEFAULT_STROKE_WIDTH, computeStrokeBounds, strokeToPathD, strokeToWidthRuns
} from '../../src/lib/viewer/page-svg.js';
import { DEFAULT_SKETCH_PROFILE } from '../../src/lib/sketch-width.js';
import { rotateFrame, svgRotationTransform, normalizeRotation } from '../../src/lib/page-orientation.js';
import { strokeBox } from './bounds.js';
import { rgbaToGray, encodeGrayPng } from './png.js';

export const INK = '#1a1a2e';
export const CONTEXT_INK = '#c3c7d4';   // the grey the reader dims to
const PAD = 8;                          // user units around the page
/** Smallest width the byte guard will shrink an image to before giving up on it. */
export const MIN_FIT_WIDTH = 320;

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

/** One sans font for captions, if the OS has a usual one (else resvg's own system scan). */
const CAPTION_FONTS = [
  'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
];
let captionFont;

/**
 * Loading every system font costs ~250 ms per render, so ink-only SVGs load none
 * and captioned sheets load one file.
 */
function fontOptions(svg) {
  if (!svg.includes('<text')) return { loadSystemFonts: false };
  if (captionFont === undefined) captionFont = CAPTION_FONTS.find((p) => fs.existsSync(p)) || null;
  return captionFont
    ? { loadSystemFonts: false, fontFiles: [captionFont], defaultFontFamily: path.basename(captionFont, '.ttf') }
    : { loadSystemFonts: true };
}

/**
 * Rasterise an SVG to a grayscale PNG at `width` px (height follows the aspect ratio).
 * @param {{bits?: 8|4|2}} [opts]  grey bits per pixel (default 4)
 * @returns {{png: Buffer, width: number, height: number}}
 */
export function svgToPng(svg, width = 1000, { bits = 4 } = {}) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(64, Math.round(width)) }, background: '#ffffff',
    font: fontOptions(svg)
  });
  const img = r.render();
  const gray = rgbaToGray(img.pixels, img.width, img.height);
  return { png: encodeGrayPng(gray, img.width, img.height, bits), width: img.width, height: img.height };
}

/**
 * svgToPng, shrunk until it fits `maxBytes` (never below MIN_FIT_WIDTH).
 * @returns {{png: Buffer, width: number, height: number, shrunk: boolean}|null} null when even the smallest is too big
 */
export function pngWithin(svg, width, maxBytes, opts) {
  let w = width;
  for (let i = 0; i < 4; i++) {
    const out = svgToPng(svg, w, opts);
    if (out.png.length <= maxBytes) return { ...out, shrunk: w !== width };
    if (w <= MIN_FIT_WIDTH) return null;
    w = Math.max(MIN_FIT_WIDTH, Math.floor(w * Math.sqrt(maxBytes / out.png.length) * 0.95));
  }
  return null;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/**
 * Contact sheet: rendered pages in a grid, each with a caption (composite / by_day).
 * Cells take the tallest item's aspect ratio, so pages on one paper size share a scale.
 * @param {Array<{svg: string, width: number, height: number, label: string}>} items
 * @param {{cols?: number, cell?: number, title?: string}} [opts]
 */
export function composeSheet(items, { cols = 3, cell = 360, title = '' } = {}) {
  const n = items.length;
  const c = Math.min(cols, n) || 1;
  const rows = Math.ceil(n / c);
  const labelH = 22;
  const titleH = title ? 28 : 0;
  const aspect = Math.min(1.6, Math.max(0.6, ...items.map((it) => it.height / it.width)));
  const cellH = Math.round((cell - 10) * aspect) + 10 + labelH;
  let out = title
    ? `<text x="8" y="20" font-family="sans-serif" font-size="16" font-weight="bold" fill="#222">${esc(title)}</text>` : '';
  items.forEach((it, i) => {
    const x = (i % c) * cell, y = titleH + Math.floor(i / c) * cellH;
    const k = Math.min((cell - 10) / it.width, (cellH - labelH - 10) / it.height);
    const inner = it.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/id="page"/, `id="page${i}"`).replace('url(#page)', `url(#page${i})`);
    out += `<g transform="translate(${x + 5} ${y + 5}) scale(${k.toFixed(4)})">${inner}</g>`
      + `<rect x="${x + 5}" y="${y + 5}" width="${(it.width * k).toFixed(1)}" height="${(it.height * k).toFixed(1)}" fill="none" stroke="#bbb" stroke-width="1"/>`
      + `<text x="${x + 6}" y="${y + cellH - 6}" font-family="sans-serif" font-size="13" fill="#333">${esc(it.label)}</text>`;
  });
  const W = c * cell, H = titleH + rows * cellH;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${out}</svg>`,
    width: W, height: H
  };
}
