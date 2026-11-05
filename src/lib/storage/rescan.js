/**
 * Rescan the data folder: drop the cached thumbnails and pages, re-read every
 * page's metadata, and refresh the Timeline index quietly. Was the Library home's
 * Rescan button; since v3.14.0 it is in the home's ⋯ menu and in Settings → Data folder.
 */
import { scanLocalPages } from '$lib/storage/scan.js';
import { clearPageCache } from '$lib/viewer/page-cache.js';
import { thumbs } from '$lib/viewer/thumbs.js';
import { loadTimeline } from '$stores/timeline.js';

export async function rescanLibrary() {
  thumbs.clear();
  clearPageCache();
  await scanLocalPages();
  loadTimeline({ silent: true });
}
