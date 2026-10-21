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
import { writable, derived, get } from 'svelte/store';
import {
  destinationOf, modesFor, planNavigation, isDestination, DISCARD_PROMPT
} from '../lib/navigation.js';

/* ============================================================
 *  Pane mode
 * ============================================================ */

/**
 * 'editor' = live StrokeCanvas (capture/edit), 'book' = BookViewer.
 * The app opens on Book View's Timeline (see `bookViewMode`), not an empty canvas.
 */
export const viewerMode = writable('book');

export function setViewerMode(mode) {
  viewerMode.set(mode === 'book' ? 'book' : 'editor');
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

/**
 * Live pen ink belongs on the Editor canvas, so Book View steps aside when the
 * pen starts writing. Unsaved transcript edits win: switching would unmount
 * them, so the pane stays put (the strokes are still captured either way).
 * @returns {'switched' | 'blocked' | 'already'}
 */
export function showEditorForLiveInk() {
  if (get(viewerMode) !== 'book') return 'already';
  if (get(viewerDirty)) return 'blocked';
  viewerMode.set('editor');
  return 'switched';
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
 *  ink, card per sitting. The app always opens on the Timeline; feed order is a
 *  per-viewer convenience, so it persists to localStorage. The in-view day and
 *  jump requests are session-only.
 * ============================================================ */

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
export const bookViewMode = writable('timeline');

export function setBookViewMode(mode) {
  bookViewMode.set(mode === 'books' ? 'books' : 'timeline');
}

/** Feed order. Newest first by default — the day you just wrote is on top. */
export const feedOrder = writable(loadChoice(FEED_ORDER_KEY, ['newest', 'oldest'], 'newest'));

export function setFeedOrder(order) {
  const next = order === 'oldest' ? 'oldest' : 'newest';
  persistChoice(FEED_ORDER_KEY, next);
  feedOrder.set(next);
}

/**
 * Book View's hover highlight: hovering ink shows its sitting in ink, the rest
 * of the page grey, with the sitting's date and time. On unless switched off.
 */
const SITTING_HOVER_KEY = 'smartpen-sitting-hover';

export const sittingHoverEnabled = writable(loadChoice(SITTING_HOVER_KEY, ['on', 'off'], 'on') === 'on');

export function toggleSittingHover() {
  sittingHoverEnabled.update((on) => {
    persistChoice(SITTING_HOVER_KEY, on ? 'off' : 'on');
    return !on;
  });
}

/* ============================================================
 *  Navigation spine (reading-first package C)
 *  Library | Timeline | Editor, mapped onto viewerMode + bookViewMode
 *  (lib/navigation.js). Every route between them goes through navigateTo, so
 *  the unsaved-transcript prompt is asked in one place.
 * ============================================================ */

/** 'library' | 'timeline' | 'editor' */
export const destination = derived(
  [viewerMode, bookViewMode],
  ([$viewerMode, $bookViewMode]) => destinationOf($viewerMode, $bookViewMode)
);

function windowConfirm(message) {
  return typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(message)
    : false;
}

/**
 * Go to a destination, asking first when that would drop transcript edits.
 * @param {'library'|'timeline'|'editor'} dest
 * @param {{confirm?: (message: string) => boolean}} [opts] - injectable for tests
 * @returns {'same'|'cancelled'|'navigated'|'invalid'}
 */
export function navigateTo(dest, { confirm = windowConfirm } = {}) {
  if (!isDestination(dest)) return 'invalid';
  const plan = planNavigation({ from: get(destination), to: dest, viewerDirty: get(viewerDirty) });
  if (plan === 'same') return 'same';
  if (plan === 'confirm') {
    if (!confirm(DISCARD_PROMPT)) return 'cancelled';
    clearAllViewerDirty();
  }
  const modes = modesFor(dest);
  if (modes.bookViewMode) bookViewMode.set(modes.bookViewMode);
  viewerMode.set(modes.viewerMode);
  return 'navigated';
}

/**
 * Open one page in the Library (feed card, search result, contents list).
 * Changing the open page unmounts its transcript editor even when the Library
 * is already showing, so the same prompt applies; re-opening the page that is
 * already open does not ask.
 * @returns {'cancelled'|'opened'}
 */
export function openPageInLibrary(book, pageId, { confirm = windowConfirm } = {}) {
  const sel = get(viewerSelection);
  const samePage = sel && String(sel.book) === String(book) && sel.pageId === String(pageId);
  if (!samePage && get(viewerDirty)) {
    if (!confirm(DISCARD_PROMPT)) return 'cancelled';
    clearAllViewerDirty();
  }
  setViewerSelection(book, pageId);
  recordRecentView(book, String(pageId));
  // Dirty was settled above, so this never asks again.
  navigateTo('library', { confirm });
  return 'opened';
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

/* ============================================================
 *  Library home + global search (reading-first package E)
 *  Session-only: none of these is persisted.
 * ============================================================ */

/**
 * The notebook whose page grid the Library shows when no page is open, or
 * null for the home (notebook cards). A book key: a volume is its own notebook.
 */
export const libraryNotebook = writable(null);

/**
 * A Library page list that is not one notebook (v3.1.0 page tags), shown when
 * no page is open and `libraryNotebook` is null:
 *   { kind: 'tag', tag }      that tag's pages, across notebooks
 *   { kind: 'untagged' }      pages with no tag
 *   { kind: 'suggestions' }   the suggested-project-number queue
 * null = the home. Session-only.
 */
export const libraryView = writable(null);

/** A notebook's page grid, or the home for null. Leaves any tag view. */
export function showLibraryGrid(book) {
  libraryView.set(null);
  libraryNotebook.set(book == null ? null : String(book));
}

/**
 * Show one notebook's page grid in the Library (a card, a Notebook search
 * result). Leaving an open page with unsaved transcript edits asks first.
 * @returns {'cancelled'|'opened'}
 */
export function openNotebookInLibrary(book, { confirm = windowConfirm } = {}) {
  if (get(viewerSelection) && get(viewerDirty)) {
    if (!confirm(DISCARD_PROMPT)) return 'cancelled';
    clearAllViewerDirty();
  }
  clearViewerSelection();
  showLibraryGrid(book);
  navigateTo('library', { confirm });
  return 'opened';
}

/**
 * Show a tag's pages, the Untagged pages or the suggestions queue in the
 * Library (a tag card, a Tags search result). Asks first like a notebook.
 * @param {{kind: 'tag', tag: string}|{kind: 'untagged'}|{kind: 'suggestions'}} view
 * @returns {'cancelled'|'opened'}
 */
export function openLibraryView(view, { confirm = windowConfirm } = {}) {
  if (get(viewerSelection) && get(viewerDirty)) {
    if (!confirm(DISCARD_PROMPT)) return 'cancelled';
    clearAllViewerDirty();
  }
  clearViewerSelection();
  libraryNotebook.set(null);
  libraryView.set(view || null);
  navigateTo('library', { confirm });
  return 'opened';
}

/** True while a Library transcript is in edit mode (Ctrl K stays out of it). */
export const transcriptEditing = writable(false);

/**
 * Page ids the reader is showing in the open book: one, or both pages of a
 * spread. The contents list highlights them all.
 */
export const readerPages = writable([]);

/**
 * A search hit the reader should point at: { book, pageId, tokens, n }. The
 * open page lights the matching line only where its links are trustworthy
 * (ink-text.js); `n` changes on every request, so re-opening the same hit
 * shows it again.
 */
export const readerFocus = writable(null);

export function focusReaderLine(book, pageId, tokens) {
  readerFocus.update((f) => ({ book: String(book), pageId: String(pageId), tokens: [...(tokens || [])], n: (f ? f.n : 0) + 1 }));
}

export function clearReaderFocus() {
  readerFocus.set(null);
}
