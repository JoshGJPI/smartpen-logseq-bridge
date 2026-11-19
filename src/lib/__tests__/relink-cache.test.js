/**
 * Tests for electron/relink-cache.cjs (v3.21.0, spec B.5): Relink's MyScript
 * runs in <userData>/relink-cache/<bookKey>/<pageId>.json, never in the data
 * folder; get / put / drop; bad keys refused; a corrupt entry reads as a miss.
 * Whether an entry still fits the page is lib/relink.js cachedRunValid
 * (relink.test.js, and relink-store.test.js for the invalidation in use).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cache = require('../../../electron/relink-cache.cjs');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relink-cache-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const entry = { revision: '2026-07-02T15:00:00.000Z', originNcodeY: 10, sent: ['s1'], lines: [{ text: 'a', yBounds: { minY: 1, maxY: 2 } }] };

describe('relink-cache', () => {
  it('stores one entry per page under <userData>/relink-cache/<bookKey>/<pageId>.json', () => {
    expect(cache.handle(dir, 'get', '3017', '123')).toBeNull();
    expect(cache.handle(dir, 'put', '3017', '123', entry)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'relink-cache', '3017', '123.json'))).toBe(true);
    expect(cache.handle(dir, 'get', '3017', '123')).toEqual(entry);
    cache.handle(dir, 'put', '390v2', '151b', { ...entry, revision: 'r2' });
    expect(fs.existsSync(path.join(dir, 'relink-cache', '390v2', '151b.json'))).toBe(true);
    // No temp files left behind.
    expect(fs.readdirSync(path.join(dir, 'relink-cache', '3017'))).toEqual(['123.json']);
  });

  it('put replaces, drop removes', () => {
    cache.handle(dir, 'put', '3017', '123', entry);
    cache.handle(dir, 'put', '3017', '123', { ...entry, revision: 'r2' });
    expect(cache.handle(dir, 'get', '3017', '123').revision).toBe('r2');
    expect(cache.handle(dir, 'drop', '3017', '123')).toBe(true);
    expect(cache.handle(dir, 'get', '3017', '123')).toBeNull();
    expect(cache.handle(dir, 'drop', '3017', '123')).toBe(false);
  });

  it('refuses bad keys, entries without a revision and unknown actions', () => {
    expect(() => cache.handle(dir, 'get', '../x', '1')).toThrow(/book key/);
    expect(() => cache.handle(dir, 'get', '3017', '1/../2')).toThrow(/page id/);
    expect(() => cache.handle(dir, 'put', '3017', '1', { lines: [] })).toThrow(/revision/);
    expect(() => cache.handle(dir, 'zap', '3017', '1')).toThrow(/Unknown/);
  });

  it('reads a corrupt entry as a miss', () => {
    const file = cache.entryFile(dir, '3017', '9');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(cache.handle(dir, 'get', '3017', '9')).toBeNull();
  });
});
