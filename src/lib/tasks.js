/**
 * tasks — transcript lines as tasks (v3.4.0). Pure: no DOM, no stores, no I/O.
 *
 * A task is a transcript line whose `checked` is set. Its state is one of
 * three, and only three (no DOING / NOW / LATER, anywhere):
 *
 *   checked: false                       TODO
 *   checked: false, marker: 'WAITING'    WAITING (set by hand in the app)
 *   checked: true                        DONE
 *
 * `marker` is an optional, additive TranscriptLine field: it is written only
 * for WAITING and only beside `checked: false`, so older code reads a WAITING
 * line as an ordinary TODO and PAGE_DOC_VERSION stays "2.0". DONE and TODO
 * clear it. Every place that copies a line carries it with `markerField()`.
 *
 * The task list is built from the metadata-only scan: each record carries a
 * small `tasks` summary (`buildTaskSummary()`, mirrored in main by
 * electron/task-summary.cjs; the two must agree), never strokes.
 *
 * Tested in src/lib/__tests__/tasks.test.js and task-summary.test.js.
 */

import { compareBookKeys } from './volumes.js';
import { isProjectTag } from './tags.js';

export const WAITING = 'WAITING';

/** The three states, as the UI and setTaskState() name them. */
export const TASK_STATES = ['todo', 'done', 'waiting'];

/** Longest text a scan summary keeps (the record is display data, not the line). */
export const TASK_TEXT_MAX = 300;
export const TASK_PARENT_MAX = 120;

/**
 * `{ marker: 'WAITING' }` for a WAITING line, else `{}`: spread into any copy
 * of a line so the field is carried where it belongs and nowhere else.
 * @param {{checked?: boolean|null, marker?: string|null}} line
 */
export function markerField(line) {
  return line && line.checked === false && line.marker === WAITING ? { marker: WAITING } : {};
}

/**
 * 'todo' | 'done' | 'waiting', or null for a line that is not a task.
 * @param {{checked?: boolean|null, marker?: string|null}} line
 */
export function taskStateOf(line) {
  if (!line) return null;
  if (line.checked === true) return 'done';
  if (line.checked === false) return line.marker === WAITING ? 'waiting' : 'todo';
  return null;
}

/** True for a state setTaskState() accepts. */
export function isTaskState(state) {
  return TASK_STATES.includes(state);
}

/**
 * A copy of the line in that state: `checked` set, `marker` only for WAITING.
 * Every other field is kept.
 * @template T
 * @param {T} line
 * @param {'todo'|'done'|'waiting'} state
 * @returns {T}
 */
export function withTaskState(line, state) {
  if (!isTaskState(state)) throw new Error(`Unknown task state: ${state}`);
  const { marker, ...rest } = line || {};
  if (state === 'done') return { ...rest, checked: true };
  if (state === 'waiting') return { ...rest, checked: false, marker: WAITING };
  return { ...rest, checked: false };
}

/** The label a state is shown with: TODO, DONE, WAITING. */
export function stateLabel(state) {
  return state === 'done' ? 'DONE' : state === 'waiting' ? 'WAITING' : 'TODO';
}

/** What a click on the box does: DONE goes back to TODO, anything else to DONE. */
export function toggledState(state) {
  return state === 'done' ? 'todo' : 'done';
}

const clip = (s, max) => {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * The scan's per-page task summary: one entry per line with `checked` set.
 * The parent is the line `parentId` names when it exists and has text, else
 * the nearest earlier line with a smaller indent (some stored parentIds point
 * at lines that are gone).
 *
 * MIRRORED in electron/task-summary.cjs (main can't import this ESM module).
 * Change both; task-summary.test.js runs them over one fixture.
 *
 * @param {Array<{id?: string, text?: string, indentLevel?: number, parentId?: string|null, checked?: boolean|null, marker?: string}>} lines
 * @returns {Array<{id: string, text: string, checked: boolean, marker: string|null, parentText: string|null}>}
 */
export function buildTaskSummary(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const byId = new Map();
  for (const l of lines) if (l && typeof l.id === 'string') byId.set(l.id, l);
  const out = [];
  const stack = []; // [{ level, text }] of earlier lines with text
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const level = Math.max(0, Number(l.indentLevel) || 0);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if ((l.checked === true || l.checked === false) && typeof l.id === 'string' && l.id) {
      const named = l.parentId != null ? byId.get(l.parentId) : null;
      let parent = named && named !== l && typeof named.text === 'string' && named.text.trim() ? named.text : null;
      if (!parent && stack.length) parent = stack[stack.length - 1].text;
      out.push({
        id: l.id,
        text: clip(l.text, TASK_TEXT_MAX),
        checked: l.checked,
        marker: l.checked === false && l.marker === WAITING ? WAITING : null,
        parentText: parent ? clip(parent, TASK_PARENT_MAX) : null
      });
    }
    if (typeof l.text === 'string' && l.text.trim()) stack.push({ level, text: l.text });
  }
  return out;
}

/**
 * A scan summary as the renderer keeps it: anything malformed is dropped, so
 * a record from an older main (no `tasks`) simply has none.
 * @returns {Array<{id: string, text: string, checked: boolean, marker: string|null, parentText: string|null}>}
 */
export function normalizeTaskSummary(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => t && typeof t.id === 'string' && (t.checked === true || t.checked === false))
    .map((t) => ({
      id: t.id,
      text: typeof t.text === 'string' ? t.text : '',
      checked: t.checked,
      marker: t.checked === false && t.marker === WAITING ? WAITING : null,
      parentText: typeof t.parentText === 'string' && t.parentText ? t.parentText : null
    }));
}

/** One task's key, unique across the library: `"388v2/151b#<lineId>"`. */
export const taskKey = (book, pageId, lineId) => `${book}/${pageId}#${lineId}`;

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/**
 * One row per task in the library, from the scan records, page tags and the
 * capture-date index. `overrides` (taskKey → state) are changes made in the
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
        project: projects[0] || null,
        day: when ? when.first : null,
        lastDay: when ? when.last : null
      });
    });
  }
  return rows;
}

/** The filter chips: Open (TODO), Waiting, Done, All. */
export const TASK_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' }
];

export function parseTaskFilter(raw) {
  return TASK_FILTERS.some((f) => f.id === raw) ? raw : 'open';
}

/** `{ open, waiting, done, all }` */
export function taskCounts(rows) {
  const c = { open: 0, waiting: 0, done: 0, all: 0 };
  for (const r of rows || []) {
    c.all++;
    if (r.state === 'todo') c.open++;
    else if (r.state === 'waiting') c.waiting++;
    else if (r.state === 'done') c.done++;
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

export const NO_PROJECT = 'No project tag';
export const NO_DATE = 'No date';

/**
 * Rows in groups: `[{ id, label, kind, rows }]`.
 *   project  by the page's first project tag (newest group first; untagged last)
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
 * The row / line menu: the two states a task can move to from `state`, as
 * `[{ state, label }]`. WAITING is only ever set here, by hand.
 */
export function taskMenuChoices(state) {
  if (state === 'done') return [{ state: 'todo', label: 'Mark TODO' }, { state: 'waiting', label: 'Mark WAITING' }];
  if (state === 'waiting') return [{ state: 'done', label: 'Mark DONE' }, { state: 'todo', label: 'Clear WAITING (back to TODO)' }];
  return [{ state: 'done', label: 'Mark DONE' }, { state: 'waiting', label: 'Mark WAITING' }];
}
