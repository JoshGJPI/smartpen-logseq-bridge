/**
 * lib/viewer/sketch-lines.js (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.3 / E.6):
 * create, rename, add / remove strokes, remove (strokes unlinked, never deleted),
 * bounds, placement by y on trusted and untrusted pages, the Editor's multi-page
 * targets, the reader's box (wholly inside, text-line warning), and the one write
 * path's guards, savePage, the canvas copy and refreshAfterSave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({ getPage: vi.fn(), savePage: vi.fn() }));
vi.mock('$lib/storage/refresh.js', () => ({ refreshAfterSave: vi.fn() }));
vi.mock('$stores/page-guards.js', () => ({ pageGuardState: vi.fn(), suffixOnCanvas: vi.fn() }));
vi.mock('$stores/textless.js', () => ({ syncCanvasAfterPageWrite: vi.fn() }));
vi.mock('$stores/orientation.js', () => ({ pageOrientations: writable({}) }));

import { getPage, savePage } from '$lib/storage/local-store.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import { pageGuardState, suffixOnCanvas } from '$stores/page-guards.js';
import { syncCanvasAfterPageWrite } from '$stores/textless.js';
import {
  docWithSketch, sketchRefusal, sketchTargets, boxPick, selectionPick, inLineWarning, previewPlacement, saveSketchLine, SketchError
} from '../viewer/sketch-lines.js';
import { isTrustworthyTranscript } from '../viewer/ink-text.js';

const st = (id, x, y0, y1, extra = {}) => ({ id, startTime: Number(id.slice(1)), endTime: 0, lineId: null, points: [[x, y0], [x + 4, y1]], ...extra });

/**
 * A trusted page: A at y 10 (ink linked), B at y 80; drawing strokes s5/s6 at
 * y 40–60 unlinked; s7 a Not text stroke in the drawing; s8 in line B but
 * inside the drawing's area (x 20).
 */
function page({ trusted = true } = {}) {
  const yb = (a, b) => ({ minY: a, maxY: b });
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1, book: 3017, page: 124 },
    metadata: { lastUpdated: '2026-11-01T00:00:00Z', totalStrokes: 6 },
    transcript: {
      lastTranscribed: trusted ? '2026-11-01T00:00:00Z' : '2026-05-01T00:00:00Z',
      lines: [
        { id: 'A', text: '9:30 6226-001 Initial Site Visit', indentLevel: 0, parentId: null, checked: null, yBounds: yb(200, 210) },
        { id: 'B', text: 'Need hot water heater', indentLevel: 1, parentId: 'A', checked: null, yBounds: yb(300, 310) }
      ]
    },
    strokes: [
      st('s1', 10, 10, 12, { lineId: 'A' }), st('s2', 30, 10, 12, { lineId: 'A' }),
      st('s5', 20, 40, 60), st('s6', 30, 42, 55), st('s7', 25, 45, 50, { textless: true }),
      st('s8', 20, 44, 46, { lineId: 'B' }), st('s9', 10, 80, 82, { lineId: 'B' })
    ]
  };
}
const NOW = '2026-11-20T10:00:00.000Z';
const opts = { now: NOW, newId: () => 'SK' };

