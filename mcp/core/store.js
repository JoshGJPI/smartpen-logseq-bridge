/**
 * Node-side page scan and page reads. Read-only: only readdir / stat / readFile.
 *
 * The scan holds summary records and a per-page capture-day histogram (the same
 * shape as `_timeline.json`, built here in memory so the cache file is never
 * needed or touched). PageDocs are parsed once per (mtime, size) and the strokes
 * are dropped again; strokes are loaded lazily by getPage().
 */
import fs from 'node:fs';
import path from 'node:path';
import { pagesDir, pagePath, requireBookKey, requirePageId } from './paths.js';
import { readAliases, readVolumes, readOrientations, readTags } from './sidecars.js';
import { parseBookKey, compareBookKeys, BOOK_DIR_RE } from '../../src/lib/volumes.js';
import { dayKey } from '../../src/lib/timeline.js';

const PAGE_FILE_RE = /^P(\d+)([a-zA-Z]?)\.json$/;

function transcriptText(doc) {
  const lines = (doc.transcript && doc.transcript.lines) || [];
  return lines.map((l) => `${'  '.repeat(l.indentLevel || 0)}${l.text || ''}`).join('\n');
}

function summarize(doc, f, st) {
  const strokes = Array.isArray(doc.strokes) ? doc.strokes : [];
  const days = {};
  let first = null, last = null;
  for (const s of strokes) {
    const t = Number(s && s.startTime);
    if (!Number.isFinite(t) || t <= 0) continue;
    const k = dayKey(t);
    days[k] = (days[k] || 0) + 1;
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }
  const lines = (doc.transcript && doc.transcript.lines) || [];
  return {
    book: f.book, page: f.page, pageId: f.pageId, suffix: f.suffix,
    mtimeMs: st.mtimeMs, size: st.size,
    strokes: strokes.length,
    days, firstStroke: first, lastStroke: last,
    lastUpdated: (doc.metadata && doc.metadata.lastUpdated) || null,
    lastTranscribed: (doc.transcript && doc.transcript.lastTranscribed) || null,
    lineCount: lines.length,
    text: transcriptText(doc)
  };
}

export class Store {
  constructor(root) {
    this.root = root;
    this.cache = new Map();   // "<book>/<pageId>" -> summary
  }

  /** Every page file on disk, sorted book (compareBookKeys), page, suffix. */
  walk() {
    const dir = pagesDir(this.root);
    const files = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(BOOK_DIR_RE);
      if (!m || !parseBookKey(m[1])) continue;
      let pf = [];
      try { pf = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true }); } catch { continue; }
      for (const f of pf) {
        const pm = f.isFile() && f.name.match(PAGE_FILE_RE);
        if (!pm) continue;
        const page = parseInt(pm[1], 10);
        const suffix = pm[2] || '';
        files.push({ book: m[1], page, suffix, pageId: `${page}${suffix}`, path: path.join(dir, e.name, f.name) });
      }
    }
    files.sort((a, b) => compareBookKeys(a.book, b.book) || a.page - b.page || a.suffix.localeCompare(b.suffix));
    return files;
  }

  /** Refresh the summaries (one stat per page; reparse only what changed). */
  scan() {
    const files = this.walk();
    const seen = new Set();
    for (const f of files) {
      const key = `${f.book}/${f.pageId}`;
      seen.add(key);
      let st;
      try { st = fs.statSync(f.path); } catch { continue; }
      const c = this.cache.get(key);
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) continue;
      try {
        const doc = JSON.parse(fs.readFileSync(f.path, 'utf8'));
        this.cache.set(key, summarize(doc, f, st));
      } catch {
        this.cache.delete(key);   // unreadable / half-written: skip, retry next call
      }
    }
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
    const pages = [...this.cache.values()].sort(
      (a, b) => compareBookKeys(a.book, b.book) || a.page - b.page || a.suffix.localeCompare(b.suffix)
    );
    return {
      pages,
      // The `_timeline.json` shape that lib/timeline.js consumes.
      index: { version: 1, pages: Object.fromEntries(pages.map((p) => [`${p.book}/${p.pageId}`, p])) },
      aliases: readAliases(this.root),
      volumes: readVolumes(this.root),
      orientations: readOrientations(this.root),
      tags: readTags(this.root).pages
    };
  }

  /** One full PageDoc (with strokes) or null. Path-guarded. */
  getPage(book, page) {
    const p = pagePath(this.root, requireBookKey(book), requirePageId(page));
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      return doc && typeof doc === 'object' ? doc : null;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
}

/** Display name for a book key: alias, else "Book 388" / "Book 388 v2". */
export function bookName(aliases, book) {
  if (aliases[book]) return aliases[book];
  const b = parseBookKey(book);
  return b ? `Book ${b.ncodeBook}${b.volume > 1 ? ` v${b.volume}` : ''}` : `Book ${book}`;
}
