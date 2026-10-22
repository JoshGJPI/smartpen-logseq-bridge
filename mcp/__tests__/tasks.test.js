/**
 * list_tasks: the MCP task query against the app's Tasks view on one synthetic
 * folder. The app side is the app's own pipeline: main.cjs scan metadata
 * (task-summary.cjs) → metaToRecord → buildTaskRows / filterTaskRows /
 * groupTaskRows (stores/tasks.js, TasksView.svelte).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskRows, filterTaskRows, groupTaskRows, compareTaskRows, stateLabel, TASK_FILTERS, TASK_GROUPS } from '$lib/tasks.js';
import { pageDates } from '$lib/library-home.js';
import { normalizeTagsFile } from '$lib/tags.js';
import { createTools } from '../core/tools.js';
import { appScan, writePage as writeFixturePage } from '../__fixtures__/app-side.js';

let root, tools;
const t = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const stroke = (ms) => ({ id: `s${ms}`, startTime: ms, endTime: ms + 400, lineId: null, points: [[5, 5, ms, 200], [9, 6, ms + 200, 200]] });
const line = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null, ...extra });
const todo = (id, text, extra = {}) => line(id, text, { checked: false, ...extra });
const done = (id, text, extra = {}) => line(id, text, { checked: true, ...extra });
const writePage = (...a) => writeFixturePage(root, ...a);

const TAGS = {
  '388/1': ['P2026-141', 'beam'],
  '388/2': ['2327-018', 'P2026-141', 'site'],   // first project tag: 2327-018
  '390/5': ['site'],                            // tagged, no project tag
  '390/9': ['orphan']                           // page does not exist
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tasks-'));
  // 23:59:59 on the 14th (local): this page is written on the 14th only.
  writePage('388', '1', [stroke(t(2026, 10, 14, 23, 59, 59))], [
    line('h', 'Beam check grid 4'),
    todo('a', 'call supplier', { indentLevel: 1 }),
    todo('b', 'RFI 12 answer', { indentLevel: 1, marker: 'WAITING' }),
    done('c', 'old steel option', { indentLevel: 1, marker: 'CANCELLED' }),
    done('d', 'sent drawings', { indentLevel: 1 }),
    todo('e', 'wrong-side cancelled', { marker: 'CANCELLED' }),   // reads as TODO
    done('f', 'wrong-side waiting', { marker: 'WAITING' })        // reads as DONE
  ]);
  // 00:00:00 on the 15th: the 15th.
  writePage('388', '2', [stroke(t(2026, 10, 15, 0, 0, 0))], [
    line('h', 'Footing meeting'),
    todo('a', 'review footing sizes', { indentLevel: 1, parentId: 'h' }),
    todo('b', 'ask owner about pier', { indentLevel: 1, marker: 'WAITING' })
  ]);
  writePage('388v2', '151b', [stroke(t(2026, 10, 16, 9, 0))], [line('p', 'notes'), todo('a', 'order rebar')]);
  writePage('390', '5', [stroke(t(2026, 10, 17, 9, 0)), stroke(t(2026, 10, 18, 9, 0))], [
    todo('a', 'site walk photos'), done('b', 'site walk booked')
  ]);
  writePage('390', '6', [stroke(t(2026, 10, 17, 10, 0))], [line('a', '☐ unconverted box')]);  // not a task yet
  writePage('390', '7', [stroke(t(2026, 10, 17, 11, 0))]);                                  // untranscribed
  fs.writeFileSync(path.join(root, 'pages', '_aliases.json'), JSON.stringify({ 388: 'Field Book', 390: 'Desk Pad' }));
  fs.writeFileSync(path.join(root, 'pages', '_tags.json'), JSON.stringify({ version: 1, pages: TAGS, dismissed: {} }));
  tools = createTools(root);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const call = (args) => {
  const res = tools.list_tasks(args);
  if (res.isError) throw new Error(res.content[0].text);
  const [head, ...rest] = res.content[0].text.split('\n');
  return { head, body: JSON.parse(rest.join('\n')) };
};
const ids = (rows) => rows.map((r) => `${r.book}/${r.page}#${r.line}`);

describe('list_tasks states', () => {
  it('reads each state, ignoring a marker on the wrong side', () => {
    const { body } = call({ state: 'all', book: '388', limit: 200 });
    const by = Object.fromEntries(body.map((r) => [`${r.page}#${r.line}`, r.state]));
    expect(by).toMatchObject({
      '1#a': 'TODO', '1#b': 'WAITING', '1#c': 'CANCELLED', '1#d': 'DONE', '1#e': 'TODO', '1#f': 'DONE',
      '2#a': 'TODO', '2#b': 'WAITING'
    });
    for (const r of body) expect(['TODO', 'DONE', 'WAITING', 'CANCELLED']).toContain(r.state);
  });
  it('open (the default) is TODO + WAITING; todo is TODO only', () => {
    const open = call({}).body;
    expect(new Set(open.map((r) => r.state))).toEqual(new Set(['TODO', 'WAITING']));
    expect(open).toHaveLength(7);
    expect(call({ state: 'todo' }).body.every((r) => r.state === 'TODO')).toBe(true);
    expect(call({ state: 'todo' }).body).toHaveLength(5);
    expect(call({ state: 'waiting' }).body).toHaveLength(2);
    expect(call({ state: 'cancelled' }).body.map((r) => r.text)).toEqual(['old steel option']);
  });
  it('reports counts per state for the scope, whatever the state filter', () => {
    const { head } = call({ state: 'done', book: '388' });
    expect(head).toContain('"open":5,"todo":3,"waiting":2,"done":2,"cancelled":1,"all":8');
  });
  it('rejects an unknown state or group', () => {
    expect(tools.list_tasks({ state: 'doing' }).isError).toBe(true);
    expect(tools.list_tasks({ group_by: 'week' }).isError).toBe(true);
  });
});

describe('list_tasks filters', () => {
  it('project = the first project tag only', () => {
    expect(ids(call({ project: 'P2026-141' }).body).every((k) => k.startsWith('388/1#'))).toBe(true);
    expect(ids(call({ project: '2327-018' }).body)).toEqual(['388/2#a', '388/2#b']);
    // normalized like the app: dashes, brackets, case
    expect(call({ project: '[[p2026–141]]' }).body).toHaveLength(3);
  });
  it('project "untagged" = no project tag (tagged or not)', () => {
    expect(ids(call({ project: 'untagged' }).body).sort()).toEqual(['388v2/151b#a', '390/5#a']);
  });
  it('tag matches any of the page tags, not only the first project tag', () => {
    expect(ids(call({ tag: 'P2026-141' }).body).sort()).toEqual(['388/1#a', '388/1#b', '388/1#e', '388/2#a', '388/2#b']);
    expect(ids(call({ tag: 'site' }).body).sort()).toEqual(['388/2#a', '388/2#b', '390/5#a']);
  });
  it('several tags must all be on the page', () => {
    expect(ids(call({ tag: ['site', 'P2026-141'] }).body).sort()).toEqual(['388/2#a', '388/2#b']);
    expect(call({ tag: ['site', 'beam'] }).body).toEqual([]);
  });
  it('book', () => {
    expect(ids(call({ book: '388v2' }).body)).toEqual(['388v2/151b#a']);
  });
  it('dates are local days: 23:59:59 and 00:00:00 fall on different days', () => {
    expect(ids(call({ from: '2026-10-15' }).body)).toEqual(['388/2#a', '388/2#b']);
    expect(new Set(call({ from: '2026-10-14', to: '2026-10-14' }).body.map((r) => r.page))).toEqual(new Set(['1']));
    expect(call({ from: '2026-10-13', to: '2026-10-15' }).body).toHaveLength(5);
    expect(tools.list_tasks({ from: '2026-13-45' }).isError).toBe(true);
  });
  it('a page written over several days matches any of them', () => {
    expect(ids(call({ from: '2026-10-18' }).body)).toEqual(['390/5#a']);
    expect(call({ from: '2026-10-18' }).body[0].written).toBe('2026-10-17 to 2026-10-18');
  });
  it('text matches the task or its parent, case-insensitive', () => {
    expect(ids(call({ text: 'FOOTING MEETING' }).body)).toEqual(['388/2#a', '388/2#b']);
    expect(ids(call({ text: 'rebar' }).body)).toEqual(['388v2/151b#a']);
  });
});

describe('list_tasks rows, groups, paging', () => {
  it('a row carries what Claude needs to follow up', () => {
    const r = call({ book: '388', project: '2327-018' }).body[0];
    expect(r).toEqual({
      state: 'TODO', text: 'review footing sizes', parent: 'Footing meeting', notebook: 'Field Book', book: '388', page: '2',
      project: '2327-018', tags: ['2327-018', 'P2026-141', 'site'], written: '2026-10-15', line: 'a'
    });
    expect(call({ book: '388v2' }).body[0]).not.toHaveProperty('tags');
  });
  it('groups by project like the Tasks view (untagged last)', () => {
    const { body } = call({ group_by: 'project' });
    // Newest-written group first: 2327-018 (Oct 15) before P2026-141 (Oct 14).
    expect(body.map((g) => [g.group, g.tasks])).toEqual([['2327-018', 2], ['P2026-141', 3], ['No project tag', 2]]);
  });
  it('groups by date and book', () => {
    expect(call({ group_by: 'date' }).body.map((g) => g.group)).toEqual(['2026-10-17', '2026-10-16', '2026-10-15', '2026-10-14']);
    expect(call({ group_by: 'book' }).body.map((g) => g.group)).toEqual(['Field Book (388)', 'Field Book · Vol 2 (388v2)', 'Desk Pad (390)']);
  });
  it('pages with offset and says what is left', () => {
    const all = ids(call({ limit: 200 }).body);
    const a = call({ limit: 3 });
    expect(a.head).toContain('4 more, call again with offset=3');
    const b = call({ limit: 3, offset: 3 });
    const c = call({ limit: 3, offset: 6 });
    expect(c.head).not.toContain('more');
    expect([...ids(a.body), ...ids(b.body), ...ids(c.body)]).toEqual(all);
  });
  it('grouped paging keeps the grouped order', () => {
    const flat = call({ group_by: 'project', limit: 200 }).body.flatMap((g) => ids(g.rows));
    const p1 = call({ group_by: 'project', limit: 4 }).body.flatMap((g) => ids(g.rows));
    const p2 = call({ group_by: 'project', limit: 4, offset: 4 }).body.flatMap((g) => ids(g.rows));
    expect([...p1, ...p2]).toEqual(flat);
  });
  it('names pages whose task boxes are still in the text', () => {
    expect(call({}).head).toContain('1 transcribed page(s) still have task boxes');
  });
  it('says it is read-only', () => {
    expect(call({}).head).toContain('Read-only');
  });
});

describe('open-task counts on the other tools', () => {
  it('list_pages, list_tags, list_notebooks', () => {
    const pages = JSON.parse(tools.list_pages({ book: '388' }).content[0].text.split('\n')[1]);
    expect(pages.find((p) => p.page === '1').openTasks).toBe(3);
    const tags = JSON.parse(tools.list_tags({}).content[0].text.split('\n')[1]);
    expect(tags.find((x) => x.tag === 'site').openTasks).toBe(3);
    expect(tags.find((x) => x.tag === 'beam').openTasks).toBe(3);
    const books = JSON.parse(tools.list_notebooks({}).content[0].text);
    expect(books.find((b) => b.book === '388').openTasks).toBe(5);
  });
  it('get_transcript labels WAITING and CANCELLED', () => {
    const txt = tools.get_transcript({ book: '388', page: '1' }).content[0].text;
    expect(txt).toContain('- WAITING RFI 12 answer');
    expect(txt).toContain('- CANCELLED old steel option');
    expect(txt).toContain('- TODO wrong-side cancelled');
  });
});

describe('parity with the app Tasks view', () => {
  const appRows = () => {
    const { records, timeline } = appScan(root);
    const tags = normalizeTagsFile(JSON.parse(fs.readFileSync(path.join(root, 'pages', '_tags.json'), 'utf8'))).pages;
    return buildTaskRows(records, { tags, dates: pageDates(timeline) });
  };
  const appShape = (r) => [r.book, r.pageId, r.lineId, stateLabel(r.state), r.text, r.parentText || null, r.project, r.day];
  const mcpShape = (r) => [r.book, r.page, r.line, r.state, r.text, r.parent || null, r.project || null, r.written ? r.written.slice(0, 10) : null];
  // The app's chips → this tool's state (the app's "Open" chip is TODO only).
  const STATE_FOR = { open: 'todo', waiting: 'waiting', done: 'done', cancelled: 'cancelled', all: 'all' };

  it.each(TASK_FILTERS.map((f) => f.id))('chip %s', (f) => {
    const app = filterTaskRows(appRows(), f).sort(compareTaskRows).map(appShape);
    expect(app.length).toBeGreaterThan(0);
    expect(call({ state: STATE_FOR[f], limit: 200 }).body.map(mcpShape)).toEqual(app);
  });
  it.each(TASK_GROUPS.map((g) => g.id))('group by %s', (by) => {
    const app = groupTaskRows(filterTaskRows(appRows(), 'all'), by).map((g) => [g.id, g.rows.map(appShape)]);
    const mcp = call({ state: 'all', group_by: by, limit: 200 }).body.map((g) => g.rows.map(mcpShape));
    expect(mcp).toEqual(app.map(([, rows]) => rows));
  });
  it('the fixture exercises every state', () => {
    const states = new Set(appRows().map((r) => r.state));
    expect(states).toEqual(new Set(['todo', 'waiting', 'done', 'cancelled']));
  });
});
