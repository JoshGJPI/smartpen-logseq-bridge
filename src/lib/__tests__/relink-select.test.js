/**
 * Tests for Relink's decorative filter and the Editor's "Relink selection…"
 * (v3.21.0, after Josh's run on 3017/125):
 *   - the reader / bulk run holds back underlines and boxes (never a task box),
 *     measured on the turned copies; held-back ink is written Not text (default)
 *     or only unlinked, never with an old link; a cache entry from before the
 *     filter is sent again;
 *   - a selection run sends only the selection, is never cached, refuses a
 *     multi-page selection and a page with unsaved changes; ink it doesn't send
 *     is unlinked on an untrustworthy page and kept on a trustworthy one; a
 *     two-pass table relink keeps pass 1's links and yBounds.
 * MyScript is mocked: no request leaves the test.
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
import { transcribeStrokes } from '$lib/myscript-api.js';
import {
  getRelinkRun, saveRelink, runBulkRelink, relinkQueue, openRelinkSelection, relinkTarget, closeRelink
} from '$stores/relink.js';
import { myscriptAppKey, myscriptHmacKey } from '$stores/settings.js';
import { pageTranscriptions } from '$stores/transcription.js';
import { resetPages } from '$stores/transcript-reset.js';
import { pageOrientations } from '$stores/orientation.js';
import { strokes } from '$stores/strokes.js';
import { selectedIndices } from '$stores/selection.js';
import { noteOnDiskStrokeIds, onDiskStrokeIds } from '$stores/pending-changes.js';
import { storedStrokesToCanvas } from '$lib/storage/load-page.js';
import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
import {
  classifyRelink, buildRelinkSpec, defaultDecisions, holdBackDecorative, heldBackLabel, selectionRelinkTarget,
  cachedRunValid, relinkRefusal
} from '$lib/relink.js';
import { makeOldPage, makeRun, rowY, mm } from './fixtures/relink-page.js';

const UNDERLINE_T = 1765400000000;
const BOX_T = 1765400100000;
const TICK_T = 1765400101000;

/** A long, flat stroke just under row `i`'s writing (x 18..50, 20 dots), linked the old, wrong way. */
function underline(i, t = UNDERLINE_T) {
  const y = rowY(i) + 2.6;
  return {
    id: `s${t}`, startTime: t, endTime: t + 300, lineId: 'L00',
    points: Array.from({ length: 20 }, (_, k) => [18 + (32 * k) / 19, y + (k % 2 ? 0.03 : -0.03), t + k, 400])
  };
}

/** A ☑ task box (5 mm square, one stroke) and its tick, left of row `i`. */
function taskBox(i) {
  const s = 5 / 2.371, x0 = 5, y0 = rowY(i) - 0.2, x1 = x0 + s, y1 = y0 + s, xm = (x0 + x1) / 2;
  const seg = (ax, ay, bx, by) => Array.from({ length: 15 }, (_, k) => [ax + ((bx - ax) * k) / 14, ay + ((by - ay) * k) / 14]);
  const pts = [...seg(xm, y0, x1, y0), ...seg(x1, y0, x1, y1), ...seg(x1, y1, x0, y1), ...seg(x0, y1, x0, y0), ...seg(x0, y0, xm, y0)];
  const box = { id: `s${BOX_T}`, startTime: BOX_T, endTime: BOX_T + 500, lineId: 'L01', points: pts.map(([x, y], k) => [x, y, BOX_T + k, 400]) };
  const tick = {
    id: `s${TICK_T}`, startTime: TICK_T, endTime: TICK_T + 100, lineId: 'L01',
    points: [[x0 + 0.4, y0 + 1.1, TICK_T, 400], [x0 + 0.8, y0 + 1.6, TICK_T + 5, 400], [x0 + 1.7, y0 + 0.4, TICK_T + 10, 400]]
  };
  return [box, tick];
}

function decoratedPage() {
  const doc = makeOldPage();
  doc.strokes.push(underline(2), ...taskBox(8));
  return doc;
}

