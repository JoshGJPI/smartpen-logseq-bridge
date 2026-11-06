/**
 * book-types — notebook types (v3.15.0): "Work", "Personal", … one per notebook,
 * and the type filter the Library home and the date features share.
 *
 * Stored in `<dataRoot>/pages/_book-types.json`, keyed by BOOK KEY like
 * `_aliases.json`:
 *
 *   { "version": 1, "books": { "388": "Work", "3017": "Personal" } }
 *
 * A volume with no type of its own takes volume 1's (`bookTypeOf`), so starting
 * Volume 2 of a work notebook keeps it a work notebook without a trip to the
 * Books tab. Types are free text, compared without case ("work" = "Work"), and
 * the first spelling seen is the one listed. Display metadata only: never in a
 * PageDoc. The file is written by main (`electron/book-types-sidecar.cjs`).
 *
 * Pure: no DOM, no stores, no I/O. Tested in `src/lib/__tests__/book-types.test.js`.
 */

import { parseBookKey, makeBookKey } from './volumes.js';

export const BOOK_TYPES_VERSION = 1;

/** Longest type kept; main enforces the same bound. */
export const MAX_TYPE_LENGTH = 40;

/** The filter value for "notebooks with no type". Reserved: never a type (normalizeBookType). */
export const NO_TYPE = '__none__';

/** localStorage key for the type filter (a per-viewer preference, like the book filter). */
export const TYPE_FILTER_KEY = 'smartpen-book-type-filter';

/** Trimmed, inner whitespace collapsed, capped; '' / non-string → null (no type). */
export function normalizeBookType(value) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim().slice(0, MAX_TYPE_LENGTH).trim();
  return t && t !== NO_TYPE ? t : null;
}

/** Case-insensitive identity for comparing and de-duplicating types. */
export const typeId = (t) => (normalizeBookType(t) || '').toLocaleLowerCase();

const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/**
 * A parsed sidecar (or anything) → `{ book key: type }`, keeping only canonical
 * book keys and non-empty types. Never throws.
 */
export function normalizeBookTypes(raw) {
  const books = plain(plain(raw)?.books) || {};
  const out = {};
  for (const [k, v] of Object.entries(books)) {
    const t = normalizeBookType(v);
    if (parseBookKey(k) && t) out[k] = t;
  }
  return out;
}

/**
 * A notebook's type: its own, else its volume 1's, else null.
 * @param {string} bookKey
 * @param {Record<string, string>} types
 */
export function bookTypeOf(bookKey, types) {
  if (!types) return null;
  const key = String(bookKey);
  if (types[key]) return types[key];
  const parsed = parseBookKey(key);
  if (parsed && parsed.volume > 1) return types[makeBookKey(parsed.ncodeBook, 1)] || null;
  return null;
}

/** Whether `bookKey`'s type is only inherited from volume 1. */
export function isInheritedType(bookKey, types) {
  return !!types && !types[String(bookKey)] && bookTypeOf(bookKey, types) != null;
}

/** Every type in use, one spelling each, sorted by name. */
export function typeNames(types) {
  const seen = new Map();
  for (const t of Object.values(types || {})) {
    const id = typeId(t);
    if (id && !seen.has(id)) seen.set(id, t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * The spelling to store for `value`: an existing type's when it differs only in
 * case (so "work" joins "Work" rather than starting a second type), else as typed.
 */
export function canonicalType(value, types) {
  const t = normalizeBookType(value);
  if (!t) return null;
  return typeNames(types).find((n) => typeId(n) === typeId(t)) || t;
}

/** A stored filter value → a type name, NO_TYPE, or null (all notebooks). */
export function parseTypeFilter(raw) {
  if (raw === NO_TYPE) return NO_TYPE;
  return normalizeBookType(raw);
}

/**
 * Whether a notebook passes the type filter. A filter naming a type nobody uses
 * any more passes nothing, which the UI shows (and offers to clear) rather than
 * silently dropping it.
 */
export function matchesTypeFilter(bookKey, filter, types) {
  if (!filter) return true;
  const t = bookTypeOf(bookKey, types);
  if (filter === NO_TYPE) return t == null;
  return t != null && typeId(t) === typeId(filter);
}

/**
 * The book keys the type filter leaves out, for the date features (which filter
 * the index by exclusion). Empty set when there's no filter.
 * @param {Iterable<string>} bookKeys
 */
export function booksOutsideType(bookKeys, filter, types) {
  const out = new Set();
  if (!filter) return out;
  for (const b of bookKeys || []) {
    if (!matchesTypeFilter(b, filter, types)) out.add(String(b));
  }
  return out;
}

/** "Work", "No type" or "All types": the filter as a label. */
export function typeFilterLabel(filter) {
  if (!filter) return 'All types';
  return filter === NO_TYPE ? 'No type' : filter;
}
