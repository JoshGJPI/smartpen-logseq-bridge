// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../core/tools.js';
import { renderPageSvg, INK } from '../core/render.js';
import { checkColoring, decorativeStrokes, LINE_PALETTE, DECORATIVE } from '../core/check-colors.js';
import { detectDecorativeIndices } from '../../src/lib/stroke-filter.js';

// Synthetic data only: render_page's color_by_line / show_decorative options.
let root;
const PAGE_INFO = { section: 3, owner: 1, book: 3017, page: 1 };

const stroke = (t, pts, lineId = null) => ({
  id: `s${t}`, startTime: t, endTime: t + 500, lineId,
  points: pts.map(([x, y], i) => [x, y, t + i * 10, 300])
});
/** Twelve small letters along y = 20, then the same along y = 40. */
function letters(y, t0, lineId) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const x = 10 + i * 2.5;
    out.push(stroke(t0 + i * 1000, [[x, y], [x + 0.5, y - 1.5], [x + 1, y], [x + 1.5, y - 1.4], [x + 2, y]], lineId));
  }
  return out;
}
const underline = (t, y) => stroke(t, Array.from({ length: 61 }, (_, k) => [10 + k * 0.5, y + (k % 2) * 0.02]));
function box(t, x0, y0, x1, y1) {
  const pts = [];
  const side = (a, b, c, d) => { for (let k = 0; k <= 20; k++) pts.push([a + (c - a) * k / 20, b + (d - b) * k / 20]); };
  side(x0, y0, x1, y0); side(x1, y0, x1, y1); side(x1, y1, x0, y1); side(x0, y1, x0, y0);
  return stroke(t, pts);
}
const line = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, ...extra });
// Fixed-code yBounds sit far from the raw Ncode Y (isTrustworthyTranscript tells the two apart).
const yb = (minY) => ({ minY, maxY: minY + 8 });

