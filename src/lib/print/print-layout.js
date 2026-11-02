/**
 * print-layout — sheet geometry for Print to PDF (pure: no DOM, no stores).
 *
 * A print job lays pen pages onto printer SHEETS. A sheet holds one or two
 * COLUMNS; a pen page's ink fills one column, and transcript text flows down the
 * columns (CSS multicol in the print window, see print-html.js). "2 per sheet"
 * is a landscape sheet split side by side, which is how an A5 notebook page
 * prints at nearly full size on Letter: two half-sheets, one beside the other.
 *
 * Sizes are inches throughout. A pen page's paper comes from its Ncode frame
 * (the Neo background's frame, else the ink's own box): one Ncode unit is
 * 8 × 7 / 600 inch (neo-backgrounds.js PT_PER_NCODE), so ink can print at its
 * true size.
 *
 * Tested in `src/lib/__tests__/print-layout.test.js`.
 */

import { isQuarterTurn } from '../page-orientation.js';

/** Inches per Ncode unit (8 × 7 / 600 in; the same unit web_pen_sdk uses). */
export const NCODE_INCH = (8 * 7) / 600;

/** Sheet sizes, portrait (short edge first), in inches. */
export const PAPER_SIZES = Object.freeze({
  letter: { id: 'letter', label: 'Letter (8.5 × 11 in)', widthIn: 8.5, heightIn: 11 },
  legal: { id: 'legal', label: 'Legal (8.5 × 14 in)', widthIn: 8.5, heightIn: 14 },
  tabloid: { id: 'tabloid', label: 'Tabloid (11 × 17 in)', widthIn: 11, heightIn: 17 },
  a4: { id: 'a4', label: 'A4 (210 × 297 mm)', widthIn: 8.27, heightIn: 11.69 },
  a3: { id: 'a3', label: 'A3 (297 × 420 mm)', widthIn: 11.69, heightIn: 16.54 }
});

export const PAPER_IDS = Object.freeze(Object.keys(PAPER_SIZES));

/** Sheet layouts. 'auto' resolves to one of the other three per job. */
export const LAYOUTS = Object.freeze([
  { id: 'auto', label: 'Auto' },
  { id: '1-portrait', label: '1 per sheet, portrait' },
  { id: '1-landscape', label: '1 per sheet, landscape' },
  { id: '2-up', label: '2 per sheet, side by side' }
]);

export const LAYOUT_IDS = Object.freeze(LAYOUTS.map((l) => l.id));

/** What prints: the ink, the transcript, or both (ink, then its transcript). */
export const CONTENTS = Object.freeze(['strokes', 'transcript', 'both']);

/** Ink size in its column: shrink or grow to fill it, or true size (shrunk only when too big). */
export const INK_SCALES = Object.freeze(['fit', 'actual']);

/** Pen line thickness multipliers (Bold survives a photocopy). */
export const LINE_WEIGHTS = Object.freeze({ fine: 0.7, normal: 1, bold: 1.6 });

/** Default printable margin; most printers can't reach closer to the edge. */
export const DEFAULT_MARGIN_IN = 0.25;

/** Space between the two columns of a 2-up sheet. */
export const GUTTER_IN = 0.4;

/** Height kept above each page's ink for its label (notebook, page, date). */
export const LABEL_IN = 0.3;

/**
 * Auto picks 2 per sheet only when every page still prints at least this big
 * in a column. An A5 page on Letter comes out at ~0.87; a Letter page at ~0.6.
 */
export const AUTO_TWO_UP_MIN_SCALE = 0.8;

/**
 * A page's paper, upright, in inches: its frame turned by its display rotation.
 * @param {{frame: {x0:number,y0:number,x1:number,y1:number}, rotation?: number}} page
 * @returns {{widthIn: number, heightIn: number}}
 */
export function paperOf(page) {
  const f = page && page.frame;
  if (!f) return { widthIn: 0, heightIn: 0 };
  const w = Math.max(0, f.x1 - f.x0) * NCODE_INCH;
  const h = Math.max(0, f.y1 - f.y0) * NCODE_INCH;
  return isQuarterTurn(page.rotation) ? { widthIn: h, heightIn: w } : { widthIn: w, heightIn: h };
}

/**
 * The sheet and its columns for a fixed layout.
 * @param {{paper?: string, layout: string, marginIn?: number, labels?: boolean}} opts
 * @returns {{layout: string, paper: string, widthIn: number, heightIn: number, landscape: boolean,
 *            columns: number, marginIn: number, gutterIn: number, colWIn: number, colHIn: number,
 *            inkWIn: number, inkHIn: number}}
 */
