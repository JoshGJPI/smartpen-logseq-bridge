/**
 * print-selection — Print selection… in the Editor (pure: no DOM, no stores).
 *
 * Prints only the canvas's selected strokes, one print page per pen page, from
 * memory rather than disk, so unsaved ink prints too. Each page keeps its full
 * paper (the Neo frame, grown for stray ink by printFrame), so the selection
 * sits where it was written on the sheet instead of being cropped and enlarged;
 * a notebook with no paper falls back to the selection's own ink box.
 *
 * Canvas strokes are converted with the save path's own strokeToStored(), so
 * force and the sketch flag survive (variable-width runs print) and in-memory
 * markers never get through.
 *
 * Strokes only: transcript lines can't be reliably matched to a selection of
 * ink, so `lines` is always null. `contextInk` never reaches here (it is not in
 * `strokes`, so it can't be selected), and a floating pasted copy (not yet
 * placed on a page: `pageInfo: null`) has no page to print on and is skipped.
 *
 * Tested in `src/lib/__tests__/print-selection.test.js`.
 */

import { strokeToStored } from '../storage/stroke-format.js';
import { compareBookKeys, isBookKey } from '../volumes.js';
import { pageNumberOfId } from '../neo-backgrounds.js';
import { pageDayGroups } from '../viewer/page-sittings.js';
import { writtenLabel } from '../viewer/written-on.js';
import { printFrame } from './print-html.js';

/**
 * The page a canvas stroke prints under: `{ book, pageId }`, or null. The canvas
 * has collapsed a letter-suffixed page (`151b`) onto its integer page, so the
 * integer is the page id here.
 */
export function selectionPageRef(stroke) {
  const pi = stroke && stroke.pageInfo;
  if (!pi || pi.book == null || pi.page == null) return null;
  const book = String(pi.book);
  const page = pageNumberOfId(pi.page);
  if (!isBookKey(book) || page === null) return null;
  return { book, pageId: String(page) };
}

/**
 * Group selected canvas strokes by pen page, converted to the stored format.
 * Pages in notebook order (compareBookKeys), then page number; strokes keep
 * their selection order. Strokes with no page or no points are skipped.
 *
 * @param {Array} strokes  canvas strokes (`dotArray` format)
 * @returns {{pages: Array<{book: string, pageId: string, strokes: Array}>, skipped: number}}
 */
export function groupSelectionByPage(strokes) {
  const byKey = new Map();
  let skipped = 0;
  for (const stroke of strokes || []) {
    const ref = selectionPageRef(stroke);
    if (!ref || !Array.isArray(stroke.dotArray) || stroke.dotArray.length === 0) {
      skipped++;
      continue;
    }
    const key = `${ref.book}/${ref.pageId}`;
    if (!byKey.has(key)) byKey.set(key, { ...ref, strokes: [] });
    byKey.get(key).strokes.push(strokeToStored(stroke));
  }
  const pages = [...byKey.values()].sort((a, b) =>
    compareBookKeys(a.book, b.book) || Number(a.pageId) - Number(b.pageId));
  return { pages, skipped };
}

/**
 * One selection page as print-html.js wants it.
 * @param {{book: string, pageId: string, strokes: Array}} group  from groupSelectionByPage
 * @param {{paperFrame?: Object|null, rotation?: number, title: string,
 *          background?: {frame: Object, dataUrl: string}|null}} ctx
 */
export function selectionPrintPage(group, { paperFrame = null, rotation = 0, title, background = null }) {
  const strokes = group.strokes || [];
  return {
    title,
    subtitle: writtenLabel(pageDayGroups(strokes).groups),
    frame: printFrame(paperFrame, strokes),
    rotation,
    strokes,
    lines: null,
    background
  };
}

/** "N strokes on M pages" for the dialog header. */
export function selectionStrokeCount(pages) {
  return (pages || []).reduce((n, p) => n + (p.strokes ? p.strokes.length : 0), 0);
}
