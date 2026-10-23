// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pagePath, requireBookKey, requirePageId, resolveDataRoot, manifestPath } from '../core/paths.js';
import { readAliases, readOrientations, readTags, readVolumes, readPaper } from '../core/sidecars.js';
import { Store } from '../core/store.js';
import { renderPageSvg, svgToPng, fitWidth, visualTokens, MAX_EDGE, MAX_IMAGE_TOKENS } from '../core/render.js';
import { robustInkBounds, viewBounds } from '../core/bounds.js';
import { createTools, LIMITS } from '../core/tools.js';

// Synthetic data only: a throwaway data root built per run (no real handwriting,
// none of Neo's images; the one manifest is made-up geometry).
let root;
const t = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const FRAME = { x0: 3.5, y0: 3.5, x1: 94.6, y1: 121.6 };

function stroke(startTime, x0, y0, extra = {}) {
  return {
    id: `s${startTime}`, startTime, endTime: startTime + 500, lineId: null,
    points: [[x0, y0, startTime, 300], [x0 + 10, y0 + 4, startTime + 100, 300], [x0 + 20, y0, startTime + 200, 300]],
    ...extra
  };
}
/** `n` strokes in a block of lines inside the paper, plus whatever `extra` adds. */
function inkBlock(n, start, extra = []) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(stroke(start + i * 1000, 10 + (i % 5) * 12, 10 + Math.floor(i / 5) * 6));
  return [...out, ...extra];
}
function writePage(book, id, strokes, transcript = { lastTranscribed: null, lines: [] }) {
  const dir = path.join(root, 'pages', `B${book}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P${id}.json`), JSON.stringify({
    version: '2.0', pageInfo: { section: 3, owner: 1, book: parseInt(book, 10), page: parseInt(id, 10) },
    metadata: { lastUpdated: '2026-01-01T00:00:00Z', totalStrokes: strokes.length, bounds: {} },
    transcript, strokes
  }));
}
const line = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null, ...extra });
const STRAY = (ms) => stroke(ms, 600, 600);

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-fixture-'));
  // 23:59:59 on the 14th and 00:00:00 on the 15th (local) sit on different days.
  writePage('388', '1', [stroke(t(2026, 10, 14, 23, 59, 59), 5, 5), stroke(t(2026, 10, 15, 0, 0, 0), 40, 40), stroke(t(2026, 10, 15, 9, 0), 70, 90)]);
  writePage('388v2', '151b', [stroke(t(2026, 10, 15, 10, 0), 5, 5)], {
    lastTranscribed: '2026-10-15T10:00:00Z',
    lines: [line('l1', 'Beam check', { checked: false })]
  });
  writePage('388', '151', [stroke(t(2026, 10, 16, 8, 0), 5, 5)]);
  // Outlier pages: 60 strokes of writing plus one stray far off the paper.
  writePage('388', '2', inkBlock(60, t(2026, 10, 17, 9, 0), [STRAY(t(2026, 10, 17, 11, 0))]));
  writePage('390', '5', inkBlock(60, t(2026, 10, 17, 14, 0), [STRAY(t(2026, 10, 17, 15, 0))]), {
    lastTranscribed: '2026-10-17T15:00:00Z',
    lines: [line('a', 'Footing design notes'), line('b', 'Check P2026-141 loads')]
  });
  const side = (n, o) => fs.writeFileSync(path.join(root, 'pages', n), typeof o === 'string' ? o : JSON.stringify(o));
  side('_aliases.json', { 388: 'Field Book', '388v2': 'Field Book 2', bogus: 'x' });
  side('_volumes.json', { version: 1, active: { 388: 2 } });
  side('_orientation.json', { version: 1, pages: { '388/1': 90, '388/2': 90, '388v2/151b': 7 } });
  side('_tags.json', { version: 1, pages: { '388v2/151b': ['beam'], '390/5': ['P2026-141'], '388/999': ['ghost'] }, dismissed: {} });
  fs.mkdirSync(path.join(root, 'pages', '_backgrounds', '388'), { recursive: true });
  fs.writeFileSync(manifestPath(root, 388), JSON.stringify({ version: 1, source: 'neo', sob: '3_27_388', title: 'T', frame: FRAME, firstPage: 1, lastPage: 144, ext: 'jpg' }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Decode an 8-bit PNG (any colour type, all five row filters); px() is luminance 0-255. */
function decodePng(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), bits = buf[24], type = buf[25];
  expect(bits).toBe(8);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8);
    if (kind === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rb = w * ch;
  const rows = new Uint8Array(rb * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (rb + 1)];
    for (let i = 0; i < rb; i++) {
      const x = raw[y * (rb + 1) + 1 + i];
      const a = i >= ch ? rows[y * rb + i - ch] : 0, b = y ? rows[(y - 1) * rb + i] : 0, c = i >= ch && y ? rows[(y - 1) * rb + i - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      rows[y * rb + i] = (x + pred) & 0xff;
    }
  }
  const px = (x, y) => {
    const o = y * rb + x * ch;
    return ch < 3 ? rows[o] : Math.round(0.299 * rows[o] + 0.587 * rows[o + 1] + 0.114 * rows[o + 2]);
  };
  return { w, h, type, px };
}
/** Pixels darker than `max`, and pixels in lo..hi (the context grey). */
function tally(d, { max = 80, lo = 175, hi = 225 } = {}) {
  let dark = 0, grey = 0;
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    const v = d.px(x, y);
    if (v < max) dark++; else if (v >= lo && v <= hi) grey++;
  }
  return { dark, grey };
}
const imgs = (r) => r.content.filter((c) => c.type === 'image');
const pngOf = (c) => Buffer.from(c.data, 'base64');

