/**
 * Tests for lib/tasks.js: task state and the `marker` field, and the Tasks
 * view's rows, counts, filters and groups.
 */

import { describe, it, expect } from 'vitest';
import {
  markerField, taskStateOf, withTaskState, toggledState, stateLabel, buildTaskRows, taskCounts,
  filterTaskRows, groupTaskRows, summaryWithState, taskMenuChoices, taskKey, parseTaskFilter,
  parseTaskGroup, NO_PROJECT, NO_DATE
} from '../tasks.js';

describe('task state', () => {
  it('reads the three states, and null for a plain line', () => {
    expect(taskStateOf({ checked: false })).toBe('todo');
    expect(taskStateOf({ checked: false, marker: 'WAITING' })).toBe('waiting');
    expect(taskStateOf({ checked: true })).toBe('done');
    expect(taskStateOf({ checked: true, marker: 'WAITING' })).toBe('done');
    expect(taskStateOf({ checked: null, marker: 'WAITING' })).toBeNull();
    expect(taskStateOf(null)).toBeNull();
  });

  it('markerField carries WAITING only beside checked: false', () => {
    expect(markerField({ checked: false, marker: 'WAITING' })).toEqual({ marker: 'WAITING' });
    expect(markerField({ checked: true, marker: 'WAITING' })).toEqual({});
    expect(markerField({ checked: false, marker: 'DOING' })).toEqual({});
    expect(markerField({ checked: false })).toEqual({});
  });

  it('withTaskState sets checked, adds or clears marker, keeps the rest', () => {
    const line = { id: 'a', text: 'x', indentLevel: 1, yBounds: { minY: 1, maxY: 2 }, checked: false };
    const w = withTaskState(line, 'waiting');
    expect(w).toEqual({ ...line, checked: false, marker: 'WAITING' });
    const d = withTaskState(w, 'done');
    expect(d).toEqual({ ...line, checked: true });
    expect(d).not.toHaveProperty('marker');
    expect(withTaskState(w, 'todo')).not.toHaveProperty('marker');
    expect(line).not.toHaveProperty('marker'); // not mutated
    expect(() => withTaskState(line, 'doing')).toThrow();
  });

  it('labels and toggles', () => {
    expect(['todo', 'done', 'waiting'].map(stateLabel)).toEqual(['TODO', 'DONE', 'WAITING']);
    expect(toggledState('todo')).toBe('done');
    expect(toggledState('waiting')).toBe('done');
    expect(toggledState('done')).toBe('todo');
  });

  it('the menu offers the two other states, never DOING / NOW / LATER', () => {
    expect(taskMenuChoices('todo').map((c) => c.state)).toEqual(['done', 'waiting']);
    expect(taskMenuChoices('waiting').map((c) => c.state)).toEqual(['done', 'todo']);
    expect(taskMenuChoices('done').map((c) => c.state)).toEqual(['todo', 'waiting']);
    const labels = ['todo', 'done', 'waiting'].flatMap((s) => taskMenuChoices(s).map((c) => c.label)).join(' ');
    expect(labels).not.toMatch(/DOING|NOW|LATER/);
  });

  it('summaryWithState changes one entry, or returns the same array', () => {
    const tasks = [
      { id: 'a', text: 'x', checked: false, marker: null, parentText: null },
      { id: 'b', text: 'y', checked: false, marker: null, parentText: 'h' }
    ];
    const next = summaryWithState(tasks, 'b', 'waiting');
    expect(next[1]).toEqual({ id: 'b', text: 'y', checked: false, marker: 'WAITING', parentText: 'h' });
    expect(next[0]).toBe(tasks[0]);
    expect(summaryWithState(next, 'b', 'done')[1].marker).toBeNull();
    expect(summaryWithState(tasks, 'zz', 'done')).toBe(tasks);
    expect(summaryWithState(undefined, 'a', 'done')).toBeUndefined();
  });
});

const t = (id, checked, extra = {}) => ({ id, text: `task ${id}`, checked, marker: null, parentText: 'Meeting', ...extra });

const records = [
  { book: '3017', page: 142, pageId: '142', tasks: [t('a', false), t('b', true), t('c', false, { marker: 'WAITING' })] },
  { book: '3017', page: 170, pageId: '170', tasks: [t('d', false)] },
  { book: '388v2', page: 5, pageId: '5b', tasks: [t('e', false)] },
  { book: '387', page: 29, pageId: '29', tasks: [] },
  { book: '387', page: 30, pageId: '30' }
];
const tags = { '3017/142': ['P2026-141', 'beam'], '3017/170': ['2327-018'] };
const dates = new Map([
  ['3017/142', { first: '2026-10-14', last: '2026-10-14' }],
  ['3017/170', { first: '2026-10-20', last: '2026-10-21' }]
]);

describe('buildTaskRows', () => {
  const rows = buildTaskRows(records, { tags, dates });

  it('one row per task, with page, project tags and date written', () => {
    expect(rows.map((r) => r.lineId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    const a = rows[0];
    expect(a).toMatchObject({
      key: '3017/142#a', book: '3017', pageId: '142', state: 'todo', parentText: 'Meeting',
      projects: ['P2026-141'], project: 'P2026-141', day: '2026-10-14'
    });
    expect(rows[2].state).toBe('waiting');
    expect(rows[4]).toMatchObject({ key: '388v2/5b#e', project: null, day: null });
    expect(rows[3].lastDay).toBe('2026-10-21');
  });

  it('an override (a change not in the scan yet) wins', () => {
    const over = new Map([[taskKey('3017', '142', 'a'), 'done']]);
    expect(buildTaskRows(records, { overrides: over })[0].state).toBe('done');
  });

  it('copes with nothing', () => {
    expect(buildTaskRows(undefined)).toEqual([]);
    expect(buildTaskRows([null, {}])).toEqual([]);
  });

  it('counts and filters', () => {
    expect(taskCounts(rows)).toEqual({ open: 3, waiting: 1, done: 1, all: 5 });
    expect(taskCounts([])).toEqual({ open: 0, waiting: 0, done: 0, all: 0 });
    expect(filterTaskRows(rows, 'open').map((r) => r.lineId)).toEqual(['a', 'd', 'e']);
    expect(filterTaskRows(rows, 'waiting').map((r) => r.lineId)).toEqual(['c']);
    expect(filterTaskRows(rows, 'done').map((r) => r.lineId)).toEqual(['b']);
    expect(filterTaskRows(rows, 'all')).toHaveLength(5);
    expect(filterTaskRows(rows, 'bogus').map((r) => r.lineId)).toEqual(['a', 'd', 'e']);
    expect(parseTaskFilter('nope')).toBe('open');
    expect(parseTaskGroup('nope')).toBe('project');
  });

  it('groups by project: newest project first, untagged last', () => {
    const g = groupTaskRows(rows, 'project');
    expect(g.map((x) => x.label)).toEqual(['2327-018', 'P2026-141', NO_PROJECT]);
    expect(g[1].rows.map((r) => r.lineId)).toEqual(['a', 'b', 'c']);
  });

  it('groups by date: newest day first, undated last', () => {
    const g = groupTaskRows(rows, 'date');
    expect(g.map((x) => x.label)).toEqual(['2026-10-20', '2026-10-14', NO_DATE]);
  });

  it('groups by notebook in book order (a volume after its book)', () => {
    const more = buildTaskRows([...records, { book: '388', page: 1, pageId: '1', tasks: [t('f', false)] }], { tags, dates });
    expect(groupTaskRows(more, 'book').map((x) => x.id)).toEqual(['388', '388v2', '3017']);
  });
});
