/**
 * relink-cache — MyScript runs kept for Relink (v3.21.0, spec B.5):
 * `<userData>/relink-cache/<bookKey>/<pageId>.json`, one entry per page, never
 * in the data folder. An entry holds the run (lines with yBounds, the sent
 * stroke ids, batch origin, rotation) and the page's `metadata.lastUpdated` at
 * the time (`revision`), so closing the app between the bulk run and the review
 * doesn't pay for the request twice. The renderer decides whether an entry
 * still fits the page (lib/relink.js `cachedRunValid`); a page written since
 * is sent again.
 *
 * Pure Node (tested from Vitest with a temp dir); `handle()` is the one IPC
 * entry point main wires to 'relink:cache'.
 */
const fs = require('fs');
const path = require('path');
const { renameRetry } = require('./mcp-edit-log.cjs');

const BOOK_RE = /^\d+(?:v\d+)?$/;
const PAGE_RE = /^\d+[a-zA-Z]?$/;

function cacheDir(userDataDir) {
  return path.join(userDataDir, 'relink-cache');
}

function entryFile(userDataDir, book, page) {
  if (!BOOK_RE.test(String(book))) throw new Error(`Invalid book key: ${book}`);
  if (!PAGE_RE.test(String(page))) throw new Error(`Invalid page id: ${page}`);
  // Lowercase: Windows file names ignore case, so 151b and 151B are one file anyway.
  return path.join(cacheDir(userDataDir), String(book).toLowerCase(), `${String(page).toLowerCase()}.json`);
}

function readEntry(userDataDir, book, page) {
  let text;
  try {
    text = fs.readFileSync(entryFile(userDataDir, book, page), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null; // corrupt: a miss, replaced by the next put
  }
}

function writeEntry(userDataDir, book, page, entry) {
  const file = entryFile(userDataDir, book, page);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  renameRetry(tmp, file);
}

/**
 * @param {string} userDataDir
 * @param {'get'|'put'|'drop'} action
 * @param {string} book  book key ("388", "388v2")
 * @param {string} page  page id ("42", "151b")
 * @param {object} [entry]  put: the entry (must carry `revision`)
 * @returns {object|null|boolean} get: the entry or null; put: true; drop: whether one was removed
 */
function handle(userDataDir, action, book, page, entry) {
  switch (action) {
    case 'get':
      return readEntry(userDataDir, book, page);
    case 'put':
      if (!entry || typeof entry !== 'object' || !entry.revision) throw new Error('put needs an entry with a revision');
      writeEntry(userDataDir, book, page, entry);
      return true;
    case 'drop':
      try {
        fs.unlinkSync(entryFile(userDataDir, book, page));
        return true;
      } catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
      }
    default:
      throw new Error(`Unknown relink-cache action: ${action}`);
  }
}

module.exports = { cacheDir, entryFile, readEntry, handle };