describe('path guard', () => {
  it('rejects traversal and malformed keys', () => {
    for (const bad of ['..', '../x', 'B388', '388v1x', '388/..', '', '388v2/..']) {
      expect(() => requireBookKey(bad), bad).toThrow();
    }
    for (const bad of ['..', '1/../2', '42.json', 'abc', '12bc', '']) {
      expect(() => requirePageId(bad), bad).toThrow();
    }
    expect(() => pagePath(root, '388', '../../etc')).toThrow();
    expect(() => manifestPath(root, '../388')).toThrow();
  });
  it('resolves volume keys and suffixed pages inside pages/', () => {
    const p = pagePath(root, '388v2', '151b');
    expect(p).toBe(path.join(root, 'pages', 'B388v2', 'P151b.json'));
  });
  it('requires a data root with pages/', () => {
    expect(() => resolveDataRoot([], {})).toThrow(/No data folder/);
    expect(() => resolveDataRoot(['--data-root', os.tmpdir() + '/nope-xyz'], {})).toThrow(/pages/);
    expect(resolveDataRoot(['--data-root', root], {})).toBe(path.resolve(root));
    expect(resolveDataRoot([], { SMARTPEN_DATA_ROOT: root })).toBe(path.resolve(root));
  });
});

describe('sidecars', () => {
  it('reads valid entries and drops junk', () => {
    expect(readAliases(root)).toEqual({ 388: 'Field Book', '388v2': 'Field Book 2' });
    expect(readVolumes(root)).toEqual({ 388: 2 });
    expect(readOrientations(root)).toEqual({ '388/1': 90, '388/2': 90 });
    expect(readTags(root).pages).toMatchObject({ '388v2/151b': ['beam'] });
    expect(readPaper(root, 388)).toEqual({ frame: FRAME, firstPage: 1, lastPage: 144 });
    expect(readPaper(root, 390)).toBeNull();
  });
  it('treats missing or corrupt files as empty', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-empty-'));
    fs.mkdirSync(path.join(empty, 'pages', '_backgrounds', '388'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'pages', '_tags.json'), '{not json');
    fs.writeFileSync(manifestPath(empty, 388), '{"frame":{"x0":5,"y0":0,"x1":1,"y1":9},"firstPage":1,"lastPage":2}');
    expect(readAliases(empty)).toEqual({});
    expect(readTags(empty)).toEqual({ pages: {}, dismissed: {} });
    expect(readOrientations(empty)).toEqual({});
    expect(readPaper(empty, 388)).toBeNull();
    fs.rmSync(empty, { recursive: true });
  });
});

