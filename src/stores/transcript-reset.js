/**
 * transcript-reset — re-transcribing a page that already has a saved
 * transcript (v3.17.0).
 *
 * resetPageTranscript() clears the in-memory line links (`blockUuid`) of the
 * page's loaded strokes, so the Transcribe button sends them again, and records
 * the page. setPageTranscription() marks that page's next transcription
 * `replace: true`, which the save (save-page.js planTranscript) writes as the
 * whole transcript: the old lines go instead of staying beside the new ones.
 *
 * Nothing touches disk until Save, and a Reset that is never transcribed and
 * saved changes nothing on disk. undoResetPageTranscript() puts the links back
 * while the page is still pending. The record is session-only and dropped when
 * the canvas clears the page.
 */
import { writable, get } from 'svelte/store';
import { strokes, clearStrokeBlockUuids, updateStrokeBlockUuids } from './strokes.js';
import { savedPages } from './saved-pages.js';
import { getPage } from '../lib/storage/local-store.js';
import { kindLineIds } from '../lib/line-kinds.js';

/** `B{book}/P{page}` (the canvasPageKeys form) → { links: Map<startTime, blockUuid>, strokes, at } */
export const resetPages = writable(new Map());

export const resetKey = (book, page) => `B${book}/P${page}`;

const onPage = (book, page) => (s) => s && !s.deleted && s.pageInfo
  && String(s.pageInfo.book) === String(book) && String(s.pageInfo.page) === String(page);

/** Strokes the scan says the page has on disk, or null when it has no record. */
export function strokesOnDisk(book, page) {
  const r = get(savedPages).find((p) => String(p.book) === String(book) && String(p.pageId ?? p.page) === String(page));
  return r && Number.isFinite(r.strokeCount) ? r.strokeCount : null;
}

/**
 * Unlink a loaded page's strokes for re-transcription. Refused while only part
 * of the page is loaded (a load by date): the replacing transcript would have no
 * lines for the ink left out, and the save would drop them.
 *
 * Only ink of text lines is unlinked (v3.24.0, E.4): a sketch line's ink keeps
 * its link, so Transcribe doesn't send the drawing and the save keeps the
 * sketch (re-placed by y). Which lines are sketches is read from the page.
 * @param {{ readPage?: (book: string, page: string) => Promise<object|null> }} [deps]
 * @returns {Promise<number>} strokes unlinked; 0 when the page has no ink on the canvas,
 *   -1 when refused as partly loaded
 */
export async function resetPageTranscript(book, page, { readPage = getPage } = {}) {
  if (!get(strokes).some(onPage(book, page))) return 0;
  let kinds = new Set();
  try {
    const doc = await readPage(String(book), String(page));
    kinds = kindLineIds(doc && doc.transcript && doc.transcript.lines);
  } catch {
    // unreadable: every link goes, as before sketches
  }
  const all = get(strokes).filter(onPage(book, page));
  if (!all.length) return 0;
  const total = strokesOnDisk(book, page);
  if (total != null && all.length < total) return -1;
  const mine = all.filter((s) => !(s.blockUuid && kinds.has(s.blockUuid)));
  const key = resetKey(book, page);
  resetPages.update((m) => {
    const next = new Map(m);
    // A second Reset keeps the links from the first, so Undo restores what was saved.
    const prior = m.get(key);
    const links = prior ? prior.links : new Map(mine.filter((s) => s.blockUuid).map((s) => [String(s.startTime), s.blockUuid]));
    next.set(key, { links, strokes: mine.length, at: Date.now() });
    return next;
  });
  clearStrokeBlockUuids(mine.map((s) => s.startTime));
  return mine.length;
}

/** Put a reset page's links back (before its new transcription is saved). */
export function undoResetPageTranscript(book, page) {
  const key = resetKey(book, page);
  const entry = get(resetPages).get(key);
  if (!entry) return false;
  // Only strokes still unlinked: anything linked since keeps its new link.
  const still = new Map();
  for (const s of get(strokes).filter(onPage(book, page))) {
    const id = String(s.startTime);
    if (!s.blockUuid && entry.links.has(id)) still.set(id, entry.links.get(id));
  }
  if (still.size) updateStrokeBlockUuids(still);
  forgetReset(book, page);
  return true;
}

export function isPageReset(book, page) {
  return get(resetPages).has(resetKey(book, page));
}

export function forgetReset(book, page) {
  const key = resetKey(book, page);
  if (!get(resetPages).has(key)) return;
  resetPages.update((m) => {
    const next = new Map(m);
    next.delete(key);
    return next;
  });
}

export function forgetAllResets() {
  if (get(resetPages).size) resetPages.set(new Map());
}

// A page that leaves the canvas (Clear, unload) is no longer reset: re-imported
// later, its links come back from disk and a stale record would make its next
// transcription replace the saved one. Checked only while something is reset.
strokes.subscribe(($strokes) => {
  const m = get(resetPages);
  if (!m.size) return;
  const loaded = new Set();
  for (const s of $strokes) if (s && s.pageInfo) loaded.add(resetKey(s.pageInfo.book, s.pageInfo.page));
  if ([...m.keys()].every((k) => loaded.has(k))) return;
  resetPages.set(new Map([...m].filter(([k]) => loaded.has(k))));
});