/** MyScript's reading of rows `rows` only, for a batch whose top is `origin`. */
function partialReply(rows, origin) {
  return {
    text: '', words: [],
    lines: makeRun(makeOldPage()).lines.filter((_, i) => rows.includes(i))
      .map((l, k) => ({ text: l.text, yBounds: { minY: mm(rowY(rows[k]), origin), maxY: mm(rowY(rows[k]) + 2, origin) } }))
  };
}

const ROWS = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const rowStrokeIds = (doc, rows) => rows.flatMap((i) => doc.strokes.slice(3 * i, 3 * i + 3).map((s) => s.id));

let cacheStore;
beforeEach(() => {
  disk.clear();
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
  vi.mocked(transcribeStrokes).mockReset();
  vi.mocked(transcribeStrokes).mockImplementation(async () => ({ text: '', words: [], lines: makeRun(makeOldPage()).lines }));
  myscriptAppKey.set('app');
  myscriptHmacKey.set('hmac');
  pageTranscriptions.set(new Map());
  resetPages.set(new Map());
  pageOrientations.set({});
  strokes.set([]);
  selectedIndices.set(new Set());
  onDiskStrokeIds.set(new Map());
  relinkQueue.set([]);
  closeRelink();
});

describe('holdBackDecorative (pure)', () => {
  it('holds back an underline, never a task box or its tick', () => {
    const doc = decoratedPage();
    const canvas = storedStrokesToCanvas(doc.strokes, { section: 3, owner: 1012, book: '3017', page: 123 });
    const r = holdBackDecorative(canvas, doc.strokes.map((s) => s.id));
    expect(r.heldBack).toEqual([`s${UNDERLINE_T}`]);
    expect(r.sent).toContain(`s${BOX_T}`);
    expect(r.sent).toContain(`s${TICK_T}`);
    expect(r.send).toHaveLength(doc.strokes.length - 1);
    expect(r.stats).toEqual({ underlines: 1, boxes: 0, circles: 0 });
  });

  it('holds back nothing when nothing is decorative, and never every stroke', () => {
    const doc = makeOldPage();
    const canvas = storedStrokesToCanvas(doc.strokes, { book: '3017', page: 123 });
    expect(holdBackDecorative(canvas, doc.strokes.map((s) => s.id)).heldBack).toEqual([]);
    const only = storedStrokesToCanvas([underline(2)], { book: '3017', page: 123 });
    expect(holdBackDecorative(only, [`s${UNDERLINE_T}`])).toMatchObject({ heldBack: [], sent: [`s${UNDERLINE_T}`] });
  });

  it('labels what was held back', () => {
    expect(heldBackLabel({ underlines: 3, boxes: 1, circles: 0 }, 4)).toBe('3 underlines, 1 box');
    expect(heldBackLabel({}, 2)).toBe('2 decorative strokes');
  });
});

