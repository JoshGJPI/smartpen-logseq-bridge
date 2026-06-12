import { describe, it, expect } from 'vitest';
import { metaToRecord } from '$lib/storage/scan.js';

/**
 * metaToRecord builds the lightweight Data Explorer record from a PageMeta.
 * The whole point of perf #3 is that the record carries metadata only — never
 * the strokes array or the full PageDoc — so these tests pin that contract.
 */

function meta(overrides = {}) {
  return {
    book: 3017,
    page: 42,
    pageId: '42',
    suffix: '',
    strokeCount: 385,
    lastUpdated: '2026-05-28T14:22:01.000Z',
    hasTranscription: true,
    transcriptLineCount: 7,
    transcriptionText: 'Meeting notes\n  detail',
    path: '/data/pages/B3017/P42.json',
    ...overrides,
  };
}

describe('metaToRecord', () => {
  it('maps the lightweight summary fields through', () => {
    const r = metaToRecord(meta());
    expect(r.book).toBe(3017);
    expect(r.page).toBe(42);
    expect(r.pageId).toBe('42');
    expect(r.suffix).toBe('');
    expect(r.strokeCount).toBe(385);
    expect(r.lastUpdated).toBe('2026-05-28T14:22:01.000Z');
    expect(r.transcriptLineCount).toBe(7);
    expect(r.transcriptionText).toBe('Meeting notes\n  detail');
    expect(r.transcribed).toBe(true);
    expect(r.syncStatus).toBe('clean');
    expect(r.pageName).toBe('pages/B3017/P42.json');
  });

  it('never embeds strokes / pageDoc / strokeData (residency contract)', () => {
    const r = metaToRecord(meta({ strokeCount: 99999 }));
    expect(r).not.toHaveProperty('strokes');
    expect(r).not.toHaveProperty('pageDoc');
    expect(r).not.toHaveProperty('strokeData');
  });

  it('preserves letter-suffixed pages in pageId, suffix and pageName', () => {
    const r = metaToRecord(meta({ page: 151, pageId: '151b', suffix: 'b' }));
    expect(r.page).toBe(151);
    expect(r.pageId).toBe('151b');
    expect(r.suffix).toBe('b');
    expect(r.pageName).toBe('pages/B3017/P151b.json');
  });

  it('falls back to the integer page when pageId is absent', () => {
    const r = metaToRecord({ book: 5, page: 12, strokeCount: 0 });
    expect(r.pageId).toBe('12');
    expect(r.suffix).toBe('');
    expect(r.pageName).toBe('pages/B5/P12.json');
  });

  it('marks pages without transcription as not transcribed', () => {
    const r = metaToRecord(meta({ hasTranscription: false, transcriptionText: null, transcriptLineCount: 0 }));
    expect(r.transcribed).toBe(false);
    expect(r.transcriptionText).toBeNull();
    expect(r.transcriptLineCount).toBe(0);
  });

  it('infers transcribed from text when hasTranscription is missing', () => {
    const r = metaToRecord({ book: 1, page: 2, transcriptionText: 'hello' });
    expect(r.transcribed).toBe(true);
  });
});