describe('scan: volumes, suffixes, days', () => {
  it('keeps 388 and 388v2 apart and sorts with compareBookKeys', () => {
    const { pages } = new Store(root).scan();
    expect(pages.map((p) => `${p.book}/${p.pageId}`)).toEqual(['388/1', '388/2', '388/151', '388v2/151b', '390/5']);
  });
  it('splits strokes at local midnight', () => {
    const { pages } = new Store(root).scan();
    expect(pages.find((p) => p.pageId === '1').days).toEqual({ '2026-10-14': 1, '2026-10-15': 2 });
  });
  it('records carry the app record fields search reads', () => {
    const { pages } = new Store(root).scan();
    const p = pages.find((r) => r.book === '390');
    expect(p).toMatchObject({ page: 5, pageId: '5', suffix: '', strokeCount: 61, transcribed: true });
    expect(p.transcriptionText).toBe('Footing design notes\nCheck P2026-141 loads');
    expect(pages.find((r) => r.pageId === '151').transcriptionText).toBeNull();
  });
  it('page file reads stay inside the root', () => {
    const s = new Store(root);
    expect(s.getPage('388v2', '151b').strokes).toHaveLength(1);
    expect(s.getPage('388', '999')).toBeNull();
    expect(() => s.getPage('..', '1')).toThrow();
  });
  it('paper frame: by NCode book, shared by volumes and suffixed pages, only inside the manifest', () => {
    const s = new Store(root);
    expect(s.paperFrame('388', '2')).toEqual(FRAME);
    expect(s.paperFrame('388v2', '2')).toEqual(FRAME);
    expect(s.paperFrame('388', '144b')).toEqual(FRAME);
    expect(s.paperFrame('388', '145')).toBeNull();
    expect(s.paperFrame('388v2', '151b')).toBeNull();
    expect(s.paperFrame('390', '5')).toBeNull();
  });
});

describe('bounds: paper frame and outliers', () => {
  const page = inkBlock(60, 1, [STRAY(9e6)]);
  it('robust ink extent drops a lone stray stroke', () => {
    const b = robustInkBounds(page);
    expect(b.maxX).toBeLessThan(100);
    expect(b.maxY).toBeLessThan(100);
    expect(b.minX).toBe(10);
  });
  it('trims nothing on too little ink to call anything an outlier', () => {
    const few = [stroke(1, 0, 0), STRAY(2)];
    expect(robustInkBounds(few).maxX).toBe(620);
  });
  it('lays out on the paper and clips the stray', () => {
    const v = viewBounds({ strokes: page, frame: FRAME });
    expect(v.source).toBe('paper');
    expect(v.bounds).toEqual({ minX: FRAME.x0, minY: FRAME.y0, maxX: FRAME.x1, maxY: FRAME.y1 });
    expect(v.clipped).toBe(1);
  });
  it('paper widens a little for ink just off the sheet, never to a stray', () => {
    // A margin note of a few strokes (one alone would be trimmed as an outlier).
    const v = viewBounds({ strokes: [...page, stroke(5, 1, 1), stroke(6, 1, 30), stroke(7, 1, 60)], frame: FRAME });
    expect(v.bounds.minX).toBe(1);
    expect(v.bounds.maxX).toBe(FRAME.x1);
  });
  it('fit ink crops to the ink within the paper', () => {
    const v = viewBounds({ strokes: page, frame: FRAME, fit: 'ink' });
    expect(v.source).toBe('ink');
    expect(v.bounds.maxX).toBeLessThan(FRAME.x1);
  });
  it('render_page: stray reported, page keeps the paper aspect', () => {
    const tools = createTools(root);
    const r = tools.render_page({ book: '388', page: '2', width: 400 });
    expect(r.content[0].text).toMatch(/printed page; 1 stray stroke/);
    const d = decodePng(pngOf(imgs(r)[0]));
    const aspect = (FRAME.y1 - FRAME.y0) / (FRAME.x1 - FRAME.x0);
    expect(d.w / d.h).toBeCloseTo(aspect, 1);   // stored rotation 90: the sheet on its side
    // No paper for book 390: the trimmed ink box, still not the stray.
    expect(tools.render_page({ book: '390', page: '5' }).content[0].text).toMatch(/on the ink; 1 stray/);
    const v = viewBounds({ strokes: new Store(root).getPage('390', '5').strokes, frame: null });
    expect(renderPageSvg([], { bounds: v.bounds }).width).toBeLessThan(200);   // the stray would make it ~1450 user units
  });
});

describe('PNG output', () => {
  it('rendered page: white paper, dark ink, requested width', () => {
    const r = renderPageSvg([stroke(1, 0, 0), stroke(2, 0, 50)]);
    const out = svgToPng(r.svg, 500);
    const d = decodePng(out.png);
    expect([d.w, d.h]).toEqual([out.width, out.height]);
    expect(out.width).toBe(500);
    expect(d.px(0, 0)).toBe(255);
    expect(tally(d).dark).toBeGreaterThan(50);
  });
});