export function sheetFor({ paper = 'letter', layout, marginIn = DEFAULT_MARGIN_IN, labels = true }) {
  const size = PAPER_SIZES[paper] || PAPER_SIZES.letter;
  const landscape = layout === '1-landscape' || layout === '2-up';
  const widthIn = landscape ? size.heightIn : size.widthIn;
  const heightIn = landscape ? size.widthIn : size.heightIn;
  const columns = layout === '2-up' ? 2 : 1;
  const m = clampMargin(marginIn, widthIn, heightIn);
  const gutterIn = columns > 1 ? GUTTER_IN : 0;
  const colWIn = (widthIn - 2 * m - gutterIn * (columns - 1)) / columns;
  const colHIn = heightIn - 2 * m;
  const labelIn = labels ? LABEL_IN : 0;
  return {
    layout: LAYOUT_IDS.includes(layout) && layout !== 'auto' ? layout : '1-portrait',
    paper: size.id,
    widthIn,
    heightIn,
    landscape,
    columns,
    marginIn: m,
    gutterIn,
    colWIn,
    colHIn,
    inkWIn: colWIn,
    inkHIn: Math.max(0, colHIn - labelIn)
  };
}

function clampMargin(marginIn, w, h) {
  if (!Number.isFinite(marginIn) || marginIn < 0) return DEFAULT_MARGIN_IN;
  return Math.min(marginIn, 0.4 * Math.min(w, h), 2);
}

/**
 * Scale (printed / true size) of a page's ink in a sheet's ink box.
 * 'fit' fills the box; 'actual' is true size unless the page is too big for it.
 * @returns {number} 0 for a page with no paper
 */
export function inkScale(page, sheet, mode = 'fit') {
  const { widthIn, heightIn } = paperOf(page);
  if (!(widthIn > 0) || !(heightIn > 0)) return 0;
  const fit = Math.min(sheet.inkWIn / widthIn, sheet.inkHIn / heightIn);
  return mode === 'actual' ? Math.min(1, fit) : fit;
}

/**
 * The layout 'auto' means for these pages: 2 per sheet when every page prints
 * at AUTO_TWO_UP_MIN_SCALE or better in a column (half-size notebooks), else
 * one per sheet, landscape when most pages are wider than tall.
 * @param {Array} pages  print pages ({ frame, rotation })
 * @returns {'2-up'|'1-portrait'|'1-landscape'}
 */
export function autoLayout(pages, { paper = 'letter', marginIn = DEFAULT_MARGIN_IN, labels = true } = {}) {
  const sized = (pages || []).filter((p) => {
    const { widthIn, heightIn } = paperOf(p);
    return widthIn > 0 && heightIn > 0;
  });
  if (!sized.length) return '1-portrait';
  const two = sheetFor({ paper, layout: '2-up', marginIn, labels });
  if (sized.every((p) => inkScale(p, two, 'fit') >= AUTO_TWO_UP_MIN_SCALE)) return '2-up';
  const wide = sized.filter((p) => {
    const { widthIn, heightIn } = paperOf(p);
    return widthIn > heightIn;
  }).length;
  return wide > sized.length / 2 ? '1-landscape' : '1-portrait';
}

/**
 * The sheet a job prints on, with 'auto' resolved.
 * @param {Array} pages
 * @param {{paper?: string, layout?: string, marginIn?: number, labels?: boolean}} opts
 */
export function resolveSheet(pages, opts = {}) {
  const layout = LAYOUT_IDS.includes(opts.layout) ? opts.layout : 'auto';
  const chosen = layout === 'auto' ? autoLayout(pages, opts) : layout;
  return sheetFor({ ...opts, layout: chosen });
}

/** Label for a resolved layout id ("2 per sheet, side by side"). */
export function layoutLabel(id) {
  const l = LAYOUTS.find((x) => x.id === id);
  return l ? l.label : '';
}

/**
 * Clean print options read back from settings: anything unknown falls back to
 * the default, so a stale or hand-edited preference never breaks a print.
 */
export function normalizePrintOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    content: CONTENTS.includes(o.content) ? o.content : 'strokes',
    paper: PAPER_IDS.includes(o.paper) ? o.paper : 'letter',
    layout: LAYOUT_IDS.includes(o.layout) ? o.layout : 'auto',
    inkScale: INK_SCALES.includes(o.inkScale) ? o.inkScale : 'fit',
    lineWeight: Object.hasOwn(LINE_WEIGHTS, o.lineWeight) ? o.lineWeight : 'normal',
    background: o.background === true,
    labels: o.labels !== false,
    openWhenDone: o.openWhenDone !== false
  };
}
