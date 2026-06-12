/**
 * Load Page — folder-backed replacement for logseq-import.js.
 *
 * Reads a PageDoc and merges its strokes into the canvas store, mirroring the
 * v1 importStrokesFromLogSeq() flow:
 *   1. Convert StoredStroke → canvas format (dotArray with dotType/timestamp)
 *   2. Dedupe against existing in-memory strokes by id
 *   3. Update strokes store
 *   4. Update sync status
 *
 * The canvas-format conversion matches v1 exactly so downstream code
 * (canvas-renderer, transcript-updater, decorative filter) doesn't care
 * where the strokes came from.
 */

import { get } from 'svelte/store';
import { strokes, log, updatePageSyncStatus, noteOnDiskStrokeIds } from '$stores';
import { registerBookIds } from '$stores/book-aliases.js';
import { getPage } from './local-store.js';

/**
 * @param {Object} stroke - either canvas-format (with dotArray) or storage-format (with points)
 * @returns {string}
 */
function getStrokeId(stroke) {
  if (stroke.id) return stroke.id;
  return `s${stroke.startTime}`;
}

/**
 * Convert v2 StoredStroke[] → canvas format strokes.
 * @param {import('./page-doc.js').PageDoc} doc
 * @param {Function} [onProgress] (current, total) => void
 * @returns {Array}
 */
function transformStoredToCanvasFormat(doc, onProgress = null) {
  const pageInfo = doc.pageInfo || {};
  // Share ONE pageInfo object across every stroke and every dot of this page.
  // pageInfo is identical for all of them, so spreading a fresh `{ ...pageInfo }`
  // per dot (as this used to) allocated one small object per dot — millions of
  // identical 4-key objects for a large book, which dominated heap use when
  // loading many pages. pageInfo is treated as read-only downstream (canvas
  // render, transcript matching), so a single shared reference is safe.
  const sharedPageInfo = { ...pageInfo };
  const storedStrokes = Array.isArray(doc.strokes) ? doc.strokes : [];
  const total = storedStrokes.length;

  return storedStrokes.map((s, index) => {
    if (onProgress && (index % 50 === 0 || index === total - 1)) {
      onProgress(index + 1, total);
    }
    const points = s.points || [];
    return {
      pageInfo: sharedPageInfo,
      startTime: s.startTime,
      endTime: s.endTime,
      // PageDoc carries lineId; in-memory canvas keeps it as blockUuid for
      // compatibility with existing transcript matching code.
      blockUuid: s.lineId || null,
      dotArray: points.map((p, i) => {
        const [x, y, ts] = p;
        let dotType;
        if (i === 0) dotType = 0;                // Pen Down
        else if (i === points.length - 1) dotType = 2; // Pen Up
        else dotType = 1;                        // Pen Move
        return {
          x, y,
          f: 100,                                // Default pressure (light)
          dotType,
          timestamp: typeof ts === 'number' ? ts : undefined,
          pageInfo: sharedPageInfo
        };
      })
    };
  });
}

/**
 * Merge new strokes into existing, deduplicated by id.
 */
function mergeStrokes(existing, incoming) {
  const existingIds = new Set(existing.map(getStrokeId));
  const uniqueNew = [];
  let dupes = 0;
  for (const s of incoming) {
    const id = getStrokeId(s);
    if (existingIds.has(id)) {
      dupes++;
    } else {
      uniqueNew.push(s);
      existingIds.add(id);
    }
  }
  const merged = [...existing, ...uniqueNew].sort((a, b) => {
    const ta = a.startTime || parseInt((a.id || '').slice(1) || '0');
    const tb = b.startTime || parseInt((b.id || '').slice(1) || '0');
    return ta - tb;
  });
  return { strokes: merged, imported: uniqueNew.length, duplicatesSkipped: dupes };
}

/**
 * Import strokes from the local folder PageDoc into the canvas.
 * @param {Object} pageData - Record from the scanner (must have book, page, pageDoc?)
 * @param {Function} [onProgress]
 * @returns {Promise<{success:boolean, imported?:number, duplicatesSkipped?:number, total?:number, error?:string}>}
 */
