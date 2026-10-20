/**
 * load-into-editor — the one guarded way to put a saved page onto the Editor
 * canvas from a reading view: the reader's page header, its "Transcribe in
 * Editor" empty state, and Shift+Enter on a global search result.
 *
 * Asks before dropping unsaved transcript edits (the same DISCARD_PROMPT as
 * every route between destinations), appends the page's strokes to the canvas
 * (deduped by id, non-destructive, as "Import Strokes" always has), then shows
 * the Editor. A doc the reader already holds is reused without a second read
 * or a page-cache bump (`peekCachedPage`); otherwise importStrokesFromFolder
 * reads it once and releases it.
 */
import { get } from 'svelte/store';
import { viewerDirty, clearAllViewerDirty, navigateTo } from '$stores';
import { DISCARD_PROMPT } from '$lib/navigation.js';
import { importStrokesFromFolder } from '$lib/storage/load-page.js';
import { peekCachedPage } from './page-cache.js';

/**
 * @param {object} record  a metadata-only scan record ({book, page, pageId, ...})
 * @param {{confirm?: (message: string) => boolean}} [opts]
 * @returns {Promise<'cancelled'|'loaded'|'failed'>}
 */
export async function loadPageIntoEditor(record, { confirm = (m) => window.confirm(m) } = {}) {
  if (!record) return 'failed';
  if (get(viewerDirty)) {
    if (!confirm(DISCARD_PROMPT)) return 'cancelled';
    clearAllViewerDirty();
  }
  const pageId = record.pageId != null ? String(record.pageId) : String(record.page);
  const pageDoc = peekCachedPage(record.book, pageId) || undefined;
  const result = await importStrokesFromFolder({ ...record, pageDoc });
  navigateTo('editor');
  return result && result.success === false ? 'failed' : 'loaded';
}
