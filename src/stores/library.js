/**
 * Library Store — the Library home's notebook cards and the global search's
 * prepared data (reading-first package E).
 *
 * Everything here is derived from what is already in memory: the
 * metadata-only scan (`savedPages`) and the capture-date index. Nothing reads
 * a page. The search index is rebuilt when the scan changes, never per
 * keystroke. Logic is in lib/library-home.js and lib/global-search.js.
 */
import { writable, derived, get } from 'svelte/store';
import { savedPages, pagesByBook, bookIds } from './saved-pages.js';
import { bookAliases } from './book-aliases.js';
import { timelineIndex, timelineIndexFiltered, loadTimeline } from './timeline.js';
import { dataFolderReady } from './settings.js';
import { formatBookName } from '$utils/formatting.js';
import { pageDates, notebookCards, parseSortOrder, LIBRARY_SORT_KEY } from '$lib/library-home.js';
import { buildSearchIndex, recordsByKey } from '$lib/global-search.js';

function loadSort() {
  try {
    return parseSortOrder(localStorage.getItem(LIBRARY_SORT_KEY));
  } catch {
    return 'recent';
  }
}

/** The home's sort chip: 'recent' | 'name' | 'pages'. A per-viewer convenience. */
export const librarySort = writable(loadSort());

export function setLibrarySort(id) {
  const next = parseSortOrder(id);
  try {
    localStorage.setItem(LIBRARY_SORT_KEY, next);
  } catch {
    /* ignore quota / unavailable storage */
  }
  librarySort.set(next);
}

/**
 * When each page was written, from the UNFILTERED index: the Library shows
 * every notebook whatever the Timeline's book filter says.
 */
export const libraryPageDates = derived(timelineIndex, ($index) => pageDates($index));

const nameOf = ($aliases) => (b) => formatBookName(b, $aliases, 'alias-only');

/** One card per notebook (book key), unsorted. */
export const notebookCardList = derived(
  [pagesByBook, bookIds, libraryPageDates, bookAliases],
  ([$grouped, $ids, $dates, $aliases]) => notebookCards($grouped, $ids, $dates, nameOf($aliases))
);

/** `{book, name}` for every notebook, for notebook-name search. */
export const notebookNames = derived([bookIds, bookAliases], ([$ids, $aliases]) =>
  $ids.map((book) => ({ book, name: nameOf($aliases)(book) }))
);

/** Search tokens and lines per transcribed page, built once per scan. */
export const globalSearchIndex = derived(savedPages, ($pages) => buildSearchIndex($pages));

/** Every scan record by page key, for pages found by date. */
export const searchRecords = derived(savedPages, ($pages) => recordsByKey($pages));

/**
 * Page dates as the date features see them (book filter applied), so a Day
 * result and the pages under it agree with the Timeline it opens.
 */
export const searchDates = derived(timelineIndexFiltered, ($index) => pageDates($index));

/** Load the capture-date index if nothing has yet (it is cached on disk). */
export function ensureTimelineLoaded() {
  if (get(timelineIndex) || !get(dataFolderReady)) return;
  loadTimeline({ silent: true });
}
