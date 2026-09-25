/**
 * Timeline Store — the capture-date index and the range the user has picked.
 *
 * The index is histograms, not strokes: one `{day: count}` map per page, a few
 * tens of KB for a ~300-page corpus, so unlike the page scan there is no reason
 * to keep it off the heap. See `src/lib/timeline.js` for what the shapes mean
 * and `buildTimeline` in electron/main.cjs for how it is built.
 */
import { writable, derived, get } from 'svelte/store';
import { getTimelineIndex } from '$lib/storage/local-store.js';
import {
  dayTotals, timelineExtent, rangeSummary, pagesOnDay, addDays,
  filterIndexByBooks, indexBooks
} from '$lib/timeline.js';
import { dataRoot, dataFolderReady } from './settings.js';
import { log } from './ui.js';

/** The raw index, or null before the first load. */
export const timelineIndex = writable(null);
export const timelineLoading = writable(false);
export const timelineError = writable(null);

/**
 * The selected span, inclusive, as local day keys. Null until the index loads
 * and a default can be chosen from real data — an arbitrary default (today)
 * would open the panel on an empty range for anyone who last wrote last week.
 */
export const timelineRange = writable({ from: null, to: null });

/** How the canvas orders pages: 'book' (book then page) or 'date'. */
export const canvasPageOrder = writable('book');

/* ------------------------------------------------------------------
 * Book filter. Stored as EXCLUSIONS so a notebook first written in next
 * week shows up without anyone having to tick it. A per-viewer preference,
 * so localStorage; every store below reads through the filtered index, which
 * is what keeps the grid, the tallies, the feed and a load in agreement.
 * ------------------------------------------------------------------ */

const EXCLUDED_BOOKS_KEY = 'smartpen-timeline-excluded-books';

function loadExcludedBooks() {
  try {
    const raw = localStorage.getItem(EXCLUDED_BOOKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Book keys left out of every date feature. */
export const timelineExcludedBooks = writable(loadExcludedBooks());

function persistExcludedBooks(set) {
  try {
    localStorage.setItem(EXCLUDED_BOOKS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

export function setBookIncluded(book, included) {
  timelineExcludedBooks.update((set) => {
    const key = String(book);
    if (included === !set.has(key)) return set;
    const next = new Set(set);
    if (included) next.delete(key); else next.add(key);
    persistExcludedBooks(next);
    return next;
  });
}

export function includeAllBooks() {
  const next = new Set();
  persistExcludedBooks(next);
  timelineExcludedBooks.set(next);
}

/** Leave out everything except `book` — the filter's "only" shortcut. */
export function includeOnlyBook(book) {
  const $index = get(timelineIndex);
  const next = new Set(indexBooks($index).map(b => b.book).filter(b => b !== String(book)));
  persistExcludedBooks(next);
  timelineExcludedBooks.set(next);
}

/** The index as the date features see it — with excluded books removed. */
export const timelineIndexFiltered = derived(
  [timelineIndex, timelineExcludedBooks],
  ([$index, $excluded]) => filterIndexByBooks($index, $excluded)
);

/** Every book in the (unfiltered) index, with strokes in the current range. */
export const timelineBooks = derived(
  [timelineIndex, timelineRange],
  ([$index, $range]) => indexBooks($index, $range.from, $range.to)
);

/** Every day with captured ink, ascending. */
export const timelineDays = derived(timelineIndexFiltered, $index => dayTotals($index));

/** First and last day with ink, or null on an empty index. */
export const timelineRangeExtent = derived(timelineIndexFiltered, $index => timelineExtent($index));

/** What loading the current range would bring in. */
export const timelineSummary = derived(
  [timelineIndexFiltered, timelineRange],
  ([$index, $range]) => {
    if (!$index || !$range.from || !$range.to) {
      return { days: 0, pages: 0, strokes: 0, contextStrokes: 0, partialPages: 0 };
    }
    return rangeSummary($index, $range.from, $range.to);
  }
);

/** The days inside the current range that actually hold ink, with their pages. */
export const timelineRangeDays = derived(
  [timelineIndexFiltered, timelineRange, timelineDays],
  ([$index, $range, $days]) => {
    if (!$index || !$range.from || !$range.to) return [];
    return $days
      .filter(d => d.day >= $range.from && d.day <= $range.to)
      .map(d => ({ ...d, entries: pagesOnDay($index, d.day) }));
  }
);

let loadInFlight = false;

/**
 * Fetch (and incrementally refresh) the index.
 *
 * Coalesced like `scanLocalPages`: the Dates tab, a post-save refresh and a
 * boot preload can all ask at once, and the extra callers should pick up the
 * result reactively rather than each triggering a pass over the folder.
 *
 * @param {{force?: boolean, silent?: boolean}} [options]
 */
export async function loadTimeline(options = {}) {
  if (!get(dataRoot) || !get(dataFolderReady)) {
    timelineError.set('No data folder configured.');
    return false;
  }
  if (loadInFlight) return false;

  loadInFlight = true;
  timelineLoading.set(true);
  timelineError.set(null);

  try {
    const index = await getTimelineIndex({ force: !!options.force });
    timelineIndex.set(index);

    // Default the range only once, and only to something with ink in it: the
    // most recent capture day. Picking "today" would open on an empty range
    // whenever the user last wrote earlier in the week.
    const range = get(timelineRange);
    if (!range.from || !range.to) {
      const extent = timelineExtent(filterIndexByBooks(index, get(timelineExcludedBooks)));
      if (extent) timelineRange.set({ from: extent.last, to: extent.last });
    }

    if (!options.silent) {
      const days = dayTotals(index).length;
      const pages = Object.keys(index?.pages || {}).length;
      log(`Capture dates indexed: ${days} day(s) across ${pages} page(s)`, 'info');
    }
    return true;
  } catch (err) {
    console.error('Timeline index failed:', err);
    timelineError.set(err.message);
    if (!options.silent) log(`Could not read capture dates: ${err.message}`, 'error');
    return false;
  } finally {
    loadInFlight = false;
    timelineLoading.set(false);
  }
}

/** Set the range, normalising the ends so `from` is never after `to`. */
export function setTimelineRange(from, to) {
  if (!from && !to) return;
  const a = from || to;
  const b = to || from;
  timelineRange.set(a <= b ? { from: a, to: b } : { from: b, to: a });
}

/** Extend the range to include one more day (drag-select across the grid). */
export function extendTimelineRange(anchor, day) {
  setTimelineRange(anchor, day);
}

/** Shift the whole range by n days, keeping its length. */
export function shiftTimelineRange(n) {
  const { from, to } = get(timelineRange);
  if (!from || !to) return;
  setTimelineRange(addDays(from, n), addDays(to, n));
}

export function setCanvasPageOrder(mode) {
  canvasPageOrder.set(mode === 'date' ? 'date' : 'book');
}
