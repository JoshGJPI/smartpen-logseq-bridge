/**
 * View history store — the header's Back / Forward (v3.13.0).
 *
 * It watches the navigation stores (destination, libraryNotebook, libraryView,
 * viewerSelection) instead of hooking every route, so whatever moves the pane
 * (a tab, a tile, a crumb, search, a task link, Escape) is recorded. Changes
 * made together in one handler (openLibraryView sets four stores) settle into
 * one entry: the record is taken in a microtask, after the handler is done.
 *
 * Back / Forward put the entry's stores back directly, with the same unsaved
 * transcript prompt as every other route (DISCARD_PROMPT): leaving a page with a
 * draft asks first, and a No leaves the history where it was. A page turn in
 * the reader calls `replaceNextView()` first, so it replaces the current entry.
 * Pure rules: lib/view-history.js. Session-only.
 */

import { writable, derived, get } from 'svelte/store';
import {
  destination, viewerMode, bookViewMode, libraryNotebook, libraryView, viewerSelection,
  readerSequence, readerOrder, viewerDirty, clearAllViewerDirty
} from './viewer.js';
import { DISCARD_PROMPT, modesFor } from '$lib/navigation.js';
import {
  emptyHistory, recordView, refreshCurrent, stepTarget, stepped, canStep, viewKey
} from '$lib/view-history.js';

export const viewHistory = writable(emptyHistory());
export const canGoBack = derived(viewHistory, (h) => canStep(h, 'back'));
export const canGoForward = derived(viewHistory, (h) => canStep(h, 'forward'));
/** The entries one step away (tooltips), or null. */
export const backTarget = derived(viewHistory, (h) => stepTarget(h, 'back'));
export const forwardTarget = derived(viewHistory, (h) => stepTarget(h, 'forward'));

let pending = false;
let applying = false;
let replaceNext = false;
let unsubscribers = [];

/** Where the pane is now. */
export function currentView() {
  const sel = get(viewerSelection);
  return {
    dest: get(destination),
    notebook: get(libraryNotebook),
    view: get(libraryView),
    selection: sel ? { book: String(sel.book), pageId: String(sel.pageId) } : null,
    sequence: get(readerSequence),
    order: get(readerOrder)
  };
}

function flush() {
  if (!pending) return;
  pending = false;
  const now = currentView();
  if (applying) {
    applying = false;
    viewHistory.update((h) => refreshCurrent(h, now));
    return;
  }
  const replace = replaceNext;
  replaceNext = false;
  viewHistory.update((h) => recordView(h, now, { replace }));
}

function schedule() {
  if (pending) return;
  pending = true;
  queueMicrotask(flush);
}

/** The next recorded view replaces the current one (a page turn). */
export function replaceNextView() {
  replaceNext = true;
}

/** Start recording (App onMount). Idempotent; returns a stop function. */
export function startViewHistory() {
  if (unsubscribers.length) return stopViewHistory;
  // Each subscribe calls back at once; the microtask records the start view.
  unsubscribers = [destination, libraryNotebook, libraryView, viewerSelection].map((s) => s.subscribe(schedule));
  return stopViewHistory;
}

export function stopViewHistory() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
}

/** Forget the history (tests, a data-folder change). */
export function clearViewHistory() {
  viewHistory.set(emptyHistory());
  replaceNext = false;
}

function windowConfirm(message) {
  return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false;
}

/** Put an entry's stores back. false when the user keeps an unsaved draft. */
function restore(entry, confirm) {
  const sel = get(viewerSelection);
  const staysOnPage = entry.dest === 'library' && entry.selection && sel
    && String(sel.book) === entry.selection.book && String(sel.pageId) === entry.selection.pageId;
  if (get(viewerDirty) && !staysOnPage) {
    if (!confirm(DISCARD_PROMPT)) return false;
    clearAllViewerDirty();
  }
  applying = true;
  if (entry.dest === 'library') {
    libraryNotebook.set(entry.notebook ?? null);
    libraryView.set(entry.view ?? null);
    viewerSelection.set(entry.selection ? { ...entry.selection } : null);
    readerSequence.set(entry.sequence ?? null);
    readerOrder.set(entry.sequence && entry.order === 'tag' ? 'tag' : 'book');
  }
  const modes = modesFor(entry.dest);
  if (modes.bookViewMode) bookViewMode.set(modes.bookViewMode);
  viewerMode.set(modes.viewerMode);
  schedule();
  return true;
}

/**
 * One step 'back' or 'forward'.
 * @returns {'moved'|'none'|'cancelled'}
 */
export function stepView(dir, { confirm = windowConfirm } = {}) {
  const h = get(viewHistory);
  const target = stepTarget(h, dir);
  if (!target) return 'none';
  // Settle a change still waiting for its microtask, so it isn't lost.
  if (pending && viewKey(currentView()) !== viewKey(h.entries[h.index])) flush();
  const h2 = get(viewHistory);
  const t2 = stepTarget(h2, dir);
  if (!t2) return 'none';
  viewHistory.set(stepped(h2, dir));
  if (!restore(t2, confirm)) {
    viewHistory.set(h2);
    return 'cancelled';
  }
  return 'moved';
}

export const goBack = (opts) => stepView('back', opts);
export const goForward = (opts) => stepView('forward', opts);
