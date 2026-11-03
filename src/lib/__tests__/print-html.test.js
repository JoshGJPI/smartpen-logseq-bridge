/**
 * lib/print/print-html.js (v3.8.0): the print frame, the ink SVG, transcript
 * lines and the flow of items onto sheets.
 */
import { describe, it, expect } from 'vitest';
import { printFrame, inkSvg, lineWidthFactor, transcriptHtml, buildPrintHtml, escapeHtml } from '$lib/print/print-html.js';
import { sheetFor, normalizePrintOptions } from '$lib/print/print-layout.js';

const PAPER = { x0: 0, y0: 0, x1: 60, y1: 90 };
const stroke = (points, extra = {}) => ({ id: 's' + points[0][0], startTime: 0, endTime: 0, points, ...extra });
const line = (text, extra = {}) => ({ id: text, text, indentLevel: 0, parentId: null, checked: null, ...extra });

describe('printFrame', () => {
  it('is the paper when the ink sits inside it', () => {
    expect(printFrame(PAPER, [stroke([[10, 10], [20, 20]])])).toEqual(PAPER);
  });

  it('grows to take in ink outside the paper', () => {
    expect(printFrame(PAPER, [stroke([[-2, 10], [61, 95]])])).toEqual({ x0: -2, y0: 0, x1: 61, y1: 95 });
  });

  it('pads the ink box when there is no paper; null with neither', () => {
    expect(printFrame(null, [stroke([[10, 10], [20, 30]])])).toEqual({ x0: 8, y0: 8, x1: 22, y1: 32 });
    expect(printFrame(null, [])).toBeNull();
    expect(printFrame(PAPER, [])).toEqual(PAPER);
  });
});

