/**
 * lib/print/print-layout.js (v3.8.0): sheets, columns, ink scale and the Auto
 * layout. Frames are the real notebooks' Neo frames, in Ncode units.
 */
import { describe, it, expect } from 'vitest';
import {
  NCODE_INCH, sheetFor, paperOf, inkScale, autoLayout, resolveSheet, normalizePrintOptions, clampLineWidthMm,
  AUTO_TWO_UP_MIN_SCALE, DEFAULT_MARGIN_IN, GUTTER_IN, LABEL_IN
} from '$lib/print/print-layout.js';

// JPI Dotted (3017), an A5 notebook, and a College (387/388) Letter-size notebook.
const A5 = { x0: 3.4976, y0: 3.4975, x1: 64.6618, y1: 90.393 };
const LETTER = { x0: 3.4976, y0: 3.4976, x1: 94.6112, y1: 121.6079 };
const page = (frame, rotation = 0) => ({ frame, rotation });

describe('paperOf', () => {
  it('converts Ncode units to inches', () => {
    expect(NCODE_INCH).toBeCloseTo(0.09333, 5);
    const p = paperOf(page(A5));
    expect(p.widthIn).toBeCloseTo(5.71, 2);
    expect(p.heightIn).toBeCloseTo(8.11, 2);
  });

  it('swaps width and height for a quarter turn', () => {
    const p = paperOf(page(A5, 90));
    expect(p.widthIn).toBeCloseTo(8.11, 2);
    expect(p.heightIn).toBeCloseTo(5.71, 2);
    expect(paperOf(page(A5, 180)).widthIn).toBeCloseTo(5.71, 2);
  });

  it('is zero without a frame', () => {
    expect(paperOf({ frame: null })).toEqual({ widthIn: 0, heightIn: 0 });
    expect(paperOf(null)).toEqual({ widthIn: 0, heightIn: 0 });
  });
});

describe('sheetFor', () => {
  it('2 per sheet is landscape Letter split in two columns', () => {
    const s = sheetFor({ paper: 'letter', layout: '2-up' });
    expect(s).toMatchObject({ widthIn: 11, heightIn: 8.5, landscape: true, columns: 2, gutterIn: GUTTER_IN });
    expect(s.colWIn).toBeCloseTo((11 - 2 * DEFAULT_MARGIN_IN - GUTTER_IN) / 2, 6);
    expect(s.colHIn).toBeCloseTo(8.5 - 2 * DEFAULT_MARGIN_IN, 6);
    expect(s.inkHIn).toBeCloseTo(s.colHIn - LABEL_IN, 6);
  });

  it('1 per sheet portrait and landscape', () => {
    expect(sheetFor({ layout: '1-portrait' })).toMatchObject({ widthIn: 8.5, heightIn: 11, columns: 1, gutterIn: 0 });
    expect(sheetFor({ layout: '1-landscape' })).toMatchObject({ widthIn: 11, heightIn: 8.5, columns: 1 });
  });

  it('no label row when labels are off', () => {
    const s = sheetFor({ layout: '1-portrait', labels: false });
    expect(s.inkHIn).toBe(s.colHIn);
  });

  it('unknown paper falls back to Letter; silly margins are clamped', () => {
    expect(sheetFor({ paper: 'napkin', layout: '1-portrait' }).paper).toBe('letter');
    expect(sheetFor({ layout: '1-portrait', marginIn: -1 }).marginIn).toBe(DEFAULT_MARGIN_IN);
    expect(sheetFor({ layout: '1-portrait', marginIn: 50 }).marginIn).toBe(2);
  });
});

