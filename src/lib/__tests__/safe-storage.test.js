/**
 * lib/safe-storage.js and the stores that read localStorage at module load
 * (page-order, page-scale): a corrupt, wrong-shaped or blocked value falls
 * back instead of throwing while the app starts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readJson, readString, write, remove, isPlainObject } from '$lib/safe-storage.js';
import { modalOpen } from '$lib/left-panel.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('safe-storage', () => {
  it('reads JSON, falls back on missing, corrupt or rejected values', () => {
    expect(readJson('k', { a: 1 })).toEqual({ a: 1 });
    localStorage.setItem('k', '{"b":2}');
    expect(readJson('k', {})).toEqual({ b: 2 });
    localStorage.setItem('k', '{not json');
    expect(readJson('k', 'fb')).toBe('fb');
    localStorage.setItem('k', '[1,2]');
    expect(readJson('k', {}, isPlainObject)).toEqual({});
    localStorage.setItem('k', 'null');
    expect(readJson('k', {}, isPlainObject)).toEqual({});
  });

  it('never throws when storage is blocked', () => {
    const spies = ['getItem', 'setItem', 'removeItem'].map((m) =>
      vi.spyOn(Storage.prototype, m).mockImplementation(() => { throw new Error('blocked'); }));
    expect(readJson('k', 7)).toBe(7);
    expect(readString('k')).toBe(null);
    expect(() => write('k', { a: 1 })).not.toThrow();
    expect(() => remove('k')).not.toThrow();
    spies.forEach((s) => s.mockRestore());
  });

  it('writes strings as-is and anything else as JSON', () => {
    write('s', 'true');
    write('o', { a: 1 });
    expect(localStorage.getItem('s')).toBe('true');
    expect(localStorage.getItem('o')).toBe('{"a":1}');
    remove('s');
    expect(localStorage.getItem('s')).toBe(null);
  });
});

describe('stores reading localStorage at load', () => {
  it('page-order and page-scale load with corrupt values', async () => {
    localStorage.setItem('pagePositions', '{corrupt');
    localStorage.setItem('pageScales', '"a string"');
    vi.resetModules();
    const { get } = await import('svelte/store');
    const order = await import('../../stores/page-order.js');
    const scale = await import('../../stores/page-scale.js');
    expect(get(order.pagePositions)).toEqual({});
    expect(get(scale.pageScales)).toEqual({});
  });
});

describe('modalOpen', () => {
  it('true only while an aria-modal element is in the document', () => {
    expect(modalOpen()).toBe(false);
    const d = document.createElement('div');
    d.setAttribute('aria-modal', 'true');
    document.body.appendChild(d);
    expect(modalOpen()).toBe(true);
    d.remove();
    expect(modalOpen()).toBe(false);
    expect(modalOpen(null)).toBe(false);
  });
});
