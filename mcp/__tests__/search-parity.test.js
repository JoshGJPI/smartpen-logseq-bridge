/**
 * Search parity: the MCP `search` tool against the app's header search on the
 * same synthetic folder.
 *
 * The app side is built the way the app builds it: page metadata and the
 * capture-day histogram by main.cjs's own extractPageMeta() / extractCaptureDays()
 * (lifted out of electron/main.cjs source, since main is not importable outside
 * Electron), records by scan.js metaToRecord(), and the context SearchField.svelte
 * passes runSearch() (library.js / tags.js derivations).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { metaToRecord } from '$lib/storage/scan.js';
import { parseSearchQuery } from '$lib/search-query.js';
import { buildSearchIndex, recordsByKey, runSearch } from '$lib/global-search.js';
import { pageDates } from '$lib/library-home.js';
import { tagStats, normalizeTagsFile } from '$lib/tags.js';
import { compareBookKeys } from '$lib/volumes.js';
import { formatBookName } from '../../src/utils/formatting.js';
import { createTools } from '../core/tools.js';

/** Pull named top-level functions out of main.cjs and evaluate them together. */
function mainFunctions(names) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../electron/main.cjs'), 'utf8');
  const body = names.map((n) => {
    const start = src.indexOf(`\nfunction ${n}(`);
    if (start < 0) throw new Error(`main.cjs has no function ${n}`);
    // A top-level function ends at the first `}` in column 0 (bodies hold braces in strings).
    const end = src.indexOf('\n}', start + 1);
    return src.slice(start, end + 2);
  }).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${names.join(', ')} };`)();
}
const main = mainFunctions(['buildTranscriptionText', 'countStrokeLines', 'extractPageMeta', 'dayKeyLocal', 'extractCaptureDays']);

let root;
const t = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const stroke = (ms, x = 5, y = 5) => ({
  id: `s${ms}`, startTime: ms, endTime: ms + 400, lineId: null, points: [[x, y, ms, 200], [x + 4, y + 1, ms + 200, 200]]
});
const line = (id, text, indentLevel = 0) => ({ id, text, indentLevel, parentId: null, checked: null, yBounds: null });

/** The hybrid layout the app writes: shell pretty-printed, strokes last, one per line. */
function serialize(doc) {
  const { strokes, ...shell } = doc;
  const head = JSON.stringify(shell, null, 2).replace(/\n}$/, '');
  return `${head},\n  "strokes": [\n${strokes.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]\n}\n`;
}
function writePage(book, id, strokes, lines = []) {
  const dir = path.join(root, 'pages', `B${book}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P${id}.json`), serialize({
    version: '2.0',
    pageInfo: { section: 3, owner: 1, book: parseInt(book, 10), page: parseInt(id, 10) },
    metadata: { lastUpdated: '2026-01-01T00:00:00Z', totalStrokes: strokes.length, bounds: {} },
    transcript: { lastTranscribed: lines.length ? '2026-10-16T00:00:00Z' : null, lines },
    strokes
  }));
}

/** What the app's stores would hand runSearch for this folder. */
function appContext() {
  const pagesRoot = path.join(root, 'pages');
  const records = [];
  const timeline = { version: 1, pages: {} };
  for (const dir of fs.readdirSync(pagesRoot)) {
    const m = dir.match(/^B(\d+(?:v\d+)?)$/);
    if (!m) continue;
    for (const f of fs.readdirSync(path.join(pagesRoot, dir))) {
      const pm = f.match(/^P(\d+)([a-zA-Z]?)\.json$/);
      if (!pm) continue;
      const raw = fs.readFileSync(path.join(pagesRoot, dir, f), 'utf8');
      const page = parseInt(pm[1], 10), suffix = pm[2] || '', pageId = `${page}${suffix}`;
      records.push(metaToRecord({ book: m[1], page, pageId, suffix, ...main.extractPageMeta(raw) }));
      timeline.pages[`${m[1]}/${pageId}`] = { book: m[1], page, pageId, suffix, ...main.extractCaptureDays(raw) };
    }
  }
  const aliases = JSON.parse(fs.readFileSync(path.join(pagesRoot, '_aliases.json'), 'utf8'));
  const tags = normalizeTagsFile(JSON.parse(fs.readFileSync(path.join(pagesRoot, '_tags.json'), 'utf8'))).pages;
  const bookIds = [...new Set(records.map((r) => r.book))].sort(compareBookKeys);
  return {
    index: buildSearchIndex(records),
    notebooks: bookIds.map((book) => ({ book, name: formatBookName(book, aliases, 'alias-only') })),
    timeline,
    dates: pageDates(timeline),
    records: recordsByKey(records),
    tags: tagStats(tags)
  };
}

/** The comparable shape of a result set. */
const shape = (res) => ({
  order: res.order,
  pages: res.pages.map((p) => [p.key, p.score, p.snippet]),
  notebooks: res.notebooks.map((n) => [n.book, n.name, n.exact]),
  days: res.days.map((d) => [d.day, d.pages, d.strokes]),
  tags: res.tags.map((g) => [g.tag, g.pages, g.exact])
});
const mcpShape = (out) => ({
  order: out.order,
  pages: out.pages.map((p) => [p.page, p.score, p.snippet]),
  notebooks: out.notebooks.map((n) => [n.book, n.name, n.exact]),
  days: out.days.map((d) => [d.day, d.pages, d.strokes]),
  tags: out.tags.map((g) => [g.tag, g.pages, g.exact])
});

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-parity-'));
  writePage('388', '1', [stroke(t(2026, 10, 14, 9, 0)), stroke(t(2026, 10, 15, 8, 0))],
    [line('a', 'Beam check at grid 4'), line('b', 'footing sizes', 1), line('c', 'TODO call about P2026-141')]);
  writePage('388', '2', [stroke(t(2026, 10, 15, 10, 0)), stroke(t(2026, 10, 15, 10, 5)), stroke(t(2026, 10, 15, 10, 9))],
    [line('a', 'Beams and columns'), line('b', 'Notes for 2327-018')]);
  writePage('388', '12', [stroke(t(2026, 10, 15, 11, 0))]);               // untranscribed
  writePage('388v2', '151b', [stroke(t(2026, 10, 16, 7, 0))], [line('a', 'Footing beam review')]);
  writePage('390', '3', [stroke(t(2026, 10, 16, 9, 0))], [line('a', 'Reading log: chapter summary')]);
  writePage('3017', '42', [stroke(t(2026, 9, 30, 23, 59)), stroke(t(2026, 10, 1, 0, 0))], [line('a', 'Meeting with the owner')]);
  fs.writeFileSync(path.join(root, 'pages', '_aliases.json'), JSON.stringify({ 388: 'Field Book', 390: 'Reading Log', 3017: 'Lamy' }));
  fs.writeFileSync(path.join(root, 'pages', '_tags.json'), JSON.stringify({
    version: 1,
    pages: { '388/1': ['P2026-141', 'beam'], '388/2': ['2327-018'], '388v2/151b': ['P2026-141'], '390/9': ['orphan'] },
    dismissed: {}
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const QUERIES = [
  'beam', 'bea', 'BEAM', 'beam footing', 'footing beam', 'columns', 'notes', 'check',
  'P2026-141', 'p2026–141', '[[2327-018]]', '2327-018',
  'field', 'Field Book', 'reading log', '388v2', 'B390', '3017', 'lamy',
  '2026-10-15', 'Oct 15 2026', '10/15/2026', '15 October 2026', '2026-10-15 beam', 'Oct 1 2026', 'Sep 30 2026',
  'yesterday', 'today', 'x', 'zzz', 'orphan', '#beam'
];

describe('search parity with the app header search', () => {
  it.each(QUERIES)('%s', (q) => {
    const now = new Date();
    const app = runSearch(parseSearchQuery(q, { now }), appContext());
    const res = createTools(root).search({ query: q });
    if (!app.total && res.isError) return;
    const out = JSON.parse(res.content[0].text.split('\n')[1]);
    expect(mcpShape(out)).toEqual(shape(app));
  });
  it('the fixture exercises every group', () => {
    const ctx = appContext();
    const hits = (q) => runSearch(parseSearchQuery(q), ctx);
    expect(hits('beam').pages.length).toBeGreaterThan(1);
    expect(hits('2026-10-15').days).toHaveLength(1);
    expect(hits('2026-10-15').pages.map((p) => p.key)).toContain('388/12');   // untranscribed, found by date
    expect(hits('Field Book').notebooks.length).toBe(2);                     // inherited alias on the volume
    expect(hits('P2026-141').tags).toHaveLength(1);
  });
});
