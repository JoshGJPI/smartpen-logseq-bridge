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
    expect(out.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  });

  it('keeps the state and WAITING only beside checked: false', () => {
    expect(byId.t1).toMatchObject({ checked: false, marker: null });
    expect(byId.t2).toMatchObject({ checked: true, marker: null });
    expect(byId.t3).toMatchObject({ checked: false, marker: 'WAITING' });
    expect(byId.t4).toMatchObject({ checked: true, marker: null });
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
    for (const t of out) expect(Object.keys(t).sort()).toEqual(['checked', 'id', 'marker', 'parentText', 'text']);
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
      { id: 'c', text: 'z', checked: null },
      { text: 'no id', checked: false },
      null
    ])).toEqual([
      { id: 'a', text: 'x', checked: false, marker: 'WAITING', parentText: null },
      { id: 'b', text: 'y', checked: true, marker: null, parentText: null }
    ]);
  });
});
