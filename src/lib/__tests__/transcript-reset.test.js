/**
 * stores/transcript-reset.js (v3.17.0): Reset unlinks a loaded page's ink for
 * re-transcription, marks its next transcription `replace`, Undo restores the
 * links, and a partly loaded page is refused. v3.24.0: a sketch line's ink
 * keeps its link (spec E.4).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { strokes } from '../../stores/strokes.js';
import { savedPages } from '../../stores/saved-pages.js';
import { pageTranscriptions, setPageTranscription, clearTranscription } from '../../stores/transcription.js';
import {
  resetPages, resetPageTranscript, undoResetPageTranscript, isPageReset, forgetAllResets,
  resetRefusalText, RESET_UNREADABLE, RESET_PARTLY_LOADED
} from '../../stores/transcript-reset.js';

const info = (page) => ({ section: 3, owner: 1012, book: '3017', page });
const s = (t, page, blockUuid) => ({ pageInfo: info(page), startTime: t, endTime: t + 10, blockUuid, dotArray: [{ x: 1, y: 1 }, { x: 2, y: 2 }] });
/** The page as read from disk: L1 a text line, SK a sketch line. */
const readPage = async () => ({ transcript: { lines: [{ id: 'L1', text: 'a' }, { id: 'SK', kind: 'sketch', text: 'Plan' }] } });
const reset = (book, page) => resetPageTranscript(book, page, { readPage });

beforeEach(() => {
  forgetAllResets();
  clearTranscription();
  strokes.set([s(1, 182, 'L1'), s(2, 182, 'L1'), s(3, 182, null), s(4, 183, 'M1')]);
  savedPages.set([{ book: '3017', page: 182, pageId: '182', strokeCount: 3 }, { book: '3017', page: 183, pageId: '183', strokeCount: 9 }]);
});

describe('resetPageTranscript', () => {
  it('unlinks only that page and marks its next transcription replace', async () => {
    expect(await reset('3017', 182)).toBe(3);
    expect(get(strokes).map((x) => x.blockUuid)).toEqual([null, null, null, 'M1']);
    expect(isPageReset('3017', 182)).toBe(true);
    setPageTranscription('S3/O1012/B3017/P182', { lines: [{ text: 'x' }] }, info(182), 3, []);
    expect(get(pageTranscriptions).get('S3/O1012/B3017/P182').replace).toBe(true);
    setPageTranscription('S3/O1012/B3017/P183', { lines: [{ text: 'y' }] }, info(183), 1, []);
    expect(get(pageTranscriptions).get('S3/O1012/B3017/P183').replace).toBeUndefined();
  });
  it('keeps the links of a sketch line\'s ink (v3.24.0)', async () => {
    strokes.set([s(1, 182, 'L1'), s(2, 182, 'SK'), s(3, 182, null)]);
    expect(await reset('3017', 182)).toBe(2);
    expect(get(strokes).map((x) => x.blockUuid)).toEqual([null, 'SK', null]);
    undoResetPageTranscript('3017', 182);
    expect(get(strokes).map((x) => x.blockUuid)).toEqual(['L1', 'SK', null]);
  });
  it('a page that can\'t be read is refused, nothing unlinked (its sketch lines are unknown)', async () => {
    strokes.set([s(1, 182, 'L1'), s(2, 182, 'SK'), s(3, 182, null)]);
    expect(await resetPageTranscript('3017', 182, { readPage: async () => { throw new Error('x'); } })).toBe(RESET_UNREADABLE);
    expect(get(strokes).map((x) => x.blockUuid)).toEqual(['L1', 'SK', null]);
    expect(isPageReset('3017', 182)).toBe(false);
    expect(resetRefusalText(RESET_UNREADABLE, '3017', 182)).toMatch(/could not be read.*Reset refused/);
    expect(resetRefusalText(RESET_PARTLY_LOADED, '3017', 182)).toMatch(/partly loaded/);
    expect(resetRefusalText(3, '3017', 182)).toBeNull();
  });
  it('refuses a partly loaded page and a page with no ink', async () => {
    expect(await reset('3017', 183)).toBe(-1);
    expect(get(strokes)[3].blockUuid).toBe('M1');
    expect(await reset('3017', 999)).toBe(0);
    expect(get(resetPages).size).toBe(0);
  });
  it('Undo restores the saved links; a second Reset keeps the first one\'s', async () => {
    await reset('3017', 182);
    await reset('3017', 182);
    expect(undoResetPageTranscript('3017', 182)).toBe(true);
    expect(get(strokes).map((x) => x.blockUuid)).toEqual(['L1', 'L1', null, 'M1']);
    expect(isPageReset('3017', 182)).toBe(false);
    expect(undoResetPageTranscript('3017', 182)).toBe(false);
  });
  it('is forgotten when the page leaves the canvas', async () => {
    await reset('3017', 182);
    strokes.set([s(4, 183, 'M1')]);
    expect(isPageReset('3017', 182)).toBe(false);
  });
});
