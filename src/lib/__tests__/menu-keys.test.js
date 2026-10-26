/**
 * Tests for menu-keys.js, and for the contract it relies on: a menu's
 * capture-phase window listener runs before the bubble-phase listeners of the
 * views behind it, which stand down on defaultPrevented. Run with the real
 * reader helper (pageTurnKey), so ←/→ under an open ⋯ menu no longer turn
 * the page (T8) and Escape in the bulk bar's menu no longer leaves Select (G2).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { menuKeyAction, menuFocusIndex } from '../menu-keys.js';
import { pageTurnKey } from '../viewer/page-reader.js';

describe('menuKeyAction', () => {
  it('handles nothing while the menu is closed', () => {
    for (const key of ['Escape', 'ArrowLeft', 'ArrowDown']) expect(menuKeyAction({ key }, false)).toBeNull();
  });
  it('maps keys while open', () => {
    expect(menuKeyAction({ key: 'Escape' }, true)).toBe('close');
    expect(menuKeyAction({ key: 'ArrowDown' }, true)).toBe('next');
    expect(menuKeyAction({ key: 'ArrowUp' }, true)).toBe('prev');
    expect(menuKeyAction({ key: 'Home' }, true)).toBe('first');
    expect(menuKeyAction({ key: 'End' }, true)).toBe('last');
    expect(menuKeyAction({ key: 'ArrowLeft' }, true)).toBe('swallow');
    expect(menuKeyAction({ key: 'ArrowRight' }, true)).toBe('swallow');
    expect(menuKeyAction({ key: 'a' }, true)).toBeNull();
    expect(menuKeyAction({ key: 'Escape', isComposing: true }, true)).toBeNull();
  });
});

describe('menuFocusIndex', () => {
  it('wraps and starts from the ends when nothing is focused', () => {
    expect(menuFocusIndex(-1, 3, 'next')).toBe(0);
    expect(menuFocusIndex(-1, 3, 'prev')).toBe(2);
    expect(menuFocusIndex(2, 3, 'next')).toBe(0);
    expect(menuFocusIndex(0, 3, 'prev')).toBe(2);
    expect(menuFocusIndex(1, 3, 'first')).toBe(0);
    expect(menuFocusIndex(1, 3, 'last')).toBe(2);
    expect(menuFocusIndex(0, 0, 'next')).toBe(-1);
  });
});

describe('a menu in the capture phase keeps its keys from the view behind', () => {
  const cleanup = [];
  const listen = (type, fn, capture) => {
    window.addEventListener(type, fn, capture);
    cleanup.push(() => window.removeEventListener(type, fn, capture));
  };
  afterEach(() => { while (cleanup.length) cleanup.pop()(); document.body.innerHTML = ''; });

  function setup(menuOpen) {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const seen = { turn: null, leftSelect: false };
    // The view behind, registered FIRST (as a parent's svelte:window is), bubble phase.
    listen('keydown', (e) => {
      seen.turn = pageTurnKey(e);
      if (e.key === 'Escape' && !e.defaultPrevented) seen.leftSelect = true; // PageGrid / BookViewer
    }, false);
    // The menu, capture phase.
    listen('keydown', (e) => { if (menuKeyAction(e, menuOpen)) e.preventDefault(); }, true);
    return { btn, seen };
  }
  const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it('T8: → on an open ⋯ menu does not turn the page', () => {
    const { btn, seen } = setup(true);
    press(btn, 'ArrowRight');
    expect(seen.turn).toBeNull();
  });

  it('G2 / T9: Escape closes the menu only; Select and the reader focus stay', () => {
    const { btn, seen } = setup(true);
    press(btn, 'Escape');
    expect(seen.leftSelect).toBe(false);
  });

  it('with the menu closed, the view behind gets its keys as before', () => {
    const { btn, seen } = setup(false);
    press(btn, 'ArrowRight');
    expect(seen.turn).toBe('next');
    press(btn, 'Escape');
    expect(seen.leftSelect).toBe(true);
  });
});
