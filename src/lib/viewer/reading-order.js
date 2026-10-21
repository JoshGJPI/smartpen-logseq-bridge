/**
 * reading-order — the Library reader's Book | Tag order (v3.2.0). Pure: no
 * DOM, no stores.
 *
 * Opening a page from a tag's pages, the Untagged pages, or a page grid with
 * a tag filter on hands the reader a *sequence*: the page keys that grid was
 * showing, in reading order (notebook, then page). In Tag order ←/→ and the
 * spread walk that sequence across notebooks; in Book order they walk the open
 * page's notebook, as before. The sequence is a snapshot taken at the click,
 * so retagging a page while reading it never pulls it out from under you;
 * keys whose page has gone since (deleted, moved) are skipped.
 *
 * Tested in `src/lib/__tests__/reading-order.test.js`.
 */

import { compareRecords, recordTagKey } from '../tags.js';
import { pageIdOf } from './page-reader.js';

/** @typedef {{kind: 'notebook', book: string}|{kind: 'tag', tag: string}|{kind: 'untagged'}} SequenceOrigin */
/** @typedef {{keys: string[], chosen: string[], mode: 'any'|'all', origin: SequenceOrigin}} ReadingSequence */

export const READING_ORDERS = ['book', 'tag'];

/**
 * The sequence a page grid hands the reader, or null when Tag order would be
 * the same as Book order (one notebook's grid with no tag filter).
 *
 * @param {{records: object[], origin: SequenceOrigin, chosen?: string[], mode?: 'any'|'all'}} grid
 *        records: the pages the grid is showing (after its filter)
 * @returns {ReadingSequence|null}
 */
export function buildSequence({ records, origin, chosen = [], mode = 'any' }) {
  if (!origin) return null;
  if (origin.kind === 'notebook' && !chosen.length) return null;
  const keys = [...(records || [])].sort(compareRecords).map(recordTagKey).filter(Boolean);
  if (!keys.length) return null;
  return { keys, chosen: [...chosen], mode: mode === 'all' ? 'all' : 'any', origin };
}

/**
 * The sequence's pages that still exist, in sequence order.
 * @param {ReadingSequence|null} sequence
 * @param {Map<string, object>} records  `recordsByKey` (the `searchRecords` store)
 */
export function sequenceRecords(sequence, records) {
  if (!sequence || !records) return [];
  const out = [];
  for (const k of sequence.keys) {
    const r = records.get(k);
    if (r) out.push(r);
  }
  return out;
}

const sameRecord = (r, book, pageId) => !!r && String(r.book) === String(book) && pageIdOf(r) === String(pageId);

/**
 * The list the reader turns through, and which order it is really in. Tag
 * order applies only while the open page is in the sequence; otherwise (a
 * page opened some other way, or the page has gone) the reader falls back to
 * the open page's notebook.
 *
 * @param {{order: 'book'|'tag', sequence: object[], selection: {book, pageId}|null, bookPages: object[]}} s
 *        sequence: `sequenceRecords()`; bookPages: the open notebook's records
 * @returns {{pages: object[], order: 'book'|'tag'}}
 */
export function readerPageList({ order, sequence, selection, bookPages }) {
  if (order === 'tag' && selection && (sequence || []).some((r) => sameRecord(r, selection.book, selection.pageId))) {
    return { pages: sequence, order: 'tag' };
  }
  return { pages: bookPages || [], order: 'book' };
}

/**
 * Where switching to Tag order lands when the open page is not in the
 * sequence (Book order turned off it): the first sequence page at or after the
 * open page in reading order, else the last. null for an empty sequence.
 *
 * @param {object[]} sequence  `sequenceRecords()`
 * @param {object|null} current  the open page's record
 */
export function landingInSequence(sequence, current) {
  if (!sequence || !sequence.length) return null;
  if (!current) return sequence[0];
  return sequence.find((r) => compareRecords(r, current) >= 0) || sequence[sequence.length - 1];
}

/**
 * Breadcrumb position in Tag order: "3 of 9", or "3–4 of 9" for a spread.
 * @param {number} index  the left page's index in the sequence
 * @param {number} total
 * @param {boolean} spread
 */
export function sequenceCrumb(index, total, spread) {
  if (!(index >= 0) || !(total > 0) || index >= total) return '';
  const right = spread && index + 1 < total ? `–${index + 2}` : '';
  return `${index + 1}${right} of ${total}`;
}

/**
 * The breadcrumb name of what the sequence came from: "Tag: beam",
 * "Tag: beam + slab" (a tag's pages filtered by another), "Untagged", or for a
 * filtered notebook grid "<notebook> · beam / slab" (Any) or "· beam + slab"
 * (All).
 *
 * @param {ReadingSequence|null} sequence
 * @param {(book: string) => string} [nameOf]  notebook display name
 */
export function sequenceLabel(sequence, nameOf = (b) => `B${b}`) {
  if (!sequence) return '';
  const { origin, chosen = [], mode } = sequence;
  if (origin.kind === 'untagged') return 'Untagged';
  const filter = chosen.join(mode === 'all' ? ' + ' : ' / ');
  if (origin.kind === 'notebook') return `${nameOf(origin.book)} · ${filter}`;
  return `Tag: ${origin.tag}${filter ? ` + ${chosen.length > 1 && mode === 'any' ? `(${filter})` : filter}` : ''}`;
}