describe('docWithSketch: create', () => {
  it('the fixture page is trusted (and the untrusted one is not)', () => {
    expect(isTrustworthyTranscript(page())).toBe(true);
    expect(isTrustworthyTranscript(page({ trusted: false }))).toBe(false);
  });

  it('adds a sketch line under the nearest text line above its ink, links the strokes, sets bounds', () => {
    const out = docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's6'], label: '  Floor plan ' }, opts);
    const lines = out.doc.transcript.lines;
    expect(lines.map((l) => l.id)).toEqual(['A', 'SK', 'B']);
    expect(lines[1]).toEqual({
      id: 'SK', kind: 'sketch', text: 'Floor plan', indentLevel: 1, parentId: 'A', checked: null, yBounds: null,
      bounds: { minX: 20, maxX: 34, minY: 40, maxY: 60 }
    });
    expect(out.doc.strokes.filter((s) => s.lineId === 'SK').map((s) => s.id)).toEqual(['s5', 's6']);
    expect(out.links).toEqual({ s5: 'SK', s6: 'SK' });
    expect(out.under).toBe(0);
  });

  it('never deletes a stroke, never moves a point, never touches lastTranscribed; bumps lastUpdated', () => {
    const before = page();
    const out = docWithSketch(before, { op: 'create', strokeIds: ['s5'] }, opts);
    expect(out.doc.strokes).toHaveLength(before.strokes.length);
    out.doc.strokes.forEach((s, i) => expect(s.points).toEqual(before.strokes[i].points));
    expect(out.doc.transcript.lastTranscribed).toBe(before.transcript.lastTranscribed);
    expect(out.doc.metadata.lastUpdated).toBe(NOW);
    expect(out.doc.transcript.lines[1].text).toBe('Sketch');   // empty label
  });

  it('on an untrusted page goes at the end, level 0', () => {
    const out = docWithSketch(page({ trusted: false }), { op: 'create', strokeIds: ['s5'] }, opts);
    expect(out.doc.transcript.lines.at(-1)).toMatchObject({ id: 'SK', indentLevel: 0, parentId: null });
    expect(out.under).toBe(-1);
  });

  it('takes a text line\'s stroke when asked, and clears Not text on a stroke it takes (a textless stroke is in no line)', () => {
    const out = docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's7', 's8'] }, opts);
    const by = Object.fromEntries(out.doc.strokes.map((s) => [s.id, s]));
    expect(by.s8.lineId).toBe('SK');
    expect(by.s7).toMatchObject({ lineId: 'SK' });
    expect(by.s7.textless).toBeUndefined();
    expect(out.textlessCleared).toEqual(['s7']);
  });

  it('Also draw with pen pressure sets sketch: true (Pressure ink), off by default', () => {
    expect(docWithSketch(page(), { op: 'create', strokeIds: ['s5'] }, opts).doc.strokes.find((s) => s.id === 's5').sketch).toBeUndefined();
    const out = docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's6'], pressure: true }, opts);
    expect(out.doc.strokes.filter((s) => s.sketch).map((s) => s.id)).toEqual(['s5', 's6']);
    expect(out.sketchIds).toEqual(['s5', 's6']);
  });

  it('places by y in the page\'s reading frame when it is shown turned', () => {
    // Turned 180°: B (ink down to y 82) now reads above the drawing (y 40–60), and A (y 10) below it.
    const out = docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's6'] }, { ...opts, rotation: 180 });
    expect(out.doc.transcript.lines.map((l) => l.id)).toEqual(['A', 'B', 'SK']);
    expect(out.doc.transcript.lines[2]).toMatchObject({ indentLevel: 2, parentId: 'B' });
  });

  it('refuses strokes that are not on the page', () => {
    expect(() => docWithSketch(page(), { op: 'create', strokeIds: ['s999'] }, opts)).toThrow(SketchError);
    expect(() => docWithSketch(page(), { op: 'nope' }, opts)).toThrow(/Unknown sketch op/);
    expect(() => docWithSketch(null, { op: 'create' }, opts)).toThrow(SketchError);
  });

  it('previewPlacement names the anchor line the dialog shows', () => {
    expect(previewPlacement(page(), ['s5'])).toEqual({ n: 1, text: '9:30 6226-001 Initial Site Visit', indentLevel: 1 });
    expect(previewPlacement(page({ trusted: false }), ['s5'])).toBeNull();
  });
});

