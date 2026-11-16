/**
 * lib/print/print-list.js (v3.8.0): the print list across notebooks.
 */
import { describe, it, expect } from 'vitest';
import { refKey, toRef, addRefs, removeRefs, moveRef, sortByBook, isSelectionItem } from '$lib/print/print-list.js';

const r = (book, pageId) => ({ book, pageId });

describe('toRef / refKey', () => {
  it('stringifies, rejects missing parts', () => {
    expect(toRef({ book: 388, pageId: 12 })).toEqual(r('388', '12'));
    expect(toRef({ book: '388' })).toBeNull();
    expect(toRef(null)).toBeNull();
    expect(refKey(r('388v2', '151b'))).toBe('388v2/151b');
  });

  it('keeps a selected-strokes item whole, keyed apart from its page', () => {
    const strokes = [{ id: 's1', points: [[0, 0], [1, 1]] }];
    const item = toRef({ book: 388, pageId: 12, selection: true, key: '388/12#1.abc', strokes, extra: 1 });
    expect(item).toEqual({ book: '388', pageId: '12', selection: true, key: '388/12#1.abc', strokes });
    expect(isSelectionItem(item)).toBe(true);
    expect(isSelectionItem(r('388', '12'))).toBe(false);
    expect(refKey(item)).toBe('sel:388/12#1.abc');
    expect(toRef({ book: '388', pageId: '12', selection: true, key: 'k', strokes: [] })).toBeNull();
    expect(toRef({ book: '388', pageId: '12', selection: true, strokes })).toBeNull();
  });

  it('removes a selection item without touching its page', () => {
    const item = { book: '388', pageId: '12', selection: true, key: 'k', strokes: [{ id: 's1' }] };
    const list = [r('388', '12'), item];
    expect(removeRefs(list, [item])).toEqual([r('388', '12')]);
    expect(removeRefs(list, [r('388', '12')])).toEqual([item]);
  });
});

describe('addRefs', () => {
  it('appends across notebooks, skipping duplicates', () => {
    const list = [r('3017', '1')];
    expect(addRefs(list, [r('387', '23'), { book: 3017, pageId: 1 }, r('387', '23')]))
      .toEqual([r('3017', '1'), r('387', '23')]);
  });

  it('same array when nothing is new', () => {
    const list = [r('3017', '1')];
    expect(addRefs(list, [r('3017', '1'), null])).toBe(list);
    expect(addRefs(list, null)).toBe(list);
  });
});

describe('removeRefs', () => {
  it('drops the given pages only', () => {
    expect(removeRefs([r('1', '1'), r('1', '2'), r('2', '1')], [r('1', '2')])).toEqual([r('1', '1'), r('2', '1')]);
  });
});

describe('moveRef', () => {
  const list = [r('a', '1'), r('b', '1'), r('c', '1')];
  it('moves down and up', () => {
    expect(moveRef(list, 0, 2).map((x) => x.book)).toEqual(['b', 'c', 'a']);
    expect(moveRef(list, 2, 0).map((x) => x.book)).toEqual(['c', 'a', 'b']);
  });
  it('clamps the target, ignores bad sources', () => {
    expect(moveRef(list, 0, 9).map((x) => x.book)).toEqual(['b', 'c', 'a']);
    expect(moveRef(list, 5, 0)).toBe(list);
    expect(moveRef(list, 1, 1)).toBe(list);
    expect(moveRef(list, 0, -3)).toBe(list);
  });
});

describe('sortByBook', () => {
  it('book keys by number and volume, pages numerically', () => {
    const list = [r('3017', '10'), r('390v2', '2'), r('387', '23'), r('3017', '9'), r('390', '151b'), r('390', '151')];
    expect(sortByBook(list).map(refKey)).toEqual(['387/23', '390/151', '390/151b', '390v2/2', '3017/9', '3017/10']);
  });
});
