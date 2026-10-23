/**
 * tasks — transcript lines as tasks (v3.4.0). Pure: no DOM, no stores, no I/O.
 *
 * A task is a transcript line whose `checked` is set. Its state is one of
 * four, and only four (no DOING / NOW / LATER, anywhere):
 *
 *   checked: false                        TODO
 *   checked: false, marker: 'WAITING'     WAITING   (set by hand in the app)
 *   checked: true                         DONE
 *   checked: true,  marker: 'CANCELLED'   CANCELLED (set by hand, v3.5.0)
 *
 * `marker` is an optional, additive TranscriptLine field, written only for
 * WAITING (beside `checked: false`) and CANCELLED (beside `checked: true`).
 * Older code ignores it, so it reads a WAITING line as an open TODO and a
 * CANCELLED line as closed (DONE), never as open; PAGE_DOC_VERSION stays "2.0".
 * TODO and DONE clear it. Every place that copies a line carries it with
 * `markerField()`.
 *
 * The task list is built from the metadata-only scan: each record carries a
 * small `tasks` summary (`buildTaskSummary()`, mirrored in main by
 * electron/task-summary.cjs; the two must agree), never strokes.
 *
 * Tested in src/lib/__tests__/tasks.test.js and task-summary.test.js.
 */

import { compareBookKeys } from './volumes.js';
import { isProjectTag, findProjectNumbers } from './tags.js';

export const WAITING = 'WAITING';
export const CANCELLED = 'CANCELLED';

/** The four states, as the UI and setTaskState() name them. */
export const TASK_STATES = ['todo', 'done', 'waiting', 'cancelled'];

/** Longest text a scan summary keeps (the record is display data, not the line). */
export const TASK_TEXT_MAX = 300;
export const TASK_PARENT_MAX = 120;

/**
 * The marker a line legitimately carries: 'WAITING' beside `checked: false`,
 * 'CANCELLED' beside `checked: true`, else null (a marker on the wrong side,
 * or any other value, is dropped).
 * @param {{checked?: boolean|null, marker?: string|null}} line
 * @returns {'WAITING'|'CANCELLED'|null}
 */
export function markerOf(line) {
  if (!line) return null;
  if (line.checked === false && line.marker === WAITING) return WAITING;
  if (line.checked === true && line.marker === CANCELLED) return CANCELLED;
  return null;
}

/**
 * `{ marker }` for a WAITING or CANCELLED line, else `{}`: spread into any
 * copy of a line so the field is carried where it belongs and nowhere else.
 * @param {{checked?: boolean|null, marker?: string|null}} line
 */
export function markerField(line) {
  const m = markerOf(line);
  return m ? { marker: m } : {};
}

/**
 * 'todo' | 'done' | 'waiting' | 'cancelled', or null for a line that is not a task.
 * @param {{checked?: boolean|null, marker?: string|null}} line
 */
export function taskStateOf(line) {
  if (!line) return null;
  if (line.checked === true) return line.marker === CANCELLED ? 'cancelled' : 'done';
  if (line.checked === false) return line.marker === WAITING ? 'waiting' : 'todo';
  return null;
}

/** True for a state setTaskState() accepts. */
export function isTaskState(state) {
  return TASK_STATES.includes(state);
}

/**
 * A copy of the line in that state: `checked` set, `marker` only for WAITING
 * and CANCELLED. Every other field is kept.
 * @template T
 * @param {T} line
 * @param {'todo'|'done'|'waiting'|'cancelled'} state
 * @returns {T}
 */
export function withTaskState(line, state) {
  if (!isTaskState(state)) throw new Error(`Unknown task state: ${state}`);
  const { marker, ...rest } = line || {};
  if (state === 'done') return { ...rest, checked: true };
  if (state === 'waiting') return { ...rest, checked: false, marker: WAITING };
  if (state === 'cancelled') return { ...rest, checked: true, marker: CANCELLED };
  return { ...rest, checked: false };
}

/** The label a state is shown with: TODO, DONE, WAITING, CANCELLED. */
export function stateLabel(state) {
  if (state === 'done') return 'DONE';
  if (state === 'waiting') return 'WAITING';
  if (state === 'cancelled') return 'CANCELLED';
  return 'TODO';
}

/** True for the two closed states, DONE and CANCELLED (drawn struck through). */
export function isClosedState(state) {
  return state === 'done' || state === 'cancelled';
}

/**
 * What a click on the box does: a closed task (DONE or CANCELLED) reopens as
 * TODO, an open one (TODO or WAITING) is ticked DONE.
 */
export function toggledState(state) {
  return isClosedState(state) ? 'todo' : 'done';
}

const clip = (s, max) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Project numbers in a line's text, in order (pattern only, see tags.js). */
function projectsIn(text) {
  return findProjectNumbers(text).map((h) => h.tag);
}

