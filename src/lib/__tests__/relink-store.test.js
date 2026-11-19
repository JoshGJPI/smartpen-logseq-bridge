/**
 * Tests for stores/relink.js (v3.21.0, spec B.2 / B.5 / B.6): the page is read
 * from disk and sent once (textless and kind-line strokes never sent, turned
 * upright); the cache saves a second request while the page is unchanged and
 * is invalidated when it changes; every guard refuses with nothing sent or
 * written; a save goes through savePageToFolder, drops the cache entry, brings
 * a canvas copy in line and calls refreshAfterSave; the bulk run saves pages
 * that need no review and queues the rest, newest first. MyScript is mocked:
 * no request leaves the test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const disk = new Map();
let clock = 0;
vi.mock('$lib/storage/local-store.js', () => ({
  getPage: vi.fn(async (book, page) => {
    const d = disk.get(`${book}/${page}`);
    return d ? JSON.parse(JSON.stringify(d)) : null;
  }),
  savePage: vi.fn(async (book, page, doc) => {
    const stamped = { ...doc, metadata: { ...doc.metadata, lastUpdated: `${doc.metadata.lastUpdated}#${++clock}` } };
    disk.set(`${book}/${page}`, JSON.parse(JSON.stringify(stamped)));
    return { success: true, path: 'x' };
  }),
  deletePage: vi.fn(),
}));
vi.mock('$lib/storage/refresh.js', () => ({ refreshAfterSave: vi.fn(async () => {}) }));
vi.mock('$lib/myscript-api.js', async (orig) => ({ ...(await orig()), transcribeStrokes: vi.fn() }));

import { savePage } from '$lib/storage/local-store.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import { transcribeStrokes } from '$lib/myscript-api.js';
import { getRelinkRun, saveRelink, runBulkRelink, relinkQueue, openRelink, relinkTarget, closeRelink } from '$stores/relink.js';
import { myscriptAppKey, myscriptHmacKey } from '$stores/settings.js';
import { markViewerDirtyPage, clearViewerDirtyPage, transcriptEditorHold } from '$stores/viewer.js';
import { pageTranscriptions } from '$stores/transcription.js';
import { resetPages } from '$stores/transcript-reset.js';
import { pageOrientations } from '$stores/orientation.js';
import { strokes } from '$stores/strokes.js';
import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
import { classifyRelink, buildRelinkSpec, defaultDecisions, NO_LINKS } from '$lib/relink.js';
import { noteOnDiskStrokeIds, hasPendingChanges, onDiskStrokeIds } from '$stores/pending-changes.js';
import { makeOldPage, makeRun, makeMovedPage, rowY } from './fixtures/relink-page.js';

let cacheStore;
const reply = (doc, opts) => ({ text: '', lines: makeRun(doc, opts).lines, words: [] });

beforeEach(() => {
  disk.clear();
  disk.set('3017/123', makeOldPage());
  cacheStore = new Map();
  window.relinkAPI = {
    cache: vi.fn(async (action, book, page, entry) => {
      const k = `${book}/${page}`;
      if (action === 'get') return { ok: true, result: cacheStore.get(k) || null };
      if (action === 'put') { cacheStore.set(k, entry); return { ok: true, result: true }; }
      if (action === 'drop') return { ok: true, result: cacheStore.delete(k) };
      return { ok: false, error: 'bad' };
    }),
  };
  vi.mocked(savePage).mockClear();
  vi.mocked(refreshAfterSave).mockClear();
  vi.mocked(transcribeStrokes).mockReset();
  vi.mocked(transcribeStrokes).mockImplementation(async () => reply(makeOldPage()));
  myscriptAppKey.set('app');
  myscriptHmacKey.set('hmac');
  pageTranscriptions.set(new Map());
  resetPages.set(new Map());
  pageOrientations.set({});
  strokes.set([]);
  onDiskStrokeIds.set(new Map());
  relinkQueue.set([]);
});

describe('getRelinkRun', () => {
  it('does not send without permission; with it, sends the page once and caches the run', async () => {
    const asked = await getRelinkRun('3017', '123');
    expect(asked).toMatchObject({ ok: false, needsSend: true });
    expect(transcribeStrokes).not.toHaveBeenCalled();

    const got = await getRelinkRun('3017', '123', { send: true });
    expect(got.ok).toBe(true);
    expect(got.cached).toBe(false);
    expect(transcribeStrokes).toHaveBeenCalledTimes(1);
    const [sent, appKey] = vi.mocked(transcribeStrokes).mock.calls[0];
    expect(appKey).toBe('app');
    expect(sent).toHaveLength(84);
    expect(sent[0].dotArray[0]).toMatchObject({ x: 20, y: 10 });
    expect(got.run).toMatchObject({ revision: '2026-07-02T15:00:00.000Z', originNcodeY: 10, rotation: 0 });
    expect(cacheStore.get('3017/123')).toEqual(got.run);

    const again = await getRelinkRun('3017', '123', { send: true });
    expect(again.cached).toBe(true);
    expect(transcribeStrokes).toHaveBeenCalledTimes(1);
  });

  it('never sends textless strokes or a kind line\'s strokes', async () => {
    const doc = makeOldPage();
    doc.strokes[0].textless = true;
    doc.strokes[0].lineId = null;
    doc.transcript.lines.push({ id: 'sk', kind: 'sketch', text: 'Sketch', indentLevel: 0, parentId: null, checked: null, yBounds: null });
    doc.strokes[1].lineId = 'sk';
    disk.set('3017/123', doc);
    const got = await getRelinkRun('3017', '123', { send: true });
    const sentTimes = vi.mocked(transcribeStrokes).mock.calls[0][0].map((s) => s.startTime);
    expect(sentTimes).not.toContain(doc.strokes[0].startTime);
    expect(sentTimes).not.toContain(doc.strokes[1].startTime);
    expect(got.run.sent).not.toContain(doc.strokes[0].id);
    expect(got.run.sent).not.toContain(doc.strokes[1].id);
    expect(got.run.sent).toHaveLength(82);
  });

  it('sends a rotated page turned upright and measures the origin on the turned copies', async () => {
    pageOrientations.set({ '3017/123': 90 });
    const got = await getRelinkRun('3017', '123', { send: true });
    const sent = vi.mocked(transcribeStrokes).mock.calls[0][0];
    expect(sent[0].dotArray[0].y).not.toBe(10);
    expect(got.run.rotation).toBe(90);
    expect(got.run.originNcodeY).toBe(Math.min(...sent.flatMap((s) => s.dotArray.map((d) => d.y))));
  });

  it('a page written since its run is sent again (the cache entry no longer fits)', async () => {
    await getRelinkRun('3017', '123', { send: true });
    const doc = disk.get('3017/123');
    doc.metadata.lastUpdated = '2026-11-19T10:00:00.000Z';
    expect((await getRelinkRun('3017', '123')).needsSend).toBe(true);
    const again = await getRelinkRun('3017', '123', { send: true });
    expect(again.cached).toBe(false);
    expect(transcribeStrokes).toHaveBeenCalledTimes(2);
    expect(cacheStore.get('3017/123').revision).toBe('2026-11-19T10:00:00.000Z');
  });

  it('refuses without MyScript keys', async () => {
    myscriptAppKey.set('');
    expect((await getRelinkRun('3017', '123', { send: true })).error).toMatch(/MyScript keys/);
    expect(transcribeStrokes).not.toHaveBeenCalled();
  });
});

describe('guards (B.6): the same set as Claude\'s edits, nothing sent or written', () => {
  async function expectRefused(pattern) {
    const r = await getRelinkRun('3017', '123', { send: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(pattern);
    const doc = makeOldPage();
    const s = await saveRelink('3017', '123', buildRelinkSpec(makeRun(doc), classifyRelink(doc.transcript.lines, makeRun(doc).lines)));
    expect(s.ok).toBe(false);
    expect(transcribeStrokes).not.toHaveBeenCalled();
    expect(savePage).not.toHaveBeenCalled();
  }

  it('a Library draft on the page', async () => {
    markViewerDirtyPage('3017:123');
    try { await expectRefused(/unsaved transcript edits/); } finally { clearViewerDirtyPage('3017:123'); }
  });

  it('any transcript editor open on the page', async () => {
    const hold = transcriptEditorHold();
    hold.set('3017:123', true);
    try { await expectRefused(/transcript editor/); } finally { hold.release(); }
  });

  it('a pending Editor transcription', async () => {
    pageTranscriptions.set(new Map([['B3017/P123', { pageInfo: { book: '3017', page: 123 }, lines: [] }]]));
    await expectRefused(/unsaved transcription/);
  });

  it('a re-transcribe reset', async () => {
    resetPages.set(new Map([['B3017/P123', { links: new Map(), strokes: 1, at: 0 }]]));
    await expectRefused(/reset for re-transcription/);
  });

  it('a letter-suffixed page while its page number is on the canvas', async () => {
    disk.set('3017/123b', makeOldPage());
    strokes.set([{ pageInfo: { book: '3017', page: 123 }, startTime: 1, endTime: 2, dotArray: [] }]);
    const r = await getRelinkRun('3017', '123b', { send: true });
    expect(r.error).toMatch(/letter-suffixed/);
    expect(transcribeStrokes).not.toHaveBeenCalled();
    // Unsuffixed P123 with the same canvas is fine, and P123b off the canvas is fine.
    expect((await getRelinkRun('3017', '123', { send: true })).ok).toBe(true);
    strokes.set([]);
    expect((await getRelinkRun('3017', '123b', { send: true })).ok).toBe(true);
  });

  it('a page with no text lines (the trustworthy refusal: relink.test.js)', async () => {
    const doc = makeOldPage();
    doc.transcript.lines = [];
    disk.set('3017/123', doc);
    await expectRefused(/no transcript lines/);
  });
});

describe('saveRelink', () => {
  it('saves through savePageToFolder, drops the cache, refreshes the views and syncs a canvas copy', async () => {
    const doc = makeOldPage();
    // The page is loaded in the Editor with the old links.
    strokes.set(doc.strokes.map((s) => ({ pageInfo: { book: '3017', page: 123 }, startTime: s.startTime, endTime: s.endTime, blockUuid: s.lineId, dotArray: [] })));
    const got = await getRelinkRun('3017', '123', { send: true });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    const r = await saveRelink('3017', '123', buildRelinkSpec(got.run, model, defaultDecisions(model)));
    expect(r.ok).toBe(true);
    expect(savePage).toHaveBeenCalledTimes(1);
    expect(isTrustworthyTranscript(disk.get('3017/123'))).toBe(true);
    expect(cacheStore.has('3017/123')).toBe(false);
    expect(refreshAfterSave).toHaveBeenCalledWith([{ book: '3017', pageId: '123' }]);
    get(strokes).forEach((s, k) => expect(s.blockUuid).toBe(doc.transcript.lines[Math.floor(k / 3)].id));
  });

  it('a page on the canvas with leftover ink saved as Not text is not left looking unsaved', async () => {
    const doc = makeOldPage();
    const y = rowY(27) + 6;
    doc.strokes.push({ id: 's1765400000000', startTime: 1765400000000, endTime: 1765400000400, lineId: 'L03', points: [[20, y], [30, y + 2]] });
    disk.set('3017/123', doc);
    // As the Editor loads it: same points, links as stored, on-disk index primed.
    strokes.set(doc.strokes.map((s) => ({ pageInfo: { book: '3017', page: 123 }, startTime: s.startTime, endTime: s.endTime,
      blockUuid: s.lineId, dotArray: s.points.map(([x, y]) => ({ x, y, f: 400 })) })));
    noteOnDiskStrokeIds('3017', 123, doc.strokes);
    expect(get(hasPendingChanges)).toBe(false);
    vi.mocked(transcribeStrokes).mockImplementation(async () => reply(makeOldPage(), { extra: [{ text: 'scribble', y }] }));
    const got = await getRelinkRun('3017', '123', { send: true });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    const d = defaultDecisions(model);
    d.leftover[model.rows.find((r) => r.type === 'leftover').ms] = 'textless';
    expect((await saveRelink('3017', '123', buildRelinkSpec(got.run, model, d))).ok).toBe(true);
    const last = get(strokes).at(-1);
    expect(last).toMatchObject({ textless: true, blockUuid: null });
    expect(get(hasPendingChanges)).toBe(false);
  });

  it('refuses a relink that links no line, writing nothing', async () => {
    const got = await getRelinkRun('3017', '123', { send: true });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    const r = await saveRelink('3017', '123', { ...buildRelinkSpec(got.run, model), links: [] });
    expect(r).toMatchObject({ ok: false, error: NO_LINKS });
    expect(savePage).not.toHaveBeenCalled();
    expect(refreshAfterSave).not.toHaveBeenCalled();
  });

  it('a page written between the run and the save is refused as stale and its cache dropped', async () => {
    const got = await getRelinkRun('3017', '123', { send: true });
    disk.get('3017/123').metadata.lastUpdated = '2026-11-19T11:00:00.000Z';
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    const r = await saveRelink('3017', '123', buildRelinkSpec(got.run, model));
    expect(r).toMatchObject({ ok: false, stale: true });
    expect(savePage).not.toHaveBeenCalled();
    expect(refreshAfterSave).not.toHaveBeenCalled();
    expect(cacheStore.has('3017/123')).toBe(false);
  });
});

describe('runBulkRelink (B.5)', () => {
  it('saves at once pages that need no review, queues the rest newest first, skips refused pages', async () => {
    const queued = makeOldPage();
    queued.strokes.forEach((s) => { s.startTime += 1e9; s.endTime += 1e9; s.id = `s${s.startTime}`; });
    disk.set('3017/124', queued);
    const older = makeOldPage();
    disk.set('3017/125', older);
    const trusted = makeOldPage();
    trusted.transcript.lines = [];
    disk.set('3017/126', trusted);
    // Pages are sent in order 123, 124, 125 (126 is refused before sending); 124 and 125 come
    // back with a line missing, so they need review.
    vi.mocked(transcribeStrokes)
      .mockImplementationOnce(async () => reply(makeOldPage()))
      .mockImplementationOnce(async () => reply(makeOldPage(), { drop: [10] }))
      .mockImplementationOnce(async () => reply(makeOldPage(), { drop: [10] }));
    const progress = [];
    const out = await runBulkRelink([
      { book: '3017', pageId: '123', written: 1 }, { book: '3017', pageId: '124', written: 3 },
      { book: '3017', pageId: '125', written: 2 }, { book: '3017', pageId: '126', written: 0 }
    ], { onProgress: (p) => progress.push(p) });
    expect(out.saved).toBe(1);
    expect(out.queued).toBe(2);
    expect(out.skipped).toEqual([{ label: 'B3017/P126', why: expect.stringMatching(/no transcript lines/) }]);
    expect(out.requests).toBe(3);
    expect(isTrustworthyTranscript(disk.get('3017/123'))).toBe(true);
    expect(isTrustworthyTranscript(disk.get('3017/124'))).toBe(false);
    expect(get(relinkQueue).map((q) => q.pageId)).toEqual(['124', '125']);
    expect(get(relinkQueue)[0].counts.noink).toBe(1);
    expect(progress.at(-1)).toMatchObject({ saved: 1, queued: 2 });

    // A second run costs no requests: the queued pages' runs are cached.
    vi.mocked(transcribeStrokes).mockClear();
    const again = await runBulkRelink([{ book: '3017', pageId: '124' }, { book: '3017', pageId: '125' }]);
    expect(again.requests).toBe(0);
    expect(transcribeStrokes).not.toHaveBeenCalled();
    expect(get(relinkQueue)).toHaveLength(2);
  });

  it('a page with moved lines is queued for review, never saved at once', async () => {
    disk.set('3017/180', makeMovedPage());
    vi.mocked(transcribeStrokes).mockImplementationOnce(async () => reply(makeMovedPage()));
    const out = await runBulkRelink([{ book: '3017', pageId: '180' }]);
    expect(out).toMatchObject({ saved: 0, queued: 1 });
    expect(savePage).not.toHaveBeenCalled();
    expect(get(relinkQueue)[0]).toMatchObject({ pageId: '180', counts: expect.objectContaining({ moved: 3 }) });
  });

  it('stops between pages', async () => {
    disk.set('3017/124', makeOldPage());
    const out = await runBulkRelink([{ book: '3017', pageId: '123' }, { book: '3017', pageId: '124' }], { stopped: () => true });
    expect(out).toMatchObject({ saved: 0, queued: 0, requests: 0 });
  });

  it('a page that fails to transcribe is counted and the run carries on', async () => {
    disk.set('3017/124', makeOldPage());
    vi.mocked(transcribeStrokes).mockRejectedValueOnce(new Error('HTTP 500'));
    const out = await runBulkRelink([{ book: '3017', pageId: '123' }, { book: '3017', pageId: '124' }]);
    expect(out.failed).toBe(1);
    expect(out.saved).toBe(1);
  });
});

describe('relinkTarget', () => {
  it('opens and closes the dialog on a page', () => {
    openRelink(3017, 123);
    expect(get(relinkTarget)).toEqual({ book: '3017', pageId: '123' });
    closeRelink();
    expect(get(relinkTarget)).toBeNull();
  });
});
