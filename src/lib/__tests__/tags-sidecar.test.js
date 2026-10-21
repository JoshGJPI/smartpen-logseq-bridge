/**
 * Tests for electron/tags-sidecar.cjs: reading `_tags.json` (missing, corrupt,
 * newer) and applying a per-page patch, as main.cjs does inside its tags lock.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseTagsFile, applyTagsPatch, serializeTagsFile, emptyTagsFile, TAG_SHAPE } =
  require('../../../electron/tags-sidecar.cjs');

// main.cjs's own guards, reproduced: canonical book keys, page id + one letter.
const guards = {
  requireBookKey(book) {
    const s = String(book);
    if (!/^\d+(?:v([2-9]|[1-9]\d+))?$/.test(s)) throw new Error(`Invalid book: ${book}`);
    return s;
  },
  requirePageId(page) {
    const s = String(page);
    if (!/^\d+[a-zA-Z]?$/.test(s)) throw new Error(`Invalid page id: ${page}`);
    return s;
  }
};

describe('parseTagsFile', () => {
  it('a missing file is empty', () => {
    expect(parseTagsFile(null)).toEqual({ file: emptyTagsFile(), state: 'missing' });
  });

  it('a corrupt file reads as empty', () => {
    expect(parseTagsFile('{ nope').state).toBe('corrupt');
    expect(parseTagsFile('[]').state).toBe('corrupt');
    expect(parseTagsFile('null').file).toEqual(emptyTagsFile());
  });

  it('keeps unknown fields and fixes wrongly shaped sections', () => {
    const { file, state } = parseTagsFile(JSON.stringify({ version: 1, pages: [], dismissed: { '1/1': ['a'] }, note: 'x' }));
    expect(state).toBe('ok');
    expect(file).toEqual({ version: 1, pages: {}, dismissed: { '1/1': ['a'] }, note: 'x' });
  });

  it('flags a file from a newer version', () => {
    const { file, state } = parseTagsFile(JSON.stringify({ version: 2, pages: { '1/1': ['a'] } }));
    expect(state).toBe('newer');
    expect(file.pages).toEqual({ '1/1': ['a'] });
  });
});

describe('applyTagsPatch', () => {
  const file = { version: 1, pages: { '388/1': ['beam'], '388/2': ['roof'] }, dismissed: {}, note: 'kept' };

  it('sets and removes per page, leaving other pages and fields alone', () => {
    const next = applyTagsPatch(file, {
      pages: { '388v2/151b': ['P2026-141', 'beam'], '388/2': null, '388/1': [] },
      dismissed: { '388v2/151b': ['2327-018'] }
    }, guards);
    expect(next).toEqual({
      version: 1,
      pages: { '388v2/151b': ['P2026-141', 'beam'] },
      dismissed: { '388v2/151b': ['2327-018'] },
      note: 'kept'
    });
    expect(file.pages['388/1']).toEqual(['beam']); // input untouched
  });

  it('two patches to different pages both survive (read-merge-write)', () => {
    const a = applyTagsPatch(file, { pages: { '388/3': ['x'] } }, guards);
    const b = applyTagsPatch(a, { pages: { '388/4': ['y'] } }, guards);
    expect(Object.keys(b.pages).sort()).toEqual(['388/1', '388/2', '388/3', '388/4']);
  });

  it('rejects the whole patch on any bad key or tag', () => {
    expect(() => applyTagsPatch(file, { pages: { '388/9': ['ok'], '388v1/1': ['x'] } }, guards)).toThrow(/Invalid book/);
    expect(() => applyTagsPatch(file, { pages: { '../etc/1': ['x'] } }, guards)).toThrow();
    expect(() => applyTagsPatch(file, { pages: { '388/1': ['Not Normalized'] } }, guards)).toThrow(/Invalid tag/);
    expect(() => applyTagsPatch(file, { pages: { '388/1': 'beam' } }, guards)).toThrow(/Invalid tag list/);
    expect(() => applyTagsPatch(file, { pages: { '388/1': Array(201).fill('a') } }, guards)).toThrow(/Too many/);
    expect(() => applyTagsPatch(file, null, guards)).toThrow();
    expect(() => applyTagsPatch(file, { pages: [] }, guards)).toThrow();
  });

  it('de-duplicates a list', () => {
    expect(applyTagsPatch(file, { pages: { '388/1': ['a', 'a'] } }, guards).pages['388/1']).toEqual(['a']);
  });

  it('accepts exactly the normalized tag shapes', () => {
    for (const t of ['P2026-141', '2327-018', 'beam', 'site-visit', 'roof_framing', 'a'.repeat(40)]) {
      expect(TAG_SHAPE.test(t)).toBe(true);
    }
    for (const t of ['Beam', 'a b', '', 'a'.repeat(41), '[[x]]']) {
      expect(TAG_SHAPE.test(t)).toBe(false);
    }
  });

  it('serializes as JSON that reads back', () => {
    const next = applyTagsPatch(emptyTagsFile(), { pages: { '1/1': ['a'] } }, guards);
    expect(parseTagsFile(serializeTagsFile(next))).toEqual({ file: next, state: 'ok' });
  });
});
