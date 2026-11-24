/**
 * Timeline Store — the capture-date index and the range the user has picked.
 *
 * The index is histograms, not strokes: one `{day: count}` map per page, a few
 * tens of KB for a ~300-page corpus, so unlike the page scan there is no reason
 * to keep it off the heap. See `src/lib/timeline.js` for what the shapes mean
 * and `buildTimeline` in electron/main.cjs for how it is built.
 */
import { writable, derived, get } from 'svelte/store';
import { getTimelineIndex, getPage } from '$lib/storage/local-store.js';
import {
  dayTotals, timelineExtent, rangeSummary, pagesOnDay, addDays,
  filterIndexByBooks, indexBooks, dayKey
} from '$lib/timeline.js';
import { defaultTimelineDay } from '$lib/timeline-range.js';
import { dataRoot, dataFolderReady } from './settings.js';
import { log } from './ui.js';
import { debug } from '$lib/debug.js';
import { bookTypes, bookTypeFilter } from './book-types.js';
import { booksOutsideType, matchesTypeFilter } from '$lib/book-types.js';
import { filterIndexByTags, indexTags, scopedStrokes, dayHistogram, scopeIndex } from '$lib/timeline-tags.js';
import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
import { tagKey, infoOf } from '$lib/tags.js';
import { pageTags, tagInfo, tagBlocks } from './tags.js';

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

/**
 * True while the range is the one the app picked, not the user (v3.10.0). Each
 * index refresh then re-picks it (`defaultTimelineDay`): today once today has ink
 * on disk, so a page saved this morning, or an app left open overnight, opens on
 * today. Any range the user sets (`setTimelineRange`, the Today button) ends it
 * for the session.
 */
export const timelineRangeIsDefault = writable(true);

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

/**
 * Book keys the notebook-type filter (v3.15.0) leaves out. Kept apart from the
 * exclusions above so choosing "All types" brings back exactly what the type
 * hid, and a new notebook of the chosen type shows up without a click.
 */
export const timelineTypeExcludedBooks = derived(
  [timelineIndex, bookTypes, bookTypeFilter],
  ([$index, $types, $filter]) => booksOutsideType(indexBooks($index).map((b) => b.book), $filter, $types)
);

/* ------------------------------------------------------------------
 * Tag filter. Stored as the CHOSEN tags (pages with any of them stay), and
 * session-only on purpose: a remembered tag filter would hide today's
 * untagged ink on the next launch. Applied after the book and type filters,
 * and offers only tags on pages of the notebooks those leave in.
 * ------------------------------------------------------------------ */

/** Tags the date features are narrowed to; empty = no tag filter. */
export const timelineTagFilter = writable(new Set());

export function setTagIncluded(tag, included) {
  timelineTagFilter.update((set) => {
    const key = String(tag);
    if (included === set.has(key)) return set;
    const next = new Set(set);
    if (included) next.add(key); else next.delete(key);
    return next;
  });
}

/** Narrow to one tag — the tag column's "Only". */
export function includeOnlyTag(tag) {
  timelineTagFilter.set(new Set([String(tag)]));
}

export function clearTagFilter() {
  if (get(timelineTagFilter).size) timelineTagFilter.set(new Set());
}

/** True while the book, type or tag filter leaves anything out. */
export const timelineFiltering = derived(
  [timelineExcludedBooks, timelineTypeExcludedBooks, timelineTagFilter],
  ([$excluded, $byType, $tags]) => $excluded.size > 0 || $byType.size > 0 || $tags.size > 0
);

/** The index with excluded books (by hand or by type) removed, before the tag filter. */
const timelineIndexByBooks = derived(
  [timelineIndex, timelineExcludedBooks, timelineTypeExcludedBooks],
  ([$index, $excluded, $byType]) =>
    filterIndexByBooks($index, $byType.size ? new Set([...$excluded, ...$byType]) : $excluded)
);

/**
 * Block scope under a tag filter (v3.26.0). Each page carrying a chosen tag is
 * read once (`getPage`, never the reader's page cache), its strokes narrowed to
 * the tags' blocks (`scopedStrokes`) and only their capture days kept, so the
 * activity grid, tallies and feed never count the rest of the page. Cached by
 * page key; an entry is reused while the file (index `mtimeMs` + `size`), the
 * page's chosen tags, their info and the page's block corrections are unchanged.
 * Only the day histogram is kept, never strokes.
 */
const scopeCache = new Map();   // page key → { sig, days, why }
const SCOPE_READS = 4;
let scopeRun = 0;

/** Pages still being read for block scope (0 when settled). */
export const timelineScoping = writable(0);

function chosenOnPage(entry, chosen, $pageTags) {
  const list = ($pageTags && $pageTags[tagKey(entry.book, entry.pageId != null ? entry.pageId : entry.page)]) || [];
  return list.filter((t) => chosen.has(t)).sort();
}

