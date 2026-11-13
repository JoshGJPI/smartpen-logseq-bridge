/**
 * The page store, main-process half: book keys and path guards, the atomic
 * write, per-file locks, the PageDoc serializer, page read / write / delete and
 * the page-file walk. (The metadata scan and the capture-date index stay in
 * main.cjs, where the MCP's parity tests lift them from.) Node only (fs, path), no Electron, so Vitest can run it
 * against a temp folder (src/lib/__tests__/page-store.test.js).
 *
 * One JSON file per pen page at <dataRoot>/pages/B{bookKey}/P{pageId}.json.
 * See docs/LOCAL-STORAGE-PIVOT-SPEC.md for the design.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs').promises;

// ----- Book keys (volumes) -----
// A book key is the NCode book id plus an optional volume suffix: "388", "388v2".
// Volume 1 is spelled bare, so every pre-volume path is unchanged.
//
// Mirrors src/lib/volumes.js. Main is CommonJS and can't import the ESM module.
// Keep the two in step; volumes.js is the authority (page-store.test.js
// compares them).
const BOOK_KEY_RE = /^(\d+)(?:v(\d+))?$/;

function parseBookKey(bookKey) {
  if (bookKey == null || bookKey === '') return null;
  const raw = String(bookKey);
  const m = raw.match(BOOK_KEY_RE);
  if (!m) return null;
  const ncodeBook = Number(m[1]);
  const volume = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isInteger(ncodeBook) || !Number.isInteger(volume) || volume < 1) return null;
  // Canonical-form check: one spelling per physical notebook.
  const canonical = volume === 1 ? String(ncodeBook) : `${ncodeBook}v${volume}`;
  return canonical === raw ? { ncodeBook, volume } : null;
}

function compareBookKeys(a, b) {
  const pa = parseBookKey(a);
  const pb = parseBookKey(b);
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return 1;
  if (!pb) return -1;
  return (pa.ncodeBook - pb.ncodeBook) || (pa.volume - pb.volume);
}

/**
 * Validate a book key before it reaches a filesystem path.
 *
 * `book` used to arrive here via parseInt and was inherently path-safe. As a
 * string it is not, so this guard is what keeps page reads and writes inside the
 * data root.
 */
function requireBookKey(book) {
  if (!parseBookKey(book)) throw new Error(`Invalid book key: ${book}`);
  return String(book);
}

const PAGE_ID_RE = /^\d+[a-zA-Z]?$/;

/** Page ids are digits plus an optional single letter: "42", "151b". */
function requirePageId(page) {
  const pid = String(page);
  if (!PAGE_ID_RE.test(pid)) throw new Error(`Invalid page id: ${page}`);
  return pid;
}

// ----- Paths -----

function pagesDir(root) {
  return path.join(root, 'pages');
}

function bookDir(root, book) {
  return path.join(pagesDir(root), `B${requireBookKey(book)}`);
}

function pagePath(root, book, page) {
  return path.join(bookDir(root, book), `P${requirePageId(page)}.json`);
}

/** A sidecar beside the book folders, e.g. sidecarPath(root, '_tags.json'). */
function sidecarPath(root, name) {
  return path.join(pagesDir(root), name);
}

// ----- Atomic write -----

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

// Windows: a rename onto a file that an indexer, antivirus or sync client has
// open for a moment fails with EPERM / EACCES / EBUSY. Retry briefly rather
// than fail the save.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [20, 60, 150, 400];

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!RENAME_RETRY_CODES.has(err.code) || delay === undefined) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// The write in flight per target path (see writeFileAtomic).
const pathChains = new Map();

/**
 * Atomic write: write to a unique .tmp sibling, fsync, then rename over the
 * target. A failure at any step removes the temp file and leaves the target as
 * it was.
 *
 * Writes to one path run one at a time (in call order, so the last call wins):
 * on Windows, overlapping renames onto one file fail with EPERM however long
 * they retry. Different paths still write in parallel.
 */
function writeFileAtomic(filePath, contents) {
  const key = path.resolve(filePath);
  const lockKey = process.platform === 'win32' ? key.toLowerCase() : key;
  const prev = pathChains.get(lockKey) || Promise.resolve();
  const run = prev.then(() => writeFileAtomicNow(filePath, contents));
  const settled = run.catch(() => {});
  pathChains.set(lockKey, settled);
  settled.then(() => {
    if (pathChains.get(lockKey) === settled) pathChains.delete(lockKey);
  });
  return run;
}

