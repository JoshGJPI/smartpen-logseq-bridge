import { describe, it, expect } from 'vitest';
import {
  emptyPick, pickable, boxIds, applyBox, toggleStroke, setLineTaken,
  pickGroups, groupWarning, pickedIds, pickMarks, strokeAt
} from '../viewer/sketch-pick.js';

const stroke = (id, pts, extra = {}) => ({ id, points: pts, lineId: null, ...extra });
const line = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null, ...extra });

// Page: a bowl (free), a spoon wrongly linked to "Thank You!" (L3), letters of L3, a sketch S1.
const doc = {
  transcript: { lines: [line('L1', 'I felt anxious'), line('L2', 'My interpretation'), line('L3', 'Thank You!'), line('S1', 'Cup', { kind: 'sketch' })] },
  strokes: [
    stroke('bowl1', [[10, 50], [20, 55]]),
    stroke('bowl2', [[12, 52], [18, 53]]),
    stroke('spoon', [[19, 48], [24, 44]], { lineId: 'L3' }),
    stroke('T', [[10, 40], [12, 40]], { lineId: 'L3' }),
    stroke('cup', [[40, 40], [42, 42]], { lineId: 'S1' }),
    stroke('nottext', [[15, 51], [16, 51]], { lineId: null, textless: true }),
    stroke('gone', [[14, 49], [15, 49]], { lineId: 'L9' }),
    stroke('empty', [])
  ]
};
const big = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const bowlBox = { minX: 9, maxX: 25, minY: 43, maxY: 56 };

describe('pickable', () => {
  it('never takes a stroke without points', () => {
    expect(pickable(doc.strokes[7])).toBe(false);
    expect(pickable(null)).toBe(false);
  });
  it('add mode leaves the sketch’s own strokes out; remove mode takes only them', () => {
    const cup = doc.strokes[4];
    expect(pickable(cup, { mode: 'add', lineId: 'S1' })).toBe(false);
    expect(pickable(cup, { mode: 'remove', lineId: 'S1' })).toBe(true);
    expect(pickable(doc.strokes[0], { mode: 'remove', lineId: 'S1' })).toBe(false);
    expect(pickable(doc.strokes[0], { mode: 'remove', lineId: null })).toBe(false);
  });
});

describe('boxIds / applyBox', () => {
  it('a box picks strokes wholly inside; free ink is chosen, in-line ink offered', () => {
    const ids = boxIds(doc, bowlBox);
    expect(ids.sort()).toEqual(['bowl1', 'bowl2', 'gone', 'nottext', 'spoon'].sort());
    const p = applyBox(emptyPick(), doc, ids);
    expect([...p.chosen].sort()).toEqual(['bowl1', 'bowl2', 'gone', 'nottext']);
    expect([...p.offered]).toEqual(['spoon']);
  });
  it('no box picks nothing', () => {
    expect(boxIds(doc, null)).toEqual([]);
  });
  it('replace starts again, add keeps, subtract takes away from both sets', () => {
    let p = applyBox(emptyPick(), doc, ['bowl1', 'spoon']);
    p = applyBox(p, doc, ['T'], 'add');
    expect([...p.chosen]).toEqual(['bowl1']);
    expect([...p.offered].sort()).toEqual(['T', 'spoon']);
    p = applyBox(p, doc, ['spoon', 'bowl1'], 'subtract');
    expect([...p.chosen]).toEqual([]);
    expect([...p.offered]).toEqual(['T']);
    p = applyBox(p, doc, ['bowl2']);
    expect([...p.chosen]).toEqual(['bowl2']);
    expect(p.offered.size).toBe(0);
  });
  it('an added box never demotes a chosen in-line stroke to offered', () => {
    let p = toggleStroke(emptyPick(), 'spoon');
    p = applyBox(p, doc, ['spoon'], 'add');
    expect(p.chosen.has('spoon')).toBe(true);
    expect(p.offered.has('spoon')).toBe(false);
  });
  it('remove mode chooses the sketch’s strokes outright', () => {
    const ids = boxIds(doc, big, { mode: 'remove', lineId: 'S1' });
    expect(ids).toEqual(['cup']);
    const p = applyBox(emptyPick(), doc, ids, 'replace', { mode: 'remove' });
    expect([...p.chosen]).toEqual(['cup']);
  });
  it('does not mutate the pick it is given', () => {
    const p0 = emptyPick();
    applyBox(p0, doc, ['bowl1']);
    expect(p0.chosen.size).toBe(0);
  });
});

