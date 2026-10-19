/**
 * Left Panel Store — whether the data explorer is collapsed to its rail
 * (reading-first package B).
 *
 * A per-viewer convenience, so localStorage and never the data folder. Every
 * storage access is guarded: a blocked or corrupt store must leave the panel
 * expanded and working, not throw during module load.
 *
 * Revealing the panel for a caller that wants the user to see it
 * (`revealLeftPanel`) lives in `ui.js` next to `activeTab`, since it also
 * selects a tab; it builds on `expandLeftPanel` here.
 */
import { writable, get } from 'svelte/store';
import { LEFT_PANEL_KEY, parseCollapsed, serializeCollapsed } from '../lib/left-panel.js';

function load() {
  try {
    return parseCollapsed(localStorage.getItem(LEFT_PANEL_KEY));
  } catch {
    return false;
  }
}

function persist(collapsed) {
  try {
    localStorage.setItem(LEFT_PANEL_KEY, serializeCollapsed(collapsed));
  } catch {
    /* per-viewer convenience: not being able to remember is fine */
  }
}

/**
 * Notebooks open in the Library's contents list. Session-only (tab content is
 * unmounted when collapsed or switched away, so it cannot live in the component).
 */
export const contentsOpenBooks = writable(new Set());

/** @param {string} book @param {boolean} [open] - toggles when omitted */
export function setContentsBookOpen(book, open) {
  contentsOpenBooks.update((set) => {
    const key = String(book);
    const next = new Set(set);
    if (open ?? !set.has(key)) next.add(key); else next.delete(key);
    return next;
  });
}

/** True when the panel is the ~48 px rail. */
export const leftPanelCollapsed = writable(load());

/** @param {boolean} collapsed */
export function setLeftPanelCollapsed(collapsed) {
  const next = !!collapsed;
  persist(next);
  leftPanelCollapsed.set(next);
}

export function toggleLeftPanel() {
  setLeftPanelCollapsed(!get(leftPanelCollapsed));
}

export function expandLeftPanel() {
  setLeftPanelCollapsed(false);
}

export function collapseLeftPanel() {
  setLeftPanelCollapsed(true);
}
