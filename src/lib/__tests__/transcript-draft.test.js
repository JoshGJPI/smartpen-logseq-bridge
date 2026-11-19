import { describe, it, expect } from 'vitest';
import {
  blankLine, cloneLines, indentAt, outdentAt, swapAt, siblingSlot, insertAt, removeAt, mergeIndices, tickedIndices, deletedBaseIds
} from '$lib/viewer/transcript-draft.js';
import { deleteLines, deletePrompt } from '$lib/delete-lines.js';

const line = (id, indentLevel = 0, extra = {}) => ({ id, text: id, indentLevel, ...extra });
const ids = (lines) => lines.map((l) => l.id);
const levels = (lines) => lines.map((l) => l.indentLevel);

describe('blankLine / cloneLines', () => {
  it('makes an empty plain line with a fresh id', () => {
    const a = blankLine(2), b = blankLine();
    expect(a).toMatchObject({ text: '', indentLevel: 2, parentId: null, checked: null, yBounds: null });
    expect(b.indentLevel).toBe(0);
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('copies known fields only and normalises them', () => {
    const src = [{ id: 'a', text: 'x', indentLevel: -1, checked: false, marker: 'WAITING', yBounds: { minY: 1, maxY: 2 }, junk: 1 }];
    const [c] = cloneLines(src);
    expect(c).toEqual({ id: 'a', text: 'x', indentLevel: 0, parentId: null, checked: false, marker: 'WAITING', yBounds: { minY: 1, maxY: 2 } });
    expect(c).not.toBe(src[0]);
  });

  it('fills in a missing id and text, drops a non-boolean checked', () => {
    const [c] = cloneLines([{ checked: 'yes' }]);
    expect(c.id).toBeTruthy();
    expect(c.text).toBe('');
    expect(c.checked).toBeNull();
    expect(c).not.toHaveProperty('marker');
  });

  it('handles null and empty input', () => {
    expect(cloneLines(null)).toEqual([]);
    expect(cloneLines([])).toEqual([]);
  });
});

describe('indentAt / outdentAt', () => {
  const draft = [line('a'), line('b'), line('c', 1)];

  it('indents at most one deeper than the line above', () => {
    expect(levels(indentAt(draft, 1))).toEqual([0, 1, 1]);
    expect(indentAt(draft, 2)).toBeNull(); // already one deeper than b
    expect(levels(indentAt(indentAt(draft, 1), 2))).toEqual([0, 1, 2]);
  });

  it('never indents the first line', () => {
    expect(indentAt(draft, 0)).toBeNull();
  });

  it('outdents to the margin and no further', () => {
    expect(levels(outdentAt(draft, 2))).toEqual([0, 0, 0]);
    expect(outdentAt(draft, 0)).toBeNull();
  });

  it('leaves the input untouched and is null for a missing line', () => {
    indentAt(draft, 1);
    expect(levels(draft)).toEqual([0, 0, 1]);
    expect(indentAt(draft, 9)).toBeNull();
    expect(outdentAt([], 0)).toBeNull();
  });
});

describe('swapAt', () => {
  const draft = [line('a'), line('b'), line('c')];
  it('swaps with the neighbour', () => {
    expect(ids(swapAt(draft, 1, -1))).toEqual(['b', 'a', 'c']);
    expect(ids(swapAt(draft, 1, 1))).toEqual(['a', 'c', 'b']);
    expect(ids(draft)).toEqual(['a', 'b', 'c']);
  });
  it('is null at either end', () => {
    expect(swapAt(draft, 0, -1)).toBeNull();
    expect(swapAt(draft, 2, 1)).toBeNull();
  });
});

describe('siblingSlot', () => {
  const draft = [line('a'), line('b', 1), line('c', 2), line('d', 1), line('e')];
  it('goes after the active line\'s subtree, at its level', () => {
    expect(siblingSlot(draft, 1)).toEqual({ at: 3, indentLevel: 1 });
    expect(siblingSlot(draft, 0)).toEqual({ at: 4, indentLevel: 0 });
    expect(siblingSlot(draft, 4)).toEqual({ at: 5, indentLevel: 0 });
  });
  it('appends at level 0 with no active line', () => {
    expect(siblingSlot(draft, -1)).toEqual({ at: 5, indentLevel: 0 });
    expect(siblingSlot(draft, 99)).toEqual({ at: 5, indentLevel: 0 });
    expect(siblingSlot([], -1)).toEqual({ at: 0, indentLevel: 0 });
  });
});

describe('insertAt / removeAt', () => {
  const draft = [line('a'), line('b')];
  it('inserts and removes without touching the input', () => {
    expect(ids(insertAt(draft, 1, line('x')))).toEqual(['a', 'x', 'b']);
    expect(ids(insertAt(draft, 2, line('x')))).toEqual(['a', 'b', 'x']);
    expect(ids(removeAt(draft, 0))).toEqual(['b']);
    expect(ids(draft)).toEqual(['a', 'b']);
  });
});

describe('mergeIndices / tickedIndices', () => {
  const draft = [line('a'), line('b'), line('c'), line('d')];
  it('takes the ticked lines in draft order', () => {
    expect(mergeIndices(draft, new Set(['d', 'a']), 1)).toEqual([0, 3]);
    expect(tickedIndices(draft, new Set(['c', 'b']))).toEqual([1, 2]);
  });
  it('falls back to the active line and the next', () => {
    expect(mergeIndices(draft, new Set(['b']), 1)).toEqual([1, 2]);
    expect(mergeIndices(draft, new Set(), 3)).toEqual([]);
    expect(mergeIndices(draft, new Set(), -1)).toEqual([]);
  });
});

describe('deletedBaseIds (Library Edit, v3.20.0)', () => {
  const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('the saved lines the draft deleted: gone, and not merged into a kept line', () => {
    const draft = [{ id: 'a', mergedIds: ['c'] }, { id: 'new' }];
    expect(deletedBaseIds(draft, base)).toEqual(['b', 'd']);
  });

  it('nothing deleted, or nothing saved to begin with', () => {
    expect(deletedBaseIds(base, base)).toEqual([]);
    expect(deletedBaseIds([{ id: 'x' }], [])).toEqual([]);
    expect(deletedBaseIds([], null)).toEqual([]);
  });
});

describe('Library Edit delete: line, block and ink (delete-lines on a draft)', () => {
  // The pane runs deletePrompt / deleteLines on its draft, then deletedBaseIds for the ink choice.
  const draft = () => [
    { id: 'm', text: 'Meeting', indentLevel: 0, checked: null },
    { id: 't', text: 'Tom', indentLevel: 1, checked: null },
    { id: 'x', text: 'call back', indentLevel: 2, checked: false },
    { id: 'n', text: 'Next', indentLevel: 0, checked: null },
  ];

  it('a line with children asks; Delete line keeps the children one level up', () => {
    const ask = deletePrompt(draft(), [0]);
    expect(ask.askBlock).toBe(true);
    const r = deleteLines(draft(), ask.indices);
    expect(r.lines.map((l) => [l.id, l.indentLevel])).toEqual([['t', 0], ['x', 1], ['n', 0]]);
    expect(deletedBaseIds(r.lines, draft())).toEqual(['m']);
  });

  it('Delete block takes the task under it, which the prompt named', () => {
    const ask = deletePrompt(draft(), [1]);
    expect(ask.blockTasks).toEqual(['call back']);
    const r = deleteLines(draft(), ask.indices, { block: true });
    expect(deletedBaseIds(r.lines, draft())).toEqual(['t', 'x']);
  });

  it('a task line alone asks first; a plain leaf deletes straight away', () => {
    expect(deletePrompt(draft(), [2])).toMatchObject({ askBlock: false, lineTasks: ['call back'] });
    expect(deletePrompt(draft(), [3])).toBeNull();
  });
});
