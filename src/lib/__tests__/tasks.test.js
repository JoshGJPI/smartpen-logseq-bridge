/**
 * Tests for lib/tasks.js: task state and the `marker` field, and the Tasks
 * view's rows, counts, filters and groups.
 */

import { describe, it, expect } from 'vitest';
import {
  markerField, markerOf, isClosedState, taskStateOf, withTaskState, toggledState, stateLabel, buildTaskRows, taskCounts,
  filterTaskRows, groupTaskRows, searchTaskRows, summaryWithState, taskMenuChoices, NOT_A_TASK, isTaskState, isLineState, taskKey, parseTaskFilter,
  parseTaskGroup, latestTaskRows, NO_PROJECT, NO_DATE, NO_PERSON, personOpenItems, agendaMarkdown, buildTaskSummary,
  parseShownStates, toggleShownState, isDefaultShown, rowsInStates, taskRowsForTag, DEFAULT_SHOWN_STATES,
  TASK_STATES, TASK_STATE_CHIPS, TASK_FILTERS
} from '../tasks.js';

describe('task state', () => {
  it('reads the four states, and null for a plain line', () => {
    expect(taskStateOf({ checked: false })).toBe('todo');
    expect(taskStateOf({ checked: false, marker: 'WAITING' })).toBe('waiting');
    expect(taskStateOf({ checked: true })).toBe('done');
    expect(taskStateOf({ checked: true, marker: 'CANCELLED' })).toBe('cancelled');
    expect(taskStateOf({ checked: true, marker: 'WAITING' })).toBe('done');
    expect(taskStateOf({ checked: false, marker: 'CANCELLED' })).toBe('todo');
    expect(taskStateOf({ checked: null, marker: 'CANCELLED' })).toBeNull();
    expect(taskStateOf({ checked: null, marker: 'WAITING' })).toBeNull();
    expect(taskStateOf(null)).toBeNull();
  });

  it('markerField carries WAITING only beside checked: false', () => {
    expect(markerField({ checked: false, marker: 'WAITING' })).toEqual({ marker: 'WAITING' });
    expect(markerField({ checked: true, marker: 'WAITING' })).toEqual({});
    expect(markerField({ checked: false, marker: 'DOING' })).toEqual({});
    expect(markerField({ checked: false })).toEqual({});
  });

  it('markerField carries CANCELLED only beside checked: true (v3.5.0)', () => {
    expect(markerField({ checked: true, marker: 'CANCELLED' })).toEqual({ marker: 'CANCELLED' });
    expect(markerField({ checked: false, marker: 'CANCELLED' })).toEqual({});
    expect(markerField({ checked: null, marker: 'CANCELLED' })).toEqual({});
    expect(markerField({ checked: true, marker: 'cancelled' })).toEqual({});
    expect(markerOf(null)).toBeNull();
    expect(markerOf({ checked: true, marker: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('CANCELLED is stored as checked: true, so older code reads it as closed', () => {
    const line = { id: 'a', text: 'x', checked: false, marker: 'WAITING' };
    const c = withTaskState(line, 'cancelled');
    expect(c).toEqual({ id: 'a', text: 'x', checked: true, marker: 'CANCELLED' });
    expect(withTaskState(c, 'done')).not.toHaveProperty('marker');
    expect(withTaskState(c, 'todo')).toEqual({ id: 'a', text: 'x', checked: false });
    expect(withTaskState(c, 'waiting')).toEqual({ id: 'a', text: 'x', checked: false, marker: 'WAITING' });
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
    expect(['todo', 'done', 'waiting', 'cancelled'].map(stateLabel)).toEqual(['TODO', 'DONE', 'WAITING', 'CANCELLED']);
    expect(toggledState('todo')).toBe('done');
    expect(toggledState('waiting')).toBe('done');
    expect(toggledState('done')).toBe('todo');
    expect(toggledState('cancelled')).toBe('todo'); // a click reopens it
    expect(['todo', 'waiting', 'done', 'cancelled'].map(isClosedState)).toEqual([false, false, true, true]);
  });

  it('the menu offers the three other states then Not a task, never DOING / NOW / LATER', () => {
    expect(taskMenuChoices('todo').map((c) => c.state)).toEqual(['done', 'waiting', 'cancelled', 'none']);
    expect(taskMenuChoices('waiting').map((c) => c.state)).toEqual(['done', 'todo', 'cancelled', 'none']);
    expect(taskMenuChoices('done').map((c) => c.state)).toEqual(['todo', 'waiting', 'cancelled', 'none']);
    expect(taskMenuChoices('cancelled').map((c) => c.state)).toEqual(['todo', 'done', 'waiting', 'none']);
    expect(taskMenuChoices('todo').at(-1)).toEqual({ state: NOT_A_TASK, label: 'Not a task' });
    for (const s of ['todo', 'waiting', 'done', 'cancelled']) {
      expect(taskMenuChoices(s).map((c) => c.state)).not.toContain(s);
    }
    const labels = ['todo', 'done', 'waiting'].flatMap((s) => taskMenuChoices(s).map((c) => c.label)).join(' ');
    expect(labels).not.toMatch(/DOING|NOW|LATER/);
  });

  it('every label the UI shows names only TODO / DONE / WAITING / CANCELLED (two Ls)', () => {
    const labels = [
      ...TASK_STATES.map(stateLabel),
      ...[...TASK_STATES, null].flatMap((s) => taskMenuChoices(s).map((c) => c.label)),
      ...TASK_STATE_CHIPS.map((c) => c.label),
      ...TASK_FILTERS.map((f) => f.label)
    ].join(' | ');
    expect(labels).not.toMatch(/doing|now|later|canceled/i);
    expect(TASK_STATE_CHIPS.map((c) => c.state)).toEqual(['todo', 'waiting', 'done', 'cancelled']);
  });

  it('a plain line\'s menu offers only Make task (TODO)', () => {
    expect(taskMenuChoices(null)).toEqual([{ state: 'todo', label: 'Make task' }]);
    expect(taskMenuChoices(NOT_A_TASK)).toEqual([{ state: 'todo', label: 'Make task' }]);
  });

  it('Not a task: a plain line, dropped from the summary and the rows, never a task state', () => {
    const w = { id: 'a', text: 'x', checked: false, marker: 'WAITING', yBounds: null };
    expect(withTaskState(w, NOT_A_TASK)).toEqual({ id: 'a', text: 'x', checked: null, yBounds: null });
    expect(isTaskState(NOT_A_TASK)).toBe(false);
    expect(isLineState(NOT_A_TASK)).toBe(true);
    expect(isLineState('doing')).toBe(false);
    const tasks = [{ id: 'a', checked: false, marker: null }, { id: 'b', checked: true, marker: null }];
    expect(summaryWithState(tasks, 'a', NOT_A_TASK).map((t) => t.id)).toEqual(['b']);
    const rows = buildTaskRows([{ book: '3', page: 1, pageId: '1', tasks }], { overrides: new Map([['3/1#a', NOT_A_TASK]]) });
    expect(rows.map((r) => r.lineId)).toEqual(['b']);
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
    expect(summaryWithState(next, 'b', 'cancelled')[1]).toMatchObject({ checked: true, marker: 'CANCELLED' });
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

  it('project: the nearest project number in the transcript when the page is tagged with it', () => {
    const recs = [{ book: '3017', page: 170, pageId: '170', tasks: [
      t('p', false, { projectHint: '5444-006' }), // tagged, but not first: wins
      t('q', false, { projectHint: '2327-018' }), // not a tag on this page: first tag
      t('r', false)
    ] }];
    const r = buildTaskRows(recs, { tags: { '3017/170': ['4981-003', '5444-006', 'beam'] } });
    expect(r.map((x) => x.project)).toEqual(['5444-006', '4981-003', '4981-003']);
    expect(r[0].projects).toEqual(['4981-003', '5444-006']);
    expect(buildTaskRows(recs, { tags: {} }).map((x) => x.project)).toEqual([null, null, null]);
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
    expect(taskCounts(rows)).toEqual({ open: 3, waiting: 1, done: 1, cancelled: 0, all: 5 });
    expect(taskCounts([])).toEqual({ open: 0, waiting: 0, done: 0, cancelled: 0, all: 0 });
    expect(filterTaskRows(rows, 'open').map((r) => r.lineId)).toEqual(['a', 'd', 'e']);
    expect(filterTaskRows(rows, 'waiting').map((r) => r.lineId)).toEqual(['c']);
    expect(filterTaskRows(rows, 'done').map((r) => r.lineId)).toEqual(['b']);
    expect(filterTaskRows(rows, 'all')).toHaveLength(5);
    expect(filterTaskRows(rows, 'cancelled')).toEqual([]);
    const withCancelled = [...rows, { ...rows[0], key: 'x', lineId: 'x', state: 'cancelled' }];
    expect(taskCounts(withCancelled)).toMatchObject({ open: 3, done: 1, cancelled: 1, all: 6 });
    expect(filterTaskRows(withCancelled, 'cancelled').map((r) => r.lineId)).toEqual(['x']);
    expect(filterTaskRows(withCancelled, 'done').map((r) => r.lineId)).toEqual(['b']);
    expect(parseTaskFilter('cancelled')).toBe('cancelled');
    expect(filterTaskRows(rows, 'bogus').map((r) => r.lineId)).toEqual(['a', 'd', 'e']);
    expect(parseTaskFilter('nope')).toBe('open');
    expect(parseTaskGroup('nope')).toBe('project');
  });

  it('groups by project: numbers first then A to Z, untagged last', () => {
    const g = groupTaskRows(rows, 'project');
    expect(g.map((x) => x.label)).toEqual(['2327-018', 'P2026-141', NO_PROJECT]);
    expect(g[1].rows.map((r) => r.lineId)).toEqual(['a', 'b', 'c']);
  });

  it('searches text, under, notebook, page, tag and date; all words must match', () => {
    const r = rows[0];
    const hit = (q) => searchTaskRows(rows, q, (b) => `Book ${b}`).some((x) => x.key === r.key);
    expect(searchTaskRows(rows, '  ')).toHaveLength(rows.length);
    expect(hit(r.text.slice(0, 5).toUpperCase())).toBe(true);
    expect(hit(`p.${r.pageId}`)).toBe(true);
    expect(hit(`book ${r.book}`)).toBe(true);
    expect(hit(r.project)).toBe(true);
    expect(hit(r.day)).toBe(true);
    expect(hit(`${r.day} zzzz-nomatch`)).toBe(false);
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

describe('latestTaskRows (the Library home card)', () => {
  const row = (book, pageId, order, day, lastDay, state = 'todo') =>
    ({ key: `${book}/${pageId}#${order}`, book, pageId, order, day, lastDay, state });

  it('newest capture day first, so a long-running page with new tasks ranks by its last day', () => {
    const rows = [
      row('3017', '10', 0, '2026-10-01', '2026-10-01'),
      row('3017', '11', 0, '2026-09-01', '2026-10-20'), // started long ago, written on yesterday
      row('388', '4', 0, '2026-10-15', '2026-10-15')
    ];
    expect(latestTaskRows(rows).map((r) => r.key)).toEqual(['3017/11#0', '388/4#0', '3017/10#0']);
  });

  it('on one page, the lower (later) line first; only open tasks; at most n', () => {
    const rows = [0, 1, 2, 3].map((i) => row('3017', '12', i, '2026-10-20', '2026-10-20'));
    rows.push(row('3017', '12', 4, '2026-10-20', '2026-10-20', 'done'));
    expect(latestTaskRows(rows, 'open', 3).map((r) => r.order)).toEqual([3, 2, 1]);
  });

  it('undated pages last, and falls back to the first day when there is no last day', () => {
    const rows = [row('388', '1', 0, null, null), row('388', '2', 0, '2026-10-02', null)];
    expect(latestTaskRows(rows).map((r) => r.pageId)).toEqual(['2', '1']);
    expect(latestTaskRows([])).toEqual([]);
  });
});

describe('state chips as toggles (v3.12.0)', () => {
  const rows = ['todo', 'waiting', 'done', 'cancelled', 'todo'].map((state, i) => ({ key: String(i), state }));

  it('parses a shown list into chip order, defaulting only for a non-array', () => {
    expect(parseShownStates(undefined)).toEqual(['todo', 'waiting']);
    expect(parseShownStates('todo')).toEqual(['todo', 'waiting']);
    expect(parseShownStates([])).toEqual([]);
    expect(parseShownStates(['cancelled', 'todo', 'todo', 'DOING', 'now'])).toEqual(['todo', 'cancelled']);
    expect(DEFAULT_SHOWN_STATES).toEqual(['todo', 'waiting']);
  });

  it('toggles one state at a time', () => {
    expect(toggleShownState(['todo', 'waiting'], 'done')).toEqual(['todo', 'waiting', 'done']);
    expect(toggleShownState(['todo', 'waiting'], 'todo')).toEqual(['waiting']);
    expect(toggleShownState(['waiting'], 'waiting')).toEqual([]);
    expect(toggleShownState(['todo'], 'none')).toEqual(['todo']);
  });

  it('All turns everything on, then back to the default', () => {
    expect(isDefaultShown(['waiting', 'todo'])).toBe(true);
    expect(isDefaultShown(['todo'])).toBe(false);
    expect(isDefaultShown(['todo', 'waiting', 'done'])).toBe(false);
    expect(isDefaultShown([])).toBe(false);
    expect(isDefaultShown('junk')).toBe(true); // unreadable falls back to the default
  });

  it('keeps the rows in the shown states', () => {
    expect(rowsInStates(rows, ['todo', 'waiting']).map((r) => r.key)).toEqual(['0', '1', '4']);
    expect(rowsInStates(rows, ['cancelled']).map((r) => r.key)).toEqual(['3']);
    expect(rowsInStates(rows, [])).toEqual([]);
    expect(rowsInStates(null, ['todo'])).toEqual([]);
  });
});

describe('taskRowsForTag (the tasks on a tag page, v3.12.0)', () => {
  const rows = [
    { key: 'a', book: '388', pageId: '178', project: '2237-011' },
    { key: 'b', book: '388', pageId: '178', project: '5444-006' },
    { key: 'c', book: '388v2', pageId: '3', project: '2237-011' },
    { key: 'd', book: '3017', pageId: '9', project: null }
  ];

  it('a project tag takes the rows grouped under it, not every task on its pages', () => {
    expect(taskRowsForTag(rows, '2237-011', ['388/178', '388v2/3']).map((r) => r.key)).toEqual(['a', 'c']);
  });

  it('a keyword tag takes every task on its pages', () => {
    expect(taskRowsForTag(rows, 'site visit', new Set(['388/178', '3017/9'])).map((r) => r.key)).toEqual(['a', 'b', 'd']);
    expect(taskRowsForTag(rows, 'site visit')).toEqual([]);
  });

  it('copes with nothing', () => {
    expect(taskRowsForTag(rows, '')).toEqual([]);
    expect(taskRowsForTag(null, '2237-011')).toEqual([]);
  });
});

describe('people on tasks (v3.23.0, D.3)', () => {
  const info = {
    rich: { type: 'person', label: 'Rich' },
    tom: { type: 'person', label: 'Tom', aliases: ['Thomas'] },
    loren: { type: 'person', label: 'Loren' }
  };
  const L = (id, text, indentLevel = 0, extra = {}) => ({ id, text, indentLevel, parentId: null, checked: null, ...extra });
  const pageLines = [
    L('h1', '10:00 5444-006 Rich update', 0),
    L('t1', 'Finalize column location', 1, { checked: false }),
    L('t2', 'Send RFI to Thomas', 1, { checked: false, marker: 'WAITING' }),
    L('h2', '11:00 Site walk', 0),
    L('t3', 'Pour schedule', 1, { checked: false }),
    L('t4', 'rich mix check', 0, { checked: true })
  ];
  const otherLines = [L('t9', 'Loren will reach out to Brady', 0, { checked: false, marker: 'WAITING' }), L('t8', 'Loren call', 0, { checked: false })];
  const text = (lines) => lines.map((l) => `${'  '.repeat(l.indentLevel)}${l.text}`).join('\n');
  const rec = (pageId, lines) => ({ book: '3017', page: Number(pageId), pageId, transcriptionText: text(lines), tasks: buildTaskSummary(lines) });
  const records = [rec('170', pageLines), rec('171', otherLines)];
  const tags = { '3017/170': ['rich', 'tom', '5444-006'], '3017/171': ['beam'] };
  const rows = buildTaskRows(records, { tags, info });
  const by = Object.fromEntries(rows.map((r) => [r.lineId, r]));

  it('people are the Person tags on the page whose blocks hold the task', () => {
    expect(by.t1.people).toEqual(['rich']);
    expect(by.t2.people).toEqual(['rich', 'tom']);   // under Rich's block, and names Thomas
    expect(by.t3.people).toEqual([]);
    expect(by.t4.people).toEqual([]);                 // "rich mix": case-sensitive
    expect(by.t9.people).toEqual([]);                 // names Loren, but the page has no Loren tag
    expect(by.t1.project).toBe('5444-006');           // project unchanged
  });

  it('a person named nowhere on the page covers the whole page', () => {
    const r = buildTaskRows(records, { tags: { ...tags, '3017/171': ['rich'] }, info });
    expect(r.filter((x) => x.pageId === '171').map((x) => x.people)).toEqual([['rich'], ['rich']]);
  });

  it('hand corrections: an added root among the heads, a removed one', () => {
    const blocks = { '3017/170': { tom: { add: ['h2'] }, rich: { remove: ['h1'] } } };
    const r = Object.fromEntries(buildTaskRows(records, { tags, info, blocks }).map((x) => [x.lineId, x]));
    expect(r.t3.people).toEqual(['tom']);
    // From scan text alone the removed root is dropped, but the whole-page fallback can't be seen (the
    // text has no ids): that is why stores/tag-scope.js reads corrected pages (next test).
    expect(r.t1.people).toEqual([]);
  });

  it('with lines read for a corrected page, the covered ids decide', () => {
    const blocks = { '3017/170': { rich: { remove: ['h1'] } } };
    const scopeLines = new Map([['3017/170', pageLines]]);
    const r = Object.fromEntries(buildTaskRows(records, { tags, info, blocks, scopeLines }).map((x) => [x.lineId, x]));
    expect(r.t3.people).toContain('rich');   // its one root removed: Rich covers the whole page again
  });

  it('Group by → Person lists a task under each of its people, "No person" last', () => {
    const groups = groupTaskRows(rows, 'person');
    expect(groups.map((g) => [g.id, g.rows.map((x) => x.lineId)])).toEqual([
      ['rich', ['t1', 't2']], ['tom', ['t2']], ['', expect.arrayContaining(['t3', 't4', 't8', 't9'])]
    ]);
    expect(groups[groups.length - 1].label).toBe(NO_PERSON);
    expect(parseTaskGroup('person')).toBe('person');
  });

  it('person: in the search, by key, display name or alias, case-insensitive', () => {
    const ids = (q) => searchTaskRows(rows, q, (b) => b, info).map((r) => r.lineId).sort();
    expect(ids('person:tom')).toEqual(['t2']);
    expect(ids('person:thomas')).toEqual(['t2']);
    expect(ids('person:Rich')).toEqual(['t1', 't2']);
    expect(ids('person:rich column')).toEqual(['t1']);
    expect(ids('person:nobody')).toEqual([]);
    expect(ids('project:5444-006 send')).toEqual(['t2']);
    expect(ids('Tom')).toEqual(['t2']);   // a person's display name is a word in the row too
  });

  it('a Person page’s open items: open tasks in their blocks, plus WAITING tasks naming them anywhere', () => {
    const open = (t) => personOpenItems(rows, t, info).map((r) => r.lineId).sort();
    expect(open('rich')).toEqual(['t1', 't2']);
    expect(open('loren')).toEqual(['t9']);   // WAITING naming Loren on an untagged page; not the TODO t8
    expect(open('tom')).toEqual(['t2']);
    expect(personOpenItems(rows, '5444-006', info)).toEqual([]);
  });

  it('Copy agenda: TODO / WAITING lines, grouped under their project', () => {
    expect(agendaMarkdown(personOpenItems(rows, 'rich', info))).toBe(
      '- [[5444-006]]\n\t- TODO Finalize column location\n\t- WAITING Send RFI to Thomas'
    );
    expect(agendaMarkdown(personOpenItems(rows, 'loren', info))).toBe('- WAITING Loren will reach out to Brady');
    expect(agendaMarkdown([])).toBe('');
  });
});
