/**
 * Folder Scanner — produces the page records the Data Explorer UI expects.
 *
 * Drop-in replacement for src/lib/logseq-scanner.js. Reads from local-store
 * (pages/B###/P##.json) and emits the same record shape the UI components
 * expect, so PageCard / BookAccordion / LogSeqDbTab can use it unchanged.
 */

import { get } from 'svelte/store';
import { log, setLogseqPages, setScanning } from '$stores';
import { registerBookIds, setBookAliases } from '$stores/book-aliases.js';
import { dataRoot, dataFolderReady } from '$stores/settings.js';
import { listPages, getPage, getAliases } from './local-store.js';

/**
 * Build the transcription text from a PageDoc's transcript.lines.
 * Mirrors the v1 LogSeq scanner's `extractTranscriptionText` output (2-space
 * indents reflecting the line hierarchy).
 */
function buildTranscriptionText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return lines
    .map(l => '  '.repeat(l.indentLevel || 0) + (l.text || ''))
    .join('\n');
}

/**
 * Convert a folder PageDoc → record shape consumed by PageCard / BookViewer.
 *
 * `pageId` is the per-book-unique file identifier including any letter suffix
 * (e.g. "151b"); `page` is the integer NCode page number, which can collide
 * across suffixed variants. Consumers should key/navigate by `pageId`.
 * @param {import('./page-doc.js').PageDoc} doc
 * @param {import('./page-doc.js').PageMeta} meta - from listPages() (has pageId/suffix)
 */
function pageDocToRecord(doc, meta) {
  const { book, page } = meta;
  const pageId = meta.pageId != null ? String(meta.pageId) : String(page);
  const suffix = meta.suffix || '';
  const transcriptionText = buildTranscriptionText(doc.transcript?.lines);
  return {
    pageName: `pages/B${book}/P${pageId}.json`,   // unique per page (incl. suffix)
    book,
    page,                                          // integer NCode page number
    pageId,                                        // unique-within-book identifier
    suffix,
    strokeCount: doc.strokes?.length || 0,
    lastUpdated: doc.metadata?.lastUpdated || null,
    transcribed: !!transcriptionText,
    transcriptionText,
    // The full PageDoc — UI uses these for in-canvas import and transcript edits
    pageDoc: doc,
    strokes: doc.strokes || [],
    strokeData: doc,                              // unified — full doc is the data
    syncStatus: 'clean'
  };
}

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

    // List all pages (lightweight metadata)
    const metaList = await listPages();

    if (metaList.length === 0) {
      log('No saved pages found.', 'info');
      setLogseqPages([]);
      return true;
    }

    // Read each PageDoc once to build full records (transcription text, etc.)
    const records = [];
    for (const meta of metaList) {
      // Load by pageId so letter-suffixed variants (e.g. P151b.json) read the
      // correct file rather than collapsing onto the integer-page file.
      const pageRef = meta.pageId != null ? meta.pageId : meta.page;
      try {
        const doc = await getPage(meta.book, pageRef);
        if (doc) {
          records.push(pageDocToRecord(doc, meta));
        }
      } catch (err) {
        console.warn(`Skipping unreadable page B${meta.book}/P${pageRef}:`, err.message);
      }
    }

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
    setScanning(false);
  }
}