describe('docWithSketch: change and remove', () => {
  const made = () => docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's6'], label: 'Plan' }, opts).doc;

  it('rename; an empty label is "Sketch"; the same label changes nothing', () => {
    expect(docWithSketch(made(), { op: 'rename', lineId: 'SK', label: 'Floor plan' }, opts).doc.transcript.lines[1].text).toBe('Floor plan');
    expect(docWithSketch(made(), { op: 'rename', lineId: 'SK', label: '' }, opts).doc.transcript.lines[1].text).toBe('Sketch');
    const same = docWithSketch(made(), { op: 'rename', lineId: 'SK', label: 'Plan' }, opts);
    expect(same.changed).toBe(false);
  });

  it('add strokes: linked, bounds grow', () => {
    const out = docWithSketch(made(), { op: 'add-strokes', lineId: 'SK', strokeIds: ['s9'] }, opts);
    expect(out.doc.strokes.find((s) => s.id === 's9').lineId).toBe('SK');
    expect(out.doc.transcript.lines[1].bounds).toEqual({ minX: 10, maxX: 34, minY: 40, maxY: 82 });
  });

  it('remove strokes: only the sketch\'s own are unlinked, never deleted; bounds shrink', () => {
    const doc = made();
    const out = docWithSketch(doc, { op: 'remove-strokes', lineId: 'SK', strokeIds: ['s5', 's9'] }, opts);
    expect(out.doc.strokes).toHaveLength(doc.strokes.length);
    expect(out.doc.strokes.find((s) => s.id === 's5').lineId).toBeNull();
    expect(out.doc.strokes.find((s) => s.id === 's9').lineId).toBe('B');
    expect(out.links).toEqual({ s5: null });
    expect(out.doc.transcript.lines[1].bounds).toEqual({ minX: 30, maxX: 34, minY: 42, maxY: 55 });
  });

  it('remove sketch: its ink is Not text by default (never sent again); Transcribe it again only unlinks', () => {
    const doc = made();
    const out = docWithSketch(doc, { op: 'remove', lineId: 'SK' }, opts);
    expect(out.doc.strokes).toHaveLength(doc.strokes.length);
    for (const id of ['s5', 's6']) expect(out.doc.strokes.find((s) => s.id === id)).toMatchObject({ lineId: null, textless: true });
    expect(out.textlessIds).toEqual(['s5', 's6']);
    const retry = docWithSketch(doc, { op: 'remove', lineId: 'SK', ink: 'retry' }, opts);
    expect(retry.doc.strokes.filter((s) => s.textless).map((s) => s.id)).toEqual(['s7']);   // only the page's own Not text
    expect(retry.textlessIds).toEqual([]);
    expect(retry.links).toEqual({ s5: null, s6: null });
    // Remove strokes only unlinks (they may go elsewhere).
    expect(docWithSketch(doc, { op: 'remove-strokes', lineId: 'SK', strokeIds: ['s5'] }, opts).textlessIds).toEqual([]);
  });

  it('remove sketch: the line goes, its strokes are unlinked (never deleted), lines under it move up', () => {
    const doc = made();
    doc.transcript.lines.splice(2, 0, { id: 'C', text: 'note on the plan', indentLevel: 2, parentId: 'SK', checked: null, yBounds: null });
    const out = docWithSketch(doc, { op: 'remove', lineId: 'SK', ink: 'retry' }, opts);
    expect(out.doc.transcript.lines.map((l) => l.id)).toEqual(['A', 'C', 'B']);
    expect(out.doc.transcript.lines[1]).toMatchObject({ indentLevel: 1, parentId: 'A' });
    expect(out.doc.strokes).toHaveLength(doc.strokes.length);
    expect(out.doc.strokes.filter((s) => s.lineId === 'SK')).toEqual([]);
    expect(out.links).toEqual({ s5: null, s6: null });
  });

  it('refuses a line that is gone or not a sketch', () => {
    expect(() => docWithSketch(made(), { op: 'rename', lineId: 'zz', label: 'x' }, opts)).toThrow(/no longer/);
    expect(() => docWithSketch(made(), { op: 'remove', lineId: 'A' }, opts)).toThrow(/not a sketch/);
  });
});

