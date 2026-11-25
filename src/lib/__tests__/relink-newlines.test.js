import { describe, it, expect } from 'vitest';
import {
  defaultDecisions, addedGroups, canMergeUp, setMergeUp, setNewText, setNewIndent, isNewLineRow,
  buildRelinkSpec, reviewCounts, LEFTOVER_ADD, LEFTOVER_TEXTLESS
} from '../relink.js';
import { planRelink, newLinePreview } from '../relink-plan.js';

// v3.30.0: new lines from leftover ink, edited in the review (text, indent, merge).
const stored = (n, lineId, text, ms, indentLevel = 0) => ({ type: 'matched', n, lineId, text, indentLevel, ms, msAll: [ms], reading: text, fixes: [], breaks: [] });
const left = (ms, reading) => ({ type: 'leftover', n: null, lineId: null, text: '', indentLevel: 0, ms, msAll: [ms], reading, fixes: [], breaks: [] });

const model = {
  rows: [stored(1, 'A', 'Meeting notes', 0), left(1, '8:00 9999-110 Electrical Safety'), left(2, 'meeting'), left(3, '6- 8min response'), stored(2, 'B', 'Next item', 4)],
  counts: {},
  msTexts: ['Meeting notes', '8:00 9999-110 Electrical Safety', 'meeting', '6- 8min response', 'Next item']
};
const run = {
  revision: 'r1', rotation: 0, originNcodeY: 0, sent: [],
  lines: model.msTexts.map((text, i) => ({ text, yBounds: { minY: 2 + i * 5, maxY: 5 + i * 5 } }))
};
const lines = [
  { id: 'A', text: 'Meeting notes', indentLevel: 0, parentId: null, checked: null },
  { id: 'B', text: 'Next item', indentLevel: 0, parentId: null, checked: null }
];
const allAdd = () => {
  const d = defaultDecisions(model);
  for (const ms of [1, 2, 3]) d.leftover[ms] = LEFTOVER_ADD;
  return d;
};

describe('addedGroups', () => {
  it('one line per Add as new line row, MyScript’s reading as its text', () => {
    const g = addedGroups(model, allAdd());
    expect(g.map((x) => [x.head, x.ms, x.text, x.indent])).toEqual([
      [1, [1], '8:00 9999-110 Electrical Safety', null], [2, [2], 'meeting', null], [3, [3], '6- 8min response', null]
    ]);
    expect(addedGroups(model, defaultDecisions(model))).toEqual([]);
  });
  it('typed text and an indent are taken; blank text means the reading again', () => {
    let d = setNewText(allAdd(), 1, 'Electrical safety meeting');
    d = setNewIndent(d, 3, 1);
    const g = addedGroups(model, d);
    expect(g[0]).toMatchObject({ text: 'Electrical safety meeting', edited: true });
    expect(g[2].indent).toBe(1);
    expect(addedGroups(model, setNewText(d, 1, null))[0].text).toBe('8:00 9999-110 Electrical Safety');
    expect(addedGroups(model, setNewText(d, 1, '  '))[0].text).toBe('8:00 9999-110 Electrical Safety');
    expect(addedGroups(model, setNewIndent(d, 3, null))[2].indent).toBe(null);
  });
});

