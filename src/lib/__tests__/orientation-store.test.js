/**
 * Tests for the page-orientation store (stores/orientation.js): loading the
 * `_orientation.json` sidecar through the IPC facade, and setting a rotation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getOrientation: vi.fn(),
  setOrientation: vi.fn(),
}));

import { getOrientation, setOrientation } from '$lib/storage/local-store.js';
import { pageOrientations, loadOrientations, setPageRotation } from '$stores/orientation.js';

beforeEach(() => {
  vi.mocked(getOrientation).mockReset();
  vi.mocked(setOrientation).mockReset();
  pageOrientations.set({});
});

describe('loadOrientations', () => {
  it('normalises what the sidecar holds', async () => {
    vi.mocked(getOrientation).mockResolvedValue({ version: 1, pages: { '388v2/151b': 90, '388/1': 33 } });
    await loadOrientations();
    expect(get(pageOrientations)).toEqual({ '388v2/151b': 90 });
  });

  it('a missing data folder or unreadable sidecar leaves every page portrait', async () => {
    pageOrientations.set({ '388/1': 90 });
    vi.mocked(getOrientation).mockRejectedValue(new Error('No data folder selected.'));
    expect(await loadOrientations()).toBe(false);
    expect(get(pageOrientations)).toEqual({});

    vi.mocked(getOrientation).mockResolvedValue('garbage');
    await loadOrientations();
    expect(get(pageOrientations)).toEqual({});
  });
});

describe('setPageRotation', () => {
  it('applies at once and persists by book key and page id', async () => {
    vi.mocked(setOrientation).mockImplementation(async (b, p, r) => ({ version: 1, pages: { [`${b}/${p}`]: r } }));
    const pending = setPageRotation('388v2', '151b', 270);
    expect(get(pageOrientations)).toEqual({ '388v2/151b': 270 });
    expect(await pending).toBe(true);
    expect(setOrientation).toHaveBeenCalledWith('388v2', '151b', 270);
  });

  it('portrait clears the entry', async () => {
    pageOrientations.set({ '388/4': 90 });
    vi.mocked(setOrientation).mockResolvedValue({ version: 1, pages: {} });
    await setPageRotation('388', 4, 0);
    expect(get(pageOrientations)).toEqual({});
  });

  it('rolls back when the write fails', async () => {
    pageOrientations.set({ '388/4': 90 });
    vi.mocked(setOrientation).mockRejectedValue(new Error('disk full'));
    expect(await setPageRotation('388', '4', 180)).toBe(false);
    expect(get(pageOrientations)).toEqual({ '388/4': 90 });
  });

  it('refuses keys that are not pages', async () => {
    expect(await setPageRotation('388v1', '4', 90)).toBe(false);
    expect(await setPageRotation('388', '../x', 90)).toBe(false);
    expect(setOrientation).not.toHaveBeenCalled();
  });
});
