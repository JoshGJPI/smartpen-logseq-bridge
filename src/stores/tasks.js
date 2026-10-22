/**
 * Tasks Store — every task line in the library, and changing one (v3.4.0).
 *
 * `taskRows` is derived from what is already in memory: the scan records'
 * `tasks` summaries, the page tags (for the project) and the capture-date
 * index (for the date written). Nothing here reads a page.
 *
 * A change is optimistic, like a tag change (stores/tags.js): the new state
 * shows at once (`taskOverrides`), the write goes through
 * lib/viewer/task-state.js setTaskState() (one line of one PageDoc), and a
 * failed write rolls back that one task, only if nothing has changed it
 * since, and says why in the Activity Log. Writes to the same page run one at
 * a time. The last change can be undone (`taskUndo`, the toast's Undo) until
 * the next change. Session-only.
 */

import { writable, derived, get } from 'svelte/store';
import { savedPages } from './saved-pages.js';
import { pageTags } from './tags.js';
import { libraryPageDates } from './library.js';
import { isViewerPageDirty } from './viewer.js';
import { log } from './ui.js';
import {
  buildTaskRows, taskCounts, taskKey, parseTaskFilter, parseTaskGroup, isTaskState, toggledState, TASK_GROUP_KEY
} from '$lib/tasks.js';
import { setTaskState, taskChangeLabel } from '$lib/viewer/task-state.js';
import { readString, write } from '$lib/safe-storage.js';
import { debug } from '$lib/debug.js';

/** taskKey → the state the app has set but the scan record may not show yet. */
export const taskOverrides = writable(new Map());

/** One row per task (lib/tasks.js buildTaskRows), unfiltered and unsorted. */
export const taskRows = derived(
  [savedPages, pageTags, libraryPageDates, taskOverrides],
  ([$pages, $tags, $dates, $over]) => buildTaskRows($pages, { tags: $tags, dates: $dates, overrides: $over })
);

/** `{ open, waiting, done, cancelled, all }` */
export const taskCountsStore = derived(taskRows, ($rows) => taskCounts($rows));

/** The header badge: open (TODO) tasks. */
export const openTaskCount = derived(taskCountsStore, ($c) => $c.open);

/** The Tasks view's state filter: 'open' | 'waiting' | 'done' | 'cancelled' | 'all'. Session-only. */
export const taskFilter = writable('open');

export function setTaskFilter(id) {
  taskFilter.set(parseTaskFilter(id));
}

/** Group by 'project' | 'date' | 'book'. A per-viewer convenience. */
export const taskGroupBy = writable(parseTaskGroup(readString(TASK_GROUP_KEY)));

export function setTaskGroupBy(id) {
  const next = parseTaskGroup(id);
  write(TASK_GROUP_KEY, next);
  taskGroupBy.set(next);
}

/** The last change, for Undo: `{ label, book, pageId, lineId, prev, state }` or null. */
export const taskUndo = writable(null);

// Per-page write chains: a page's writes run in order, so the last one wins.
const chains = new Map();

function enqueue(pageKey, job) {
  const prev = chains.get(pageKey) || Promise.resolve();
  const run = prev.then(job, job);
  chains.set(pageKey, run);
  run.finally(() => {
    if (chains.get(pageKey) === run) chains.delete(pageKey);
  });
  return run;
}

function setOverride(key, state) {
  taskOverrides.update((m) => {
    const next = new Map(m);
    if (state == null) next.delete(key);
    else next.set(key, state);
    return next;
  });
}

/** The state a task shows now (an unsaved-yet override, else the scan). */
export function currentTaskState(book, pageId, lineId) {
  const key = taskKey(book, pageId, lineId);
  const over = get(taskOverrides).get(key);
  if (over) return over;
  const row = get(taskRows).find((r) => r.key === key);
  return row ? row.state : null;
}

/**
 * Set a task's state: shown at once, written to its PageDoc, rolled back if
 * the write fails.
 * @param {string} book  book key
 * @param {string} pageId
 * @param {string} lineId
 * @param {'todo'|'done'|'waiting'|'cancelled'} state
 * @param {{ from?: string, undoable?: boolean }} [opts]  `from`: the state the
 *   caller shows, for a line the scan doesn't list yet
 * @returns {Promise<boolean>} true when the page holds the new state
 */
export function changeTask(book, pageId, lineId, state, { from = null, undoable = true } = {}) {
  book = String(book);
  pageId = String(pageId);
  if (!isTaskState(state)) return Promise.resolve(false);
  if (isViewerPageDirty(book, pageId)) {
    log(`B${book}/P${pageId} has unsaved transcript edits. Save or cancel them before changing a task there.`, 'warning');
    return Promise.resolve(false);
  }
  const key = taskKey(book, pageId, lineId);
  const prev = currentTaskState(book, pageId, lineId) || from;
  if (prev === state) return Promise.resolve(true);

  setOverride(key, state);
  const change = undoable && prev
    ? { label: taskChangeLabel(state, book, pageId), book, pageId, lineId, prev, state }
    : null;
  taskUndo.set(change);

  return enqueue(`${book}/${pageId}`, async () => {
    try {
      await setTaskState(book, pageId, lineId, state);
      // The scan record holds it now (task-state.js updated it).
      if (get(taskOverrides).get(key) === state) setOverride(key, null);
      debug('[tasks] set', key, state);
      return true;
    } catch (err) {
      if (get(taskOverrides).get(key) === state) setOverride(key, null);
      if (change && get(taskUndo) === change) taskUndo.set(null);
      log(`Could not change the task on B${book}/P${pageId}: ${err?.message || err}`, 'error');
      return false;
    }
  });
}

/** Tick ↔ untick: DONE or CANCELLED goes back to TODO, TODO or WAITING to DONE. */
export function toggleTask(book, pageId, lineId, { from = null } = {}) {
  const now = currentTaskState(book, pageId, lineId) || from;
  return changeTask(book, pageId, lineId, toggledState(now), { from });
}

/**
 * Put the last change back. Not itself undoable.
 * @returns {Promise<boolean>} false when there was nothing to undo or the write failed
 */
export function undoTaskChange() {
  const u = get(taskUndo);
  if (!u) return Promise.resolve(false);
  taskUndo.set(null);
  return changeTask(u.book, u.pageId, u.lineId, u.prev, { undoable: false });
}

/** Forget pending state (a data-folder change). Writes in flight still finish. */
export function clearTasks() {
  taskOverrides.set(new Map());
  taskUndo.set(null);
}