describe('size caps: pixels, not bytes', () => {
  const tools = () => createTools(root);
  it('defaults per tool', () => {
    const page = tools().render_page({ book: '388', page: '1' });
    expect(decodePng(pngOf(imgs(page)[0])).w).toBe(LIMITS.page.width);
    const days = tools().render_days({ from: '2026-10-14', to: '2026-10-17' });
    expect(imgs(days)).toHaveLength(LIMITS.images);
    for (const im of imgs(days)) expect(decodePng(pngOf(im)).w).toBe(LIMITS.pages.width);
    expect(days.content[0].text).toMatch(/1 more, call again with offset=4/);
    expect(days.content[0].text).toMatch(/\[PNG 700x\d+, ~\d+ visual tokens\]/);
  });
  it('at most 4 images per call, whatever the limit', () => {
    const r = tools().render_days({ from: '2026-10-14', to: '2026-10-17', limit: 50 });
    expect(imgs(r)).toHaveLength(4);
    expect(r.content[0].text).toMatch(/showing 4 \(offset 0\); 1 more, call again with offset=4/);
  });
  it('width is capped at the long edge and the token ceiling, and floored', () => {
    for (const r of [tools().render_days({ from: '2026-10-17', book: '390', width: 99999 }), tools().render_page({ book: '388', page: '2', width: 99999 })]) {
      const d = decodePng(pngOf(imgs(r)[0]));
      expect(Math.max(d.w, d.h)).toBeLessThanOrEqual(MAX_EDGE);
      expect(visualTokens(d.w, d.h)).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
    }
    const tiny = tools().render_page({ book: '388', page: '1', width: 1 });
    expect(decodePng(pngOf(imgs(tiny)[0])).w).toBe(LIMITS.minWidth);
  });
  it('fitWidth: long edge, then tokens; 4 worst-case images stay under 10,000 tokens', () => {
    expect(fitWidth(0.5, 3000)).toBe(MAX_EDGE);                       // landscape: width is the long edge
    expect(fitWidth(1.3, 1000)).toBe(1000);                           // the default page needs no change
    expect(Math.ceil(fitWidth(3, 3000) * 3)).toBeLessThanOrEqual(MAX_EDGE);   // tall: height is
    for (const a of [0.2, 0.5, 0.77, 1, 1.3, 2, 5]) {
      const w = fitWidth(a, MAX_EDGE);
      expect(visualTokens(w, Math.ceil(w * a))).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
    }
    expect(fitWidth(1, MAX_EDGE)).toBeLessThan(MAX_EDGE);              // a square at 1500 px would be 2,916 tokens
    expect(LIMITS.images * MAX_IMAGE_TOKENS).toBeLessThan(10_000);
  });
});

describe('rotation (stored in _orientation.json)', () => {
  const tools = () => createTools(root);
  it('render_page and render_days turn within the paper frame; lists report it', () => {
    const turned = tools().render_page({ book: '388', page: '2' });
    expect(turned.content[0].text).toContain('rotation 90');
    const a = decodePng(pngOf(imgs(turned)[0]));
    expect(a.w).toBeGreaterThan(a.h);
    const day = decodePng(pngOf(imgs(tools().render_days({ from: '2026-10-17', book: '388' }))[0]));
    expect(day.w).toBeGreaterThan(day.h);
    expect(tools().list_pages({ book: '388' }).content[0].text).toContain('"page":"2","strokes":61,"days":["2026-10-17"],"tags":[],"transcribed":false,"rotation":90');
  });
});