describe('sketchTargets: the Editor\'s selection (one sketch per page; unsaved → Save first)', () => {
  const cs = (t, page, extra = {}) => ({ startTime: t, pageInfo: { book: '3017', page }, dotArray: [{}], ...extra });
  const onDisk = new Map([['B3017/P124', new Map([['s1', {}], ['s2', {}]])], ['B3017/P125', new Map([['s3', {}]])]]);

  it('groups saved strokes by page', () => {
    const all = [cs(1, 124), cs(2, 124), cs(3, 125)];
    expect(sketchTargets(all, [0, 1, 2], onDisk)).toEqual({
      ok: true, unsaved: 0, marked: 0,
      pages: [{ book: '3017', pageId: '124', ids: ['s1', 's2'] }, { book: '3017', pageId: '125', ids: ['s3'] }]
    });
  });

  it('refuses unsaved, retimed, moved or point-edited strokes', () => {
    for (const bad of [cs(9, 124), cs(1, 124, { retimedFrom: { id: 's0' } }), cs(1, 124, { movedFrom: {} }), cs(1, 124, { pointsEdited: true })]) {
      const r = sketchTargets([cs(2, 124), bad], [0, 1], onDisk);
      expect(r.ok).toBe(false);
      expect(r.unsaved).toBe(1);
      expect(r.error).toMatch(/Save first/);
    }
  });

  it('strokes marked for deletion (deletedIndices) are left out, never taken', () => {
    const all = [cs(1, 124), cs(2, 124), cs(3, 125)];
    const r = sketchTargets(all, [0, 1, 2], onDisk, new Set([1, 2]));
    expect(r).toMatchObject({ ok: true, marked: 2, pages: [{ book: '3017', pageId: '124', ids: ['s1'] }] });
    const none = sketchTargets(all, [1, 2], onDisk, new Set([1, 2]));
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/marked for deletion/);
    // An unsaved stroke marked for deletion doesn't block the rest.
    expect(sketchTargets([cs(1, 124), cs(9, 124)], [0, 1], onDisk, new Set([1])).ok).toBe(true);
  });

  it('nothing selected', () => {
    expect(sketchTargets([], [], onDisk).ok).toBe(false);
  });
});

describe('selectionPick: the Editor\'s Make sketch warns about linked strokes', () => {
  it('takes strokes in no line (and Not text ink); groups text-line and sketch strokes per line', () => {
    const doc = docWithSketch(page(), { op: 'create', strokeIds: ['s6'], label: 'Plan' }, opts).doc;
    const r = selectionPick(doc, ['s5', 's7', 's8', 's9', 's6', 's1']);
    expect(r.take.sort()).toEqual(['s5', 's7']);
    expect(r.inLines.map((g) => [g.lineId, g.n, g.sketch, g.ids])).toEqual([
      ['A', 1, false, ['s1']], ['SK', 2, true, ['s6']], ['B', 3, false, ['s8', 's9']]
    ]);
    expect(inLineWarning(r.inLines[2])).toBe('2 strokes are in line #3 (“Need hot water heater”)');
    expect(selectionPick(doc, [])).toEqual({ take: [], inLines: [] });
  });
});