describe('inkSvg', () => {
  const page = { frame: PAPER, rotation: 0, strokes: [stroke([[0, 0], [10, 10]])] };

  it('sizes the svg in inches at the given scale', () => {
    const svg = inkSvg(page, 1);
    expect(svg).toMatch(/width="5\.6in" height="8\.4in"/);
    expect(svg).toContain('<path d="M 0.00 0.00 L 23.71 23.71"/>');
  });

  it('swaps the box for a quarter turn and turns the content', () => {
    const svg = inkSvg({ ...page, rotation: 90 }, 1);
    expect(svg).toMatch(/width="8\.4in" height="5\.6in"/);
    expect(svg).toContain('<g transform="matrix(');
  });

  it('line width is millimetres on the sheet, whatever the scale', () => {
    // At true size one user unit is ~1 mm, so the reader's 0.5 is ~0.5 mm.
    expect(lineWidthFactor(0.5, 1)).toBeCloseTo(1, 3);
    expect(inkSvg(page, 1, { lineWidthMm: 1 })).toContain('stroke-width="1"');
    expect(inkSvg(page, 1)).toContain('stroke-width="0.5"');
    // Half size: the units double so the printed line stays 0.5 mm.
    expect(inkSvg(page, 0.5, { lineWidthMm: 0.5 })).toContain('stroke-width="1"');
    expect(lineWidthFactor(undefined, 1)).toBeCloseTo(1, 3);
  });

  it('sketch runs take the same factor', () => {
    const sk = { ...page, strokes: [stroke([[0, 0, 1, 500], [10, 10, 2, 500]], { sketch: true })] };
    const width = (svg) => Number(svg.match(/<path d="[^"]+" stroke-width="([\d.]+)"/)[1]);
    expect(width(inkSvg(sk, 1, { lineWidthMm: 1 }))).toBeCloseTo(2 * width(inkSvg(sk, 1, { lineWidthMm: 0.5 })), 2);
  });

  it('draws the background only when asked', () => {
    const withBg = { ...page, background: { frame: PAPER, dataUrl: 'data:image/jpeg;base64,AAAA' } };
    expect(inkSvg(withBg, 1)).not.toContain('<image');
    expect(inkSvg(withBg, 1, { background: true })).toContain('<image href="data:image/jpeg;base64,AAAA"');
  });

  it('sketch strokes become width runs', () => {
    const sk = { ...page, strokes: [stroke([[0, 0, 1, 100], [5, 5, 2, 600], [10, 10, 3, 900]], { sketch: true })] };
    const n = (inkSvg(sk, 1).match(/<path /g) || []).length;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empty without a frame or scale', () => {
    expect(inkSvg({ frame: null }, 1)).toBe('');
    expect(inkSvg(page, 0)).toBe('');
  });
});

describe('transcriptHtml', () => {
  it('indents, escapes, and drops blank and property lines', () => {
    const html = transcriptHtml([line('a < b'), line('  '), line('id:: 123'), line('child', { indentLevel: 2 })]);
    expect(html).toContain('a &lt; b');
    expect(html).not.toContain('id::');
    expect(html).toContain('padding-left:2.8em');
    expect((html.match(/class="ln/g) || []).length).toBe(2);
  });

  it('task states: TODO, DONE, WAITING, CANCELLED', () => {
    const html = transcriptHtml([
      line('todo', { checked: false }),
      line('done', { checked: true }),
      line('wait', { checked: false, marker: 'WAITING' }),
      line('gone', { checked: true, marker: 'CANCELLED' })
    ]);
    expect((html.match(/class="box"/g) || []).length).toBe(4);
    expect(html).toContain('class="ln task done"');
    expect(html).toContain('<span class="tag">WAITING</span>');
    expect(html).toContain('class="ln task done cancelled"');
  });

  it('empty for nothing to print', () => {
    expect(transcriptHtml(null)).toBe('');
    expect(transcriptHtml([line('')])).toBe('');
  });
});

describe('buildPrintHtml', () => {
  const pages = [
    { title: 'JPI Dotted — P1', subtitle: 'Oct 1, 2026', frame: PAPER, rotation: 0, strokes: [stroke([[1, 1], [2, 2]])], lines: [line('hello')] },
    { title: 'JPI Dotted — P2', subtitle: '', frame: PAPER, rotation: 0, strokes: [stroke([[1, 1], [2, 2]])], lines: null }
  ];
  const build = (over) => {
    const opts = normalizePrintOptions(over);
    return buildPrintHtml(pages, { ...opts, sheet: sheetFor({ layout: over.layout || '2-up', labels: opts.labels }) });
  };

  it('pins the sheet with @page', () => {
    expect(build({ layout: '2-up' })).toContain('@page { size: 11in 8.5in; margin: 0.25in; }');
    expect(build({ layout: '1-portrait' })).toContain('@page { size: 8.5in 11in; margin: 0.25in; }');
  });

  it('2 per sheet flows in columns and breaks ink by column; 1 per sheet by page', () => {
    const two = build({ layout: '2-up' });
    expect(two).toContain('columns: 2;');
    expect(two).toContain('break-before: column');
    const one = build({ layout: '1-portrait' });
    expect(one).not.toContain('columns: 2');
    expect(one).toContain('break-before: page');
  });

  it('strokes: one figure per page, no transcript', () => {
    const html = build({ content: 'strokes' });
    expect((html.match(/<figure class="ink">/g) || []).length).toBe(2);
    expect(html).not.toContain('class="page-tx"');
  });

  it('transcript: headed sections, untranscribed pages say so', () => {
    const html = build({ content: 'transcript' });
    expect(html).not.toContain('<figure');
    expect(html).toContain('<h2 class="lb">');
    expect(html).toContain('Not transcribed');
  });

  it('both: ink then its transcript, no heading repeat, untranscribed prints ink only', () => {
    const html = build({ content: 'both' });
    expect((html.match(/<figure class="ink">/g) || []).length).toBe(2);
    expect((html.match(/class="page-tx"/g) || []).length).toBe(1);
    expect(html).not.toContain('<h2');
    expect(html.indexOf('hello')).toBeGreaterThan(html.indexOf('<figure'));
    expect(html).not.toContain('Not transcribed');
  });

  it('labels can be turned off', () => {
    expect(build({ content: 'strokes', labels: false })).not.toContain('<figcaption');
    expect(build({ content: 'strokes' })).toContain('<figcaption class="lb">');
  });

  it('has no scripts and escapes the title', () => {
    const html = buildPrintHtml(pages, { ...normalizePrintOptions({}), sheet: sheetFor({ layout: '2-up' }), docTitle: '<x>' });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<title>&lt;x&gt;</title>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(escapeHtml(null)).toBe('');
  });
});
