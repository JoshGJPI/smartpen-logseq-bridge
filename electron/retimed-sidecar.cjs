/**
 * Retimed-stroke sidecar — `<dataRoot>/pages/_retimed.json` (v3.6.0), the
 * main-process half. Pure: no fs, no Electron; main.cjs reads the file, calls
 * these, and writes the result atomically inside its retimed lock.
 *
 *   { "version": 1,
 *     "pages": { "<ncodeBook>/<page>": { "s<penId>": "s<idNow>" } } }
 *
 * WHY IT EXISTS. A stroke's id is its start time (`s{startTime}`), so retiming
 * a stroke in the Editor changes its id: the save deletes the old id and
 * appends the new one. The pen's memory still holds the stroke at its ORIGINAL
 * time, though, and offline import dedupes by id, so importing it again would
 * add it back as a duplicate at the old time. This file remembers every pen id
 * that was retimed away, per physical page, and import drops those strokes.
 *
 * Keyed by the NCode book and the integer page (the paper the pen saw), not by
 * the book key: volumes share their book's paper, and a stroke's pen id is the
 * same whichever volume it was filed under.
 *
 * Chains collapse: retiming `s1 → s2` and later `s2 → s3` leaves `s1 → s3`,
 * because the key is always the id the PEN knows. A retime back to the pen id
 * removes the entry (the pen copy would dedupe again).
 *
 * Read rules match `_tags.json`: a missing file is empty; a corrupt one reads
 * as empty and is replaced by the next write; a file from a newer version is
 * read but never rewritten. Unknown top-level fields survive a write.
 *
 * Tested in src/lib/__tests__/retimed-sidecar.test.js.
 */
'use strict';

const RETIMED_VERSION = 1;

/** `"388/41"`: NCode book number, slash, integer page. */
const PAGE_KEY_SHAPE = /^\d+\/\d+$/;

/** A stroke id: `s` + integer ms. */
const STROKE_ID_SHAPE = /^s-?\d+$/;

/** Upper bound on one patch; far above any real selection. */
const MAX_ENTRIES_PER_PATCH = 100000;

function emptyRetimedFile() {
  return { version: RETIMED_VERSION, pages: {} };
}

const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/**
 * The file's text (null when missing) → `{ file, state }`.
 * state: 'missing' | 'ok' | 'corrupt' | 'newer'.
 */
function parseRetimedFile(text) {
  if (text == null) return { file: emptyRetimedFile(), state: 'missing' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { file: emptyRetimedFile(), state: 'corrupt' };
  }
  if (!plainObject(parsed)) return { file: emptyRetimedFile(), state: 'corrupt' };
  const version = Number.isInteger(parsed.version) && parsed.version > 0 ? parsed.version : RETIMED_VERSION;
  const pages = {};
  for (const [key, map] of Object.entries(plainObject(parsed.pages) || {})) {
    if (!PAGE_KEY_SHAPE.test(key) || !plainObject(map)) continue;
    const clean = {};
    for (const [from, to] of Object.entries(map)) {
      if (STROKE_ID_SHAPE.test(from) && typeof to === 'string' && STROKE_ID_SHAPE.test(to)) clean[from] = to;
    }
    if (Object.keys(clean).length) pages[key] = clean;
  }
  const file = { ...parsed, version, pages };
  return { file, state: version > RETIMED_VERSION ? 'newer' : 'ok' };
}

/**
 * Record retimes: `[{ page: "388/41", from: "s<old>", to: "s<new>" }]`, where
 * `from` is the id on disk before the save and `to` the id after. Returns a new
 * file. Everything is validated first, so one bad entry rejects the whole patch.
 */
function applyRetimes(file, entries) {
  if (!Array.isArray(entries)) throw new Error('Invalid retimed patch');
  if (entries.length > MAX_ENTRIES_PER_PATCH) throw new Error('Retimed patch too large');
  for (const e of entries) {
    if (!plainObject(e)) throw new Error('Invalid retimed entry');
    if (!PAGE_KEY_SHAPE.test(String(e.page))) throw new Error(`Invalid page key: ${String(e.page).slice(0, 40)}`);
    if (!STROKE_ID_SHAPE.test(String(e.from)) || !STROKE_ID_SHAPE.test(String(e.to))) {
      throw new Error(`Invalid stroke id in retimed entry for ${e.page}`);
    }
  }

  const pages = {};
  for (const [k, v] of Object.entries(file.pages || {})) pages[k] = { ...v };

  for (const { page, from, to } of entries) {
    if (from === to) continue;
    const map = pages[page] || (pages[page] = {});
    // Is `from` itself a retimed id? Then the pen knows the stroke by the key
    // that maps to it, and that key now maps to `to`.
    const penIds = Object.keys(map).filter((k) => map[k] === from);
    if (penIds.length === 0) penIds.push(from);
    for (const penId of penIds) {
      if (penId === to) delete map[penId];   // back where the pen put it
      else map[penId] = to;
    }
    if (Object.keys(map).length === 0) delete pages[page];
  }
  return { ...file, pages };
}

function serializeRetimedFile(file) {
  return JSON.stringify(file, null, 2);
}

module.exports = {
  RETIMED_VERSION,
  PAGE_KEY_SHAPE,
  STROKE_ID_SHAPE,
  emptyRetimedFile,
  parseRetimedFile,
  applyRetimes,
  serializeRetimedFile
};
