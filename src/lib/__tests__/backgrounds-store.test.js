/**
 * Tests for stores/backgrounds.js — resolving the paper behind a page.
 *
 * What matters: a missing or broken background must read as "no background" and
 * never as an error inside a render; volumes and letter-suffixed pages share their
 * parent's paper; and a book's manifest / a page's image is fetched once, not once
 * per card that shows it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  listBackgrounds: vi.fn(),
  getBackgroundManifest: vi.fn(),
  getBackgroundImage: vi.fn()
}));

import {
  listBackgrounds,
  getBackgroundManifest,
  getBackgroundImage
} from '$lib/storage/local-store.js';
import {
  backgroundsEnabled,
  setBackgroundsEnabled,
  toggleBackgrounds,
  installedBackgrounds,
  backgroundsAvailable,
  resolvePageBackground,
  refreshBackgrounds
} from '$stores/backgrounds.js';

const FRAME = { x0: 3.5, y0: 3.5, x1: 94.6, y1: 121.6 };
const manifest = (over = {}) => ({
  version: 1, source: 'neo', sob: '3_27_388', title: 'COLLEGE_Mint',
  frame: FRAME, firstPage: 1, lastPage: 144, ext: 'jpg', ...over
});
const bytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

let urlCounter;
beforeEach(async () => {
  vi.clearAllMocks();
  urlCounter = 0;
  globalThis.URL.createObjectURL = vi.fn(() => `blob:page-${++urlCounter}`);
  getBackgroundManifest.mockResolvedValue(manifest());
  getBackgroundImage.mockResolvedValue(bytes());
  listBackgrounds.mockResolvedValue([]);
  await refreshBackgrounds();          // also empties the module-level caches
  vi.clearAllMocks();
});

describe('resolvePageBackground', () => {
  it('returns the frame and an object URL for a covered page', async () => {
    const bg = await resolvePageBackground('388', '11');
    expect(bg).toEqual({ frame: FRAME, url: 'blob:page-1', title: 'COLLEGE_Mint' });
    expect(getBackgroundImage).toHaveBeenCalledWith(388, 11);
  });

  it('gives a volume the paper of its NCode book', async () => {
    const bg = await resolvePageBackground('388v2', '11');
    expect(bg?.frame).toEqual(FRAME);
    expect(getBackgroundManifest).toHaveBeenCalledWith(388);
  });

  it('gives a letter-suffixed page its integer page\'s paper', async () => {
    await resolvePageBackground('388', '141b');
    expect(getBackgroundImage).toHaveBeenCalledWith(388, 141);
  });

  it('is null for a book with no manifest, without asking for an image', async () => {
    getBackgroundManifest.mockResolvedValue(null);
    expect(await resolvePageBackground('553', '1')).toBeNull();
    expect(getBackgroundImage).not.toHaveBeenCalled();
  });

  it('is null for a page outside the manifest\'s range, without asking for an image', async () => {
    expect(await resolvePageBackground('388', '145')).toBeNull();
    expect(await resolvePageBackground('388', '0')).toBeNull();
    expect(getBackgroundImage).not.toHaveBeenCalled();
  });

  it('is null when the page has no image on disk', async () => {
    getBackgroundImage.mockResolvedValue(null);
    expect(await resolvePageBackground('388', '5')).toBeNull();
  });

  it('is null for an empty image', async () => {
    getBackgroundImage.mockResolvedValue(new Uint8Array(0));
    expect(await resolvePageBackground('388', '5')).toBeNull();
  });

  it.each([['not-a-key', '1'], ['388', 'x'], [null, '1'], ['388', null]])(
    'is null, not a throw, for unusable ids (%j, %j)',
    async (book, page) => {
      expect(await resolvePageBackground(book, page)).toBeNull();
    }
  );

  it('treats a manifest that fails validation as no background', async () => {
    getBackgroundManifest.mockResolvedValue({ frame: { x0: 1, y0: 1, x1: 1, y1: 1 }, firstPage: 1, lastPage: 9 });
    expect(await resolvePageBackground('388', '1')).toBeNull();
  });

  it('never throws when the backend does', async () => {
    getBackgroundManifest.mockRejectedValue(new Error('boom'));
    expect(await resolvePageBackground('388', '1')).toBeNull();
  });

  it('does not cache a failed image read, so the next look retries', async () => {
    getBackgroundImage.mockRejectedValueOnce(new Error('transient'));
    expect(await resolvePageBackground('388', '7')).toBeNull();
    expect((await resolvePageBackground('388', '7'))?.url).toMatch(/^blob:/);
    expect(getBackgroundImage).toHaveBeenCalledTimes(2);
  });
});

describe('caching', () => {
  it('reads a book\'s manifest once however many pages ask', async () => {
    await Promise.all([resolvePageBackground('388', '1'), resolvePageBackground('388', '2'), resolvePageBackground('388v2', '3')]);
    expect(getBackgroundManifest).toHaveBeenCalledTimes(1);
  });

  it('reads a page\'s image once however many cards show it', async () => {
    const [a, b] = await Promise.all([resolvePageBackground('388', '9'), resolvePageBackground('388', '9')]);
    expect(getBackgroundImage).toHaveBeenCalledTimes(1);
    expect(a.url).toBe(b.url);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shares one image between a page and its volume-2 twin', async () => {
    const a = await resolvePageBackground('388', '9');
    const b = await resolvePageBackground('388v2', '9');
    expect(a.url).toBe(b.url);
  });

  it('forgets everything on refresh, so a re-import is noticed', async () => {
    await resolvePageBackground('388', '9');
    await refreshBackgrounds();
    await resolvePageBackground('388', '9');
    expect(getBackgroundManifest).toHaveBeenCalledTimes(2);
    expect(getBackgroundImage).toHaveBeenCalledTimes(2);
  });
});

describe('refreshBackgrounds / availability', () => {
  it('lists installed books, sorted, from validated manifests', async () => {
    listBackgrounds.mockResolvedValue([
      { book: '3017', manifest: manifest({ title: 'LAMY digital paper', lastPage: 192 }) },
      { book: '388', manifest: manifest() },
      { book: '999', manifest: { frame: null } }            // invalid: skipped
    ]);
    const list = await refreshBackgrounds();
    expect(list.map((b) => b.book)).toEqual(['388', '3017']);
    expect(get(installedBackgrounds)[1]).toMatchObject({ title: 'LAMY digital paper', lastPage: 192 });
    expect(get(backgroundsAvailable)).toBe(true);
  });

  it('is unavailable, not an error, when the scan fails', async () => {
    listBackgrounds.mockRejectedValue(new Error('No data folder selected'));
    expect(await refreshBackgrounds()).toEqual([]);
    expect(get(backgroundsAvailable)).toBe(false);
  });

  it('is unavailable when nothing is installed', async () => {
    listBackgrounds.mockResolvedValue([]);
    await refreshBackgrounds();
    expect(get(backgroundsAvailable)).toBe(false);
  });
});

describe('enabled preference', () => {
  it('persists and toggles', () => {
    setBackgroundsEnabled(false);
    expect(get(backgroundsEnabled)).toBe(false);
    expect(localStorage.getItem('smartpen-page-backgrounds')).toBe('0');
    toggleBackgrounds();
    expect(get(backgroundsEnabled)).toBe(true);
    expect(localStorage.getItem('smartpen-page-backgrounds')).toBe('1');
  });
});
