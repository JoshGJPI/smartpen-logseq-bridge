/**
 * Task queries over the Node scan, built the way the app's Tasks view builds
 * them (stores/tasks.js → TasksView.svelte). Nothing is ported:
 *
 *   taskRows      buildTaskRows(savedPages, { tags: pageTags, dates: libraryPageDates })
 *                 → buildTaskRows(scan.pages, { tags: scan.tags, dates: pageDates(scan.index) })
 *   state chips   filterTaskRows(rows, filter)
 *   Group by      groupTaskRows(rows, by), rows in compareTaskRows order
 *
 * Read-only. The app has no overrides here (that is unsaved-yet UI state), so a
 * row's state is what the page on disk says.
 *
 * One difference, on purpose: the app's "Open" chip is TODO only (WAITING has its
 * own chip). Here `open` means still to do, TODO + WAITING, and `todo` is the
 * app's Open chip.
 */
import {
  buildTaskRows, filterTaskRows, groupTaskRows, compareTaskRows, taskCounts, stateLabel
} from '../../src/lib/tasks.js';
import { pageDates } from '../../src/lib/library-home.js';
import { normalizeTag, tagAnswersTo, tagTypeOf } from '../../src/lib/tags.js';
import { inRange } from '../../src/lib/timeline.js';

export const TASK_STATE_ARGS = ['open', 'todo', 'waiting', 'done', 'cancelled', 'all'];
export const TASK_GROUP_ARGS = ['project', 'person', 'date', 'book'];
export const UNTAGGED = 'untagged';

const isOpen = (r) => r.state === 'todo' || r.state === 'waiting';

/** Rows in one state, by the app's filter where it has one. */
export function rowsInState(rows, state = 'open') {
  if (!TASK_STATE_ARGS.includes(state)) throw new Error(`Unknown state "${state}": use ${TASK_STATE_ARGS.join(', ')}`);
  if (state === 'open') return rows.filter(isOpen);
  return filterTaskRows(rows, state === 'todo' ? 'open' : state);
}

/** `{ open, todo, waiting, done, cancelled, all }`, where open = todo + waiting (taskCounts' `open` is TODO only). */
export function countsOf(rows) {
  const c = taskCounts(rows);
  return { open: c.open + c.waiting, todo: c.open, waiting: c.waiting, done: c.done, cancelled: c.cancelled, all: c.all };
}

const tagOf = (t) => normalizeTag(t) || String(t).trim().toLowerCase();

/** Every task row in the folder, exactly as the Tasks view derives them (people from block scope, v3.23.0). */
export function allTaskRows(scan, dates = pageDates(scan.index)) {
  return buildTaskRows(scan.pages, {
    tags: scan.tags, dates, info: scan.tagInfo || {}, blocks: scan.tagBlocks || {}, scopeLines: scan.scopeLines || null
  });
}

/**
 * The Person tags a `person` argument names (key, display name or alias,
 * case-insensitive, as the app's person: facet). Throws when it names none.
 */
export function personTags(scan, person) {
  const info = scan.tagInfo || {};
  const all = new Set([...Object.values(scan.tags || {}).flat(), ...Object.keys(info)]);
  const hits = [...all].filter((t) => tagTypeOf(t, info) === 'person' && tagAnswersTo(t, info, person));
  if (!hits.length) throw new Error(`No Person tag answers to "${person}": list_tags type=person lists them`);
  return hits;
}

/**
 * The non-state filters: book, project (the row's project from buildTaskRows:
 * the nearest tagged project number, else the first project tag; 'untagged' for
 * none), tags (all must be on the page), from/to (the page has ink on a local
 * day in range), text (task or parent text, case-insensitive), people (v3.23.0:
 * Person tags, one of which must be in the row's `people`, its block scope).
 */
export function filterTasks(rows, scan, { book, project, tags, from, to, text, people } = {}) {
  const proj = project == null || project === '' ? null
    : String(project).trim().toLowerCase() === UNTAGGED ? UNTAGGED : tagOf(project);
  const want = (Array.isArray(tags) ? tags : tags != null && tags !== '' ? [tags] : []).map(tagOf);
  const needle = text ? String(text).toLowerCase() : null;
  const byKey = from ? new Map(scan.pages.map((p) => [`${p.book}/${p.pageId}`, p])) : null;
  return rows.filter((r) => {
    if (book && r.book !== book) return false;
    if (proj === UNTAGGED ? r.project !== null : proj && r.project !== proj) return false;
    if (people && !people.some((p) => (r.people || []).includes(p))) return false;
    if (want.length) {
      const have = scan.tags[`${r.book}/${r.pageId}`] || [];
      if (!want.every((t) => have.includes(t))) return false;
    }
    if (from) {
      const p = byKey.get(`${r.book}/${r.pageId}`);
      if (!p || !Object.keys(p.days).some((d) => inRange(d, from, to))) return false;
    }
    if (needle && !`${r.text}\n${r.parentText || ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The rows in the order they are listed: grouped (group order, then row order) or compareTaskRows. */
export function orderTasks(rows, groupBy) {
  if (!groupBy) return [...rows].sort(compareTaskRows);
  return groupTaskRows(rows, groupBy).flatMap((g) => g.rows);
}

/** One row as the tool returns it: short keys, nulls left out. */
export function taskOut(r, scan, bookName) {
  const out = {
    state: stateLabel(r.state),
    text: r.text,
    parent: r.parentText || undefined,
    notebook: bookName(scan.aliases, r.book),
    book: r.book,
    page: r.pageId,
    project: r.project || undefined,
    people: r.people && r.people.length ? r.people : undefined,
    tags: (scan.tags[`${r.book}/${r.pageId}`] || []),
    written: r.day ? (r.day === r.lastDay ? r.day : `${r.day} to ${r.lastDay}`) : undefined,
    line: r.lineId
  };
  if (!out.tags.length) delete out.tags;
  return out;
}

/** Open (TODO + WAITING) task counts per page key, from the scan alone. */
export function openTasksByPage(scan) {
  const m = new Map();
  for (const p of scan.pages) {
    const n = (p.tasks || []).filter((t) => t.checked === false).length;
    if (n) m.set(`${p.book}/${p.pageId}`, n);
  }
  return m;
}

/** How many transcribed pages still have ☐ / ☑ / TODO markers in their text that the app's Convert task boxes… step has not moved into `checked`. */
export function unconvertedPages(scan) {
  return scan.pages.filter((p) => p.taskBoxesInText).length;
}
