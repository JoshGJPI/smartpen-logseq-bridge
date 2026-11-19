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
  relinkNeedsNoReview, buildRelinkSpec
} from '$lib/relink.js';

/** The page the Relink dialog is open on: `{ book, pageId }` or null. */
export const relinkTarget = writable(null);

/** Pages a bulk run left for review, newest first: `{ book, pageId, counts, written }`. Session-only (the runs are cached). */
export const relinkQueue = writable([]);

export function openRelink(book, pageId) {
  relinkTarget.set({ book: String(book), pageId: String(pageId) });
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

/** Why Relink is refused on this page now (the page read from disk), or null. */
export async function relinkRefusalFor(book, pageId, doc) {
  const d = doc === undefined ? await getPage(String(book), String(pageId)) : doc;
  return relinkRefusal(pageGuardState(book, pageId), d);
}

/**
 * The page's MyScript run for Relink.
 * @param {{ send?: boolean }} [opts]  send: allowed to make a MyScript request when the cache has nothing usable
 * @returns {Promise<{ ok: true, doc: Object, run: Object, cached: boolean } | { ok: false, error: string, needsSend?: boolean }>}
 */
export async function getRelinkRun(book, pageId, { send = false } = {}) {
  const doc = await getPage(String(book), String(pageId));
  const why = relinkRefusal(pageGuardState(book, pageId), doc);
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
 * A copy of the page on the canvas takes the links just written, so an Editor
 * save of that copy doesn't put the old links back. Not an edit (the disk has it).
 */
function syncCanvasLinks(book, pageId, written) {
  if (!Array.isArray(written)) return 0;
  const byId = new Map(written.map((s) => [s.id, s]));
  let changed = 0;
  const next = get(strokes).map((s) => {
    const pi = s.pageInfo;
    if (!pi || String(pi.book) !== String(book) || String(pi.page) !== String(pageId)) return s;
    const w = byId.get(`s${s.startTime}`);
    if (!w) return s;
    const link = w.lineId || null;
    const flag = w.textless === true;
    if ((s.blockUuid || null) === link && (s.textless === true) === flag) return s;
    changed++;
    const out = { ...s, blockUuid: link };
    if (flag) out.textless = true;
    return out;
  });
  if (changed) strokes.set(next);
  return changed;
}

/**
 * Write a relink.
 * @returns {Promise<{ ok: boolean, error?: string, stale?: boolean, result?: Object }>}
 */
export async function saveRelink(book, pageId, spec) {
  const why = relinkRefusal(pageGuardState(book, pageId), await getPage(String(book), String(pageId)));
  if (why) return { ok: false, error: why };
  const result = await savePageToFolder({ book: String(book), page: String(pageId), activeStrokes: [], relink: spec });
  if (!result || !result.success) {
    if (result && result.stale) await cacheCall('drop', book, pageId).catch(() => {});
    return { ok: false, stale: !!(result && result.stale), error: (result && result.error) || 'save failed' };
  }
  await cacheCall('drop', book, pageId).catch(() => {});
  syncCanvasLinks(book, pageId, result.strokes);
  relinkQueue.update((q) => q.filter((p) => !(p.book === String(book) && p.pageId === String(pageId))));
  await refreshAfterSave([{ book: String(book), pageId: String(pageId) }]);
  log(`Relinked ${label(book, pageId)}: ${result.relinked} line${result.relinked === 1 ? '' : 's'} linked to ink`
    + (result.linesAdded ? `, ${result.linesAdded} added` : '')
    + (result.textlessIds && result.textlessIds.length ? `, ${result.textlessIds.length} stroke(s) left out as Not text` : ''), 'success');
  return { ok: true, result };
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