/**
 * The scan's per-page task summary: one entry per line with `checked` set.
 * The parent is the line `parentId` names when it exists and has text, else
 * the nearest earlier line with a smaller indent (some stored parentIds point
 * at lines that are gone).
 *
 * `projectHint` is the project number nearest the task in the transcript: the
 * first one in the task's own text, else the nearest one among the lines it
 * sits under (the named parent, then shallower lines, nearest first), else the
 * last one on any earlier line; null when none. Pattern only (OCR can misread
 * a digit), so buildTaskRows() uses it only when it is one of the page's tags.
 *
 * MIRRORED in electron/task-summary.cjs (main can't import this ESM module).
 * Change both; task-summary.test.js runs them over one fixture.
 *
 * @param {Array<{id?: string, text?: string, indentLevel?: number, parentId?: string|null, checked?: boolean|null, marker?: string}>} lines
 * @returns {Array<{id: string, text: string, checked: boolean, marker: 'WAITING'|'CANCELLED'|null, parentText: string|null, projectHint: string|null}>}
 */
export function buildTaskSummary(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const byId = new Map();
  for (const l of lines) if (l && typeof l.id === 'string') byId.set(l.id, l);
  const out = [];
  const stack = []; // [{ level, text, project }] of earlier lines with text
  let lastProject = null; // the last project number on any earlier line
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const level = Math.max(0, Number(l.indentLevel) || 0);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const own = projectsIn(l.text);
    if ((l.checked === true || l.checked === false) && typeof l.id === 'string' && l.id) {
      const named = l.parentId != null ? byId.get(l.parentId) : null;
      let parent = named && named !== l && typeof named.text === 'string' && named.text.trim() ? named.text : null;
      if (!parent && stack.length) parent = stack[stack.length - 1].text;
      let hint = own[0] || (named && named !== l ? projectsIn(named.text).pop() : null) || null;
      for (let i = stack.length - 1; !hint && i >= 0; i--) hint = stack[i].project;
      out.push({
        id: l.id,
        text: clip(l.text, TASK_TEXT_MAX),
        checked: l.checked,
        marker: markerOf(l),
        parentText: parent ? clip(parent, TASK_PARENT_MAX) : null,
        projectHint: hint || lastProject
      });
    }
    if (own.length) lastProject = own[own.length - 1];
    if (typeof l.text === 'string' && l.text.trim()) stack.push({ level, text: l.text, project: own[own.length - 1] || null });
  }
  return out;
}

/**
 * A scan summary as the renderer keeps it: anything malformed is dropped, so
 * a record from an older main (no `tasks`) simply has none.
 * @returns {Array<{id: string, text: string, checked: boolean, marker: 'WAITING'|'CANCELLED'|null, parentText: string|null, projectHint: string|null}>}
 */
export function normalizeTaskSummary(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => t && typeof t.id === 'string' && (t.checked === true || t.checked === false))
    .map((t) => ({
      id: t.id,
      text: typeof t.text === 'string' ? t.text : '',
      checked: t.checked,
      marker: markerOf(t),
      parentText: typeof t.parentText === 'string' && t.parentText ? t.parentText : null,
      projectHint: isProjectTag(t.projectHint) ? t.projectHint : null
    }));
}

/** One task's key, unique across the library: `"388v2/151b#<lineId>"`. */
export const taskKey = (book, pageId, lineId) => `${book}/${pageId}#${lineId}`;

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/**
 * One row per task in the library, from the scan records, page tags and the
 * capture-date index. A task's project is its `projectHint` (the project number
 * nearest it in the transcript) when that is one of the page's project tags,
 * else the page's first project tag. `overrides` (taskKey → state) are changes made in the
 * app that the scan doesn't know about yet: they win.
 *
 * @param {Array<object>} records  scan records (`tasks` on each)
 * @param {{ tags?: Object<string, string[]>, dates?: Map<string, {first: string, last: string}>, overrides?: Map<string, string> }} [ctx]
 */
export function buildTaskRows(records, { tags = {}, dates = null, overrides = null } = {}) {
  const rows = [];
  for (const r of records || []) {
    if (!r || !Array.isArray(r.tasks) || !r.tasks.length) continue;
    const pageId = idOf(r);
    const pageKey = `${r.book}/${pageId}`;
    const pageTagList = (tags && tags[pageKey]) || [];
    const projects = pageTagList.filter(isProjectTag);
    const when = dates ? dates.get(pageKey) : null;
    r.tasks.forEach((t, order) => {
      const key = taskKey(r.book, pageId, t.id);
      const state = (overrides && overrides.get(key)) || taskStateOf(t);
      if (!state) return;
      rows.push({
        key,
        book: String(r.book),
        pageId,
        page: r.page,
        lineId: t.id,
        order,
        text: t.text,
        parentText: t.parentText || null,
        state,
        projects,
        project: (t.projectHint && projects.includes(t.projectHint) ? t.projectHint : projects[0]) || null,
        day: when ? when.first : null,
        lastDay: when ? when.last : null
      });
    });
  }
  return rows;
}

/** The filter chips: Open (TODO), Waiting, Done, Cancelled, All. */
export const TASK_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' }
];

export function parseTaskFilter(raw) {
  return TASK_FILTERS.some((f) => f.id === raw) ? raw : 'open';
}