/**
 * For each (book, page) currently loaded in the canvas, look up the PageDoc
 * on disk and merge in any strokes the canvas doesn't already have.
 * @param {Function} [onProgress] (message, current, total) => void
 */
export async function importStrokesForLoadedPagesFromFolder(onProgress = null) {
  try {
    const current = get(strokes);
    if (current.length === 0) {
      log('No strokes loaded — nothing to merge against', 'warning');
      return { success: false, error: 'No strokes loaded' };
    }

    const loadedPages = new Map();
    for (const s of current) {
      const pi = s.pageInfo || {};
      const book = pi.book || 0, page = pi.page || 0;
      const key = `B${book}/P${page}`;
      if (!loadedPages.has(key)) loadedPages.set(key, { book, page });
    }

    let totalImported = 0, totalDuplicates = 0, pagesProcessed = 0;
    let i = 0;
    for (const [, ref] of loadedPages) {
      i++;
      if (onProgress) onProgress(`Importing B${ref.book}/P${ref.page}…`, i, loadedPages.size);
      const doc = await getPage(ref.book, ref.page);
      if (!doc) continue;
      const res = await importStrokesFromFolder({ book: ref.book, page: ref.page, pageDoc: doc });
      if (res.success) {
        totalImported += res.imported || 0;
        totalDuplicates += res.duplicatesSkipped || 0;
        pagesProcessed++;
      }
    }

    const msg = `Import complete: ${totalImported} new strokes from ${pagesProcessed} page(s)`
      + (totalDuplicates > 0 ? ` (${totalDuplicates} duplicates skipped)` : '');
    log(msg, 'success');
    return { success: true, imported: totalImported, duplicatesSkipped: totalDuplicates, pagesProcessed };
  } catch (err) {
    console.error('Failed to import strokes for loaded pages:', err);
    log(`Import failed: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

export async function importStrokesFromFolder(pageData, onProgress = null) {
  try {
    // Prefer a doc handed in by the caller; otherwise read lazily. Records from
    // the scanner no longer embed the PageDoc (perf #3), so this read is the
    // normal path. Load by pageId so letter-suffixed variants (P151b) read the
    // correct file rather than collapsing onto the integer-page file.
    let doc = pageData.pageDoc;
    if (!doc) {
      const pageRef = pageData.pageId != null ? pageData.pageId : pageData.page;
      log(`Loading B${pageData.book}/P${pageRef} from folder...`, 'info');
      doc = await getPage(pageData.book, pageRef);
      if (!doc) throw new Error(`Page file not found for B${pageData.book}/P${pageRef}`);
      // Do NOT stash the doc back onto pageData — these records live in the
      // logseqPages store, and caching the strokes there is the residency we're
      // removing. The doc is used locally below and then released.
    }

    // Prime the on-disk stroke-id index for this page (book/page from the doc),
    // before strokes.set below, so pendingChanges never briefly flags these
    // freshly-loaded strokes as unsaved additions.
    noteOnDiskStrokeIds(
      doc.pageInfo?.book ?? pageData.book,
      doc.pageInfo?.page ?? pageData.page,
      doc.strokes || []
    );

    const canvasStrokes = transformStoredToCanvasFormat(doc, onProgress);
    if (canvasStrokes.length === 0) {
      log(`B${pageData.book}/P${pageData.page} has no strokes`, 'info');
      return { success: true, imported: 0, duplicatesSkipped: 0, total: 0 };
    }

    const bookIds = [...new Set(canvasStrokes.map(s => s.pageInfo?.book).filter(Boolean))];
    if (bookIds.length > 0) registerBookIds(bookIds);

    const current = get(strokes);
    const result = mergeStrokes(current, canvasStrokes);

    strokes.set(result.strokes);
    updatePageSyncStatus(pageData.book, pageData.page, 'in-canvas');

    const tail = result.duplicatesSkipped > 0
      ? ` (${result.duplicatesSkipped} duplicates skipped)`
      : '';
    log(`Imported ${result.imported} strokes from B${pageData.book}/P${pageData.page}${tail}`, 'success');

    return {
      success: true,
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      total: result.strokes.length
    };
  } catch (err) {
    console.error('Failed to import strokes from folder:', err);
    log(`Import failed: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}
