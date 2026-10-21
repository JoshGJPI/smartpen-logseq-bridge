// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pagePath, requireBookKey, requirePageId, resolveDataRoot } from '../core/paths.js';
import { readAliases, readOrientations, readTags, readVolumes } from '../core/sidecars.js';
import { Store } from '../core/store.js';
import { renderPageSvg, svgToPng } from '../core/render.js';
import { createTools } from '../core/tools.js';

// Synthetic data only: a throwaway data root built per run (no real handwriting).
let root;
const t = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

function stroke(startTime, x0, y0, extra = {}) {
  return {
    id: `s${startTime}`, startTime, endTime: startTime + 500, lineId: null,
    points: [[x0, y0, startTime, 300], [x0 + 10, y0 + 4, startTime + 100, 300], [x0 + 20, y0, startTime + 200, 300]],
    ...extra
  };
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

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-fixture-'));
  // 23:59:59 on the 14th and 00:00:00 on the 15th (local) sit on different days.
  writePage('388', '1', [stroke(t(2026, 10, 14, 23, 59, 59), 5, 5), stroke(t(2026, 10, 15, 0, 0, 0), 40, 40), stroke(t(2026, 10, 15, 9, 0), 70, 90)]);
  writePage('388v2', '151b', [stroke(t(2026, 10, 15, 10, 0), 5, 5)], {
    lastTranscribed: '2026-10-15T10:00:00Z',
    lines: [{ id: 'l1', text: 'Beam check', indentLevel: 0, parentId: null, checked: false, yBounds: null }]
  });
  writePage('388', '151', [stroke(t(2026, 10, 16, 8, 0), 5, 5)]);
  const side = (n, o) => fs.writeFileSync(path.join(root, 'pages', n), typeof o === 'string' ? o : JSON.stringify(o));
  side('_aliases.json', { 388: 'Field Book', '388v2': 'Field Book 2', bogus: 'x' });
  side('_volumes.json', { version: 1, active: { 388: 2 } });
  side('_orientation.json', { version: 1, pages: { '388/1': 90, '388v2/151b': 7 } });
  side('_tags.json', { version: 1, pages: { '388v2/151b': ['beam'] }, dismissed: {} });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('path guard', () => {
  it('rejects traversal and malformed keys', () => {
    for (const bad of ['..', '../x', 'B388', '388v1x', '388/..', '', '388v2/..']) {
      expect(() => requireBookKey(bad), bad).toThrow();
    }
    for (const bad of ['..', '1/../2', '42.json', 'abc', '12bc', '']) {
      expect(() => requirePageId(bad), bad).toThrow();
    }
    expect(() => pagePath(root, '388', '../../etc')).toThrow();
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
    expect(readOrientations(root)).toEqual({ '388/1': 90 });
    expect(readTags(root).pages).toEqual({ '388v2/151b': ['beam'] });
  });
  it('treats missing or corrupt files as empty', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-empty-'));
    fs.mkdirSync(path.join(empty, 'pages'));
    fs.writeFileSync(path.join(empty, 'pages', '_tags.json'), '{not json');
    expect(readAliases(empty)).toEqual({});
    expect(readTags(empty)).toEqual({ pages: {}, dismissed: {} });
    expect(readOrientations(empty)).toEqual({});
    fs.rmSync(empty, { recursive: true });
  });
});

describe('scan: volumes, suffixes, days', () => {
  it('keeps 388 and 388v2 apart and sorts with compareBookKeys', () => {
    const { pages } = new Store(root).scan();
    expect(pages.map((p) => `${p.book}/${p.pageId}`)).toEqual(['388/1', '388/151', '388v2/151b']);
  });
  it('splits strokes at local midnight', () => {
    const { pages } = new Store(root).scan();
    expect(pages.find((p) => p.pageId === '1').days).toEqual({ '2026-10-14': 1, '2026-10-15': 2 });
  });
  it('page file reads stay inside the root', () => {
    const s = new Store(root);
    expect(s.getPage('388v2', '151b').strokes).toHaveLength(1);
    expect(s.getPage('388', '999')).toBeNull();
    expect(() => s.getPage('..', '1')).toThrow();
  });
});

describe('tools', () => {
  const tools = () => createTools(root);
  it('list_notebooks names volumes and the active one', () => {
    const rows = JSON.parse(tools().list_notebooks().content[0].text);
    expect(rows.map((r) => r.book)).toEqual(['388', '388v2']);
    expect(rows[1]).toMatchObject({ name: 'Field Book 2', activeVolume: true });
    expect(rows[0].activeVolume).toBe(false);
  });
  it('days_summary uses local days and rejects impossible dates', () => {
    const r = tools().days_summary({ from: '2026-10-14', to: '2026-10-15' });
    const days = JSON.parse(r.content[0].text);
    expect(days.map((d) => [d.day, d.strokes])).toEqual([['2026-10-14', 1], ['2026-10-15', 3]]);
    expect(tools().days_summary({ from: '2026-13-45' }).isError).toBe(true);
  });
  it('render_days: halftone context present, drops with context:false', () => {
    const withCtx = tools().render_days({ from: '2026-10-14', book: '388', format: 'svg' });
    const svg = withCtx.content.find((c) => c.text && c.text.startsWith('<svg')).text;
    expect(svg).toContain('#c3c7d4');
    expect(svg).toContain('#1a1a2e');
    const noCtx = tools().render_days({ from: '2026-10-14', book: '388', format: 'svg', context: false });
    expect(noCtx.content.find((c) => c.text && c.text.startsWith('<svg')).text).not.toContain('#c3c7d4');
  });
  it('render_days pages by limit / offset', () => {
    const r = tools().render_days({ from: '2026-10-14', to: '2026-10-16', limit: 1, format: 'svg' });
    expect(r.content[0].text).toMatch(/more, call again with offset=1/);
  });
  it('get_transcript shows TODO state and flags old transcripts', () => {
    const r = tools().get_transcript({ book: '388v2', page: '151b' });
    expect(r.content[0].text).toContain('- TODO Beam check');
    expect(tools().get_transcript({ book: '388v2', page: '999' }).isError).toBe(true);
    expect(tools().get_transcript({ book: '../x', page: '1' }).isError).toBe(true);
  });
  it('search finds transcript and tag words', () => {
    expect(tools().search({ query: 'beam' }).content[0].text).toContain('388v2/151b');
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
  it('PNG decodes to the requested width', () => {
    const r = renderPageSvg(pts);
    const out = svgToPng(r.svg, 500);
    expect(out.width).toBe(500);
    expect([...out.png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(renderPageSvg([])).toBeNull();
  });
  it('render_page returns an image block', () => {
    const r = createTools(root).render_page({ book: '388', page: '1', width: 400 });
    const img = r.content.find((c) => c.type === 'image');
    expect(img.mimeType).toBe('image/png');
    expect(r.content[0].text).toContain('rotation 90');   // stored orientation
  });
});