describe('the auto-filter in the reader\'s Relink and the bulk run', () => {
  it('does not send held-back ink, records it in the run and caches it', async () => {
    disk.set('3017/123', decoratedPage());
    const got = await getRelinkRun('3017', '123', { send: true });
    expect(got.ok).toBe(true);
    const sentTimes = vi.mocked(transcribeStrokes).mock.calls[0][0].map((s) => s.startTime);
    expect(sentTimes).not.toContain(UNDERLINE_T);
    expect(sentTimes).toContain(BOX_T);
    expect(got.run.heldBack).toEqual([`s${UNDERLINE_T}`]);
    expect(got.run.sent).not.toContain(`s${UNDERLINE_T}`);
    expect(got.run.heldBackStats.underlines).toBe(1);
    expect(cacheStore.get('3017/123').heldBack).toEqual([`s${UNDERLINE_T}`]);
    expect((await getRelinkRun('3017', '123')).cached).toBe(true);
  });

  it('runs the detector on the turned copies: an underline stored upright on a page turned 90° is still found', async () => {
    // Stored vertical (as the pen wrote it on a page held sideways), horizontal once turned.
    const doc = makeOldPage();
    const t = UNDERLINE_T;
    const v = { id: `s${t}`, startTime: t, endTime: t + 300, lineId: 'L00',
      points: Array.from({ length: 20 }, (_, k) => [60 + (k % 2 ? 0.03 : -0.03), 20 + (32 * k) / 19, t + k, 400]) };
    doc.strokes.push(v);
    disk.set('3017/123', doc);
    const flat = await getRelinkRun('3017', '123', { send: true });
    expect(flat.run.heldBack).toEqual([]);
    cacheStore.clear();
    pageOrientations.set({ '3017/123': 90 });
    const turned = await getRelinkRun('3017', '123', { send: true });
    expect(turned.run.heldBack).toEqual([`s${t}`]);
  });

  it('held-back ink is written Not text and unlinked by default; never keeps its old link', async () => {
    disk.set('3017/123', decoratedPage());
    const got = await getRelinkRun('3017', '123', { send: true });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    expect(defaultDecisions(model).heldBackTextless).toBe(true);
    const r = await saveRelink('3017', '123', buildRelinkSpec(got.run, model));
    expect(r.ok).toBe(true);
    const u = disk.get('3017/123').strokes.find((s) => s.id === `s${UNDERLINE_T}`);
    expect(u).toMatchObject({ textless: true, lineId: null });
    expect(r.result.textlessIds).toContain(`s${UNDERLINE_T}`);
    expect(r.result.links[`s${UNDERLINE_T}`]).toBe(null);
  });

  it('unticked, held-back ink is only unlinked (no Not text flag)', async () => {
    disk.set('3017/123', decoratedPage());
    const got = await getRelinkRun('3017', '123', { send: true });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    const decisions = { ...defaultDecisions(model), heldBackTextless: false };
    expect((await saveRelink('3017', '123', buildRelinkSpec(got.run, model, decisions))).ok).toBe(true);
    const u = disk.get('3017/123').strokes.find((s) => s.id === `s${UNDERLINE_T}`);
    expect(u.lineId).toBe(null);
    expect(u.textless).toBeUndefined();
  });

  it('the bulk run marks held-back ink Not text', async () => {
    disk.set('3017/123', decoratedPage());
    const out = await runBulkRelink([{ book: '3017', pageId: '123' }]);
    expect(out.saved).toBe(1);
    expect(disk.get('3017/123').strokes.find((s) => s.id === `s${UNDERLINE_T}`)).toMatchObject({ textless: true, lineId: null });
  });

  it('a cache entry from before the filter (no heldBack) is invalid: the page is sent again', async () => {
    const doc = decoratedPage();
    disk.set('3017/123', doc);
    const old = { ...makeRun(doc), revision: doc.metadata.lastUpdated };
    expect(cachedRunValid(old, doc.metadata.lastUpdated)).toBe(false);
    expect(cachedRunValid({ ...old, heldBack: [] }, doc.metadata.lastUpdated)).toBe(true);
    cacheStore.set('3017/123', old);
    expect((await getRelinkRun('3017', '123')).needsSend).toBe(true);
    const got = await getRelinkRun('3017', '123', { send: true });
    expect(got.cached).toBe(false);
    expect(got.run.heldBack).toEqual([`s${UNDERLINE_T}`]);
  });
});

/** Put the page on the canvas (saved, so no pending changes) and select `ids`. */
function onCanvas(doc, ids) {
  const canvas = storedStrokesToCanvas(doc.strokes, { section: 3, owner: 1012, book: '3017', page: 123 });
  strokes.set(canvas);
  noteOnDiskStrokeIds('3017', 123, doc.strokes);
  const want = new Set(ids);
  selectedIndices.set(new Set(canvas.map((s, i) => (want.has(`s${s.startTime}`) ? i : -1)).filter((i) => i >= 0)));
  return canvas;
}

