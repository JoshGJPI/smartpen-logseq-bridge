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

describe('info (v3.22.0)', () => {
  const file = {
    version: 1, pages: { '388/1': ['tom'] }, dismissed: {}, blocks: { kept: true },
    info: { tom: { type: 'person', label: 'Tom' }, framing: { aliases: ['framed'] } }
  };

  it('sets and removes records in the same patch as page lists, keeping unknown fields', () => {
    const next = applyTagsPatch(file, {
      pages: { '388/2': ['tom-b'], '388/1': null },
      info: { 'tom-b': { type: 'person', label: 'Tom', aliases: ['Thomas'] }, tom: null }
    }, guards);
    expect(next).toEqual({
      version: 1,
      pages: { '388/2': ['tom-b'] },
      dismissed: {},
      blocks: { kept: true },
      info: { framing: { aliases: ['framed'] }, 'tom-b': { type: 'person', label: 'Tom', aliases: ['Thomas'] } }
    });
    expect(file.info.tom).toBeDefined();   // input untouched
  });

  it('a patch without info leaves the info section exactly as it was', () => {
    const next = applyTagsPatch(file, { pages: { '388/3': ['beam'] } }, guards);
    expect(next.info).toBe(file.info);
    expect('info' in applyTagsPatch(emptyTagsFile(), { pages: { '388/3': ['beam'] } }, guards)).toBe(false);
  });

  it('creates the section on a file that has none; an empty record removes', () => {
    const next = applyTagsPatch(emptyTagsFile(), { info: { tom: { type: 'person' }, x: {} } }, guards);
    expect(next.info).toEqual({ tom: { type: 'person' } });
  });

  it('a file whose info is not an object is replaced by the patched records', () => {
    const next = applyTagsPatch({ ...emptyTagsFile(), info: 'junk' }, { info: { tom: { label: 'Tom' } } }, guards);
    expect(next.info).toEqual({ tom: { label: 'Tom' } });
  });

  it('rejects the whole patch on a bad info key, shape or type, writing nothing', () => {
    const bad = [
      { info: { Tom: { label: 'Tom' } } },                         // key not normalized
      { info: { '../x': null } },
      { info: { tom: 'Tom' } },
      { info: { tom: ['person'] } },
      { info: { tom: { label: { nested: 1 } } } },
      { info: { tom: { aliases: [1, 2] } } },
      { info: { tom: { type: 'company' } } },                      // only person is stored
      { info: { '5444-006': { type: 'person' } } },                // a project's type is the pattern
      { info: { 'P2026-141': { type: 'person' } } },
      { info: { tom: { label: 'x'.repeat(1001) } } },
      { info: [] },
      { pages: { '388/1': ['ok'] }, info: { BAD: null } }           // a good page list does not go through alone
    ];
    for (const patch of bad) expect(() => applyTagsPatch(file, patch, guards), JSON.stringify(patch)).toThrow();
  });

  it('parseTagsFile keeps an info section untouched, and a 3.21-style patch never drops it', () => {
    const { file: read } = parseTagsFile(serializeTagsFile(file));
    expect(read.info).toEqual(file.info);
    const next = applyTagsPatch(read, { pages: { '388/1': ['tom', 'beam'] }, dismissed: {} }, guards);
    expect(next.info).toEqual(file.info);
    expect(next.blocks).toEqual({ kept: true });
  });
});

describe('info under the tags lock (v3.22.0)', () => {
  // main.cjs storage:patchTags, reproduced over an in-memory file: read, apply, write, inside one lock.
  const { createLock } = require('../../../electron/page-store.cjs');

  it('an info patch and a page patch sent together both land', async () => {
    let disk = serializeTagsFile({ version: 1, pages: { '388/1': ['tom'] }, dismissed: {} });
    const withTagsLock = createLock();
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const patchTags = (patch) => withTagsLock(async () => {
      const { file } = parseTagsFile(disk);
      await tick();   // the read and the write are apart, as they are on disk
      const next = applyTagsPatch(file, patch, guards);
      await tick();
      disk = serializeTagsFile(next);
    });
    await Promise.all([
      patchTags({ info: { tom: { type: 'person', label: 'Tom' } } }),
      patchTags({ pages: { '388/2': ['beam'] } }),
      patchTags({ info: { beam: { aliases: ['girder'] } } })
    ]);
    const { file } = parseTagsFile(disk);
    expect(file.pages).toEqual({ '388/1': ['tom'], '388/2': ['beam'] });
    expect(file.info).toEqual({ tom: { type: 'person', label: 'Tom' }, beam: { aliases: ['girder'] } });
  });
});

describe('info: a keyword that only ends like a number (v3.22.0)', () => {
  it('may be a person; only a whole project number may not', () => {
    const next = applyTagsPatch(emptyTagsFile(), { info: { 'x1234-567': { type: 'person' } } }, guards);
    expect(next.info).toEqual({ 'x1234-567': { type: 'person' } });
  });
});
