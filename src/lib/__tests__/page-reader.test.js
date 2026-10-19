/**
 * lib/viewer/page-reader.js (reading-first package D): the position label, the
 * "Go to page…" resolution, page-turn targets and the ←/→ key rule.
 *
 * What matters: suffixed pages (P151b) and volumes ("388v2") are reachable and
 * labelled as BookViewer pairs them, and the keys never steal a keystroke from
 * a text field, a modifier chord or the transcript editor.
 */
import { describe, it, expect } from 'vitest';
import { pageIdOf, pagePosition, resolveGoToPage, turnTarget, pageTurnKey, zoomText } from '$lib/viewer/page-reader.js';

const book = [
  { pageId: '150', page: 150 },
  { pageId: '151', page: 151 },
  { pageId: '151b', page: 151 },
  { pageId: '152', page: 152 },
  { page: 160 }
];
const pagesByBook = { '388': book, '388v2': [{ pageId: '1', page: 1 }, { pageId: '2', page: 2 }], '390': [{ pageId: '7b', page: 7 }] };

describe('pageIdOf', () => {
  it('prefers pageId, falls back to page, empty for nothing', () => {
    expect(pageIdOf({ pageId: '151b', page: 151 })).toBe('151b');
    expect(pageIdOf({ page: 160 })).toBe('160');
    expect(pageIdOf(null)).toBe('');
  });
});

describe('pagePosition', () => {
  it('single page: index, total, label', () => {
    expect(pagePosition({ book: '388', pageId: '151' }, pagesByBook, false))
      .toEqual({ index: 1, total: 5, left: '151', right: null, label: 'P151 of 5' });
  });

  it('spread pairs with the next record, suffix included', () => {
    expect(pagePosition({ book: '388', pageId: '151' }, pagesByBook, true).label).toBe('P151–P151b of 5');
    expect(pagePosition({ book: '388', pageId: '151b' }, pagesByBook, true).label).toBe('P151b–P152 of 5');
  });

  it('last page of a spread shows alone; a record without pageId uses its page', () => {
    expect(pagePosition({ book: '388', pageId: '160' }, pagesByBook, true).label).toBe('P160 of 5');
  });

  it('a volume counts its own pages only', () => {
    expect(pagePosition({ book: '388v2', pageId: '1' }, pagesByBook, true).label).toBe('P1–P2 of 2');
  });

  it('null for no selection, unknown book or page, missing index', () => {
    expect(pagePosition(null, pagesByBook, true)).toBeNull();
    expect(pagePosition({ book: '999', pageId: '1' }, pagesByBook, true)).toBeNull();
    expect(pagePosition({ book: '388', pageId: '99' }, pagesByBook, true)).toBeNull();
    expect(pagePosition({ book: '388', pageId: '150' }, null, true)).toBeNull();
  });
});

describe('resolveGoToPage', () => {
  it('number, P-prefix, spaces and case', () => {
    expect(resolveGoToPage('152', book)).toBe(3);
    expect(resolveGoToPage('P152', book)).toBe(3);
    expect(resolveGoToPage(' p 152 ', book)).toBe(3);
  });

  it('exact suffixed id; the bare number prefers the unsuffixed page', () => {
    expect(resolveGoToPage('151b', book)).toBe(2);
    expect(resolveGoToPage('P151B', book)).toBe(2);
    expect(resolveGoToPage('151', book)).toBe(1);
  });

  it('a number that exists only as suffixed variants opens the first', () => {
    expect(resolveGoToPage('7', pagesByBook['390'])).toBe(0);
  });

  it('a suffix that does not exist is not found (no silent fallback)', () => {
    expect(resolveGoToPage('151c', book)).toBe(-1);
  });

  it('leading zeros, a record with no pageId', () => {
    expect(resolveGoToPage('0152', book)).toBe(3);
    expect(resolveGoToPage('160', book)).toBe(4);
  });

  it('-1 for missing pages, junk, empty and bad input', () => {
    expect(resolveGoToPage('999', book)).toBe(-1);
    expect(resolveGoToPage('abc', book)).toBe(-1);
    expect(resolveGoToPage('', book)).toBe(-1);
    expect(resolveGoToPage('1-2', book)).toBe(-1);
    expect(resolveGoToPage(null, book)).toBe(-1);
    expect(resolveGoToPage('1', null)).toBe(-1);
  });
});