describe('inkScale', () => {
  const two = sheetFor({ layout: '2-up' });
  const one = sheetFor({ layout: '1-portrait' });

  it('an A5 page prints at better than the Auto threshold in half a Letter sheet', () => {
    const s = inkScale(page(A5), two, 'fit');
    expect(s).toBeGreaterThan(AUTO_TWO_UP_MIN_SCALE);
    expect(s).toBeLessThan(1);
  });

  it('actual size never grows a page', () => {
    expect(inkScale(page(A5), one, 'fit')).toBeGreaterThan(1);
    expect(inkScale(page(A5), one, 'actual')).toBe(1);
  });

  it('actual size still shrinks a page that does not fit', () => {
    expect(inkScale(page(LETTER), one, 'actual')).toBeLessThan(1);
    expect(inkScale(page(LETTER), one, 'actual')).toBe(inkScale(page(LETTER), one, 'fit'));
  });

  it('zero for a page with no paper', () => {
    expect(inkScale({ frame: null }, one)).toBe(0);
  });
});

describe('autoLayout', () => {
  it('A5 pages go 2 per sheet', () => {
    expect(autoLayout([page(A5), page(A5)])).toBe('2-up');
  });

  it('a Letter page anywhere in the job means 1 per sheet', () => {
    expect(autoLayout([page(A5), page(LETTER)])).toBe('1-portrait');
  });

  it('mostly sideways Letter pages go landscape', () => {
    expect(autoLayout([page(LETTER, 90), page(LETTER, 270), page(LETTER)])).toBe('1-landscape');
  });

  it('no sized pages: 1 per sheet portrait', () => {
    expect(autoLayout([])).toBe('1-portrait');
    expect(autoLayout([{ frame: null }])).toBe('1-portrait');
  });

  it('on Tabloid even a Letter page fits 2 per sheet', () => {
    expect(autoLayout([page(LETTER)], { paper: 'tabloid' })).toBe('2-up');
  });
});

describe('resolveSheet', () => {
  it('resolves auto, keeps a fixed choice', () => {
    expect(resolveSheet([page(A5)], { layout: 'auto' }).layout).toBe('2-up');
    expect(resolveSheet([page(A5)], { layout: '1-landscape' }).layout).toBe('1-landscape');
    expect(resolveSheet([page(A5)], { layout: 'junk' }).layout).toBe('2-up');
  });
});

describe('normalizePrintOptions', () => {
  it('defaults', () => {
    expect(normalizePrintOptions(null)).toEqual({
      content: 'strokes', paper: 'letter', layout: 'auto', inkScale: 'fit', lineWidthMm: 0.5,
      background: false, labels: true, openWhenDone: true
    });
  });

  it('keeps valid values and drops junk', () => {
    const o = normalizePrintOptions({ content: 'both', paper: 'a4', layout: '2-up', inkScale: 'actual', lineWidthMm: 0.75, background: true, labels: false, openWhenDone: false });
    expect(o).toMatchObject({ content: 'both', paper: 'a4', layout: '2-up', inkScale: 'actual', lineWidthMm: 0.75, background: true, labels: false, openWhenDone: false });
    expect(normalizePrintOptions({ content: 'DOING', lineWidthMm: 'thick' })).toMatchObject({ content: 'strokes', lineWidthMm: 0.5 });
  });

  it('clamps the line width to the slider and snaps it to the step', () => {
    expect(normalizePrintOptions({ lineWidthMm: 0 }).lineWidthMm).toBe(0.2);
    expect(normalizePrintOptions({ lineWidthMm: 9 }).lineWidthMm).toBe(1.5);
    expect(normalizePrintOptions({ lineWidthMm: 0.62 }).lineWidthMm).toBe(0.6);
    expect(normalizePrintOptions({ lineWidthMm: '0.8' }).lineWidthMm).toBe(0.8);
    expect(clampLineWidthMm(NaN)).toBe(0.5);
  });

  it('reads an older Fine / Normal / Bold choice as a width', () => {
    expect(normalizePrintOptions({ lineWeight: 'fine' }).lineWidthMm).toBe(0.35);
    expect(normalizePrintOptions({ lineWeight: 'bold' }).lineWidthMm).toBe(0.8);
    expect(normalizePrintOptions({ lineWeight: 'toString' }).lineWidthMm).toBe(0.5);
    expect(normalizePrintOptions({ lineWeight: 'bold', lineWidthMm: 0.3 }).lineWidthMm).toBe(0.3);
    expect(normalizePrintOptions({ lineWeight: 'bold' })).not.toHaveProperty('lineWeight');
  });
});