/** `{ open, waiting, done, cancelled, all }` */
export function taskCounts(rows) {
  const c = { open: 0, waiting: 0, done: 0, cancelled: 0, all: 0 };
  for (const r of rows || []) {
    c.all++;
    if (r.state === 'todo') c.open++;
    else if (r.state === 'waiting') c.waiting++;
    else if (r.state === 'done') c.done++;
    else if (r.state === 'cancelled') c.cancelled++;
  }
  return c;
}

export function filterTaskRows(rows, filter) {
  const f = parseTaskFilter(filter);
  if (f === 'all') return [...(rows || [])];
  const want = f === 'open' ? 'todo' : f;
  return (rows || []).filter((r) => r.state === want);
}

export const TASK_GROUPS = [
  { id: 'project', label: 'Project tag' },
  { id: 'date', label: 'Date written' },
  { id: 'book', label: 'Notebook' }
];

export const TASK_GROUP_KEY = 'smartpen-tasks-group';

export function parseTaskGroup(raw) {
  return TASK_GROUPS.some((g) => g.id === raw) ? raw : 'project';
}

/** Newest written first, then notebook / page / line order. */
export function compareTaskRows(a, b) {
  const da = a.day || '';
  const db = b.day || '';
  if (da !== db) return da < db ? 1 : -1;
  return compareBookKeys(a.book, b.book)
    || String(a.pageId).localeCompare(String(b.pageId), undefined, { numeric: true })
    || a.order - b.order;
}

/**
 * Most recently written first, for the Library home's short list. No line has
 * its own date, so this is the page's NEWEST capture day (a page written over
 * several weeks counts as recent), then the lower line on the page first
 * (written later), then notebook / page. Undated last.
 */
export function compareTaskRowsRecent(a, b) {
  const da = a.lastDay || a.day || '';
  const db = b.lastDay || b.day || '';
  if (da !== db) return da < db ? 1 : -1;
  if (a.book === b.book && String(a.pageId) === String(b.pageId)) return b.order - a.order;
  return compareBookKeys(a.book, b.book)
    || String(a.pageId).localeCompare(String(b.pageId), undefined, { numeric: true });
}

/** The `n` most recently written tasks in `filter` (compareTaskRowsRecent). */
export function latestTaskRows(rows, filter = 'open', n = 3) {
  return filterTaskRows(rows, filter).sort(compareTaskRowsRecent).slice(0, n);
}

export const NO_PROJECT = 'No project tag';
export const NO_DATE = 'No date';

/**
 * Rows in groups: `[{ id, label, kind, rows }]`.
 *   project  by the row's project (its nearest tagged project number, else the page's
 *            first project tag; newest group first; untagged last)
 *   date     by the page's first written day (newest first; undated last)
 *   book     by notebook (book order)
 * @param {Array<object>} rows
 * @param {'project'|'date'|'book'} by
 */
export function groupTaskRows(rows, by) {
  const mode = parseTaskGroup(by);
  const groups = new Map();
  for (const r of [...(rows || [])].sort(compareTaskRows)) {
    let id;
    if (mode === 'project') id = r.project || '';
    else if (mode === 'date') id = r.day || '';
    else id = r.book;
    if (!groups.has(id)) groups.set(id, { id, kind: mode, rows: [] });
    groups.get(id).rows.push(r);
  }
  const list = [...groups.values()];
  const newest = (g) => g.rows[0].day || '';
  list.sort((a, b) => {
    if (!a.id !== !b.id) return a.id ? -1 : 1; // the "none" group last
    if (mode === 'book') return compareBookKeys(a.id, b.id);
    if (mode === 'date') return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    const na = newest(a), nb = newest(b);
    return na !== nb ? (na < nb ? 1 : -1) : a.id.localeCompare(b.id, undefined, { numeric: true });
  });
  return list.map((g) => ({
    ...g,
    label: g.id || (mode === 'project' ? NO_PROJECT : NO_DATE)
  }));
}

/**
 * A scan summary with one task's state changed, or the same array when the
 * line isn't in it.
 */
export function summaryWithState(tasks, lineId, state) {
  if (!Array.isArray(tasks) || !tasks.some((t) => t.id === lineId)) return tasks;
  return tasks.map((t) => {
    if (t.id !== lineId) return t;
    const next = withTaskState(t, state);
    return { ...next, marker: next.marker || null };
  });
}

/**
 * The row / line menu: the three states a task can move to from `state`, as
 * `[{ state, label }]`. WAITING and CANCELLED are only ever set here, by hand.
 */
export function taskMenuChoices(state) {
  const TODO = { state: 'todo', label: 'Mark TODO' };
  const DONE = { state: 'done', label: 'Mark DONE' };
  const WAIT = { state: 'waiting', label: 'Mark WAITING' };
  const CANCEL = { state: 'cancelled', label: 'Mark CANCELLED' };
  if (state === 'done') return [TODO, WAIT, CANCEL];
  if (state === 'waiting') return [DONE, { state: 'todo', label: 'Clear WAITING (back to TODO)' }, CANCEL];
  if (state === 'cancelled') return [{ state: 'todo', label: 'Restore (back to TODO)' }, DONE, WAIT];
  return [DONE, WAIT, CANCEL];
}
