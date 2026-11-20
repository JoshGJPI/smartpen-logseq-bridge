/**
 * lib/print/print-selection.js (v3.8.0): the Editor's selected strokes in print —
 * grouping selected canvas strokes by page, the stored-format conversion, the
 * print-list items they become, and the frame each page prints in.
 */
import { describe, it, expect } from 'vitest';
import {
  selectionPageRef, groupSelectionByPage, selectionPrintPage, selectionItems,
  sketchPrintItem,
} from '$lib/print/print-selection.js';
import { inkSvg, buildPrintHtml } from '$lib/print/print-html.js';
import { sheetFor, normalizePrintOptions } from '$lib/print/print-layout.js';
import { addRefs, refKey } from '$lib/print/print-list.js';

const T0 = new Date(2026, 9, 14, 9, 0).getTime();
const PAPER = { x0: 0, y0: 0, x1: 60, y1: 90 };

function makeStroke(book, page, dots, extra = {}) {
  const startTime = extra.startTime ?? T0;
  return {
    pageInfo: book == null ? null : { section: 3, owner: 27, book, page },
    startTime,
    endTime: startTime + 100,
    dotArray: dots.map(([x, y, f], i) => ({ x, y, f, timestamp: startTime + i * 10 })),
    ...extra
  };
}

describe('selectionPageRef', () => {
  it('keeps the book key as a string and the page as its integer', () => {
    expect(selectionPageRef(makeStroke('388v2', 42, [[1, 1, 100]]))).toEqual({ book: '388v2', pageId: '42' });
    expect(selectionPageRef(makeStroke(3017, '151b', [[1, 1, 100]]))).toEqual({ book: '3017', pageId: '151' });
  });

  it('is null with no page (a floating pasted copy) or a malformed one', () => {
    expect(selectionPageRef(makeStroke(null, 1, [[1, 1]]))).toBeNull();
    expect(selectionPageRef({ pageInfo: { book: 'x', page: 1 } })).toBeNull();
    expect(selectionPageRef({ pageInfo: { book: '388', page: 'abc' } })).toBeNull();
    expect(selectionPageRef(null)).toBeNull();
  });
});

describe('groupSelectionByPage', () => {
  it('groups by page, in notebook order (a volume sorts by its NCode book, not as a string), then page', () => {
    const { pages, skipped } = groupSelectionByPage([
      makeStroke('3880', 1, [[1, 1, 1], [2, 2, 1]], { startTime: T0 + 1 }),
      makeStroke('388v2', 10, [[1, 1, 1], [2, 2, 1]], { startTime: T0 + 2 }),
      makeStroke('388v2', 9, [[1, 1, 1], [2, 2, 1]], { startTime: T0 + 3 }),
      makeStroke('388', 9, [[1, 1, 1], [2, 2, 1]], { startTime: T0 + 4 }),
      makeStroke('388v2', 9, [[3, 3, 1], [4, 4, 1]], { startTime: T0 + 5 })
    ]);
    expect(skipped).toBe(0);
    expect(pages.map((p) => `${p.book}/${p.pageId}`)).toEqual(['388/9', '388v2/9', '388v2/10', '3880/1']);
    expect(pages[1].strokes.map((s) => s.id)).toEqual([`s${T0 + 3}`, `s${T0 + 5}`]);
  });

  it('prints a suffixed page under its integer page, together with that page', () => {
    const { pages } = groupSelectionByPage([
      makeStroke('3017', 151, [[1, 1, 1]], { startTime: T0 + 1 }),
      makeStroke('3017', '151b', [[1, 1, 1]], { startTime: T0 + 2 })
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ book: '3017', pageId: '151' });
    expect(pages[0].strokes).toHaveLength(2);
  });

  it('converts to the stored format, keeping force and the sketch flag and dropping in-memory markers', () => {
    const { pages } = groupSelectionByPage([
      makeStroke('387', 3, [[10.123, 20.456, 412], [11, 21, 380.6]], {
        sketch: true, pointsEdited: true, movedFrom: { book: '387' }, retimedFrom: { id: 's1' }, blockUuid: 'line-1'
      })
    ]);
    const s = pages[0].strokes[0];
    expect(s).toEqual({
      id: `s${T0}`, startTime: T0, endTime: T0 + 100, lineId: 'line-1', sketch: true,
      points: [[10.12, 20.46, T0, 412], [11, 21, T0 + 10, 381]]
    });
  });

  it('keeps a stroke with no force as plain [x, y, ts] tuples, with no sketch key', () => {
    const { pages } = groupSelectionByPage([makeStroke('387', 3, [[1, 2], [3, 4]])]);
    expect(pages[0].strokes[0].points).toEqual([[1, 2, T0], [3, 4, T0 + 10]]);
    expect(pages[0].strokes[0]).not.toHaveProperty('sketch');
  });

  it('prints a pasted copy that was placed on a page; skips floating copies and empty strokes', () => {
    const placed = makeStroke('387', 4, [[5, 5, 200], [6, 6, 200]], { startTime: T0 + 7 });
    const floating = { ...makeStroke(null, 0, [[1, 1, 1]]), _pasted: true, _offset: { x: 50, y: 50 } };
    const empty = makeStroke('387', 4, []);
    const { pages, skipped } = groupSelectionByPage([placed, floating, empty, { pageInfo: { book: '387', page: 4 } }]);
    expect(skipped).toBe(3);
    expect(pages).toHaveLength(1);
    expect(pages[0].strokes).toHaveLength(1);
    expect(Object.keys(pages[0].strokes[0])).not.toContain('_offset');
  });

  it('is empty for no selection', () => {
    expect(groupSelectionByPage([])).toEqual({ pages: [], skipped: 0 });
    expect(groupSelectionByPage(null)).toEqual({ pages: [], skipped: 0 });
  });
});