async function writeFileAtomicNow(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  // Random, not just pid + time: two writes to one file in the same
  // millisecond must not share a temp file.
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(contents, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * A promise chain that runs read-modify-write updates of one file one at a
 * time: two overlapping updates would each read the file before the other
 * wrote it, and the first would be lost. A failed update doesn't stop the next.
 */
function createLock() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

// ----- PageDoc text -----

/**
 * Hybrid serializer: pretty-prints the doc shell but inlines each stroke onto
 * one line. Cuts file size ~60% versus full pretty-print while keeping the
 * structure human-readable and per-stroke diffs intact.
 *
 * Mirrors src/lib/storage/page-doc-format.js (the graph export's copy); the
 * two must produce identical text (page-store.test.js).
 */
function serializePageDoc(doc) {
  const { strokes, ...shell } = doc || {};
  const shellPretty = JSON.stringify(shell, null, 2);
  const closingBrace = shellPretty.lastIndexOf('}');
  const head = shellPretty.slice(0, closingBrace).trimEnd();
  // An empty shell leaves just "{", which takes no comma.
  const headWithComma = (head === '{' || head.endsWith(',')) ? head : head + ',';
  const strokeLines = (strokes || []).map(s => '    ' + JSON.stringify(s));
  const strokesBlock = strokeLines.length === 0
    ? '  "strokes": []'
    : '  "strokes": [\n' + strokeLines.join(',\n') + '\n  ]';
  return headWithComma + '\n' + strokesBlock + '\n}\n';
}

// ----- Page files -----

async function readPageDoc(root, book, page) {
  const fp = pagePath(root, book, page);
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writePageDoc(root, book, page, doc) {
  // The renderer validates the full PageDoc (validatePageDoc); this only stops
  // a non-object from being serialized into a broken file.
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('savePage: the page document is missing');
  }
  const fp = pagePath(root, book, page);
  await writeFileAtomic(fp, serializePageDoc(doc));
  return fp;
}

async function deletePageDoc(root, book, page) {
  const fp = pagePath(root, book, page);
  try {
    await fsp.unlink(fp);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Walk pages/B*\/P*.json and return one entry per page FILE, without reading any
 * of them.
 *
 * Shared by main.cjs listAllPages (which then reads each file for metadata) and
 * buildTimeline (which stats first and re-reads only what changed), so the two
 * can never disagree about which files are pages.
 *
 * @returns {Promise<Array<{book:string, page:number, pageId:string, suffix:string, path:string}>>}
 */
async function walkPageFiles(root) {
  const dir = pagesDir(root);
  let bookDirs;
  try {
    bookDirs = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const files = [];
  for (const entry of bookDirs) {
    if (!entry.isDirectory()) continue;
    // Book KEY, not a number: "388" or "388v2" (see parseBookKey). A bare
    // `^B(\d+)$` here would make every volume directory invisible to the scan.
    const m = entry.name.match(/^B(\d+(?:v\d+)?)$/);
    if (!m || !parseBookKey(m[1])) continue;
    const book = m[1];
    const bookPath = path.join(dir, entry.name);

    let pageFiles;
    try {
      pageFiles = await fsp.readdir(bookPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const pf of pageFiles) {
      if (!pf.isFile()) continue;
      // Accept "P42.json" and letter-suffixed forms like "P151b.json"
      const pm = pf.name.match(/^P(\d+)([a-zA-Z]?)\.json$/);
      if (!pm) continue;
      const page = parseInt(pm[1], 10);
      const suffix = pm[2] || '';
      files.push({
        book,
        page,
        pageId: `${page}${suffix}`,  // includes suffix if any (primary identifier)
        suffix,
        path: path.join(bookPath, pf.name)
      });
    }
  }

  // compareBookKeys, not `a.book - b.book`: book is a key string, and
  // subtraction on it yields NaN (which leaves the sort order arbitrary).
  files.sort((a, b) =>
    compareBookKeys(a.book, b.book) || (a.page - b.page) || a.suffix.localeCompare(b.suffix)
  );
  return files;
}

/**
 * Read a small JSON sidecar. Missing → `parsed: null`. Unparseable → also null,
 * with `corrupt: true`: like _tags.json, a corrupt file reads as empty rather
 * than breaking every feature that reads it. With `forWrite`, a corrupt file is
 * first copied aside (`<file>.corrupt-<ms>`) so the write that replaces it
 * doesn't destroy what could still be recovered by hand.
 */
async function readSidecarJson(file, { forWrite = false } = {}) {
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { parsed: null, corrupt: false };
    throw err;
  }
  try {
    return { parsed: JSON.parse(raw), corrupt: false };
  } catch (err) {
    console.warn(`[storage] ${path.basename(file)} is unreadable (${err.message}); reading it as empty`);
    if (forWrite) {
      const copy = `${file}.corrupt-${Date.now()}`;
      await fsp.copyFile(file, copy);
      console.warn(`[storage] kept the unreadable file as ${path.basename(copy)} before replacing it`);
    }
    return { parsed: null, corrupt: true };
  }
}

module.exports = {
  parseBookKey,
  compareBookKeys,
  requireBookKey,
  requirePageId,
  pagesDir,
  bookDir,
  pagePath,
  sidecarPath,
  writeFileAtomic,
  createLock,
  readSidecarJson,
  serializePageDoc,
  readPageDoc,
  writePageDoc,
  deletePageDoc,
  walkPageFiles,
};
