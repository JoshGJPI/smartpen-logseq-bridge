import { describe, it, expect } from 'vitest';
import { moveLines, moveLinesToEdge } from '../move-lines.js';

const L = (s) => s.split('');

describe('moveLines', () => {
  it('moves a run of ticked lines one step past the unticked line next to it', () => {
    expect(moveLines(L('abcde'), [2, 3], -1)).toEqual({ lines: L('acdbe'), selected: [1, 2] });
    expect(moveLines(L('abcde'), [1, 2], 1)).toEqual({ lines: L('adbce'), selected: [2, 3] });
  });
  it('keeps gaps between ticked lines', () => {
    expect(moveLines(L('abcde'), [1, 3], -1)).toEqual({ lines: L('badce'), selected: [0, 2] });
    expect(moveLines(L('abcde'), [1, 3], 1)).toEqual({ lines: L('acbed'), selected: [2, 4] });
  });
  it('one line is the single-line move', () => {
    expect(moveLines(L('abc'), [2], -1)).toEqual({ lines: L('acb'), selected: [1] });
  });
  it('stops at either end, and with nothing ticked', () => {
    expect(moveLines(L('abc'), [0, 2], -1)).toBeNull();
    expect(moveLines(L('abc'), [1, 2], 1)).toBeNull();
    expect(moveLines(L('abc'), [], 1)).toBeNull();
    expect(moveLines([], [0], 1)).toBeNull();
    expect(moveLines(L('abc'), [1], 0)).toBeNull();
  });
  it('ignores out-of-range and duplicate indices, and leaves the input alone', () => {
    const src = L('abcd');
    expect(moveLines(src, new Set([3, 3, 9, -1]), -1)).toEqual({ lines: L('abdc'), selected: [2] });
    expect(src).toEqual(L('abcd'));
  });
  it('a run held down Alt+↑ reaches the top (3017/180: the 11/6 meeting stored at the end)', () => {
    let r = { lines: L('wxyzABCD'), selected: [4, 5, 6, 7] };
    for (let k = 0; k < 4; k++) r = moveLines(r.lines, r.selected, -1);
    expect(r).toEqual({ lines: L('ABCDwxyz'), selected: [0, 1, 2, 3] });
    expect(moveLines(r.lines, r.selected, -1)).toBeNull();
  });
});

describe('moveLinesToEdge', () => {
  it('gathers ticked lines, in page order, at the top or bottom', () => {
    expect(moveLinesToEdge(L('abcdef'), [4, 1, 5], 'top')).toEqual({ lines: L('befacd'), selected: [0, 1, 2] });
    expect(moveLinesToEdge(L('abcdef'), [0, 2], 'bottom')).toEqual({ lines: L('bdefac'), selected: [4, 5] });
  });
  it('null when already there or nothing ticked', () => {
    expect(moveLinesToEdge(L('abc'), [0, 1], 'top')).toBeNull();
    expect(moveLinesToEdge(L('abc'), [2], 'bottom')).toBeNull();
    expect(moveLinesToEdge(L('abc'), [], 'top')).toBeNull();
  });
});
