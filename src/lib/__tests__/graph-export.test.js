import { describe, it, expect, vi, beforeEach } from 'vitest';

// The facades talk to disk through publish-graph.js; stub it so the pure core
// and the fan-out logic can be tested without Electron or a graph folder.
vi.mock('../storage/publish-graph.js', () => ({
  readGraphPage: vi.fn(),
  writeGraphPage: vi.fn(),
  isGraphConfigured: vi.fn(() => true)
}));

import { readGraphPage, writeGraphPage } from '../storage/publish-graph.js';
import {
  stripTranscriptRefs,
  mergeGraphStrokes,
  resolveGraphPageInfo,
  buildGraphPageDoc,
  groupCanvasStrokesByPage,
  exportSelectionToGraph,
  exportPageDocToGraph
} from '../storage/graph-export.js';

/** Storage-shape stroke. */
function stored(id, startTime, points = [[1, 2, 100]], lineId = null) {
  return { id, startTime, endTime: startTime + 10, lineId, points };
}

/** Canvas-shape stroke. */
function canvas(startTime, book, page, dots = [{ x: 1, y: 2, timestamp: 100 }]) {
  return {
    pageInfo: { section: 3, owner: 1012, book, page },
    startTime,
    endTime: startTime + 10,
    dotArray: dots
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readGraphPage.mockResolvedValue(null);
  writeGraphPage.mockResolvedValue({ assetPath: 'a.json', indexPath: 'i.json', strokeCount: 0 });
});

describe('stripTranscriptRefs', () => {
  it('clears lineId on every stroke', () => {
    const out = stripTranscriptRefs([
      stored('s1', 1, [[1, 2]], 'line-abc'),
      stored('s2', 2, [[3, 4]], null)
    ]);
    expect(out.map(s => s.lineId)).toEqual([null, null]);
  });

  it('leaves strokes without a lineId untouched by identity', () => {
    const s = stored('s1', 1);
    const out = stripTranscriptRefs([s]);
    expect(out[0]).toBe(s);
  });

  it('does not mutate the input', () => {
    const s = stored('s1', 1, [[1, 2]], 'line-abc');
    stripTranscriptRefs([s]);
    expect(s.lineId).toBe('line-abc');
  });

  it('handles null/empty', () => {
    expect(stripTranscriptRefs(null)).toEqual([]);
    expect(stripTranscriptRefs([])).toEqual([]);
  });
});

