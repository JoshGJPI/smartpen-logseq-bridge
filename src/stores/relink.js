/**
 * relink — Relink old transcripts (v3.21.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md
 * Phase B): runs the pure lib/relink.js against the disk and MyScript.
 *
 *   getRelinkRun(book, pageId, { send })  the page's MyScript run: from the
 *       cache (`<userData>/relink-cache/`, main's relink-cache.cjs) while the
 *       page is unchanged, else, only with `send`, one MyScript request. The
 *       page is read from disk (no canvas needed); its ink minus textless
 *       strokes and a kind line's strokes is sent turned upright like Transcribe.
 *   saveRelink(book, pageId, spec)  re-checks the guards, saves through
 *       `savePageToFolder({ relink })` (which re-checks the revision), then
 *       drops the cache entry, brings a copy of the page on the canvas in line
 *       and calls `refreshAfterSave()`.
 *   runBulkRelink(pages, …)  Settings → Maintenance → Relink old transcripts:
 *       page by page, saving at once pages that need no review and queueing
 *       the rest (`relinkQueue`, newest first) for the per-page dialog.
 *
 * `relinkTarget` opens the per-page dialog (RelinkDialog, mounted in App).
 */
import { writable, get } from 'svelte/store';
import { strokes } from './strokes.js';
import { syncCanvasAfterPageWrite } from './textless.js';
import { pageOrientations } from './orientation.js';
import { hasMyScriptCredentials, getMyScriptCredentials } from './settings.js';
import { pageGuardState } from './page-guards.js';
import { log } from './ui.js';
import { getPage } from '$lib/storage/local-store.js';
import { savePageToFolder } from '$lib/storage/save-page.js';
import { storedStrokesToCanvas } from '$lib/storage/load-page.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import { transcribeStrokes, batchOriginY } from '$lib/myscript-api.js';
import { rotationFor, rotateCanvasStrokes } from '$lib/page-orientation.js';
import {
  relinkRefusal, relinkSendStrokes, cachedRunValid, runForCache, classifyRelink,
  relinkNeedsNoReview, buildRelinkSpec, NO_LINKS
} from '$lib/relink.js';

/** The page the Relink dialog is open on: `{ book, pageId }` or null. */
export const relinkTarget = writable(null);

/** Pages a bulk run left for review, newest first: `{ book, pageId, counts, written }`. Session-only (the runs are cached). */
export const relinkQueue = writable([]);

/** @param {{ again?: boolean }} [opts]  again: a page already linked (asks first, v3.21.0) */
export function openRelink(book, pageId, { again = false } = {}) {
  relinkTarget.set({ book: String(book), pageId: String(pageId), ...(again ? { again: true } : {}) });
}

export function closeRelink() {
  relinkTarget.set(null);
}

const label = (book, pageId) => `B${book}/P${pageId}`;

function cacheCall(action, book, pageId, entry) {
  const api = typeof window !== 'undefined' ? window.relinkAPI : null;
  if (!api) return Promise.resolve(null);
  return api.cache(action, String(book), String(pageId), entry).then((r) => {
    if (!r || r.ok === false) throw new Error((r && r.error) || `relink cache ${action} failed`);
    return r.result;
  });
}

/**
 * The guard flags for Relink: Claude's edit guards (page-guards.js) plus
 * `suffixOnCanvas`. The Editor keys canvas strokes by the integer NCode page, so
 * a letter-suffixed page (P151b) can't be told from P151 there and its canvas
 * copy couldn't take the new links; Relink waits until that page is off the canvas.
 */
function relinkGuardState(book, pageId) {
  const s = pageGuardState(book, pageId);
  const m = /^(\d+)[a-zA-Z]$/.exec(String(pageId));
  const suffixOnCanvas = !!m && get(strokes).some((st) => st && st.pageInfo
    && String(st.pageInfo.book) === String(book) && String(st.pageInfo.page) === m[1]);
  return { ...s, suffixOnCanvas };
}

/** Why Relink is refused on this page now (the page read from disk), or null. */
export async function relinkRefusalFor(book, pageId, doc, opts = {}) {
  const d = doc === undefined ? await getPage(String(book), String(pageId)) : doc;
  return relinkRefusal(relinkGuardState(book, pageId), d, opts);
}

/**
 * The page's MyScript run for Relink.
 * @param {{ send?: boolean, again?: boolean }} [opts]  send: allowed to make a MyScript request when the cache has
 *   nothing usable; again: the page may already be linked (Relink again, confirmed in the dialog)
 * @returns {Promise<{ ok: true, doc: Object, run: Object, cached: boolean } | { ok: false, error: string, needsSend?: boolean }>}
 */
