/**
 * lib/viewer/thumbs.js (reading-first package E): thumbnails without the
 * reader's page cache.
 *
 * What matters: a page already in the page cache is not re-read and not bumped;
 * other pages are read once, at most `concurrency` at a time; only the SVG is
 * kept, in a bounded LRU; a failed read gives '' and never throws.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/storage/local-store.js', () => ({ getPage: vi.fn(async () => null) }));

import { createThumbLoader } from '$lib/viewer/thumbs.js';

function deferredReader() {
  const pending = [];
  const read = vi.fn((book, pageId) => new Promise((resolve) => pending.push({ book, pageId, resolve })));
  return { read, pending };
}
const render = (strokes, rot) => `svg:${strokes.length}@${rot}`;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createThumbLoader', () => {
  it('uses a page-cache doc without reading', async () => {
    const read = vi.fn();
    const peek = vi.fn(() => ({ strokes: [1, 2] }));
    const t = createThumbLoader({ read, peek, render });
    expect(await t.get('388', '1')).toBe('svg:2@0');
    expect(read).not.toHaveBeenCalled();
    expect(t.stats.peeks).toBe(1);
  });

  it('reads once per page and rotation; concurrent asks share the read', async () => {
    const { read, pending } = deferredReader();
    const t = createThumbLoader({ read, render });
    const a = t.get('388', '151b');
    const b = t.get('388', '151b');
    expect(read).toHaveBeenCalledTimes(1);
    pending[0].resolve({ strokes: [1] });
    expect(await a).toBe('svg:1@0');
    expect(await b).toBe('svg:1@0');
    expect(await t.get('388', '151b')).toBe('svg:1@0');
    expect(read).toHaveBeenCalledTimes(1);
    expect(t.peekSvg('388', '151b')).toBe('svg:1@0');
    expect(t.peekSvg('388', '151')).toBe(null);
  });

  it('a different rotation is a different thumbnail', async () => {
    const read = vi.fn(async () => ({ strokes: [] }));
    const t = createThumbLoader({ read, render });
    await t.get('1', '1', 0);
    expect(await t.get('1', '1', 90)).toBe('svg:0@90');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('runs at most `concurrency` reads at once', async () => {
    const { read, pending } = deferredReader();
    const t = createThumbLoader({ read, render, concurrency: 2 });
    const all = ['1', '2', '3', '4'].map((p) => t.get('9', p));
    expect(read).toHaveBeenCalledTimes(2);
    pending[0].resolve({ strokes: [] });
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    pending[1].resolve(null);
    pending[2].resolve(null);
    await flush();
    pending[3].resolve(null);
    expect(await Promise.all(all)).toEqual(['svg:0@0', 'svg:0@0', 'svg:0@0', 'svg:0@0']);
  });

  it('keeps at most maxEntries SVGs, least recently used out first', async () => {
    const read = vi.fn(async () => ({ strokes: [] }));
    const t = createThumbLoader({ read, render, maxEntries: 2 });
    await t.get('1', 'a');
    await t.get('1', 'b');
    await t.get('1', 'a'); // bump a
    await t.get('1', 'c'); // evicts b
    expect(t.size()).toBe(2);
    expect(t.peekSvg('1', 'b')).toBe(null);
    expect(t.peekSvg('1', 'a')).not.toBe(null);
    t.clear();
    expect(t.size()).toBe(0);
  });

  it('a failed read resolves to "" and the next ask retries', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('gone')).mockResolvedValue({ strokes: [1] });
    const t = createThumbLoader({ read, render });
    expect(await t.get('1', '1')).toBe('');
    expect(await t.get('1', '1')).toBe('svg:1@0');
  });
});
