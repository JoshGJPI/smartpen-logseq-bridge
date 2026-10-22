/**
 * Test helpers: build a synthetic data folder, and read it back the way the app
 * does (for parity tests). Synthetic data only.
 *
 * main.cjs is not importable outside Electron, so its pure scan functions are
 * lifted out of the source and evaluated together, with the helpers it
 * require()s handed in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { metaToRecord } from '../../src/lib/storage/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Pull named top-level functions out of main.cjs and evaluate them together. */
export function mainFunctions(names) {
  const src = fs.readFileSync(path.resolve(here, '../../electron/main.cjs'), 'utf8');
  const body = names.map((n) => {
    const start = src.indexOf(`\nfunction ${n}(`);
    if (start < 0) throw new Error(`main.cjs has no function ${n}`);
    // A top-level function ends at the first `}` in column 0 (bodies hold braces in strings).
    const end = src.indexOf('\n}', start + 1);
    return src.slice(start, end + 2);
  }).join('\n');
  const { buildTaskSummary } = createRequire(import.meta.url)('../../electron/task-summary.cjs');
  // eslint-disable-next-line no-new-func
  return new Function('buildTaskSummary', `${body}\nreturn { ${names.join(', ')} };`)(buildTaskSummary);
}

const main = mainFunctions(['buildTranscriptionText', 'countStrokeLines', 'extractPageMeta', 'dayKeyLocal', 'extractCaptureDays']);

/** The hybrid layout the app writes: shell pretty-printed, strokes last, one per line. */
export function serialize(doc) {
  const { strokes, ...shell } = doc;
  const head = JSON.stringify(shell, null, 2).replace(/\n}$/, '');
  return `${head},\n  "strokes": [\n${strokes.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ]\n}\n`;
}

export function writePage(root, book, id, strokes, lines = []) {
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

/**
 * The scan records and `_timeline.json` index the app would hold for this
 * folder: main.cjs extractPageMeta / extractCaptureDays per page file, records
 * through scan.js metaToRecord().
 */
export function appScan(root) {
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
  return { records, timeline };
}
