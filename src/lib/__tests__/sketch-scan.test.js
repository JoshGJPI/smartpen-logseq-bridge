/**
 * Sketch lines in the scan (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.4 / E.5):
 * both task summaries (lib/tasks.js and electron/task-summary.cjs, one fixture)
 * skip sketch lines, and main's extractPageMeta gives a record `sketches` and the
 * `[sketch] label` text.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { buildTaskSummary } from '../tasks.js';
import { metaToRecord } from '$lib/storage/scan.js';
import { mainFunctions } from '../../../mcp/__fixtures__/app-side.js';

const require = createRequire(import.meta.url);
const main = require('../../../electron/task-summary.cjs');

describe('task summaries skip sketch lines, in both implementations', () => {
  const lines = [
    { id: 'p', text: '5444-006 site visit', indentLevel: 0 },
    { id: 'sk', kind: 'sketch', text: 'Plan 6226-001', indentLevel: 1, checked: null },
    { id: 'u', kind: 'sketch', text: 'TODO looks like a task', indentLevel: 1, checked: false },
    { id: 't', text: 'check the stair', indentLevel: 2, checked: false },
    { id: 'k', kind: 'table', text: 'beam sizes', indentLevel: 0 },
    { id: 't2', text: 'order steel', indentLevel: 1, checked: false },
  ];

  it('both implementations agree', () => {
    expect(main.buildTaskSummary(lines)).toEqual(buildTaskSummary(lines));
  });

  it('a sketch is never a task, never a head, and its label gives no project', () => {
    const out = buildTaskSummary(lines);
    expect(out.map((t) => t.id)).toEqual(['t', 't2']);
    expect(out[0].heads).toEqual([{ id: 'p', text: '5444-006 site visit' }]);
    expect(out[0].projectHint).toBe('5444-006');
    expect(out[0].parentText).toBe('5444-006 site visit');
    // Another kind (E.7) is no head either.
    expect(out[1].heads).toEqual([{ id: 'p', text: '5444-006 site visit' }]);
  });
});

describe('main\'s scan record carries `sketches` and the [sketch] text', () => {
  it('extractPageMeta → metaToRecord', () => {
    const { extractPageMeta } = mainFunctions(['buildTranscriptionText', 'countStrokeLines', 'extractPageMeta']);
    const shell = {
      version: '2.0', pageInfo: { book: 3017, page: 124 }, metadata: { lastUpdated: 'x', totalStrokes: 1 },
      transcript: { lastTranscribed: null, lines: [
        { id: 'A', text: 'site visit', indentLevel: 0 },
        { id: 'S', kind: 'sketch', text: 'Floor plan', indentLevel: 1, checked: null, yBounds: null, bounds: { minX: 1, maxX: 2, minY: 3, maxY: 4 } }
      ] }
    };
    const stroke = { id: 's1', startTime: 1, endTime: 2, lineId: 'S', points: [[1, 3], [2, 4]] };
    const raw = `${JSON.stringify(shell, null, 2).replace(/\n}$/, '')},\n  "strokes": [\n    ${JSON.stringify(stroke)}\n  ]\n}\n`;
    const meta = extractPageMeta(raw);
    expect(meta.sketches).toEqual([{ id: 'S', label: 'Floor plan', lineIndex: 1 }]);
    expect(meta.transcriptionText).toBe('site visit\n  [sketch] Floor plan');
    expect(meta.tasks).toEqual([]);
    const rec = metaToRecord({ book: '3017', page: 124, pageId: '124', ...meta });
    expect(rec.sketches).toEqual([{ id: 'S', label: 'Floor plan', lineIndex: 1 }]);
    expect(metaToRecord({ book: '3017', page: 1 }).sketches).toEqual([]);   // an older main: none
  });
});
