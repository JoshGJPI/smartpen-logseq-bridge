/**
 * Tests for electron/page-store.cjs: the main process's book-key mirror and
 * path guards, the atomic write, the per-file lock, the serializer (against the
 * renderer's copy) and the page-file walk. File tests run against a temp folder,
 * never the real data folder. (extractPageMeta / extractCaptureDays, still in
 * main.cjs, are covered by the MCP's parity tests.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as volumes from '../volumes.js';
import { serializePageDoc as rendererSerialize } from '../storage/page-doc-format.js';

const require = createRequire(import.meta.url);
const store = require('../../../electron/page-store.cjs');

const stroke = (t, extra = {}) => ({ id: `s${t}`, startTime: t, endTime: t + 10, lineId: null, points: [[1, 2, t, 300]], ...extra });

function makeDoc({ strokes = [stroke(1765313505107)], lines = [] } = {}) {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 388, page: 4 },
    metadata: { lastUpdated: '2026-11-01T00:00:00.000Z', totalStrokes: strokes.length },
    transcript: { lastTranscribed: null, lines },
    strokes
  };
}

describe('book keys mirror lib/volumes.js', () => {
  const samples = ['388', '388v2', '388v1', '0388', '388V2', '388v0', '', null, undefined,
    3017, '3017v12', '../388', '388/..', '388v2x', ' 388', '1e3', '0', '0v2'];

  it('parseBookKey agrees on every sample', () => {
    for (const s of samples) expect(store.parseBookKey(s), String(s)).toEqual(volumes.parseBookKey(s));
  });

  it('compareBookKeys agrees, including "388v2" after "3880"', () => {
    const keys = ['3880', '388v2', '388', '12', 'junk', '12v3'];
    expect([...keys].sort(store.compareBookKeys)).toEqual([...keys].sort(volumes.compareBookKeys));
    expect([...keys].sort(store.compareBookKeys)).toEqual(['12', '12v3', '388', '388v2', '3880', 'junk']);
  });
});

describe('path guards', () => {
  it('requireBookKey takes canonical keys only', () => {
    expect(store.requireBookKey(388)).toBe('388');
    expect(store.requireBookKey('388v2')).toBe('388v2');
    for (const bad of ['388v1', '../388', '388\\..', 'B388', '', null, '1e3']) {
      expect(() => store.requireBookKey(bad), String(bad)).toThrow(/Invalid book key/);
    }
  });

  it('requirePageId takes digits plus one letter', () => {
    expect(store.requirePageId(42)).toBe('42');
    expect(store.requirePageId('151b')).toBe('151b');
    for (const bad of ['151bb', '../42', '42.json', '', 'b', '4 2']) {
      expect(() => store.requirePageId(bad), bad).toThrow(/Invalid page id/);
    }
  });

  it('pagePath stays inside <root>/pages', () => {
    const root = path.join(os.tmpdir(), 'x');
    expect(store.pagePath(root, '388v2', '151b')).toBe(path.join(root, 'pages', 'B388v2', 'P151b.json'));
    expect(() => store.pagePath(root, '388', '..')).toThrow();
  });
});

describe('serializePageDoc', () => {
  it('matches the renderer serializer byte for byte', () => {
    const doc = makeDoc({ strokes: [stroke(1), stroke(2, { sketch: true })], lines: [{ id: 'a', text: 'hi', indentLevel: 0, parentId: null, checked: null }] });
    expect(store.serializePageDoc(doc)).toBe(rendererSerialize(doc));
    expect(JSON.parse(store.serializePageDoc(doc))).toEqual(doc);
  });

  it('writes one stroke per line and an empty array when there are none', () => {
    const text = store.serializePageDoc(makeDoc({ strokes: [stroke(1), stroke(2)] }));
    expect(text.match(/\n {4}\{"id":"s\d"/g)).toHaveLength(2);
    expect(JSON.parse(store.serializePageDoc(makeDoc({ strokes: [] }))).strokes).toEqual([]);
  });

  it('an empty shell still serializes to valid JSON (both copies)', () => {
    for (const ser of [store.serializePageDoc, rendererSerialize]) {
      expect(JSON.parse(ser({}))).toEqual({ strokes: [] });
      expect(JSON.parse(ser({ strokes: [stroke(1)] }))).toEqual({ strokes: [stroke(1)] });
    }
  });
});

describe('createLock', () => {
  it('runs updates one at a time, and a failure does not stop the next', async () => {
    const withLock = store.createLock();
    const order = [];
    const slow = (name, ms, fail) => withLock(async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      if (fail) throw new Error(name);
      return name;
    });
    const results = await Promise.allSettled([slow('a', 20), slow('b', 1, true), slow('c', 1)]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('on disk (temp folder)', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-store-test-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  it('writeFileAtomic creates folders, replaces the file and leaves no temp file', async () => {
    const fp = path.join(root, 'a', 'b', 'x.json');
    await store.writeFileAtomic(fp, 'one');
    await store.writeFileAtomic(fp, 'two');
    expect(fs.readFileSync(fp, 'utf8')).toBe('two');
    expect(listDir(path.dirname(fp))).toEqual(['x.json']);
  });

  it('concurrent writes to one file each land whole, with no temp file left', async () => {
    const fp = path.join(root, 'x.json');
    const bodies = Array.from({ length: 8 }, (_, i) => `body-${i}-`.repeat(2000));
    await Promise.all(bodies.map((b) => store.writeFileAtomic(fp, b)));
    expect(bodies).toContain(fs.readFileSync(fp, 'utf8'));
    expect(listDir(root)).toEqual(['x.json']);
  });

  it('a failed write removes its temp file and leaves the target alone', async () => {
    const fp = path.join(root, 'x.json');
    await store.writeFileAtomic(fp, 'keep');
    // A directory where the target should be makes the rename fail.
    const dirTarget = path.join(root, 'd');
    fs.mkdirSync(path.join(dirTarget, 'inner'), { recursive: true });
    await expect(store.writeFileAtomic(dirTarget, 'x')).rejects.toThrow();
    expect(listDir(root).sort()).toEqual(['d', 'x.json']);
    expect(fs.readFileSync(fp, 'utf8')).toBe('keep');
  });

  it('writes, reads and deletes a page; a missing page reads as null', async () => {
    const doc = makeDoc();
    const fp = await store.writePageDoc(root, '388v2', '151b', doc);
    expect(fp).toBe(path.join(root, 'pages', 'B388v2', 'P151b.json'));
    expect(await store.readPageDoc(root, '388v2', '151b')).toEqual(doc);
    await store.deletePageDoc(root, '388v2', '151b');
    expect(await store.readPageDoc(root, '388v2', '151b')).toBeNull();
    await expect(store.deletePageDoc(root, '388v2', '151b')).resolves.toBeUndefined();
  });

  it('refuses a missing document and a bad path before writing', async () => {
    await expect(store.writePageDoc(root, '388', '1', null)).rejects.toThrow(/missing/);
    await expect(store.writePageDoc(root, '../388', '1', makeDoc())).rejects.toThrow(/Invalid book key/);
    expect(listDir(root)).toEqual([]);
  });

  it('walks volume folders and suffixed pages, sorted by book key, ignoring everything else', async () => {
    for (const [b, p] of [['3880', '1'], ['388v2', '2'], ['388', '10'], ['388', '2'], ['388', '2b']]) {
      await store.writePageDoc(root, b, p, makeDoc());
    }
    const pages = path.join(root, 'pages');
    fs.mkdirSync(path.join(pages, 'B388v1'));          // non-canonical: skipped
    fs.writeFileSync(path.join(pages, 'B388v1', 'P1.json'), '{}');
    fs.mkdirSync(path.join(pages, '_backgrounds'));
    fs.writeFileSync(path.join(pages, '_tags.json'), '{}');
    fs.writeFileSync(path.join(pages, 'B388', 'P3.json.tmp-1-abc'), 'partial');
    fs.writeFileSync(path.join(pages, 'B388', 'notes.txt'), '');

    const files = await store.walkPageFiles(root);
    expect(files.map((f) => `${f.book}/${f.pageId}`)).toEqual(['388/2', '388/2b', '388/10', '388v2/2', '3880/1']);
    expect(files[1]).toMatchObject({ page: 2, suffix: 'b' });
  });

});


describe('readSidecarJson', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-test-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads a missing file as null, not corrupt', async () => {
    expect(await store.readSidecarJson(path.join(dir, '_aliases.json'))).toEqual({ parsed: null, corrupt: false });
  });

  it('parses a good file', async () => {
    const file = path.join(dir, '_aliases.json');
    fs.writeFileSync(file, '{"388":"Work"}');
    expect(await store.readSidecarJson(file)).toEqual({ parsed: { 388: 'Work' }, corrupt: false });
  });

  it('reads a corrupt file as empty and leaves it alone on a plain read', async () => {
    const file = path.join(dir, '_aliases.json');
    fs.writeFileSync(file, '{"388": "Wo');
    expect(await store.readSidecarJson(file)).toEqual({ parsed: null, corrupt: true });
    expect(fs.readdirSync(dir)).toEqual(['_aliases.json']);
  });

  it('copies a corrupt file aside before a write replaces it', async () => {
    const file = path.join(dir, '_aliases.json');
    fs.writeFileSync(file, '{"388": "Wo');
    expect(await store.readSidecarJson(file, { forWrite: true })).toEqual({ parsed: null, corrupt: true });
    const copies = fs.readdirSync(dir).filter((f) => f.startsWith('_aliases.json.corrupt-'));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, copies[0]), 'utf8')).toBe('{"388": "Wo');
  });
});
