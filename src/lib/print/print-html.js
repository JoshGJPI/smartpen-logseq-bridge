/**
 * print-html — the self-contained HTML document Print to PDF renders (pure).
 *
 * Electron main loads this into a hidden window and calls `printToPDF` with
 * `preferCSSPageSize`, so the `@page` rule here IS the sheet: no OS print
 * dialog, no scaling by a driver. Everything is inline (SVG ink, background
 * images as data URLs, CSS), and the document has no scripts.
 *
 * Layout is one flow of items down the sheet's columns (print-layout.js):
 *   - a page's ink is a figure exactly one column tall, so it always starts a
 *     column of its own (`break-before: column`, or `page` on a 1-column sheet);
 *   - transcript text flows after it, into the next column and on to the next
 *     sheet when it is long.
 * So with "both" on 2 per sheet, an A5 page's ink sits on the left half and its
 * transcript on the right. Chromium fragments multicol across printed pages and
 * honours `column-fill: auto` there (checked in Electron 40 while building this).
 *
 * Ink is drawn with the reader's own helpers (page-svg.js) in Ncode × NCODE_SCALE
 * user units, sized in inches, and turned by the page's display rotation with one
 * group transform, as in the Library.
 *
 * Tested in `src/lib/__tests__/print-html.test.js`.
 */

import {
  NCODE_SCALE,
  DEFAULT_STROKE_WIDTH,
  computeStrokeBounds,
  strokeToPathD,
  strokeToWidthRuns
} from '../viewer/page-svg.js';
import { rotateFrame, svgRotationTransform } from '../page-orientation.js';
import { isPropertyLine } from '../viewer/transcript-markdown.js';
import { paperOf, inkScale, LINE_WEIGHTS } from './print-layout.js';

/** Pen ink colour on paper. */
const INK = '#111';

/** Ncode units of white kept around ink that has no paper frame. */
const INK_PAD = 2;

/**
 * The rectangle a page prints, in Ncode units: its paper frame grown to take in
 * any ink outside it (writing in the crop margin), or the ink's own box padded
 * when the notebook has no paper.
 * @param {{x0:number,y0:number,x1:number,y1:number}|null} paperFrame
 * @param {Array} strokes  PageDoc strokes
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null} null with neither
 */
export function printFrame(paperFrame, strokes) {
  const b = computeStrokeBounds(strokes);
  if (paperFrame) {
    if (!b) return { ...paperFrame };
    return {
      x0: Math.min(paperFrame.x0, b.minX),
      y0: Math.min(paperFrame.y0, b.minY),
      x1: Math.max(paperFrame.x1, b.maxX),
      y1: Math.max(paperFrame.y1, b.maxY)
    };
  }
  if (!b) return null;
  return { x0: b.minX - INK_PAD, y0: b.minY - INK_PAD, x1: b.maxX + INK_PAD, y1: b.maxY + INK_PAD };
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const r3 = (n) => String(Math.round(n * 1000) / 1000);

/**
 * One page's ink as an `<svg>` sized in inches.
 * @param {Object} page   print page: { frame, rotation, strokes, background?: { frame, dataUrl } }
 * @param {number} scale  printed / true size
 * @param {{lineWeight?: string, sketchProfile?: Object, background?: boolean}} opts
 * @returns {string} '' when the page has no frame
 */
export function inkSvg(page, scale, opts = {}) {
  const frame = page && page.frame;
  if (!frame || !(scale > 0)) return '';
  const weight = LINE_WEIGHTS[opts.lineWeight] || 1;
  const bounds = { minX: frame.x0, minY: frame.y0 };
  const w = (frame.x1 - frame.x0) * NCODE_SCALE;
  const h = (frame.y1 - frame.y0) * NCODE_SCALE;
  const pageBox = { x0: 0, y0: 0, x1: w, y1: h };
  const shown = rotateFrame(pageBox, page.rotation);
  const paper = paperOf(page);
  const turn = svgRotationTransform(page.rotation, pageBox);

  let body = '';
  const bg = opts.background && page.background;
  if (bg && bg.dataUrl && bg.frame) {
    const x = (bg.frame.x0 - frame.x0) * NCODE_SCALE;
    const y = (bg.frame.y0 - frame.y0) * NCODE_SCALE;
    const bw = (bg.frame.x1 - bg.frame.x0) * NCODE_SCALE;
    const bh = (bg.frame.y1 - bg.frame.y0) * NCODE_SCALE;
    body += `<image href="${escapeHtml(bg.dataUrl)}" x="${r3(x)}" y="${r3(y)}" width="${r3(bw)}" height="${r3(bh)}" preserveAspectRatio="none"/>`;
  }

  const base = r3(DEFAULT_STROKE_WIDTH * weight);
  let paths = '';
  for (const stroke of page.strokes || []) {
    if (stroke.sketch) {
      for (const run of strokeToWidthRuns(stroke, bounds, opts.sketchProfile)) {
        paths += `<path d="${run.d}" stroke-width="${r3(run.width * weight)}"/>`;
      }
    } else {
      const d = strokeToPathD(stroke, bounds);
      if (d) paths += `<path d="${d}"/>`;
    }
  }
  body += `<g fill="none" stroke="${INK}" stroke-width="${base}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
  if (turn) body = `<g transform="${turn}">${body}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(shown.x1)} ${r3(shown.y1)}" ` +
    `width="${r3(paper.widthIn * scale)}in" height="${r3(paper.heightIn * scale)}in">${body}</svg>`;
}

