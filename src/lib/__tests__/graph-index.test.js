import { describe, it, expect } from 'vitest';
import {
  SMARTPEN_PLUGIN_ID,
  SMARTPEN_ASSETS_REL,
  SMARTPEN_INDEX_NAME,
  smartpenAssetName,
  smartpenAssetRelPath,
  emptySmartpenIndex,
  buildSmartpenIndexEntry,
  upsertSmartpenIndex
} from '../storage/graph-index.js';

function makeDoc(overrides = {}) {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 42 },
    metadata: {
      lastUpdated: '2026-06-10T00:00:00.000Z',
      totalStrokes: 2,
      bounds: { minX: 1, maxX: 2, minY: 3, maxY: 4 }
    },
    transcript: { lastTranscribed: null, lines: [{ id: 'a', text: 'hi' }] },
    strokes: [{ id: 's1' }, { id: 's2' }],
    ...overrides
  };
}

describe('asset name convention', () => {
  it('builds the flat asset filename', () => {
    expect(smartpenAssetName(3017, 42)).toBe('smartpen-B3017-P42.json');
  });

  it('preserves a letter-suffixed pageId', () => {
    expect(smartpenAssetName(390, '151b')).toBe('smartpen-B390-P151b.json');
  });

  it('builds the graph-relative path with forward slashes', () => {
    expect(smartpenAssetRelPath(390, '151b')).toBe(
      'assets/storages/logseq-plugin-jpi-tools/smartpen-B390-P151b.json'
    );
  });

  it('exposes the plugin id, assets folder, and index name constants', () => {
    expect(SMARTPEN_PLUGIN_ID).toBe('logseq-plugin-jpi-tools');
    expect(SMARTPEN_ASSETS_REL).toBe('assets/storages/logseq-plugin-jpi-tools');
    expect(SMARTPEN_INDEX_NAME).toBe('smartpen-index.json');
  });
});

describe('buildSmartpenIndexEntry', () => {
  it('takes identity from the caller (filename), not the PageDoc pageInfo', () => {
    // doc.pageInfo.book disagrees with the filename book — filename wins.
    const doc = makeDoc({ pageInfo: { section: 3, owner: 1012, book: 9999, page: 151 } });
    const entry = buildSmartpenIndexEntry(doc, 390, '151b');
    expect(entry.book).toBe(390);
    expect(entry.pageId).toBe('151b');
    expect(entry.page).toBe(151); // integer part of the pageId
  });

  it('counts strokes and transcript lines', () => {
    const entry = buildSmartpenIndexEntry(makeDoc(), 3017, '42');
    expect(entry.strokeCount).toBe(2);
    expect(entry.transcriptLines).toBe(1);
  });

  it('carries bounds / section / owner / lastUpdated from the doc', () => {
    const entry = buildSmartpenIndexEntry(makeDoc(), 3017, '42');
    expect(entry.bounds).toEqual({ minX: 1, maxX: 2, minY: 3, maxY: 4 });
    expect(entry.section).toBe(3);
    expect(entry.owner).toBe(1012);
    expect(entry.lastUpdated).toBe('2026-06-10T00:00:00.000Z');
  });

  it('falls back to doc page number when pageId has no digits, else 0', () => {
    const doc = makeDoc({ pageInfo: { section: 0, owner: 0, book: 1, page: 7 } });
    // "b" → no leading digits → Number('b') is NaN → falls back to doc page
    expect(buildSmartpenIndexEntry(doc, 1, 'b').page).toBe(7);
  });

  it('tolerates a doc with no strokes/transcript', () => {
    const entry = buildSmartpenIndexEntry({ pageInfo: { page: 5 }, metadata: {} }, 1, '5');
    expect(entry.strokeCount).toBe(0);
    expect(entry.transcriptLines).toBe(0);
  });
});

describe('upsertSmartpenIndex', () => {
  it('adds a new entry to an empty index and bumps updatedAt', () => {
    const entry = buildSmartpenIndexEntry(makeDoc(), 3017, '42');
    const next = upsertSmartpenIndex(emptySmartpenIndex(), entry, null);
    expect(next.pages).toHaveLength(1);
    expect(next.pages[0].pageId).toBe('42');
    expect(typeof next.updatedAt).toBe('string');
    expect(next.version).toBe(1);
  });

  it('replaces an existing entry for the same book+pageId (no duplicate)', () => {
    let index = upsertSmartpenIndex(
      emptySmartpenIndex(),
      buildSmartpenIndexEntry(makeDoc({ strokes: [{ id: 's1' }] }), 3017, '42'),
      null
    );
    index = upsertSmartpenIndex(
      index,
      buildSmartpenIndexEntry(makeDoc({ strokes: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }), 3017, '42'),
      null
    );
    expect(index.pages).toHaveLength(1);
    expect(index.pages[0].strokeCount).toBe(3);
  });

  it('keeps a letter-suffixed page distinct from its integer page', () => {
    let index = upsertSmartpenIndex(emptySmartpenIndex(), buildSmartpenIndexEntry(makeDoc(), 390, '151'), null);
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 390, '151b'), null);
    expect(index.pages.map((p) => p.pageId).sort()).toEqual(['151', '151b']);
  });

  it('sorts pages by book then page number', () => {
    let index = emptySmartpenIndex();
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 3017, '42'), null);
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 390, '7'), null);
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 390, '3'), null);
    expect(index.pages.map((p) => [p.book, p.page])).toEqual([
      [390, 3],
      [390, 7],
      [3017, 42]
    ]);
  });

  it('merges a non-blank book alias, ignoring blanks', () => {
    let index = upsertSmartpenIndex(emptySmartpenIndex(), buildSmartpenIndexEntry(makeDoc(), 3017, '42'), 'Field Notes');
    expect(index.aliases['3017']).toBe('Field Notes');
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 3017, '43'), '   ');
    expect(index.aliases['3017']).toBe('Field Notes'); // blank alias did not clobber
  });

  it('preserves aliases for other books on upsert', () => {
    let index = upsertSmartpenIndex(emptySmartpenIndex(), buildSmartpenIndexEntry(makeDoc(), 390, '7'), 'Calc Pad');
    index = upsertSmartpenIndex(index, buildSmartpenIndexEntry(makeDoc(), 3017, '42'), 'Field Notes');
    expect(index.aliases).toEqual({ 390: 'Calc Pad', 3017: 'Field Notes' });
  });

  it('does not mutate the input index', () => {
    const original = emptySmartpenIndex();
    const next = upsertSmartpenIndex(original, buildSmartpenIndexEntry(makeDoc(), 3017, '42'), null);
    expect(original.pages).toHaveLength(0);
    expect(next).not.toBe(original);
  });

  it('normalizes a garbage/partial index instead of throwing', () => {
    const next = upsertSmartpenIndex({ pages: 'nope', aliases: 5 }, buildSmartpenIndexEntry(makeDoc(), 1, '1'), null);
    expect(Array.isArray(next.pages)).toBe(true);
    expect(next.pages).toHaveLength(1);
    expect(next.aliases).toEqual({});
  });
});
