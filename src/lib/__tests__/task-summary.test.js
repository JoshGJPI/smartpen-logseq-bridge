/**
 * The scan's per-page task summary is built twice: in main
 * (electron/task-summary.cjs, used by extractPageMeta) and in the renderer
 * (src/lib/tasks.js buildTaskSummary, used when a Library transcript save
 * refreshes its record). These tests run both over one fixture so they can't
 * drift, and pin what metaToRecord keeps.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fixture from './fixtures/task-lines.json';
import { buildTaskSummary, normalizeTaskSummary, TASK_TEXT_MAX } from '../tasks.js';
import { metaToRecord } from '$lib/storage/scan.js';

const require = createRequire(import.meta.url);
const main = require('../../../electron/task-summary.cjs');

describe('task summary: main and renderer agree', () => {
  it('produce the same summary from the shared fixture', () => {
    expect(main.buildTaskSummary(fixture.lines)).toEqual(buildTaskSummary(fixture.lines));
  });

  it('agree on empty and malformed input', () => {
    for (const input of [undefined, null, [], 'x', [null, 4, {}]]) {
      expect(main.buildTaskSummary(input)).toEqual(buildTaskSummary(input));
    }
  });
});

describe('buildTaskSummary', () => {
  const out = buildTaskSummary(fixture.lines);
  const byId = Object.fromEntries(out.map((t) => [t.id, t]));

  it('lists only lines with checked set and an id, in transcript order', () => {
    expect(out.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10']);
  });

  it('keeps the state and WAITING only beside checked: false', () => {
    expect(byId.t1).toMatchObject({ checked: false, marker: null });
    expect(byId.t2).toMatchObject({ checked: true, marker: null });
    expect(byId.t3).toMatchObject({ checked: false, marker: 'WAITING' });
    expect(byId.t4).toMatchObject({ checked: true, marker: null });
  });

  it('keeps CANCELLED only beside checked: true (v3.5.0)', () => {
    expect(byId.t9).toMatchObject({ checked: true, marker: 'CANCELLED' });
    expect(byId.t10).toMatchObject({ checked: false, marker: null });
  });

  it('names the parent line, falling back to the nearest shallower line', () => {
    expect(byId.t1.parentText).toBe('Coordination call w/ Troy');
    expect(byId.t5.parentText).toBe('Site visit'); // parentId points at a deleted line
    expect(byId.t6.parentText).toBe('Parent id points at a deleted line');
    expect(byId.t7.parentText).toBeNull();
  });

  it('stays small: trimmed, clipped text and five fields only', () => {
    expect(byId.t6.text).toBe('Deeper, under a sub-heading');
    expect(byId.t8.text.length).toBeLessThanOrEqual(TASK_TEXT_MAX);
    expect(byId.t8.text.endsWith('…')).toBe(true);
    for (const t of out) expect(Object.keys(t).sort()).toEqual(['checked', 'id', 'marker', 'parentText', 'projectHint', 'text']);
  });
});

// Made-up lines: two meetings on one page, as a page is often written.
const L = (id, text, indentLevel, extra = {}) => ({ id, text, indentLevel, parentId: null, checked: null, ...extra });
const twoMeetings = [
  L('d1', '10/14/26', 0),
  L('h1', '8:30 4981-003 Demo reveal site visit', 0),
  L('n1', 'Joists found under lobby', 1),
  L('a', 'Schedule field measure', 1, { checked: false }),
  L('d2', '8/14/260', 0),
  L('h2', '10:00 5444-006 Rich update', 0),
  L('n2', 'Compare with the 2327-018 detail', 1),
  L('b', 'Finalize column location', 1, { checked: false }),
  L('c', 'Send P2026-141 fee to Joe', 1, { checked: false }),
  L('e', 'Follow up', 2, { checked: false, parentId: 'n2' }),
  L('f', 'Top-level after both', 0, { checked: true })
];

describe('buildTaskSummary: projectHint, the nearest project number', () => {
  const hint = Object.fromEntries(buildTaskSummary(twoMeetings).map((t) => [t.id, t.projectHint]));

  it('main and renderer agree', () => {
    expect(main.buildTaskSummary(twoMeetings)).toEqual(buildTaskSummary(twoMeetings));
  });

  it('takes the heading the task sits under', () => {
    expect(hint.a).toBe('4981-003');
    expect(hint.b).toBe('5444-006'); // not the 2327-018 on a sibling note
  });

  it('a number in the task itself wins', () => {
    expect(hint.c).toBe('P2026-141');
  });

  it('the named parent comes before shallower lines', () => {
    expect(hint.e).toBe('2327-018');
  });

  it('falls back to the last number on any earlier line, else null', () => {
    expect(hint.f).toBe('P2026-141'); // the nearest earlier number, even inside a task
    expect(buildTaskSummary([L('x', 'No numbers', 0, { checked: false })])[0].projectHint).toBeNull();
    expect(buildTaskSummary([L('x', 'Dated 2026-10-21', 0, { checked: false })])[0].projectHint).toBeNull();
  });
});

describe('normalizeTaskSummary / metaToRecord', () => {
  it('a record carries the summary from main', () => {
    const tasks = buildTaskSummary(fixture.lines);
    const r = metaToRecord({ book: '3017', page: 42, pageId: '42', tasks });
    expect(r.tasks).toEqual(tasks);
  });

  it('a meta without tasks (an older main) gives none', () => {
    expect(metaToRecord({ book: '3017', page: 42, pageId: '42' }).tasks).toEqual([]);
  });

  it('drops malformed entries and a stray marker', () => {
    expect(normalizeTaskSummary([
      { id: 'a', text: 'x', checked: false, marker: 'WAITING', parentText: '' },
      { id: 'b', text: 'y', checked: true, marker: 'WAITING' },
      { id: 'k', text: 'w', checked: true, marker: 'CANCELLED' },
      { id: 'm', text: 'v', checked: false, marker: 'CANCELLED' },
      { id: 'c', text: 'z', checked: null },
      { text: 'no id', checked: false },
      null
    ])).toEqual([
      { id: 'a', text: 'x', checked: false, marker: 'WAITING', parentText: null, projectHint: null },
      { id: 'b', text: 'y', checked: true, marker: null, parentText: null, projectHint: null },
      { id: 'k', text: 'w', checked: true, marker: 'CANCELLED', parentText: null, projectHint: null },
      { id: 'm', text: 'v', checked: false, marker: null, parentText: null, projectHint: null }
    ]);
  });

  it('keeps a well-formed projectHint, drops anything else', () => {
    const [a, b] = normalizeTaskSummary([
      { id: 'a', text: 'x', checked: false, projectHint: '5444-006' },
      { id: 'b', text: 'y', checked: false, projectHint: 'beam' }
    ]);
    expect(a.projectHint).toBe('5444-006');
    expect(b.projectHint).toBeNull();
  });
});