function writePage(id, strokes, transcript) {
  const dir = path.join(root, 'pages', 'B3017');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P${id}.json`), JSON.stringify({
    version: '2.0', pageInfo: { ...PAGE_INFO, page: Number(id) },
    metadata: { lastUpdated: '2026-11-01T00:00:00Z', totalStrokes: strokes.length, bounds: {} },
    transcript: transcript || { lastTranscribed: null, lines: [] }, strokes
  }));
}

const trustedDoc = () => ({
  pageInfo: PAGE_INFO,
  transcript: {
    lastTranscribed: '2026-11-01T00:00:00Z',
    lines: [line('a', 'Footing notes', { yBounds: yb(200) }), line('b', 'Check loads', { yBounds: yb(220), checked: false }),
      line('c', 'nothing here', { yBounds: yb(240) })]
  },
  strokes: [...letters(20, 1000, 'a'), ...letters(40, 100000, 'b'), stroke(300000, [[60, 60], [62, 62]])]
});

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-check-'));
  const d = trustedDoc();
  writePage('1', d.strokes, d.transcript);
  // Same links, but transcribed before the line-matching fix.
  writePage('2', d.strokes, { ...d.transcript, lastTranscribed: '2026-03-01T00:00:00Z' });
  writePage('3', [...letters(20, 1000, null), underline(50000, 21), box(60000, 8, 16, 42, 23)]);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const imageCount = (r) => r.content.filter((c) => c.type === 'image').length;

describe('checkColoring', () => {
  it('colours each linked stroke by its line, in transcript order', () => {
    const doc = trustedDoc();
    const { colorOf, key } = checkColoring(doc, { byLine: true, decorative: false });
    expect(colorOf(doc.strokes[0])).toBe(LINE_PALETTE[0].hex);
    expect(colorOf(doc.strokes[12])).toBe(LINE_PALETTE[1].hex);
    expect(colorOf(doc.strokes[24])).toBeNull();          // unlinked: default ink
    const body = key.join('\n');
    expect(body).toMatch(/1\. blue\s+\(12 strokes\) Footing notes/);
    expect(body).toMatch(/2\. orange\s+\(12 strokes\) TODO Check loads/);
    expect(body).toMatch(/3\. green\s+\(NO INK LINKED\) nothing here/);
    expect(body).toMatch(/1 stroke\(s\) linked to no line/);
  });
  it('cycles the palette past eight lines', () => {
    const lines = Array.from({ length: 9 }, (_, i) => line(`l${i}`, `line ${i}`, { yBounds: yb(200 + i * 10) }));
    const strokes = lines.map((l, i) => stroke(1000 + i * 1000, [[10, 10 + i * 5], [20, 10 + i * 5]], l.id));
    const { colorOf } = checkColoring({ transcript: { lastTranscribed: '2026-11-01', lines }, strokes }, { byLine: true });
    expect(colorOf(strokes[8])).toBe(LINE_PALETTE[0].hex);
    expect(colorOf(strokes[7])).toBe(LINE_PALETTE[7].hex);
  });
  it('leaves ink plain for untrustworthy or missing transcripts', () => {
    const old = { ...trustedDoc(), transcript: { ...trustedDoc().transcript, lastTranscribed: '2026-03-01' } };
    const a = checkColoring(old, { byLine: true });
    expect(a.colorOf(old.strokes[0])).toBeNull();
    expect(a.key.join()).toMatch(/unreliable/);
    const b = checkColoring({ strokes: old.strokes }, { byLine: true });
    expect(b.key.join()).toMatch(/not transcribed/);
  });
  it('decorative strokes are the ones Deselect Decorative takes, and red wins over a line colour', () => {
    const strokes = [...letters(20, 1000, 'a'), underline(50000, 21), box(60000, 8, 16, 42, 23)];
    const doc = {
      pageInfo: PAGE_INFO, strokes,
      transcript: { lastTranscribed: '2026-11-01', lines: [line('a', 'boxed words', { yBounds: yb(200) })] }
    };
    doc.strokes[13] = { ...doc.strokes[13], lineId: 'a' };   // the box got linked to the line
    const found = decorativeStrokes(doc);
    expect([...found.ids]).toEqual(['s50000', 's60000']);
    expect(found.stats).toMatchObject({ boxes: 1, underlines: 1 });
    // Parity with the app's call on the same strokes in canvas shape.
    const canvas = strokes.map((s) => ({ pageInfo: PAGE_INFO, startTime: s.startTime, dotArray: s.points.map((p) => ({ x: p[0], y: p[1], f: p[3], timestamp: p[2] })) }));
    expect(detectDecorativeIndices(canvas).indices).toEqual([12, 13]);
    const { colorOf, key } = checkColoring(doc, { byLine: true, decorative: true });
    expect(colorOf(doc.strokes[13])).toBe(DECORATIVE.hex);
    expect(colorOf(doc.strokes[0])).toBe(LINE_PALETTE[0].hex);
    expect(key.join('\n')).toMatch(/2 stroke\(s\) in red .*1 box, 1 underline, 0 circle; 1 already linked/);
  });
  it('handles an empty page', () => {
    const { colorOf, key } = checkColoring({ strokes: [] }, { byLine: true, decorative: true });
    expect(colorOf({ id: 'x' })).toBeNull();
    expect(key.join()).toMatch(/0 stroke\(s\) in red/);
  });
});

describe('renderPageSvg colorOf', () => {
  it('overrides ink per stroke and never the grey context', () => {
    const a = stroke(1, [[0, 0], [10, 10]]), b = stroke(2, [[0, 20], [10, 30]]);
    const svg = renderPageSvg([a, b], { context: [stroke(3, [[0, 40], [10, 50]])], colorOf: (s) => (s === a ? '#123456' : null) }).svg;
    expect(svg).toContain('#123456');
    expect(svg).toContain(INK);
    expect(svg.match(/#123456/g)).toHaveLength(1);
  });
});

describe('render_page check options', () => {
  it('color_by_line adds the key under the image note', () => {
    const r = createTools(root).render_page({ book: '3017', page: '1', color_by_line: true });
    expect(r.isError).toBeFalsy();
    expect(imageCount(r)).toBe(1);
    expect(textOf(r)).toMatch(/Ink coloured by transcript line/);
    expect(textOf(r)).toMatch(/2\. orange\s+\(12 strokes\) TODO Check loads/);
  });
  it('reports unreliable links and keeps the image', () => {
    const r = createTools(root).render_page({ book: '3017', page: '2', color_by_line: true });
    expect(imageCount(r)).toBe(1);
    expect(textOf(r)).toMatch(/unreliable/);
  });
  it('show_decorative on an untranscribed page', () => {
    const r = createTools(root).render_page({ book: '3017', page: '3', show_decorative: true, color_by_line: true });
    expect(textOf(r)).toMatch(/not transcribed/);
    expect(textOf(r)).toMatch(/2 stroke\(s\) in red/);
  });
  it('without the options the reply is unchanged', () => {
    const r = createTools(root).render_page({ book: '3017', page: '1' });
    expect(textOf(r)).not.toMatch(/coloured|show_decorative/);
  });
});