describe('boxPick: the reader\'s Mark sketch box', () => {
  const box = { minX: 15, maxX: 40, minY: 35, maxY: 65 };

  it('takes strokes wholly inside and in no text line (Not text ink too); offers text-line strokes per line', () => {
    const r = boxPick(page(), box);
    expect(r.take.sort()).toEqual(['s5', 's6', 's7']);
    expect(r.inLines).toEqual([{ lineId: 'B', n: 2, text: 'Need hot water heater', sketch: false, ids: ['s8'] }]);
    expect(inLineWarning(r.inLines[0])).toBe('1 stroke is in line #2 (“Need hot water heater”)');
  });

  it('a stroke only partly inside is not picked', () => {
    expect(boxPick(page(), { ...box, maxY: 50 }).take).toEqual(['s7']);
  });

  it('add strokes leaves the sketch\'s own out; remove strokes picks only its own', () => {
    const doc = docWithSketch(page(), { op: 'create', strokeIds: ['s5'], label: 'Plan' }, opts).doc;
    expect(boxPick(doc, box, { lineId: 'SK' }).take.sort()).toEqual(['s6', 's7']);
    expect(boxPick(doc, box, { lineId: 'SK', remove: true })).toEqual({ take: ['s5'], inLines: [] });
    // Another sketch's strokes are offered like a text line's.
    const g = boxPick(doc, box).inLines.find((x) => x.lineId === 'SK');
    expect(g).toMatchObject({ sketch: true, ids: ['s5'] });
    expect(inLineWarning({ ...g, text: 'x'.repeat(60) })).toMatch(/in the sketch #2 \(“x{39}…”\)/);
  });
});

describe('saveSketchLine: the one write path', () => {
  const guard = (patch = {}) => ({ label: 'B3017/P124', draft: false, editorOpen: false, pendingTranscription: false, reset: false, ...patch });

  beforeEach(() => {
    vi.clearAllMocks();
    pageGuardState.mockReturnValue(guard());
    suffixOnCanvas.mockReturnValue(false);
    getPage.mockResolvedValue(page());
    savePage.mockResolvedValue({ path: 'x' });
  });

  it('reads, writes through savePage, syncs the canvas copy with the links, then refreshAfterSave', async () => {
    const r = await saveSketchLine('3017', '124', { op: 'create', strokeIds: ['s5', 's6', 's7'], label: 'Plan', pressure: true });
    expect(r.changed).toBe(true);
    expect(savePage).toHaveBeenCalledTimes(1);
    const [b, p, doc] = savePage.mock.calls[0];
    expect([b, p]).toEqual(['3017', '124']);
    expect(doc.transcript.lines.some((l) => l.kind === 'sketch' && l.text === 'Plan')).toBe(true);
    expect(syncCanvasAfterPageWrite).toHaveBeenCalledWith('3017', '124', expect.objectContaining({
      strokes: doc.strokes, links: { s5: r.lineId, s6: r.lineId, s7: r.lineId }, sketchIds: ['s5', 's6', 's7'], textlessCleared: ['s7']
    }));
    expect(refreshAfterSave).toHaveBeenCalledWith([{ book: '3017', pageId: '124' }]);
    expect(savePage.mock.invocationCallOrder[0]).toBeLessThan(syncCanvasAfterPageWrite.mock.invocationCallOrder[0]);
  });

  it('Remove sketch hands its Not text ink to the canvas sync', async () => {
    getPage.mockResolvedValue(docWithSketch(page(), { op: 'create', strokeIds: ['s5', 's6'], label: 'Plan' }, opts).doc);
    await saveSketchLine('3017', '124', { op: 'remove', lineId: 'SK' });
    expect(syncCanvasAfterPageWrite).toHaveBeenCalledWith('3017', '124', expect.objectContaining({
      links: { s5: null, s6: null }, textlessIds: ['s5', 's6']
    }));
    expect(refreshAfterSave).toHaveBeenCalled();
  });

  it('is refused under Relink\'s guards and the suffixed-page rule, nothing written', async () => {
    for (const g of [{ draft: true }, { editorOpen: true }, { pendingTranscription: true }, { reset: true }]) {
      pageGuardState.mockReturnValue(guard(g));
      await expect(saveSketchLine('3017', '124', { op: 'create', strokeIds: ['s5'] })).rejects.toThrow(SketchError);
    }
    pageGuardState.mockReturnValue(guard());
    suffixOnCanvas.mockReturnValue(true);
    await expect(saveSketchLine('3017', '124b', { op: 'create', strokeIds: ['s5'] })).rejects.toThrow(/letter-suffixed/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a page gone is refused; a no-op writes nothing', async () => {
    getPage.mockResolvedValue(null);
    await expect(saveSketchLine('3017', '124', { op: 'create', strokeIds: ['s5'] })).rejects.toThrow(/not found/);
    getPage.mockResolvedValue(docWithSketch(page(), { op: 'create', strokeIds: ['s5'], label: 'Plan' }, opts).doc);
    expect((await saveSketchLine('3017', '124', { op: 'rename', lineId: 'SK', label: 'Plan' })).changed).toBe(false);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('re-checks the guards after reading (a draft opened meanwhile)', async () => {
    pageGuardState.mockReturnValueOnce(guard()).mockReturnValueOnce(guard()).mockReturnValue(guard({ draft: true }));
    await expect(saveSketchLine('3017', '124', { op: 'create', strokeIds: ['s5'] })).rejects.toThrow(/unsaved transcript edits/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('sketchRefusal names each reason', () => {
    expect(sketchRefusal(guard(), {})).toBeNull();
    expect(sketchRefusal(guard(), null)).toMatch(/not found/);
    expect(sketchRefusal({ ...guard(), suffixOnCanvas: true }, {})).toMatch(/suffixed/);
  });
});
