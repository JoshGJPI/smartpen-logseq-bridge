/**
 * Folder Scanner — produces the page records the Data Explorer UI expects.
 *
 * Drop-in replacement for src/lib/logseq-scanner.js. Reads from local-store
 * (pages/B###/P##.json) and emits the same record shape the UI components
 * expect, so PageCard / BookAccordion / LogSeqDbTab can use it unchanged.
 *
 * v2 perf (#3): the scan is METADATA-ONLY. It builds records straight from the
 * lightweight PageMeta returned by `listPages()` and never loads a page's
 * strokes. Records carry only summary fields (strokeCount, lastUpdated,
 * transcript text, etc.) — NOT the strokes array or the full PageDoc. Each
 * page's strokes load lazily, on demand, when the page is actually opened
 * (Book View spread / thumbnail, "Import Strokes", Editor handoff). This keeps
 * the whole library from staying resident for the entire session.
 */

import { get } from 'svelte/store';
import { log, setLogseqPages, setScanning } from '$stores';
import { registerBookIds, setBookAliases } from '$stores/book-aliases.js';
import { dataRoot, dataFolderReady } from '$stores/settings.js';
import { listPages, getAliases } from './local-store.js';

/**
 * Convert a lightweight PageMeta → record shape consumed by PageCard / BookViewer.
 *
 * `pageId` is the per-book-unique file identifier including any letter suffix
 * (e.g. "151b"); `page` is the integer NCode page number, which can collide
 * across suffixed variants. Consumers should key/navigate by `pageId`.
 *
 * Pure (no I/O) so it can be unit-tested. Crucially it does NOT embed strokes /
 * pageDoc / strokeData — those are loaded lazily per page (see load-page.js,
 * page-cache.js).
 *
 * @param {import('./page-doc.js').PageMeta} meta
 */
export function metaToRecord(meta) {
  const { book, page } = meta;
  const pageId = meta.pageId != null ? String(meta.pageId) : String(page);
  const suffix = meta.suffix || '';
  const transcriptionText = meta.transcriptionText || null;
  return {
    pageName: `pages/B${book}/P${pageId}.json`,   // unique per page (incl. suffix)
    book,
    page,                                          // integer NCode page number
    pageId,                                        // unique-within-book identifier
    suffix,
    strokeCount: meta.strokeCount || 0,
    lastUpdated: meta.lastUpdated || null,
    transcribed: meta.hasTranscription != null ? !!meta.hasTranscription : !!transcriptionText,
    transcriptLineCount: meta.transcriptLineCount || 0,
    // Transcript text is small (no strokes) so it rides along for the Data
    // Explorer preview and full-text search. Strokes/pageDoc are intentionally
    // absent — consumers fetch them lazily via getPage / page-cache.
    transcriptionText,
    syncStatus: 'clean'
  };
}

// Guards against overlapping scans. Several entry points can fire close
// together at startup — the boot preload (App.svelte), the Saved Pages tab's
// data-folder-ready reactive, and Book View's onMount — so coalesce them: the
// first scan runs, the rest no-op and pick up the result reactively.
let scanInFlight = false;

/**
 * Scan the local data folder for smartpen pages and populate the store.
 * Replaces scanLogSeqPages().
 * @returns {Promise<boolean>}
 */
export async function scanLocalPages() {
  const root = get(dataRoot);
  const ready = get(dataFolderReady);

  if (!root || !ready) {
    log('Data folder not configured. Set it in Settings.', 'warning');
    return false;
  }

  if (scanInFlight) return false;
  scanInFlight = true;
  setScanning(true);

  try {
    log(`Scanning data folder: ${root}`, 'info');

    // Load aliases first (cheap)
    try {
      const aliases = await getAliases();
      if (Object.keys(aliases).length > 0) {
        setBookAliases(aliases);
        log(`Loaded ${Object.keys(aliases).length} book aliases`, 'info');
      }
    } catch (aliasErr) {
      console.warn('Failed to load aliases:', aliasErr);
    }

    // List all pages (lightweight metadata — no strokes loaded). This single
    // pass is the whole scan now; we no longer re-read every page with getPage.
    const metaList = await listPages();

    if (metaList.length === 0) {
      log('No saved pages found.', 'info');
      setLogseqPages([]);
      return true;
    }

    const records = metaList.map(metaToRecord);

    // Register book IDs so aliases UI shows them
    const bookIds = [...new Set(records.map(r => r.book))];
    if (bookIds.length > 0) registerBookIds(bookIds);

    setLogseqPages(records);
    log(`Scanned ${records.length} page(s) across ${bookIds.length} book(s)`, 'success');
    return true;
  } catch (err) {
    console.error('Folder scan failed:', err);
    log(`Folder scan failed: ${err.message}`, 'error');
    return false;
  } finally {
    scanInFlight = false;
    setScanning(false);
  }
}
