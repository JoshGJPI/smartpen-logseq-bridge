// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../core/tools.js';
import { inkRows, parseReference, alignLines, diffTranscript, formatDiff, swollenLines, COLUMN_MM } from '../core/transcript-check.js';

// Synthetic data only: check_transcript's ink rows and transcript diff.
const MM = 2.371;
const t0 = new Date(2026, 10, 10, 9, 0).getTime();
let root;

/** One "letter": a small zigzag 2 mm wide, 1.5 mm tall, its baseline at yMm. */
const letter = (t, xMm, yMm, lineId = null) => ({
  id: `s${t}`, startTime: t, endTime: t + 300, lineId,
  points: [[xMm, yMm], [xMm + 0.5, yMm - 1.5], [xMm + 1, yMm], [xMm + 1.5, yMm - 1.5], [xMm + 2, yMm]]
    .map(([x, y], i) => [x / MM, y / MM, t + i * 10, 300])
});
/** A row of `n` letters starting at leftMm, written from time t. */
const row = (t, leftMm, yMm, n, lineId) => Array.from({ length: n }, (_, i) => letter(t + i * 500, leftMm + i * 2.5, yMm, lineId));
const line = (id, text, indentLevel = 0, extra = {}) => ({ id, text, indentLevel, parentId: null, checked: null, yBounds: null, ...extra });

function page() {
  return {
    version: '2.0', pageInfo: { section: 3, owner: 1, book: 3017, page: 1 },
    metadata: { lastUpdated: '2026-11-10T00:00:00Z', totalStrokes: 0, bounds: {} },
    transcript: {
      lastTranscribed: '2026-11-10T16:00:00Z',
      lines: [
        line('a', '9999-110 NSSA Cont.'),
        line('b', 'Shelters requiring blast resistance', 1),
        line('c', 'Speed Fab crete', 2),
        line('d', 'ask Jeff for drawings', 1, { checked: false }),
        line('e', 'a line with no ink', 1)
      ]
    },
    strokes: [
      ...row(t0, 14.5, 20, 8, 'a'),
      // b: a row reaching the right edge (x 20 → ~140) then a wrapped row further in
      ...row(t0 + 10000, 20, 26, 49, 'b'),
      ...row(t0 + 40000, 24.6, 31, 10, 'b'),
      ...row(t0 + 50000, 20, 40, 6, 'c'),
      ...row(t0 + 60000, 24.6, 45, 6, 'd'),
      letter(t0 + 70000, 90, 60)                       // a stray letter, no row of its own
    ]
  };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tcheck-'));
  const dir = path.join(root, 'pages', 'B3017');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'P1.json'), JSON.stringify(page()));
  const untranscribed = { ...page(), transcript: { lastTranscribed: null, lines: [] } };
  fs.writeFileSync(path.join(dir, 'P2.json'), JSON.stringify(untranscribed));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('inkRows', () => {
  it('finds each written row with its indent column and flags a possible wrap', () => {
    const rows = inkRows(page());
    expect(rows.map((r) => r.y)).toEqual([19, 25, 30, 39, 44]);
    expect(rows.map((r) => r.column)).toEqual([0, 1, 2, 1, 2]);
    expect(rows.map((r) => r.wrap)).toEqual([false, false, true, false, false]);
    expect(rows[0].left).toBeCloseTo(14.5, 1);
    expect(rows[0].day).toBe('2026-11-10');
  });
  it('one column is about COLUMN_MM', () => {
    expect(COLUMN_MM).toBeGreaterThan(4);
    expect(COLUMN_MM).toBeLessThan(5);
  });
  it('ignores big strokes and empty pages', () => {
    const big = { id: 's1', startTime: 1, points: [[0, 0], [100 / MM, 0], [100 / MM, 40 / MM]] };
    expect(inkRows({ strokes: [big] })).toEqual([]);
    expect(inkRows({ strokes: [] })).toEqual([]);
    expect(inkRows(null)).toEqual([]);
  });
});

describe('parseReference', () => {
  it('reads tabs, spaces, bullets and task markers', () => {
    expect(parseReference('- a\n\t- TODO b\n\t\t* DONE c\n# heading\nplain\n- ')).toEqual([
      { level: 0, text: 'a', state: null },
      { level: 1, text: 'b', state: 'TODO' },
      { level: 2, text: 'c', state: 'DONE' }
    ]);
    expect(parseReference('- a\n  - b\n    - WAITING c\r\n').map((l) => [l.level, l.state])).toEqual([[0, null], [1, null], [2, 'WAITING']]);
    expect(parseReference('')).toEqual([]);
  });
});