describe('toggleStroke', () => {
  it('a click takes an in-line stroke, a second click drops it from the pick', () => {
    let p = applyBox(emptyPick(), doc, ['spoon']);
    p = toggleStroke(p, 'spoon');
    expect(p.chosen.has('spoon')).toBe(true);
    expect(p.offered.has('spoon')).toBe(false);
    p = toggleStroke(p, 'spoon');
    expect(p.chosen.has('spoon')).toBe(false);
    expect(p.offered.has('spoon')).toBe(false);
  });
});

describe('setLineTaken / pickGroups', () => {
  it('moves only the picked strokes of that line', () => {
    let p = applyBox(emptyPick(), doc, ['spoon', 'bowl1']);
    p = setLineTaken(p, doc, 'L3', true);
    expect(p.chosen.has('spoon')).toBe(true);
    expect(p.chosen.has('T')).toBe(false);
    p = setLineTaken(p, doc, 'L3', false);
    expect(p.offered.has('spoon')).toBe(true);
    expect(p.chosen.has('bowl1')).toBe(true);
  });
  it('groups in-line picks per line with a taken count; free and Not text ink are no group', () => {
    let p = applyBox(emptyPick(), doc, ['spoon', 'T', 'cup', 'nottext', 'gone']);
    p = toggleStroke(p, 'spoon');
    const g = pickGroups(doc, p);
    expect(g.map((x) => [x.lineId, x.n, x.ids.length, x.taken, x.sketch])).toEqual([['L3', 3, 2, 1, false], ['S1', 4, 1, 0, true]]);
    expect(groupWarning(g[0])).toBe('2 strokes are in line #3 (“Thank You!”); 1 of them taken');
    expect(groupWarning(g[1])).toBe('1 stroke is in the sketch #4 (“Cup”)');
    expect(pickGroups(doc, p, { mode: 'remove' })).toEqual([]);
  });
});

describe('pickedIds / pickMarks', () => {
  it('chosen ids in page order', () => {
    const p = { chosen: new Set(['spoon', 'bowl1']), offered: new Set() };
    expect(pickedIds(doc, p)).toEqual(['bowl1', 'spoon']);
    expect(pickedIds(null, p)).toEqual([]);
  });
  it('marks taken, offered, and the sketch’s own ink outside create mode', () => {
    const p = { chosen: new Set(['bowl1']), offered: new Set(['T']) };
    const m = pickMarks(doc, p, { mode: 'add', lineId: 'S1' });
    expect(m.taken.map((s) => s.id)).toEqual(['bowl1']);
    expect(m.offered.map((s) => s.id)).toEqual(['T']);
    expect(m.base.map((s) => s.id)).toEqual(['cup']);
    expect(pickMarks(doc, p).base).toEqual([]);
  });
});

describe('strokeAt', () => {
  it('finds the nearest pickable stroke within the tolerance', () => {
    expect(strokeAt(doc, { x: 21.5, y: 46.2 }, 1)).toBe('spoon');
    expect(strokeAt(doc, { x: 70, y: 70 }, 1)).toBe(null);
    expect(strokeAt(doc, { x: 41, y: 41 }, 1, { mode: 'add', lineId: 'S1' })).toBe(null);
    expect(strokeAt(doc, null, 1)).toBe(null);
  });
  it('measures a one-point stroke to its point', () => {
    const d = { strokes: [stroke('dot', [[5, 5]])] };
    expect(strokeAt(d, { x: 5.3, y: 5 }, 0.5)).toBe('dot');
  });
});
