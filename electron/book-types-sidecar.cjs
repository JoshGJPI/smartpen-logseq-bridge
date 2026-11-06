/**
 * Notebook types sidecar — `<dataRoot>/pages/_book-types.json` (v3.15.0), the
 * main-process half. Pure: no fs, no Electron; main.cjs reads the file, calls
 * these, and writes the result atomically inside its own lock.
 *
 *   { "version": 1, "books": { "388": "Work", "3017": "Personal" } }
 *
 * The renderer owns what a type is (src/lib/book-types.js normalizes it and
 * picks the spelling); main only checks the shape and applies one book's
 * change per call, read-merge-write. Book keys go through main's own
 * requireBookKey (passed in).
 *
 * Read rules, as for _tags.json: a missing file is empty; a corrupt one reads
 * as empty and is replaced by the next write; a file from a newer version is
 * read but never rewritten. Unknown top-level fields survive a write.
 *
 * Tested in src/lib/__tests__/book-types-sidecar.test.js.
 */
'use strict';

const BOOK_TYPES_VERSION = 1;
const MAX_TYPE_LENGTH = 40;

function emptyBookTypesFile() {
  return { version: BOOK_TYPES_VERSION, books: {} };
}

const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** The file's text (null when missing) → `{ file, state }`; state 'missing' | 'ok' | 'corrupt' | 'newer'. */
function parseBookTypesFile(text) {
  if (text == null) return { file: emptyBookTypesFile(), state: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { file: emptyBookTypesFile(), state: 'corrupt' };
  }
  if (!plainObject(parsed)) return { file: emptyBookTypesFile(), state: 'corrupt' };
  const version = Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : BOOK_TYPES_VERSION;
  const file = { ...parsed, version, books: plainObject(parsed.books) || {} };
  return { file, state: version > BOOK_TYPES_VERSION ? 'newer' : 'ok' };
}

/**
 * Set (a string) or clear (null / '') one notebook's type, returning a new file.
 * Throws on a bad key or a type that isn't a short single-line string.
 */
function applyBookType(file, book, type, { requireBookKey }) {
  const key = requireBookKey(book);
  if (type != null && typeof type !== 'string') throw new Error(`Invalid notebook type for ${key}`);
  const t = type == null ? '' : type;
  if (t.length > MAX_TYPE_LENGTH || /[\r\n\t]/.test(t) || t !== t.trim()) {
    throw new Error(`Invalid notebook type for ${key}`);
  }
  const books = { ...(file.books || {}) };
  if (t) books[key] = t;
  else delete books[key];
  return { ...file, books };
}

function serializeBookTypesFile(file) {
  return JSON.stringify(file, null, 2);
}

module.exports = {
  BOOK_TYPES_VERSION,
  MAX_TYPE_LENGTH,
  emptyBookTypesFile,
  parseBookTypesFile,
  applyBookType,
  serializeBookTypesFile
};
