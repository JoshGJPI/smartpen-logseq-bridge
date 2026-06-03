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