describe('merge into the new line above', () => {
  it('only between two adjacent new lines', () => {
    const d = allAdd();
    expect(canMergeUp(model, d, model.rows[1])).toBe(false); // the row above is a stored line
    expect(canMergeUp(model, d, model.rows[2])).toBe(true);
    const d2 = { ...d, leftover: { ...d.leftover, 1: LEFTOVER_TEXTLESS } };
    expect(canMergeUp(model, d2, model.rows[2])).toBe(false);
    expect(isNewLineRow(d2, model.rows[1])).toBe(false);
  });
  it('joins readings into one line taking both MyScript lines, and splits back', () => {
    const d = setMergeUp(model, allAdd(), 2, true);
    const g = addedGroups(model, d);
    expect(g.map((x) => [x.head, x.ms, x.text])).toEqual([[1, [1, 2], '8:00 9999-110 Electrical Safety meeting'], [3, [3], '6- 8min response']]);
    expect(reviewCounts(model, d).newLines).toBe(2);
    expect(addedGroups(model, setMergeUp(model, d, 2, false))).toHaveLength(3);
  });
  it('keeps typed text: the line above’s, then the merged line’s; a split gives it back', () => {
    let d = setNewText(allAdd(), 1, '8:00 Electrical');
    d = setMergeUp(model, d, 2, true);
    expect(addedGroups(model, d)[0].text).toBe('8:00 Electrical meeting');
    d = setMergeUp(model, d, 2, false);
    expect(addedGroups(model, d)[0].text).toBe('8:00 Electrical');
  });
  it('a refused merge changes nothing; a merged row loses its own indent', () => {
    const d = allAdd();
    expect(setMergeUp(model, d, 1, true)).toBe(d);
    const d2 = setMergeUp(model, setNewIndent(d, 2, 2), 2, true);
    expect(d2.newIndent[2]).toBeUndefined();
  });
  it('a merge is dropped when the line above stops being a new line', () => {
    const d = setMergeUp(model, allAdd(), 2, true);
    const d2 = { ...d, leftover: { ...d.leftover, 1: LEFTOVER_TEXTLESS } };
    expect(addedGroups(model, d2).map((x) => x.ms)).toEqual([[2], [3]]);
  });
});

describe('the spec and the save', () => {
  it('buildRelinkSpec writes one entry per line', () => {
    let d = setMergeUp(model, allAdd(), 2, true);
    d = setNewIndent(setNewText(d, 3, 'TODO 6-8 min response'), 3, 1);
    const spec = buildRelinkSpec(run, model, d);
    expect(spec.add).toEqual([
      { ms: [1, 2], text: '8:00 9999-110 Electrical Safety meeting' },
      { ms: [3], text: 'TODO 6-8 min response', indent: 1 }
    ]);
  });
  it('planRelink writes the merged line once, with both bounds, typed task box parsed, indent kept under its line', () => {
    let d = setMergeUp(model, allAdd(), 2, true);
    d = setNewIndent(setNewText(d, 3, 'TODO 6-8 min response'), 3, 1);
    const spec = buildRelinkSpec(run, model, d);
    let k = 0;
    const out = planRelink(lines, spec, [], 0, { newId: () => `n${k++}` });
    expect(out.lines.map((l) => [l.id, l.text, l.indentLevel, l.parentId, l.checked])).toEqual([
      ['A', 'Meeting notes', 0, null, null],
      ['n0', '8:00 9999-110 Electrical Safety meeting', 0, null, null],
      ['n1', '6-8 min response', 1, 'n0', false],
      ['B', 'Next item', 0, null, null]
    ]);
    expect(out.lines[1].yBounds).toEqual({ minY: 7, maxY: 15 });
  });
  it('an indent deeper than one below the line before is clamped', () => {
    const d = setNewIndent(allAdd(), 1, 4);
    const out = planRelink(lines, buildRelinkSpec(run, model, d), [], 0, { newId: (() => { let k = 0; return () => `n${k++}`; })() });
    expect(out.lines[1]).toMatchObject({ id: 'n0', indentLevel: 1, parentId: 'A' });
  });
  it('newLinePreview gives each new line its indent and the deepest it may go', () => {
    const d = setNewIndent(setMergeUp(model, allAdd(), 2, true), 3, 1);
    const p = newLinePreview(lines, buildRelinkSpec(run, model, d));
    expect([...p]).toEqual([[1, { indentLevel: 0, max: 1 }], [3, { indentLevel: 1, max: 1 }]]);
    expect(newLinePreview([], { myscriptLines: [], add: [] }).size).toBe(0);
  });
  it('old specs with bare indices still work', () => {
    const out = planRelink(lines, { myscriptLines: run.lines, links: [{ lineId: 'A', ms: 0 }], add: [1], sent: [] }, [], 0, { newId: () => 'x' });
    expect(out.lines[1]).toMatchObject({ id: 'x', text: '8:00 9999-110 Electrical Safety' });
  });
});