export async function getRelinkRun(book, pageId, { send = false, again = false } = {}) {
  const doc = await getPage(String(book), String(pageId));
  const why = relinkRefusal(relinkGuardState(book, pageId), doc, { again });
  if (why) return { ok: false, error: why };
  const revision = (doc.metadata && doc.metadata.lastUpdated) || '';

  let entry = null;
  try {
    entry = await cacheCall('get', book, pageId);
  } catch (e) {
    log(`Relink: could not read the cache for ${label(book, pageId)}: ${e.message}`, 'warning');
  }
  if (cachedRunValid(entry, revision)) return { ok: true, doc, run: entry, cached: true };
  if (!send) return { ok: false, needsSend: true, error: `${label(book, pageId)} has not been sent to MyScript yet` };
  if (!get(hasMyScriptCredentials)) return { ok: false, error: 'MyScript keys are not set (Settings → Handwriting recognition)' };

  const stored = relinkSendStrokes(doc);
  const rotation = rotationFor(get(pageOrientations), String(book), String(pageId));
  // Turned upright as Transcribe sends it; the origin is measured on the turned copies.
  const sentStrokes = rotateCanvasStrokes(storedStrokesToCanvas(stored, doc.pageInfo), rotation);
  const { appKey, hmacKey } = getMyScriptCredentials();
  const result = await transcribeStrokes(sentStrokes, appKey, hmacKey);
  const run = runForCache({
    revision,
    rotation,
    originNcodeY: batchOriginY(sentStrokes),
    sent: stored.map((s) => s.id),
    lines: result.lines || []
  });
  try {
    await cacheCall('put', book, pageId, run);
  } catch (e) {
    log(`Relink: could not cache the MyScript result for ${label(book, pageId)}: ${e.message}`, 'warning');
  }
  return { ok: true, doc, run, cached: false };
}

/**
 * Write a relink.
 * @returns {Promise<{ ok: boolean, error?: string, stale?: boolean, result?: Object }>}
 */
export async function saveRelink(book, pageId, spec, { again = false } = {}) {
  const why = relinkRefusal(relinkGuardState(book, pageId), await getPage(String(book), String(pageId)), { again });
  if (why) return { ok: false, error: why };
  // A relink that links no line would only bump lastTranscribed and make the page
  // read as trustworthy with all its ink unlinked.
  if (!spec || !Array.isArray(spec.links) || !spec.links.length) return { ok: false, error: NO_LINKS };
  const result = await savePageToFolder({ book: String(book), page: String(pageId), activeStrokes: [], relink: spec });
  if (!result || !result.success) {
    if (result && result.stale) await cacheCall('drop', book, pageId).catch(() => {});
    return { ok: false, stale: !!(result && result.stale), error: (result && result.error) || 'save failed' };
  }
  await cacheCall('drop', book, pageId).catch(() => {});
  // A copy of the page on the canvas takes the written links and flags, and the
  // on-disk index follows, so an Editor save neither puts the old links back nor
  // sees the new flags as unsaved changes.
  syncCanvasAfterPageWrite(book, pageId, { strokes: result.strokes, textlessIds: result.textlessIds, links: result.links });
  relinkQueue.update((q) => q.filter((p) => !(p.book === String(book) && p.pageId === String(pageId))));
  await refreshAfterSave([{ book: String(book), pageId: String(pageId) }]);
  log(`Relinked ${label(book, pageId)}: ${result.relinked} line${result.relinked === 1 ? '' : 's'} linked to ink`
    + (result.linesAdded ? `, ${result.linesAdded} added` : '')
    + (result.textlessIds && result.textlessIds.length ? `, ${result.textlessIds.length} stroke(s) left out as Not text` : ''), 'success');
  return { ok: true, result };
}

/**
 * saveRelink for the dialog: a save that throws comes back as `{ ok: false, error }`,
 * so the dialog always leaves its saving phase (lib/relink.js afterRelinkSave).
 */
export async function trySaveRelink(book, pageId, spec, opts = {}) {
  try {
    return await saveRelink(book, pageId, spec, opts);
  } catch (e) {
    log(`Relink: saving B${book}/P${pageId} failed: ${e.message}`, 'error');
    return { ok: false, error: `Save failed: ${e.message}` };
  }
}

/**
 * The bulk run (B.5). Pages one by one; a page whose run is cached costs no
 * request. Refused pages are skipped with their reason.
 *
 * @param {Array<{ book: string, pageId: string, written?: number }>} pages
 * @param {{ onProgress?: (p: object) => void, stopped?: () => boolean }} [opts]
 * @returns {Promise<{ saved: number, queued: number, skipped: Array<{label:string, why:string}>, failed: number, requests: number }>}
 */
export async function runBulkRelink(pages, { onProgress = () => {}, stopped = () => false } = {}) {
  const out = { saved: 0, queued: 0, skipped: [], failed: 0, requests: 0 };
  const queued = [];
  for (const [i, p] of (pages || []).entries()) {
    if (stopped()) break;
    onProgress({ index: i, total: pages.length, label: label(p.book, p.pageId), ...out });
    try {
      // Twice at most: a page written between its run and the save is sent again once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const got = await getRelinkRun(p.book, p.pageId, { send: true });
        if (!got.ok) { out.skipped.push({ label: label(p.book, p.pageId), why: got.error }); break; }
        if (!got.cached) out.requests++;
        const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
        if (!relinkNeedsNoReview(model)) {
          queued.push({ book: String(p.book), pageId: String(p.pageId), counts: model.counts, written: p.written || 0 });
          out.queued++;
          break;
        }
        const saved = await saveRelink(p.book, p.pageId, buildRelinkSpec(got.run, model));
        if (saved.ok) { out.saved++; break; }
        if (!saved.stale || attempt === 1) {
          out.failed++;
          log(`Relink: ${label(p.book, p.pageId)} failed: ${saved.error}`, 'error');
          break;
        }
      }
    } catch (e) {
      out.failed++;
      log(`Relink: ${label(p.book, p.pageId)} failed: ${e.message}`, 'error');
    }
  }
  relinkQueue.update((q) => {
    const keep = q.filter((x) => !queued.some((n) => n.book === x.book && n.pageId === x.pageId));
    return [...keep, ...queued].sort((a, b) => (b.written || 0) - (a.written || 0));
  });
  onProgress({ index: (pages || []).length, total: (pages || []).length, label: '', ...out });
  return out;
}