describe('mergeGraphStrokes', () => {
  it('appends new strokes and reports the count', () => {
    const r = mergeGraphStrokes([stored('s1', 1)], [stored('s2', 2)]);
    expect(r.strokes.map(s => s.id)).toEqual(['s1', 's2']);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(0);
  });

  it('deduplicates by id, keeping the already-published stroke', () => {
    const existing = stored('s1', 1, [[9, 9]]);
    const r = mergeGraphStrokes([existing], [stored('s1', 1, [[5, 5]])]);
    expect(r.strokes).toHaveLength(1);
    expect(r.strokes[0]).toBe(existing);
    expect(r.added).toBe(0);
    expect(r.duplicates).toBe(1);
  });

  it('re-exporting an identical selection adds nothing', () => {
    const incoming = [stored('s1', 1), stored('s2', 2)];
    const first = mergeGraphStrokes([], incoming);
    const second = mergeGraphStrokes(first.strokes, incoming);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(second.strokes).toHaveLength(2);
  });

  it('sorts the merged result by startTime', () => {
    const r = mergeGraphStrokes([stored('s3', 300)], [stored('s1', 100), stored('s2', 200)]);
    expect(r.strokes.map(s => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('does not mutate the existing array', () => {
    const existing = [stored('s1', 1)];
    mergeGraphStrokes(existing, [stored('s2', 2)]);
    expect(existing).toHaveLength(1);
  });

  it('handles null inputs', () => {
    expect(mergeGraphStrokes(null, null).strokes).toEqual([]);
  });
});

describe('resolveGraphPageInfo', () => {
  it('prefers section/owner from the already-published doc', () => {
    const info = resolveGraphPageInfo(
      { pageInfo: { section: 3, owner: 1012, book: 1, page: 1 } },
      { section: 9, owner: 9 },
      3017,
      42
    );
    expect(info).toEqual({ section: 3, owner: 1012, book: 3017, page: 42 });
  });

  it('falls back to the source strokes', () => {
    const info = resolveGraphPageInfo(null, { section: 3, owner: 1012 }, 3017, 42);
    expect(info).toEqual({ section: 3, owner: 1012, book: 3017, page: 42 });
  });

  it('falls back to zeros rather than failing', () => {
    expect(resolveGraphPageInfo(null, null, 3017, 42)).toEqual({
      section: 0, owner: 0, book: 3017, page: 42
    });
  });
});

describe('buildGraphPageDoc', () => {
  it('never carries a transcript', () => {
    const { doc } = buildGraphPageDoc({
      existingDoc: {
        pageInfo: { section: 3, owner: 1012, book: 3017, page: 42 },
        transcript: { lastTranscribed: '2026-01-01T00:00:00.000Z', lines: [{ id: 'l1', text: 'private note' }] },
        strokes: [stored('s1', 1, [[1, 2]], 'l1')]
      },
      incoming: [stored('s2', 2, [[3, 4]], 'l2')],
      book: 3017,
      page: 42
    });

    expect(doc.transcript).toEqual({ lastTranscribed: null, lines: [] });
    expect(JSON.stringify(doc)).not.toContain('private note');
  });

  it('strips lineId from both existing and incoming strokes', () => {
    const { doc } = buildGraphPageDoc({
      existingDoc: { strokes: [stored('s1', 1, [[1, 2]], 'l1')] },
      incoming: [stored('s2', 2, [[3, 4]], 'l2')],
      book: 3017,
      page: 42
    });
    expect(doc.strokes.every(s => s.lineId === null)).toBe(true);
  });

  it('recomputes bounds and totalStrokes over the merged set', () => {
    const { doc } = buildGraphPageDoc({
      existingDoc: { strokes: [stored('s1', 1, [[10, 20]])] },
      incoming: [stored('s2', 2, [[30, 5]])],
      book: 3017,
      page: 42
    });
    expect(doc.metadata.totalStrokes).toBe(2);
    expect(doc.metadata.bounds).toEqual({ minX: 10, maxX: 30, minY: 5, maxY: 20 });
  });

  it('produces a valid v2.0 doc on first publish', () => {
    const { doc, added } = buildGraphPageDoc({
      existingDoc: null,
      incoming: [stored('s1', 1)],
      sourcePageInfo: { section: 3, owner: 1012 },
      book: 3017,
      page: 42
    });
    expect(doc.version).toBe('2.0');
    expect(added).toBe(1);
  });
});

describe('groupCanvasStrokesByPage', () => {
  it('splits a multi-page selection', () => {
    const { groups, orphans } = groupCanvasStrokesByPage([
      canvas(1, 3017, 42),
      canvas(2, 3017, 43),
      canvas(3, 3017, 42)
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ book: 3017, page: 42 });
    expect(groups[0].strokes).toHaveLength(2);
    expect(groups[1]).toMatchObject({ book: 3017, page: 43 });
    expect(orphans).toBe(0);
  });

  it('sorts groups by book then page', () => {
    const { groups } = groupCanvasStrokesByPage([
      canvas(1, 400, 9),
      canvas(2, 390, 12),
      canvas(3, 390, 2)
    ]);
    expect(groups.map(g => `${g.book}/${g.page}`)).toEqual(['390/2', '390/12', '400/9']);
  });

  it('counts strokes with unusable pageInfo as orphans instead of dropping silently', () => {
    const { groups, orphans } = groupCanvasStrokesByPage([
      canvas(1, 3017, 42),
      { startTime: 2, dotArray: [] },
      { pageInfo: null, startTime: 3, dotArray: [] }
    ]);
    expect(groups).toHaveLength(1);
    expect(orphans).toBe(2);
  });

  it('handles empty input', () => {
    expect(groupCanvasStrokesByPage([])).toEqual({ groups: [], orphans: 0 });
  });
});

describe('exportSelectionToGraph', () => {
  it('writes once per page in the selection', async () => {
    const { results, orphans } = await exportSelectionToGraph([
      canvas(1, 3017, 42),
      canvas(2, 3017, 43)
    ]);

    expect(writeGraphPage).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
    expect(orphans).toBe(0);
  });

  it('merges into the page already published in the graph', async () => {
    readGraphPage.mockResolvedValue({
      pageInfo: { section: 3, owner: 1012, book: 3017, page: 42 },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [stored('s500', 500)]
    });

    const results = (await exportSelectionToGraph([canvas(900, 3017, 42)])).results;

    const [, , doc] = writeGraphPage.mock.calls[0];
    expect(doc.strokes.map(s => s.id)).toEqual(['s500', 's900']);
    expect(results[0]).toMatchObject({ added: 1, duplicates: 0, total: 2 });
  });

  it('reports duplicates without failing when re-exporting the same strokes', async () => {
    readGraphPage.mockResolvedValue({
      strokes: [stored('s900', 900)],
      transcript: { lastTranscribed: null, lines: [] }
    });

    const results = (await exportSelectionToGraph([canvas(900, 3017, 42)])).results;
    expect(results[0]).toMatchObject({ success: true, added: 0, duplicates: 1, total: 1 });
  });

  it('uses the integer page as the asset pageId', async () => {
    await exportSelectionToGraph([canvas(1, 3017, 42)]);
    const [book, pageId] = writeGraphPage.mock.calls[0];
    expect(book).toBe(3017);
    expect(pageId).toBe('42');
  });

  it('returns a failure result instead of throwing when the write fails', async () => {
    writeGraphPage.mockRejectedValue(new Error('graph folder not found'));
    const { results } = await exportSelectionToGraph([canvas(1, 3017, 42)]);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/graph folder not found/);
  });

  it('isolates a per-page failure from the rest of the selection', async () => {
    writeGraphPage
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ assetPath: 'a', indexPath: 'i', strokeCount: 1 });

    const { results } = await exportSelectionToGraph([canvas(1, 3017, 42), canvas(2, 3017, 43)]);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });
});

describe('exportPageDocToGraph', () => {
  it('publishes a whole saved page without its transcript', async () => {
    const result = await exportPageDocToGraph(390, '151b', {
      version: '2.0',
      pageInfo: { section: 3, owner: 1012, book: 390, page: 151 },
      transcript: { lastTranscribed: '2026-01-01T00:00:00.000Z', lines: [{ id: 'l1', text: 'secret' }] },
      strokes: [stored('s1', 1, [[1, 2]], 'l1'), stored('s2', 2)]
    });

    const [book, pageId, doc] = writeGraphPage.mock.calls[0];
    expect(book).toBe(390);
    expect(pageId).toBe('151b');
    expect(doc.transcript.lines).toEqual([]);
    expect(doc.pageInfo.page).toBe(151);
    expect(JSON.stringify(doc)).not.toContain('secret');
    expect(result).toMatchObject({ success: true, added: 2, total: 2 });
  });

  it('preserves the letter suffix as the asset identity', async () => {
    await exportPageDocToGraph(390, '151b', {
      pageInfo: { section: 3, owner: 1012, book: 390, page: 151 },
      strokes: [stored('s1', 1)]
    });
    expect(writeGraphPage.mock.calls[0][1]).toBe('151b');
  });
});