function scopeSig(entry, tags, $info, $blocks) {
  const key = tagKey(entry.book, entry.pageId != null ? entry.pageId : entry.page);
  return JSON.stringify([entry.mtimeMs ?? null, entry.size ?? null, tags,
    tags.map((t) => infoOf($info, t)), ($blocks && $blocks[key]) || null]);
}

async function readScope(key, entry, tags, $info, $blocks) {
  const pageKey = tagKey(entry.book, entry.pageId != null ? entry.pageId : entry.page);
  const doc = await getPage(entry.book, entry.pageId != null ? entry.pageId : entry.page);
  if (!doc) return { days: { ...entry.days }, why: 'unreadable' };
  const res = scopedStrokes(doc, tags, {
    info: $info, corrections: ($blocks && $blocks[pageKey]) || {}, trusted: isTrustworthyTranscript(doc)
  });
  return { days: res.strokes ? dayHistogram(res.strokes) : { ...entry.days }, why: res.why };
}

/** The index as the date features see it — excluded books removed, tag filter and block scope applied. */
export const timelineIndexFiltered = derived(
  [timelineIndexByBooks, timelineTagFilter, pageTags, tagInfo, tagBlocks],
  ([$index, $chosen, $pageTags, $info, $blocks], set) => {
    const run = ++scopeRun;
    const byTags = filterIndexByTags($index, $chosen, $pageTags);
    if (!$chosen || $chosen.size === 0 || !byTags) {
      timelineScoping.set(0);
      set(byTags);
      return;
    }
    const lookup = (key, entry) => {
      const c = scopeCache.get(key);
      return c && c.sig === scopeSig(entry, chosenOnPage(entry, $chosen, $pageTags), $info, $blocks) ? c : undefined;
    };
    const first = scopeIndex(byTags, lookup);
    set(first.index);
    timelineScoping.set(first.missing.length);
    if (!first.missing.length) return;

    const queue = [...first.missing];
    const worker = async () => {
      while (queue.length && run === scopeRun) {
        const key = queue.shift();
        const entry = byTags.pages[key];
        const tags = chosenOnPage(entry, $chosen, $pageTags);
        try {
          const res = await readScope(key, entry, tags, $info, $blocks);
          scopeCache.set(key, { sig: scopeSig(entry, tags, $info, $blocks), ...res });
        } catch (err) {
          debug('[timeline] block scope read failed', key, err);
          scopeCache.set(key, { sig: scopeSig(entry, tags, $info, $blocks), days: { ...entry.days }, why: 'unreadable' });
        }
        if (run === scopeRun) timelineScoping.update((n) => Math.max(0, n - 1));
      }
    };
    Promise.all(Array.from({ length: Math.min(SCOPE_READS, queue.length) }, worker)).then(() => {
      if (run === scopeRun) set(scopeIndex(byTags, lookup).index);
    });
  },
  null
);

/** Forget block-scope results (a data-folder change). */
export function clearScopeCache() {
  scopeCache.clear();
}

/**
 * The tag filter's rows: tags on pages of the included notebooks only (no
 * filter that could never match), with pages holding ink in the range; chosen
 * tags are always listed so they can be unticked.
 */
export const timelineTags = derived(
  [timelineIndexByBooks, pageTags, timelineRange, timelineTagFilter],
  ([$index, $pageTags, $range, $chosen]) => indexTags($index, $pageTags, $range.from, $range.to, $chosen)
);

/**
 * Every book in the index with strokes in the current range: the book filter's
 * rows, so only notebooks of the chosen type when a type filter is on.
 */
export const timelineBooks = derived(
  [timelineIndex, timelineRange, bookTypes, bookTypeFilter],
  ([$index, $range, $types, $filter]) =>
    indexBooks($index, $range.from, $range.to).filter((b) => matchesTypeFilter(b.book, $filter, $types))
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

    // Default the range to something with ink in it: today when today has
    // ink, else the most recent capture day (an empty "today" would open on
    // nothing whenever the user last wrote earlier in the week). Re-picked on
    // every refresh until the user chooses a range.
    const range = get(timelineRange);
    if (!range.from || !range.to || get(timelineRangeIsDefault)) {
      const days = dayTotals(filterIndexByBooks(index, get(timelineExcludedBooks)));
      const day = defaultTimelineDay(days, dayKey(Date.now()));
      if (day && (range.from !== day || range.to !== day)) timelineRange.set({ from: day, to: day });
    }

    if (!options.silent) {
      const days = dayTotals(index).length;
      const pages = Object.keys(index?.pages || {}).length;
      log(`Capture dates indexed: ${days} day(s) across ${pages} page(s)`, 'info');
    }
    return true;
  } catch (err) {
    debug('[timeline] index failed:', err);
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
  timelineRangeIsDefault.set(false);
  timelineRange.set(a <= b ? { from: a, to: b } : { from: b, to: a });
}

/** The Today button: today's day, ink or not (the feed says when it is empty). */
export function showTimelineToday(now = Date.now()) {
  const today = dayKey(now);
  setTimelineRange(today, today);
}

export function setCanvasPageOrder(mode) {
  canvasPageOrder.set(mode === 'date' ? 'date' : 'book');
}