describe('Relink selection: the target and its guards', () => {
  it('opens the dialog on one page with the selected ids', () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    const ids = rowStrokeIds(doc, [0, 1]);
    onCanvas(doc, ids);
    expect(openRelinkSelection()).toBe(null);
    expect(get(relinkTarget)).toEqual({ book: '3017', pageId: '123', ids });
  });

  it('refuses a selection over several pages', () => {
    const a = { pageInfo: { book: '3017', page: 123 }, startTime: 1 };
    const b = { pageInfo: { book: '3017', page: 124 }, startTime: 2 };
    expect(selectionRelinkTarget([a, b], [0, 1]).error).toMatch(/2 pages.*one page at a time/);
    strokes.set([a, b]);
    selectedIndices.set(new Set([0, 1]));
    expect(openRelinkSelection()).toMatch(/one page at a time/);
    expect(get(relinkTarget)).toBe(null);
  });

  it('refuses an empty selection', () => {
    expect(selectionRelinkTarget([], []).ok).toBe(false);
  });

  it('refuses a page with unsaved canvas changes ("save first"), at open and again at save', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    const ids = rowStrokeIds(doc, [0]);
    const canvas = onCanvas(doc, ids);
    // A new stroke on the page: an unsaved addition.
    strokes.set([...canvas, { pageInfo: canvas[0].pageInfo, startTime: 1765399999999, endTime: 1765400000000, dotArray: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }]);
    expect(openRelinkSelection()).toMatch(/unsaved changes.*save first/);
    expect((await getRelinkRun('3017', '123', { send: true, ids })).error).toMatch(/save first/);
    expect(transcribeStrokes).not.toHaveBeenCalled();
    expect((await saveRelink('3017', '123', { links: [{ lineId: 'L00', ms: [0] }] }, { ids })).error).toMatch(/save first/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('refuses a selection of strokes that are all Not text', () => {
    const doc = makeOldPage();
    doc.strokes[0].textless = true;
    const guard = { label: 'B3017/P123', draft: false, editorOpen: false, reset: false, pendingTranscription: false };
    expect(relinkRefusal(guard, doc, { ids: [doc.strokes[0].id] })).toMatch(/can be sent/);
    expect(relinkRefusal(guard, doc, { ids: ['s1'] })).toMatch(/not saved/);
  });

  it('every page guard still applies', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    pageTranscriptions.set(new Map([['x', { pageInfo: { book: '3017', page: 123 } }]]));
    expect((await getRelinkRun('3017', '123', { send: true, ids: rowStrokeIds(doc, [0]) })).error).toMatch(/unsaved transcription/);
  });
});