describe('tools', () => {
  const tools = () => createTools(root);
  it('list_notebooks names volumes, the active one and paper', () => {
    const rows = JSON.parse(tools().list_notebooks().content[0].text);
    expect(rows.map((r) => r.book)).toEqual(['388', '388v2', '390']);
    expect(rows[1]).toMatchObject({ name: 'Field Book 2', activeVolume: true, paper: true });
    expect(rows[0].activeVolume).toBe(false);
    expect(rows[2]).toMatchObject({ name: 'B390', paper: false });
  });
  it('days_summary uses local days and rejects impossible dates', () => {
    const r = tools().days_summary({ from: '2026-10-14', to: '2026-10-15' });
    const days = JSON.parse(r.content[0].text);
    expect(days.map((d) => [d.day, d.strokes])).toEqual([['2026-10-14', 1], ['2026-10-15', 3]]);
    expect(tools().days_summary({ from: '2026-13-45' }).isError).toBe(true);
    expect(tools().days_summary({ from: '2026-02-30' }).isError).toBe(true);
  });
  it('render_days: the day\'s ink dark over the rest of the page in grey', () => {
    // 388/1 on the 14th: 1 stroke in range, 2 written on the 15th.
    const r = tools().render_days({ from: '2026-10-14', book: '388' });
    expect(r.content[0].text).toMatch(/p\.1: 1 of 3 strokes in range/);
    const { dark, grey } = tally(decodePng(pngOf(imgs(r)[0])));
    expect(dark).toBeGreaterThan(20);
    expect(grey).toBeGreaterThan(20);
    const svg = renderPageSvg([stroke(1, 0, 0)], { context: [stroke(2, 0, 50)] }).svg;
    expect(svg).toContain('#c3c7d4');
    expect(svg).toContain('#1a1a2e');
  });
  it('render_days pages by limit / offset', () => {
    const r = tools().render_days({ from: '2026-10-14', to: '2026-10-16', limit: 1 });
    expect(r.content[0].text).toMatch(/more, call again with offset=1/);
    const last = tools().render_days({ from: '2026-10-14', to: '2026-10-16', limit: 1, offset: 2 });
    expect(last.content[0].text).toMatch(/showing 1 \(offset 2\)\./);
  });
  it('get_transcript shows TODO state and flags untrustworthy line links', () => {
    const r = tools().get_transcript({ book: '388v2', page: '151b' });
    expect(r.content[0].text).toContain('- TODO Beam check');
    expect(r.content[0].text).toMatch(/unreliable/);
    expect(tools().get_transcript({ book: '388v2', page: '999' }).isError).toBe(true);
    expect(tools().get_transcript({ book: '../x', page: '1' }).isError).toBe(true);
  });
  it('list_tags: counts existing pages only, and lists a tag\'s pages', () => {
    const r = tools().list_tags();
    expect(r.content[0].text).toMatch(/^2 tag\(s\); 3 untagged page\(s\); 1 tagged page\(s\) no longer exist/);
    const stats = JSON.parse(r.content[0].text.split('\n')[1]);
    expect(stats.map((s) => s.tag).sort()).toEqual(['P2026-141', 'beam']);
    const one = tools().list_tags({ tag: 'p2026-141' });
    expect(JSON.parse(one.content[0].text.split('\n')[1])).toMatchObject([{ page: '390/5', days: ['2026-10-17'], transcribed: true }]);
    expect(tools().list_tags({ tag: 'ghost' }).content[0].text).toMatch(/No pages/);
  });
  it('search uses the app semantics: words, dates, notebooks, tags', () => {
    const out = (q) => JSON.parse(tools().search({ query: q }).content[0].text.split('\n')[1]);
    expect(out('beam').pages.map((p) => p.page)).toEqual(['388v2/151b']);
    expect(out('beam').tags.map((p) => p.tag)).toEqual(['beam']);
    expect(out('foot').pages.map((p) => p.page)).toEqual(['390/5']);   // part of a word, as in the app
    expect(out('2026-10-17').days).toEqual([{ day: '2026-10-17', pages: 2, strokes: 122 }]);
    expect(out('2026-10-17').pages.map((p) => p.page).sort()).toEqual(['388/2', '390/5']);   // untranscribed pages too
    expect(out('field book').notebooks.map((n) => n.book)).toEqual(['388', '388v2']);
    expect(out('388v2').notebooks).toEqual([{ book: '388v2', name: 'Field Book 2', exact: true }]);
    expect(out('P2026-141').tags).toEqual([{ tag: 'P2026-141', pages: 1, exact: true }]);
    expect(tools().search({ query: '  ' }).isError).toBe(true);
  });
});

describe('render', () => {
  const pts = [stroke(1, 0, 0), stroke(2, 0, 50)];
  it('rotation swaps the page aspect ratio', () => {
    const a = renderPageSvg(pts, { rotation: 0 });
    const b = renderPageSvg(pts, { rotation: 90 });
    expect(b.width).toBeCloseTo(a.height);
    expect(b.height).toBeCloseTo(a.width);
    expect(b.svg).toContain('matrix(');
    expect(a.svg).not.toContain('matrix(');
  });
  it('nothing to draw is null; strokes outside the view are left out of the markup', () => {
    expect(renderPageSvg([])).toBeNull();
    const r = renderPageSvg([stroke(1, 10, 10), STRAY(2)], { bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } });
    expect((r.svg.match(/<path /g) || []).length).toBe(1);
  });
});
