/**
 * Viewer Store — state for the Book View pane (v2.1)
 *
 * The right-hand canvas pane can show either the live capture canvas
 * (`StrokeCanvas`) or the read/edit-oriented Book View (`BookViewer`).
 * This store owns the pane mode, the per-page "unsaved transcript edit"
 * dirty set (kept separate from the canvas's global `unsavedChanges` flag so
 * a transcript save never masks unsaved stroke changes), and the
 * recently-viewed pages list (persisted to localStorage).
 */
import { writable, derived } from 'svelte/store';

/* ============================================================
 *  Pane mode
 * ============================================================ */

/** 'editor' = live StrokeCanvas (capture/edit), 'book' = BookViewer */
export const viewerMode = writable('editor');

export function setViewerMode(mode) {
  viewerMode.set(mode === 'book' ? 'book' : 'editor');
}

export function toggleViewerMode() {
  viewerMode.update(m => (m === 'book' ? 'editor' : 'book'));
}

/* ============================================================
 *  Unsaved transcript-edit tracking (per page)
 * ============================================================ */

const dirtyPages = writable(new Set());

/** True when any open transcript pane has unsaved edits. */
export const viewerDirty = derived(dirtyPages, ($set) => $set.size > 0);

/** @param {string} key - `${book}:${page}` */
export function markViewerDirtyPage(key) {
  dirtyPages.update((s) => {
    const next = new Set(s);
    next.add(key);
    return next;
  });
}

/** @param {string} key - `${book}:${page}` */
export function clearViewerDirtyPage(key) {
  dirtyPages.update((s) => {
    if (!s.has(key)) return s;
    const next = new Set(s);
    next.delete(key);
    return next;
  });
}

export function clearAllViewerDirty() {
  dirtyPages.set(new Set());
}

/* ============================================================
 *  Recently-viewed pages (localStorage-backed)
 * ============================================================ */

const RECENT_KEY = 'smartpen-viewer-recent';
const MAX_RECENT = 8;

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRecent(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / unavailable storage */
  }
}

/** @type {import('svelte/store').Writable<Array<{book:number,pageId:string,viewedAt:number}>>} */
export const recentViews = writable(loadRecent());

export function recordRecentView(book, pageId) {
  recentViews.update((list) => {
    const next = [
      { book, pageId, viewedAt: Date.now() },
      ...list.filter((r) => !(r.book === book && r.pageId === pageId)),
    ].slice(0, MAX_RECENT);
    persistRecent(next);
    return next;
  });
}

/* ============================================================
 *  Last-open selection (localStorage-backed)
 *  Lets Book View reopen the page(s) you were last viewing, instead of
 *  resetting to the home grid each time the pane is toggled or reloaded.
 * ============================================================ */

const SELECTION_KEY = 'smartpen-viewer-selection';

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.book != null && parsed.pageId != null) {
      return { book: parsed.book, pageId: String(parsed.pageId) };
    }
    return null;
  } catch {
    return null;
  }
}

/** @type {import('svelte/store').Writable<{book:number,pageId:string}|null>} */
export const viewerSelection = writable(loadSelection());

export function setViewerSelection(book, pageId) {
  const sel = { book, pageId: String(pageId) };
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
  viewerSelection.set(sel);
}

export function clearViewerSelection() {
  try {
    localStorage.removeItem(SELECTION_KEY);
  } catch {
    /* ignore */
  }
  viewerSelection.set(null);
}

/* ============================================================
 *  Timeline feed (v2.9)
 *  Book View's second mode: the Dates tab's range as one scrolling column of
 *  ink, card per sitting. Mode and order are per-viewer conveniences, so they
 *  persist to localStorage; the in-view day and jump requests are session-only.
 * ============================================================ */

const BOOK_VIEW_MODE_KEY = 'smartpen-book-view-mode';
const FEED_ORDER_KEY = 'smartpen-feed-order';

function loadChoice(key, allowed, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function persistChoice(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** 'books' = the page grid / spread, 'timeline' = the date feed. */
export const bookViewMode = writable(loadChoice(BOOK_VIEW_MODE_KEY, ['books', 'timeline'], 'books'));

export function setBookViewMode(mode) {
  const next = mode === 'timeline' ? 'timeline' : 'books';
  persistChoice(BOOK_VIEW_MODE_KEY, next);
  bookViewMode.set(next);
}

/** Feed order. Newest first by default — the day you just wrote is on top. */
export const feedOrder = writable(loadChoice(FEED_ORDER_KEY, ['newest', 'oldest'], 'newest'));

export function setFeedOrder(order) {
  const next = order === 'oldest' ? 'oldest' : 'newest';
  persistChoice(FEED_ORDER_KEY, next);
  feedOrder.set(next);
}

export function toggleFeedOrder() {
  feedOrder.update((o) => {
    const next = o === 'oldest' ? 'newest' : 'oldest';
    persistChoice(FEED_ORDER_KEY, next);
    return next;
  });
}

/** True when the right pane is actually showing the feed. */
export const feedVisible = derived(
  [viewerMode, bookViewMode],
  ([$viewerMode, $bookViewMode]) => $viewerMode === 'book' && $bookViewMode === 'timeline'
);

/** The day key at the top of the feed's viewport (scroll-spy), or null. */
export const feedDayInView = writable(null);

/**
 * Ask the feed to scroll to a day. A counter rather than the bare day key, so
 * asking for the day that is already requested scrolls again (the same pattern
 * as `transcriptSearchFocus`).
 */
export const feedJumpRequest = writable({ day: null, n: 0 });

export function requestFeedJump(day) {
  feedJumpRequest.update((r) => ({ day, n: r.n + 1 }));
}