describe('Relink selection: the run and the save', () => {
  it('needs a click to send, sends only the selection (minus Not text), holds nothing back and caches nothing', async () => {
    const doc = decoratedPage();
    doc.strokes[3].textless = true;
    doc.strokes[3].lineId = null;
    disk.set('3017/123', doc);
    const ids = [...rowStrokeIds(doc, [0, 1, 2]), `s${UNDERLINE_T}`];
    expect((await getRelinkRun('3017', '123', { ids })).needsSend).toBe(true);
    vi.mocked(transcribeStrokes).mockImplementation(async () => partialReply([0, 1, 2], rowY(0)));
    const got = await getRelinkRun('3017', '123', { send: true, ids });
    const sent = vi.mocked(transcribeStrokes).mock.calls[0][0].map((s) => `s${s.startTime}`);
    expect(sent.sort()).toEqual(ids.filter((id) => id !== doc.strokes[3].id).sort());
    expect(got.run).toMatchObject({ heldBack: [], selection: true });
    expect(cacheStore.size).toBe(0);
    // A second open sends again (never from the cache).
    expect((await getRelinkRun('3017', '123', { ids })).needsSend).toBe(true);
  });

  it('on an untrustworthy page, ink not in the selection is unlinked and lines not linked lose their yBounds', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    const rows = ROWS(0, 13);
    const ids = rowStrokeIds(doc, rows);
    vi.mocked(transcribeStrokes).mockImplementation(async () => partialReply(rows, rowY(0)));
    const got = await getRelinkRun('3017', '123', { send: true, ids });
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    expect(model.counts.matched).toBe(14);
    const r = await saveRelink('3017', '123', buildRelinkSpec(got.run, model), { ids });
    expect(r.ok).toBe(true);
    const after = disk.get('3017/123');
    const byId = new Map(after.strokes.map((s) => [s.id, s]));
    rows.forEach((i) => rowStrokeIds(doc, [i]).forEach((id) => expect(byId.get(id).lineId).toBe(`L${String(i).padStart(2, '0')}`)));
    rowStrokeIds(doc, ROWS(14, 27)).forEach((id) => expect(byId.get(id).lineId).toBe(null));
    after.transcript.lines.slice(14).forEach((l) => expect(l.yBounds).toBe(null));
    expect(isTrustworthyTranscript(after)).toBe(true);
    // The canvas copy, had the page been loaded, takes the unlinks too.
    expect(r.result.links[rowStrokeIds(doc, [20])[0]]).toBe(null);
  });

  it('two passes over a table: pass 2 keeps pass 1\'s links and yBounds, and links its own', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    // Pass 1: the first column (rows 0–13).
    const p1 = ROWS(0, 13);
    vi.mocked(transcribeStrokes).mockImplementation(async () => partialReply(p1, rowY(0)));
    let got = await getRelinkRun('3017', '123', { send: true, ids: rowStrokeIds(doc, p1) });
    expect((await saveRelink('3017', '123', buildRelinkSpec(got.run, classifyRelink(got.doc.transcript.lines, got.run.lines)),
      { ids: rowStrokeIds(doc, p1) })).ok).toBe(true);
    const mid = disk.get('3017/123');
    expect(isTrustworthyTranscript(mid)).toBe(true);
    const yb1 = mid.transcript.lines.slice(0, 14).map((l) => l.yBounds);
    const links1 = new Map(mid.strokes.map((s) => [s.id, s.lineId]));

    // Pass 2: the second column (rows 14–27), sent with its own origin.
    const p2 = ROWS(14, 27);
    vi.mocked(transcribeStrokes).mockImplementation(async () => partialReply(p2, rowY(14)));
    got = await getRelinkRun('3017', '123', { send: true, ids: rowStrokeIds(doc, p2) });
    expect(got.ok).toBe(true);
    const model = classifyRelink(got.doc.transcript.lines, got.run.lines);
    expect(model.counts).toMatchObject({ matched: 14, noink: 14 });
    expect((await saveRelink('3017', '123', buildRelinkSpec(got.run, model), { ids: rowStrokeIds(doc, p2) })).ok).toBe(true);

    const after = disk.get('3017/123');
    const byId = new Map(after.strokes.map((s) => [s.id, s]));
    rowStrokeIds(doc, p1).forEach((id) => expect(byId.get(id).lineId).toBe(links1.get(id)));
    expect(after.transcript.lines.slice(0, 14).map((l) => l.yBounds)).toEqual(yb1);
    p2.forEach((i) => rowStrokeIds(doc, [i]).forEach((id) => expect(byId.get(id).lineId).toBe(`L${String(i).padStart(2, '0')}`)));
    after.transcript.lines.slice(14).forEach((l) => expect(l.yBounds).not.toBe(null));
    expect(isTrustworthyTranscript(after)).toBe(true);
    // Text, order and task state untouched.
    expect(after.transcript.lines.map(({ yBounds, ...rest }) => rest)).toEqual(doc.transcript.lines.map(({ yBounds, ...rest }) => rest));
  });

  it('the "no stored line linked" refusal still applies to a pass', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    const ids = rowStrokeIds(doc, [0]);
    vi.mocked(transcribeStrokes).mockImplementation(async () => ({ text: '', words: [], lines: [{ text: 'zzzz qqqq', yBounds: { minY: mm(rowY(0)), maxY: mm(rowY(0) + 2) } }] }));
    const got = await getRelinkRun('3017', '123', { send: true, ids });
    const r = await saveRelink('3017', '123', buildRelinkSpec(got.run, classifyRelink(got.doc.transcript.lines, got.run.lines)), { ids });
    expect(r.ok).toBe(false);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a page also on the canvas takes the new links; the selection stays', async () => {
    const doc = makeOldPage();
    disk.set('3017/123', doc);
    const rows = [0, 1, 2];
    const ids = rowStrokeIds(doc, rows);
    onCanvas(doc, ids);
    const sel = get(selectedIndices);
    vi.mocked(transcribeStrokes).mockImplementation(async () => partialReply(rows, rowY(0)));
    const got = await getRelinkRun('3017', '123', { send: true, ids });
    expect((await saveRelink('3017', '123', buildRelinkSpec(got.run, classifyRelink(got.doc.transcript.lines, got.run.lines)), { ids })).ok).toBe(true);
    const canvas = get(strokes);
    expect(canvas[0].blockUuid).toBe('L00');
    expect(canvas[3].blockUuid).toBe('L01');
    expect(canvas[30].blockUuid).toBe(null);
    expect(get(selectedIndices)).toBe(sel);
  });
});
