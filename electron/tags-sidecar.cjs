/**
 * Page tags sidecar — `<dataRoot>/pages/_tags.json` (v3.1.0), the main-process
 * half. Pure: no fs, no Electron; main.cjs reads the file, calls these, and
 * writes the result atomically inside its tags lock.
 *
 *   { "version": 1,
 *     "pages":     { "<bookKey>/<pageId>": ["P2026-141", "beam"] },
 *     "dismissed": { "<bookKey>/<pageId>": ["2327-018"] } }
 *
 * The renderer owns the format (src/lib/tags.js normalizes every tag and works
 * out every edit); main applies a PATCH of whole per-page lists, read-merge-
 * write per call, so two quick edits to different pages can't overwrite each
 * other. Here a tag is only checked to be in normalized shape, and keys are
 * checked by main's own requireBookKey / requirePageId (passed in), so nothing
 * path-like or non-canonical ("388v1") is ever recorded.
 *
 * Read rules: a missing file is empty; a corrupt one reads as empty and is NOT
 * rewritten by a read (the first successful write replaces it); a file from a
 * newer version is read but never rewritten. Unknown top-level fields survive
 * a write.
 *
 * Tested in src/lib/__tests__/tags-sidecar.test.js.
 */
'use strict';

const TAGS_VERSION = 1;

/** A tag as src/lib/tags.js normalizes it: a project number or a keyword. */
const TAG_SHAPE = /^(?:P?\d{4}-\d{3}|[a-z0-9_-]{1,40})$/;

/** Upper bound on one page's list; far above any real use. */
const MAX_TAGS_PER_LIST = 200;

const SECTIONS = ['pages', 'dismissed'];

function emptyTagsFile() {
  return { version: TAGS_VERSION, pages: {}, dismissed: {} };
}

const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/**
 * The file's text (null when missing) → `{ file, state }`.
 * state: 'missing' | 'ok' | 'corrupt' | 'newer'.
 */
function parseTagsFile(text) {
  if (text == null) return { file: emptyTagsFile(), state: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { file: emptyTagsFile(), state: 'corrupt' };
  }
  if (!plainObject(parsed)) return { file: emptyTagsFile(), state: 'corrupt' };
  const version = Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : TAGS_VERSION;
  const file = {
    ...parsed,
    version,
    pages: plainObject(parsed.pages) || {},
    dismissed: plainObject(parsed.dismissed) || {}
  };
  return { file, state: version > TAGS_VERSION ? 'newer' : 'ok' };
}

/** `"388v2/151b"` → the same key, validated by main's book-key and page-id guards. */
function checkKey(key, { requireBookKey, requirePageId }) {
  const s = String(key);
  const slash = s.lastIndexOf('/');
  if (slash <= 0) throw new Error(`Invalid page key: ${key}`);
  return `${requireBookKey(s.slice(0, slash))}/${requirePageId(s.slice(slash + 1))}`;
}

/** A patch value: null (remove) or a list of normalized tags. */
function checkList(list, key) {
  if (list === null) return null;
  if (!Array.isArray(list)) throw new Error(`Invalid tag list for ${key}`);
  if (list.length > MAX_TAGS_PER_LIST) throw new Error(`Too many tags for ${key}`);
  for (const t of list) {
    if (typeof t !== 'string' || !TAG_SHAPE.test(t)) throw new Error(`Invalid tag for ${key}: ${String(t).slice(0, 50)}`);
  }
  return [...new Set(list)];
}

/**
 * Apply `{ pages?: {key: tags[]|null}, dismissed?: {key: tags[]|null} }` to a
 * file, returning a new file. Everything is validated before anything is
 * applied, so a bad entry rejects the whole patch (nothing is written).
 * An empty list removes the entry, as null does.
 */
function applyTagsPatch(file, patch, guards) {
  const p = plainObject(patch);
  if (!p) throw new Error('Invalid tags patch');
  const checked = [];
  for (const section of SECTIONS) {
    if (p[section] == null) continue;
    const entries = plainObject(p[section]);
    if (!entries) throw new Error(`Invalid tags patch: ${section}`);
    for (const key of Object.keys(entries)) {
      checked.push([section, checkKey(key, guards), checkList(entries[key], key)]);
    }
  }
  const next = { ...file, pages: { ...(file.pages || {}) }, dismissed: { ...(file.dismissed || {}) } };
  for (const [section, key, list] of checked) {
    if (list && list.length) next[section][key] = list;
    else delete next[section][key];
  }
  return next;
}

function serializeTagsFile(file) {
  return JSON.stringify(file, null, 2);
}

module.exports = {
  TAGS_VERSION,
  TAG_SHAPE,
  emptyTagsFile,
  parseTagsFile,
  applyTagsPatch,
  serializeTagsFile
};
