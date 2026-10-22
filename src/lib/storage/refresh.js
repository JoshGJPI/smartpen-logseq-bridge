/**
 * refresh — keep the reading views in step with the disk after something
 * outside them changed it.
 *
 * The Library, its thumbnails, the global search and the Timeline all read
 * from in-memory copies: the metadata-only scan (`savedPages`), the reader's
 * LRU page cache, the thumbnail SVG cache and the capture-date index. Before
 * v3.0.0 nothing refreshed them after an Editor save or a data-folder change,
 * so a new page was missing from the Library until Rescan and a re-saved page
 * kept its old ink in the reader.
 *
 *   refreshAfterSave(pages)  an Editor / Create Page save: drop those pages'
 *                            cached docs and thumbnails, rescan, refresh dates
 *   resetForDataFolder()     a different folder: drop everything read from the
 *                            old one (tags too), then load the new one as boot
 *                            does (the scan reloads the sidecars)
 *
 * The scan is metadata-only and the index rebuild is incremental (mtime/size),
 * so both are cheap; neither reads strokes into the renderer.
 */
import { get } from 'svelte/store';
import {
  isScanning, clearSavedPages, clearViewerSelection, showLibraryGrid, clearReaderFocus,
  setReaderSequence, gridFilters
} from '$stores';
import { timelineIndex, loadTimeline } from '$stores/timeline.js';
import { loadVolumes } from '$stores/volumes.js';
import { clearTags } from '$stores/tags.js';
import { clearTasks } from '$stores/tasks.js';
import { clearSuggestions } from '$stores/tag-suggestions.js';
import { refreshBackgrounds } from '$stores/backgrounds.js';
import { dataFolderReady } from '$stores/settings.js';
import { scanLocalPages } from './scan.js';
import { invalidatePage, clearPageCache } from '$lib/viewer/page-cache.js';
import { thumbs } from '$lib/viewer/thumbs.js';

/**
 * Rescan, waiting out a scan already running (scanLocalPages coalesces, so a
 * call during another scan would return without picking up this change).
 */
async function rescan() {
  for (let i = 0; i < 50 && get(isScanning); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await scanLocalPages();
}

/**
 * @param {Array<{book: string|number, pageId?: string|number, page?: number}>} pages  pages just written
 */
export async function refreshAfterSave(pages = []) {
  if (!get(dataFolderReady)) return;
  for (const p of pages) {
    if (!p) continue;
    const pageId = String(p.pageId ?? p.page);
    invalidatePage(String(p.book), pageId);
    thumbs.invalidate(String(p.book), pageId);
  }
  await rescan();
  await loadTimeline({ silent: true });
}

/** The data folder changed: forget the old folder's data and load the new one. */
export async function resetForDataFolder() {
  clearPageCache();
  thumbs.clear();
  clearSavedPages();
  clearTags();
  clearTasks();
  clearSuggestions();
  timelineIndex.set(null);
  clearReaderFocus();
  showLibraryGrid(null);
  clearViewerSelection();
  setReaderSequence(null);
  gridFilters.set({});
  if (!get(dataFolderReady)) return;
  await loadVolumes();
  await rescan();
  refreshBackgrounds();
  await loadTimeline({ silent: true });
}