describe('selectionPrintPage', () => {
  const group = groupSelectionByPage([
    makeStroke('3017', 5, [[20, 30, 300], [25, 35, 300]], { startTime: T0 }),
    makeStroke('3017', 5, [[22, 40, 300], [24, 44, 300]], { startTime: T0 + 86400000 * 2 })
  ]).pages[0];

  it('prints on the full paper, so the selection keeps its place on the page', () => {
    const page = selectionPrintPage(group, { paperFrame: PAPER, rotation: 0, title: 'JPI A5 — P5' });
    expect(page.frame).toEqual(PAPER);
    expect(page.lines).toBeNull();
    expect(page.title).toBe('JPI A5 — P5');
    expect(page.subtitle).toBe('Oct 14 – Oct 16, 2026');
  });

  it('grows the paper for ink outside it', () => {
    const wide = groupSelectionByPage([makeStroke('3017', 5, [[-3, 10, 1], [65, 20, 1]])]).pages[0];
    expect(selectionPrintPage(wide, { paperFrame: PAPER, title: 't' }).frame).toEqual({ x0: -3, y0: 0, x1: 65, y1: 90 });
  });

  it('falls back to the selection\'s padded ink box without paper', () => {
    const page = selectionPrintPage(group, { paperFrame: null, title: 't' });
    expect(page.frame).toEqual({ x0: 18, y0: 28, x1: 27, y1: 46 });
  });

  it('carries the rotation and an optional background', () => {
    const bg = { frame: PAPER, dataUrl: 'data:image/jpeg;base64,AA==' };
    const page = selectionPrintPage(group, { paperFrame: PAPER, rotation: 90, title: 't', background: bg });
    expect(page.rotation).toBe(90);
    expect(page.background).toBe(bg);
  });

  it('places the ink at its paper position in the SVG, and draws sketch strokes as width runs', () => {
    const sketchGroup = groupSelectionByPage([
      makeStroke('3017', 5, [[30, 45, 100], [31, 46, 600], [32, 47, 900]], { sketch: true })
    ]).pages[0];
    const page = selectionPrintPage(sketchGroup, { paperFrame: PAPER, title: 't' });
    const svg = inkSvg(page, 1, {});
    expect(svg).toMatch(/viewBox="0 0 142\.26 213\.39"/);
    expect(svg).toMatch(/<path d="M 71\.13 106\.69 L/); // (30, 45) × 2.371 from the paper's corner
    expect(svg).toMatch(/<path d="[^"]+" stroke-width="[\d.]+"\/>/); // a width run, from the force column
  });

  it('builds a strokes-only document even if asked for a transcript', () => {
    const page = selectionPrintPage(group, { paperFrame: PAPER, title: 'JPI A5 — P5' });
    expect(page.inkOnly).toBe(true);
    const opts = normalizePrintOptions({ content: 'both' });
    const html = buildPrintHtml([page], { ...opts, sheet: sheetFor({ layout: '1-portrait' }) });
    expect(html).toContain('JPI A5 — P5');
    expect(html).not.toContain('<section');
  });

  it('prints its ink beside a transcript-only page in a mixed list', () => {
    const page = selectionPrintPage(group, { paperFrame: PAPER, title: 'Sel P5' });
    const saved = { title: 'Saved P6', frame: PAPER, strokes: [], lines: [{ text: 'hello', indentLevel: 0 }] };
    const opts = normalizePrintOptions({ content: 'transcript' });
    const html = buildPrintHtml([saved, page], { ...opts, sheet: sheetFor({ layout: '1-portrait' }) });
    expect(html).toContain('hello');
    expect(html).toMatch(/<figure class="ink">[\s\S]*Sel P5[\s\S]*<svg/);
    expect(html).not.toMatch(/<figure class="ink">[^]*Saved P6/);
  });
});

describe('selectionItems', () => {
  const sel = [
    makeStroke('3017', 5, [[1, 1, 100], [2, 2, 100]], { startTime: T0 }),
    makeStroke('3017', 6, [[1, 1, 100], [2, 2, 100]], { startTime: T0 + 1000 }),
    makeStroke('3017', 5, [[3, 3, 100], [4, 4, 100]], { startTime: T0 + 2000 }),
    makeStroke(null, 7, [[1, 1, 100]])
  ];

  it('is one print-list item per page, carrying its strokes', () => {
    const { items, skipped } = selectionItems(sel);
    expect(skipped).toBe(1);
    expect(items.map((i) => [i.book, i.pageId, i.selection, i.strokes.length])).toEqual([
      ['3017', '5', true, 2], ['3017', '6', true, 1]
    ]);
  });

  it('keys the same strokes the same way (in any order), and different strokes differently', () => {
    const a = selectionItems(sel).items[0];
    const b = selectionItems([sel[2], sel[0]]).items[0];
    const c = selectionItems([sel[0]]).items[0];
    expect(b.key).toBe(a.key);
    expect(c.key).not.toBe(a.key);
    expect(refKey(a)).not.toBe('3017/5'); // never mistaken for the whole page
  });

  it('is added to the print list once, beside the whole page', () => {
    const items = selectionItems(sel).items;
    let list = addRefs([{ book: '3017', pageId: '5' }], items);
    list = addRefs(list, selectionItems(sel).items);
    expect(list.length).toBe(3);
    expect(list[1].strokes.length).toBe(2);
  });
});


describe('Print this sketch (v3.24.0): one sketch line as a print item', () => {
  const strokes = [
    { id: 's1', lineId: 'SK', points: [[1, 2], [3, 4]] },
    { id: 's2', lineId: 'A', points: [[1, 2], [3, 4]] },
    { id: 's3', lineId: 'SK', points: [[5, 6], [7, 8]] },
    { id: 's4', lineId: 'SK', points: [] },
  ];
  it("takes only the sketch’s inked strokes, keyed by page and line, printed like a selection", () => {
    const item = sketchPrintItem({ book: '3017', pageId: '124', lineId: 'SK', strokes });
    expect(item).toMatchObject({ book: '3017', pageId: '124', selection: true, key: '3017/124#sketch:SK' });
    expect(item.strokes.map((s) => s.id)).toEqual(['s1', 's3']);
    // Added twice, kept once.
    expect(addRefs([], [item, { ...item }])).toHaveLength(1);
    expect(refKey(item)).toBe('sel:3017/124#sketch:SK');
  });
  it('null for a sketch with no ink, or a bad book', () => {
    expect(sketchPrintItem({ book: '3017', pageId: '124', lineId: 'none', strokes })).toBeNull();
    expect(sketchPrintItem({ book: 'x', pageId: '124', lineId: 'SK', strokes })).toBeNull();
  });
});