describe('alignLines', () => {
  it('pairs similar lines and leaves missing ones unpaired', () => {
    const s = [{ text: 'alpha beta' }, { text: 'gamma' }, { text: 'delta epsilon' }];
    const r = [{ text: 'alpha betta' }, { text: 'new line here' }, { text: 'delta epsilon' }];
    const pairs = alignLines(s, r);
    expect(pairs[0]).toEqual([0, 0]);
    expect(pairs[3]).toEqual([2, 2]);
    expect(pairs.slice(1, 3)).toEqual(expect.arrayContaining([[1, null], [null, 1]]));
    expect(alignLines([], [{ text: 'x' }])).toEqual([[null, 0]]);
  });
});

describe('diffTranscript', () => {
  const ref = [
    '- 9999-110 NSSA Cont.',
    '\t- Shelters requiring blast resistance',
    '\t- Speed Fab Crete',
    '\t- TODO ask Jeff for drawings',
    '\t- Jason Thompson',
    '\t- a line with no ink'
  ].join('\n');
  it('reports wording, case-only, indent, state, missing lines and stroke counts', () => {
    const d = diffTranscript(page(), ref);
    expect(d.tally).toMatchObject({ matched: 5, exact: 4, minor: 1, wording: 0, indent: 1, state: 0, missing: 0, extra: 1 });
    expect(d.unlinked).toBe(1);
    const c = d.rows.find((r) => r.stored && r.stored.n === 3);
    expect(c).toMatchObject({ kind: 'minor', indent: true });
    expect(c.stored.strokes).toBe(6);
    expect(d.rows.find((r) => r.kind === 'reference-only').ref.text).toBe('Jason Thompson');
    const text = formatDiff(d);
    expect(text).toMatch(/#3 \(6\) case\/punct, indent/);
    expect(text).toMatch(/REFERENCE ONLY {2}L1 Jason Thompson/);
    expect(text).toMatch(/#5 \(0\) NO INK LINKED/);
    expect(text).not.toMatch(/#1 /);
  });
  it('flags a task state the reference disagrees with', () => {
    const d = diffTranscript(page(), ref.replace('TODO ask', 'DONE ask'));
    expect(d.tally.state).toBe(1);
    expect(formatDiff(d)).toMatch(/#4 \(6\) state\n {4}stored: L1 TODO ask/);
  });
});

describe('swollenLines', () => {
  const l = (n, strokes) => ({ n, strokes });
  it('flags a line holding many rows of ink and counts the empty lines after it', () => {
    const stored = [l(1, 22), l(2, 38), l(3, 35), l(4, 45), l(5, 30), l(6, 479), l(7, 116), l(8, 0), l(9, 0)];
    expect(swollenLines(stored)).toEqual([{ n: 6, strokes: 479, median: 38, emptyAfter: 2 }]);
    const d = { tally: { matched: 0, words: 0, wordDiffs: 0 }, rows: [], unlinked: 0, storedLines: 9, refLines: 0, swollen: swollenLines(stored) };
    expect(formatDiff(d)).toMatch(/LINKS BROKEN\? #6 has 479 strokes \(median line 38\) and 2 later line\(s\) have none/);
  });
  it('leaves long but normal lines and tiny transcripts alone', () => {
    expect(swollenLines([l(1, 40), l(2, 138), l(3, 45), l(4, 50)])).toEqual([]);
    expect(swollenLines([l(1, 10), l(2, 900)])).toEqual([]);
    expect(swollenLines([])).toEqual([]);
  });
});

describe('check_transcript tool', () => {
  it('without a reference: rows only, no transcript text', () => {
    const r = createTools(root).check_transcript({ book: '3017', page: '1' });
    const out = r.content[0].text;
    expect(out).toMatch(/transcribed \(5 lines; text not shown here\)/);
    expect(out).toMatch(/5 written row\(s\)/);
    expect(out).toMatch(/column 2 .* wrap\?/);
    expect(out).not.toMatch(/Shelters|NSSA|Jeff/);
  });
  it('with a reference: the diff', () => {
    const r = createTools(root).check_transcript({ book: '3017', page: '1', reference: '- 9999-110 NSSA Cont.\n\t- Shelters requiring blast resistance' });
    expect(r.content[0].text).toMatch(/Stored 5 line\(s\), reference 2; matched 2: 2 exact/);
    expect(r.content[0].text).toMatch(/STORED ONLY/);
  });
  it('a reference for an untranscribed page is an error; rows still work', () => {
    const tools = createTools(root);
    expect(tools.check_transcript({ book: '3017', page: '2', reference: '- x' }).isError).toBe(true);
    expect(tools.check_transcript({ book: '3017', page: '2' }).content[0].text).toMatch(/not transcribed/);
    expect(tools.check_transcript({ book: '3017', page: '9' }).isError).toBe(true);
  });
});
