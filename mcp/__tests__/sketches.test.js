// @vitest-environment node
/**
 * Sketch lines in the MCP (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.4 / E.5):
 * get_transcript prints `#n [sketch] label (k strokes)`, list_sketches filters by
 * project / tag / person / book / days with tags from block scope, render_page
 * { line } crops to one sketch, check_transcript leaves sketch lines out of the
 * comparison, and search finds sketches. Synthetic data only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../core/tools.js';

let root;
let tools;
const T = new Date(2026, 7, 4, 9, 30).getTime();
const stroke = (n, x, y, lineId = null) => ({
  id: `s${T + n}`, startTime: T + n, endTime: T + n + 100, lineId,
  points: [[x, y, T + n, 300], [x + 3, y + 2, T + n + 50, 300], [x + 6, y, T + n + 100, 300]]
});
const sk = (id, text, indentLevel) => ({ id, kind: 'sketch', text, indentLevel, parentId: null, checked: null, yBounds: null, bounds: null });
const line = (id, text, indentLevel = 0, extra = {}) => ({ id, text, indentLevel, parentId: null, checked: null, yBounds: null, ...extra });

function writePage(book, id, strokes, lines) {
  const dir = path.join(root, 'pages', `B${book}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P${id}.json`), JSON.stringify({
    version: '2.0', pageInfo: { section: 3, owner: 1, book: parseInt(book, 10), page: parseInt(id, 10) },
    metadata: { lastUpdated: '2026-08-04T12:00:00Z', totalStrokes: strokes.length, bounds: {} },
    transcript: { lastTranscribed: '2026-08-04T12:00:00Z', lines }, strokes
  }));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sketch-'));
  writePage('3017', '124', [
    stroke(1, 10, 10, 'A'), stroke(2, 20, 30, 'FP'), stroke(3, 30, 40, 'FP'), stroke(4, 10, 60, 'B'), stroke(5, 20, 70, 'ST'), stroke(6, 50, 90)
  ], [
    line('A', '9:30 6226-001 Initial Site Visit'), sk('FP', 'Floor plan', 1),
    line('B', 'Isaiah to check the stair'), sk('ST', 'Stair section', 1), line('C', 'call him', 1, { checked: false })
  ]);
  writePage('3017', '131', [stroke(10, 10, 10, 'W')], [line('H', 'Historical steel'), sk('W', 'Weld setup', 1)]);
  fs.writeFileSync(path.join(root, 'pages', '_tags.json'), JSON.stringify({
    version: 1, pages: { '3017/124': ['6226-001', '5444-006', 'isaiah'], '3017/131': ['5444-006'] }, dismissed: {},
    info: { isaiah: { type: 'person' } }
  }));
  tools = createTools(root);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const textOf = (r) => r.content[0].text;

describe('sketch lines in the MCP', () => {
  it('get_transcript prints a sketch line with its stroke count, never as a task', () => {
    const out = textOf(tools.get_transcript({ book: '3017', page: '124' }));
    expect(out).toMatch(/#2 +- \[sketch\] Floor plan \(2 strokes\)/);
    expect(out).toMatch(/#4 +- \[sketch\] Stair section \(1 stroke\)/);
    expect(out).toMatch(/#5 +- TODO call him/);
  });

  it('list_sketches: every sketch with page, line, label, strokes and tags by block scope', () => {
    const [head, body] = textOf(tools.list_sketches({})).split('\n');
    expect(head).toMatch(/^3 sketch\(es\)/);
    const rows = JSON.parse(body);
    const fp = rows.find((r) => r.label === 'Floor plan');
    expect(fp).toMatchObject({ page: '3017/124', line: '#2', strokes: 2, written: '2026-08-04' });
    expect(fp.tags).toEqual(['5444-006', '6226-001']);
    expect(rows.find((r) => r.label === 'Stair section').tags).toEqual(['5444-006', 'isaiah']);
  });

  it('list_sketches filters by project, person, tag, book and days', () => {
    const labels = (args) => JSON.parse(textOf(tools.list_sketches(args)).split('\n')[1]).map((r) => r.label).sort();
    expect(labels({ project: '6226-001' })).toEqual(['Floor plan']);
    expect(labels({ project: '5444-006' })).toEqual(['Floor plan', 'Stair section', 'Weld setup']);
    expect(labels({ person: 'Isaiah' })).toEqual(['Stair section']);
    expect(labels({ tag: 'isaiah', book: '3017' })).toEqual(['Stair section']);
    expect(labels({ from: '2026-08-05' })).toEqual([]);
    expect(tools.list_sketches({ person: 'nobody' }).isError).toBe(true);
  });

  it('render_page { line } crops to one sketch\'s ink', () => {
    const r = tools.render_page({ book: '3017', page: '124', line: '#2' });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/#2 \[sketch\] Floor plan: 2 strokes, cropped to them/);
    expect(r.content[1].type).toBe('image');
    expect(tools.render_page({ book: '3017', page: '124', line: 99 }).isError).toBe(true);
    expect(textOf(tools.render_page({ book: '3017', page: '124', line: 5 }))).toMatch(/no ink linked/);
  });

  it('check_transcript leaves sketch lines out of the comparison and names Make sketch for ink in no line', () => {
    const out = textOf(tools.check_transcript({ book: '3017', page: '124', reference: '- 9:30 6226-001 Initial Site Visit\n- Isaiah to check the stair\n\t- TODO call him' }));
    expect(out).toMatch(/2 sketch line\(s\) not compared/);
    expect(out).toMatch(/Make sketch/);
    expect(out).not.toMatch(/STORED ONLY/);
  });

  it('search: has:sketch with a project finds its sketch first', () => {
    const out = JSON.parse(textOf(tools.search({ query: 'has:sketch 6226-001' })).split('\n')[1]);
    expect(out.order[0]).toBe('sketches');
    expect(out.sketches).toEqual([{ page: '3017/124', line: '#2', label: 'Floor plan', tags: ['5444-006', '6226-001'] }]);
  });
});