/** A task box drawn in SVG (no font needs to carry ☐ / ☑). */
function taskBox(line) {
  const tick = line.checked === true
    ? (line.marker === 'CANCELLED'
      ? '<path d="M3.5 3.5 L8.5 8.5 M8.5 3.5 L3.5 8.5"/>'
      : '<path d="M2.8 6.2 L5 8.4 L9.3 3.4"/>')
    : '';
  return `<svg class="box" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5"/>${tick}</svg>`;
}

/**
 * One page's transcript lines as HTML: indented by level, tasks with a box,
 * WAITING named, CANCELLED struck through. Blank and LogSeq property lines are
 * dropped (as in the Markdown copy).
 * @param {Array} lines  PageDoc transcript lines
 * @returns {string} '' when nothing prints
 */
export function transcriptHtml(lines) {
  let out = '';
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = line && typeof line.text === 'string' ? line.text : '';
    if (text.trim() === '' || isPropertyLine(text)) continue;
    const level = Math.max(0, Math.min(12, line.indentLevel || 0));
    const isTask = line.checked === true || line.checked === false;
    const cancelled = line.checked === true && line.marker === 'CANCELLED';
    const waiting = line.checked === false && line.marker === 'WAITING';
    const cls = ['ln', isTask && 'task', line.checked === true && 'done', cancelled && 'cancelled']
      .filter(Boolean).join(' ');
    out += `<div class="${cls}" style="padding-left:${level * 1.4}em">` +
      (isTask ? taskBox(line) : '') +
      (waiting ? '<span class="tag">WAITING</span> ' : '') +
      `<span class="tx">${escapeHtml(text)}</span></div>`;
  }
  return out;
}

function label(page) {
  return `<span class="lb-t">${escapeHtml(page.title)}</span>` +
    (page.subtitle ? `<span class="lb-s">${escapeHtml(page.subtitle)}</span>` : '');
}

/**
 * The whole print document.
 * @param {Array<{title:string, subtitle?:string, frame:Object|null, rotation?:number, strokes?:Array,
 *                lines?:Array|null, background?:{frame:Object,dataUrl:string}|null}>} pages
 * @param {Object} opts  normalizePrintOptions() output plus { sheet, sketchProfile, docTitle }
 * @returns {string}
 */
export function buildPrintHtml(pages, opts) {
  const { sheet } = opts;
  const content = opts.content || 'strokes';
  const withInk = content !== 'transcript';
  const withText = content !== 'strokes';
  const brk = sheet.columns > 1 ? 'column' : 'page';

  let items = '';
  for (const page of pages || []) {
    if (withInk) {
      const scale = inkScale(page, sheet, opts.inkScale);
      const svg = inkSvg(page, scale, opts);
      items += '<figure class="ink">' +
        (opts.labels ? `<figcaption class="lb">${label(page)}</figcaption>` : '') +
        `<div class="ink-box">${svg || '<span class="none">No strokes</span>'}</div></figure>`;
    }
    if (withText) {
      const body = transcriptHtml(page.lines);
      if (body) {
        items += `<section class="page-tx">${withInk ? '' : `<h2 class="lb">${label(page)}</h2>`}${body}</section>`;
      } else if (!withInk) {
        items += `<section class="page-tx"><h2 class="lb">${label(page)}</h2><p class="none">Not transcribed</p></section>`;
      }
    }
  }

  const fontPt = sheet.columns > 1 ? 10 : 11;
  const css = `
@page { size: ${r3(sheet.widthIn)}in ${r3(sheet.heightIn)}in; margin: ${r3(sheet.marginIn)}in; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font: ${fontPt}pt/1.35 "Segoe UI", system-ui, sans-serif; }
.flow { ${sheet.columns > 1 ? `columns: ${sheet.columns}; column-gap: ${r3(sheet.gutterIn)}in; column-fill: auto;` : ''} }
.ink { margin: 0; height: ${r3(sheet.colHIn - 0.02)}in; break-before: ${brk}; break-inside: avoid;
  display: flex; flex-direction: column; }
.ink:first-child { break-before: auto; }
.ink-box { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ink-box svg { display: block; }
.lb { display: flex; gap: 0.8em; align-items: baseline; margin: 0; font-size: 9pt; font-weight: 600; color: #333;
  white-space: nowrap; overflow: hidden; }
figcaption.lb { height: 0.3in; flex: none; }
.lb-s { font-weight: 400; color: #777; }
h2.lb { font-size: 10.5pt; margin: 0 0 0.4em; padding-bottom: 0.2em; border-bottom: 1px solid #ccc; break-after: avoid; }
.page-tx { margin: 0 0 1.4em; }
.ln { margin: 0 0 0.25em; break-inside: avoid; }
.task { display: flex; gap: 0.4em; align-items: baseline; }
.ln .tx { white-space: pre-wrap; overflow-wrap: anywhere; }
.box { flex: none; width: 0.85em; height: 0.85em; position: relative; top: 0.1em; fill: none; stroke: #333; stroke-width: 1.2; }
.done .tx { color: #555; }
.cancelled .tx { text-decoration: line-through; color: #888; }
.tag { font-size: 0.75em; font-weight: 700; letter-spacing: 0.04em; color: #8a5a00; }
.none { color: #999; font-style: italic; }
`;

  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(opts.docTitle || 'Smartpen pages')}</title>` +
    `<style>${css}</style></head><body><div class="flow">${items}</div></body></html>`;
}