describe('turnTarget', () => {
  it('single page steps by one', () => {
    expect(turnTarget(2, 5, 'next', false)).toBe(3);
    expect(turnTarget(2, 5, 'prev', false)).toBe(1);
  });

  it('spread steps by two; back from the second record lands on the first', () => {
    expect(turnTarget(0, 5, 'next', true)).toBe(2);
    expect(turnTarget(3, 5, 'prev', true)).toBe(1);
    expect(turnTarget(1, 5, 'prev', true)).toBe(0);
  });

  it('no turn past either end', () => {
    expect(turnTarget(0, 5, 'prev', false)).toBe(-1);
    expect(turnTarget(4, 5, 'next', false)).toBe(-1);
    expect(turnTarget(3, 5, 'next', true)).toBe(-1); // 3 + 2 = 5 is past the end
    expect(turnTarget(2, 5, 'next', true)).toBe(4);
  });

  it('-1 for an empty book, a bad index or direction', () => {
    expect(turnTarget(0, 0, 'next', false)).toBe(-1);
    expect(turnTarget(-1, 5, 'next', false)).toBe(-1);
    expect(turnTarget(5, 5, 'prev', false)).toBe(-1);
    expect(turnTarget(1, 5, 'up', false)).toBe(-1);
  });
});

describe('pageTurnKey', () => {
  const ev = (key, extra = {}) => ({ key, target: { tagName: 'DIV' }, ...extra });

  it('← and → turn', () => {
    expect(pageTurnKey(ev('ArrowLeft'))).toBe('prev');
    expect(pageTurnKey(ev('ArrowRight'))).toBe('next');
  });

  it('other keys do nothing', () => {
    expect(pageTurnKey(ev('ArrowUp'))).toBeNull();
    expect(pageTurnKey(ev('['))).toBeNull();
    expect(pageTurnKey(null)).toBeNull();
  });

  it('never with a modifier', () => {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      expect(pageTurnKey(ev('ArrowRight', { [mod]: true }))).toBeNull();
    }
  });

  it('never while typing', () => {
    expect(pageTurnKey(ev('ArrowRight', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(pageTurnKey(ev('ArrowRight', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(pageTurnKey(ev('ArrowRight', { target: { tagName: 'SELECT' } }))).toBeNull();
    expect(pageTurnKey(ev('ArrowRight', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
  });

  it('never mid-IME, when already handled, or while a transcript is edited', () => {
    expect(pageTurnKey(ev('ArrowRight', { isComposing: true }))).toBeNull();
    expect(pageTurnKey(ev('ArrowRight', { defaultPrevented: true }))).toBeNull();
    expect(pageTurnKey(ev('ArrowRight'), { editing: true })).toBeNull();
    expect(pageTurnKey(ev('ArrowRight'), { editing: false })).toBe('next');
  });
});

describe('zoomText', () => {
  it('one number when the pages agree or only one shows ink', () => {
    expect(zoomText(0.62, 0.6213)).toBe('62%');
    expect(zoomText(0.62, null)).toBe('62%');
    expect(zoomText(null, 1.5)).toBe('150%');
  });

  it('both when they differ', () => {
    expect(zoomText(0.62, 0.58)).toBe('62% · 58%');
  });

  it('empty when no page shows ink; ignores junk', () => {
    expect(zoomText(null, null)).toBe('');
    expect(zoomText(NaN, 0)).toBe('');
  });
});
