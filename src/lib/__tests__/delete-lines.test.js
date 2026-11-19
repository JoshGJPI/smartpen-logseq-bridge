/**
 * delete-lines.js — deleting transcript lines by hand (v3.20.0, spec A.2):
 * Delete line (children move up a level), Delete block (they go too), and what
 * Delete asks first (a line with children; a task, named).
 */
import { describe, it, expect } from 'vitest';
import {
  deleteLines, deletePrompt, hasChildren, blockEnd, taskTexts, taskConfirmText
} from '../delete-lines.js';

const line = (text, indentLevel = 0, extra = {}) => ({ id: text, text, indentLevel, checked: null, ...extra });
const shape = (lines) => lines.map((l) => `${l.indentLevel}:${l.text}`);

// Meeting
//   Tom
//     call back
//   Rich
// Next
const page = () => [line('Meeting'), line('Tom', 1), line('call back', 2), line('Rich', 1), line('Next')];

describe('hasChildren / blockEnd', () => {
  it('a line followed by a deeper one has children; its block runs to the next line as shallow', () => {
    const p = page();
    expect(hasChildren(p, 0)).toBe(true);
    expect(hasChildren(p, 2)).toBe(false);
    expect(hasChildren(p, 4)).toBe(false);
    expect(blockEnd(p, 0)).toBe(4);
    expect(blockEnd(p, 1)).toBe(3);
  });

  it('boundaries: last line, out of range, empty', () => {
    expect(hasChildren(page(), 4)).toBe(false);
    expect(hasChildren(page(), -1)).toBe(false);
    expect(hasChildren([], 0)).toBe(false);
  });
});

describe('deleteLines', () => {
  it('Delete line: the children move up one level, grandchildren too', () => {
    const r = deleteLines(page(), [0]);
    expect(shape(r.lines)).toEqual(['0:Tom', '1:call back', '0:Rich', '0:Next']);
    expect(r.removed.map((l) => l.text)).toEqual(['Meeting']);
    expect(r.outdented).toEqual([0, 1, 2]);
  });

  it('Delete block: the line and everything under it go', () => {
    const r = deleteLines(page(), [0], { block: true });
    expect(shape(r.lines)).toEqual(['0:Next']);
    expect(r.removed.map((l) => l.text)).toEqual(['Meeting', 'Tom', 'call back', 'Rich']);
    expect(r.outdented).toEqual([]);
  });

  it('a nested line with children: only its own children move up', () => {
    const r = deleteLines(page(), [1]);
    expect(shape(r.lines)).toEqual(['0:Meeting', '1:call back', '1:Rich', '0:Next']);
  });

  it('ticked lines are each deleted alone: a line under two deleted ancestors moves up two levels', () => {
    const r = deleteLines(page(), [0, 1]);
    expect(shape(r.lines)).toEqual(['0:call back', '0:Rich', '0:Next']);
  });

  it('a line with no children: nothing else changes', () => {
    const p = page();
    const r = deleteLines(p, [4]);
    expect(r.lines).toEqual(p.slice(0, 4));
    expect(r.lines[0]).toBe(p[0]);
  });

  it('ignores bad and repeated indices, never mutates the input', () => {
    const p = page();
    const before = JSON.stringify(p);
    const r = deleteLines(p, [9, -1, 2, 2, 1.5]);
    expect(shape(r.lines)).toEqual(['0:Meeting', '1:Tom', '1:Rich', '0:Next']);
    expect(JSON.stringify(p)).toBe(before);
    expect(deleteLines([], [0])).toEqual({ lines: [], removed: [], outdented: [] });
  });
});

describe('taskTexts / taskConfirmText', () => {
  it('names every task state; plain lines are not tasks', () => {
    const lines = [
      line('a', 0, { checked: false }), line('b', 0, { checked: true }),
      line('c', 0, { checked: false, marker: 'WAITING' }), line('d', 0, { checked: true, marker: 'CANCELLED' }), line('e')
    ];
    expect(taskTexts(lines)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('one task is quoted by name, several are counted', () => {
    expect(taskConfirmText([])).toBe('');
    expect(taskConfirmText(['schedule coord. meeting w/ Tom'])).toBe("Delete the task 'schedule coord. meeting w/ Tom'?");
    expect(taskConfirmText(['a', 'b', 'c', 'd'])).toBe("Delete 4 tasks ('a', 'b', 'c', …)?");
  });

  it('a long task name is shortened', () => {
    const t = taskConfirmText(['x'.repeat(80)]);
    expect(t.length).toBeLessThan(80);
    expect(t).toContain('…');
  });
});

describe('deletePrompt', () => {
  it('a plain line with no children: nothing to ask', () => {
    expect(deletePrompt(page(), [4])).toBeNull();
    expect(deletePrompt(page(), [])).toBeNull();
  });

  it('a line with children asks line or block, with the tasks each would take', () => {
    const p = page();
    p[2] = line('call back', 2, { checked: false });
    const ask = deletePrompt(p, [0]);
    expect(ask).toMatchObject({ askBlock: true, text: 'Meeting', childCount: 3, lineTasks: [], blockTasks: ['call back'] });
  });

  it('a task asks first and names it', () => {
    const p = [line('Meeting'), line('schedule coord. meeting w/ Tom', 1, { checked: false })];
    expect(deletePrompt(p, [1])).toMatchObject({ askBlock: false, lineTasks: ['schedule coord. meeting w/ Tom'] });
  });

  it('ticked lines never ask line or block, only about tasks', () => {
    expect(deletePrompt(page(), [0], { ticked: true })).toBeNull();
    expect(deletePrompt(page(), [0, 4])).toBeNull();
    const p = page();
    p[4] = line('Next', 0, { checked: true });
    expect(deletePrompt(p, [0, 4], { ticked: true })).toMatchObject({ askBlock: false, text: '2 lines', lineTasks: ['Next'] });
  });
});
