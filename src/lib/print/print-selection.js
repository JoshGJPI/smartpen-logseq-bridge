/**
 * print-selection — the Editor's selected strokes as print-list items (pure: no
 * DOM, no stores).
 *
 * Prints only the canvas's selected strokes, one print page per pen page, from
 * memory rather than disk, so unsaved ink prints too. The groups go into the
 * print list beside whole pages (`selectionItems()`, print-list.js). Each page keeps its full
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

/** A short, stable hash of a page's selected stroke ids (FNV-1a, base 36). */
function idsHash(strokes) {
  let h = 0x811c9dc5;
  const s = strokes.map((st) => st.id).sort().join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The selection as print-list items, one per pen page:
 * `{ book, pageId, selection: true, key, strokes }`. The key names the page and
 * its strokes, so adding the same selection twice adds it once.
 * @returns {{items: Array, skipped: number}}
 */
export function selectionItems(canvasStrokes) {
  const { pages, skipped } = groupSelectionByPage(canvasStrokes);
  const items = pages.map((g) => ({
    book: g.book,
    pageId: g.pageId,
    selection: true,
    key: `${g.book}/${g.pageId}#${g.strokes.length}.${idsHash(g.strokes)}`,
    strokes: g.strokes
  }));
  return { items, skipped };
}

/**
 * One selection page as print-html.js wants it. `inkOnly`: whatever the
 * Strokes / Transcript / Both choice, it prints its ink and no transcript.
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
    inkOnly: true,
    background
  };
}
