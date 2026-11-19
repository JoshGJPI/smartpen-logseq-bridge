// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../core/tools.js';
import { inkRows, formatRows, parseReference, alignLines, movedPairs, diffTranscript, formatDiff, swollenLines, partlyTranscribedNote, linkedStrokeCount, textlessStrokeCount, COLUMN_MM } from '../core/transcript-check.js';

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

// alignLines' own tests moved to src/lib/__tests__/line-align.test.js (v3.21.0).
describe('alignLines (re-exported from src/lib/line-align.js)', () => {
  it('is the shared implementation', () => {
    expect(alignLines([{ text: 'a b' }], [{ text: 'a b' }])).toEqual([[0, 0]]);
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
    expect(text).toMatch(/#3 \(6\) case\/punct\/spacing, indent/);
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

describe('moved lines', () => {
  // 3017/180: a meeting written at the top, transcribed later, stored at the end.
  const doc = () => ({
    ...page(),
    transcript: { lastTranscribed: '2026-11-10T16:00:00Z', lines: [
      line('a', '11/10/26'), line('b', 'NSSA Conference in Norman, OK'), line('c', 'Storm shelter Code Updates', 1),
      line('d', '11/6/26'), line('e', '11:30 9999-110 Meeting w/ Joe H'), line('f', "It's not worth getting overwhelmed", 1)
    ] }
  });
  const ref = ['- 11/6/26', '- 11:30 9999-110 Meeting w/ Joe H', "\t- It's not worth getting overwhelmed",
    '- 11/10/26', '- NSSA Conference in Norman, OK', '\t- Storm shelter Code Updates'].join('\n');
  it('pairs the same line found on both sides as moved, not missing twice', () => {
    const d = diffTranscript(doc(), ref);
    expect(d.tally).toMatchObject({ matched: 6, moved: 3, missing: 0, extra: 0 });
    const text = formatDiff(d);
    expect(text).toMatch(/out of order 3/);
    expect(text).toMatch(/OUT OF ORDER: 3 stored line/);
    expect(text).toMatch(/#4 \(\d+\) MOVED \(on the page it follows nothing: it is first\)/);
    expect(text).toMatch(/#5 \(\d+\) MOVED \(on the page it follows "11\/6\/26"\)/);
    expect(text).not.toMatch(/STORED ONLY|REFERENCE ONLY/);
  });
  it('leaves unlike lines missing on both sides', () => {
    const pairs = [[0, null], [null, 0]];
    expect(movedPairs(pairs, [{ text: 'alpha beta gamma' }], [{ text: 'something else entirely' }])).toEqual(pairs);
    expect(movedPairs([[0, null], [null, 0]], [{ text: 'Typical, A-Block' }], [{ text: 'Typical, A-Block' }])).toEqual([[0, 0, true]]);
  });
});

describe('spacing-only differences', () => {
  it('count as case/punctuation/spacing, not wording', () => {
    const d = diffTranscript({ ...page(), transcript: { lines: [line('a', 'IBC 2024'), line('b', 'Rolling steel ICC 500 doors')] } },
      '- IBC2024\n- Rolling steel ICC500 doors');
    expect(d.tally).toMatchObject({ minor: 2, wording: 0, wordDiffs: 0 });
    expect(formatDiff(d)).toMatch(/#1 \(\d+\) case\/punct\/spacing/);
  });
});

describe('partly transcribed pages', () => {
  it('warns when most of the ink is in no line', () => {
    expect(partlyTranscribedNote(190, 1209)).toMatch(/PARTLY TRANSCRIBED\? 1019 of 1209 strokes \(84%\)/);
    expect(partlyTranscribedNote(1192, 1250)).toBe('');
    expect(partlyTranscribedNote(0, 100, false)).toBe('');
    expect(partlyTranscribedNote(0, 0)).toBe('');
  });
  it('counts linked strokes and marks rows with none', () => {
    const doc = { ...page(), transcript: { lines: [line('a', 'x')] } };
    expect(linkedStrokeCount(doc)).toBe(8);
    const rows = inkRows(doc);
    expect(rows.map((r) => r.linked > 0)).toEqual([true, false, false, false, false]);
    const out = formatRows(rows, { links: true });
    expect(out).toMatch(/4 of 5 rows/);
    expect(out.split('\n').filter((l) => l.endsWith('not transcribed'))).toHaveLength(4);
    expect(formatRows(rows)).not.toMatch(/not transcribed/);
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

describe('ink left out as Not text (textless, v3.20.0)', () => {
  // Row b (59 strokes) left out on purpose: unlinked, `textless: true`.
  const leftOut = () => {
    const doc = page();
    doc.strokes = doc.strokes.map((s) => (s.lineId === 'b' ? { ...s, lineId: null, textless: true } : s));
    return doc;
  };
  beforeAll(() => {
    fs.writeFileSync(path.join(root, 'pages', 'B3017', 'P3.json'), JSON.stringify(leftOut()));
  });

  it('is counted on its own, not as ink in no line', () => {
    expect(textlessStrokeCount(leftOut())).toBe(59);
    expect(textlessStrokeCount(page())).toBe(0);
    const d = diffTranscript(leftOut(), '- 9999-110 NSSA Cont.');
    expect(d.unlinked).toBe(1);   // the stray letter only
    expect(d.textless).toBe(59);
    expect(formatDiff(d)).toMatch(/1 stroke\(s\) linked to no line \(not counting 59 left out as Not text\)\./);
    expect(formatDiff(diffTranscript(page(), '- x'))).toMatch(/1 stroke\(s\) linked to no line\./);
  });

  it('its rows are not "not transcribed"', () => {
    const rows = inkRows(leftOut());
    expect(rows.every((r) => r.linked > 0)).toBe(true);
    expect(formatRows(rows, { links: true })).not.toMatch(/not transcribed/);
  });

  it('check_transcript: no PARTLY TRANSCRIBED warning for ink left out on purpose, and says how much', () => {
    const out = createTools(root).check_transcript({ book: '3017', page: '3' }).content[0].text;
    expect(out).toMatch(/80 strokes \(59 left out as Not text\)/);
    expect(out).not.toMatch(/PARTLY TRANSCRIBED/);
  });
});
