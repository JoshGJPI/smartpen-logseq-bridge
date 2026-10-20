/**
 * Page Order Store - Manages custom spatial positioning of pages on canvas
 * Each page can be positioned anywhere with X,Y coordinates
 * Persists to localStorage so layout survives page refreshes
 */
import { writable, get } from 'svelte/store';
import { readJson, readString, write, remove, isPlainObject } from '../lib/safe-storage.js';

// Map of pageKey -> {x, y} positions in Ncode space. A missing, corrupt or
// blocked value means "no custom positions"; it must never stop the app loading.
export const pagePositions = writable(readJson('pagePositions', {}, isPlainObject));

// Flag to indicate if custom positioning is active
export const useCustomPositions = writable(readString('useCustomPositions') === 'true');

// Subscribe to changes and persist to localStorage
pagePositions.subscribe(positions => write('pagePositions', positions));

useCustomPositions.subscribe(value => write('useCustomPositions', String(value)));

/**
 * Set position for a specific page
 * @param {string} pageKey - Page identifier (S#/O#/B#/P#)
 * @param {number} x - X position in Ncode space
 * @param {number} y - Y position in Ncode space
 */
export function setPagePosition(pageKey, x, y) {
  pagePositions.update(positions => ({
    ...positions,
    [pageKey]: { x, y }
  }));
  useCustomPositions.set(true);
}

/**
 * Move a page by delta amounts
 * @param {string} pageKey - Page identifier
 * @param {number} deltaX - Change in X position
 * @param {number} deltaY - Change in Y position
 */
export function movePageBy(pageKey, deltaX, deltaY) {
  pagePositions.update(positions => {
    const current = positions[pageKey] || { x: 0, y: 0 };
    return {
      ...positions,
      [pageKey]: {
        x: current.x + deltaX,
        y: current.y + deltaY
      }
    };
  });
  useCustomPositions.set(true);
}

/**
 * Clear all custom positioning data
 */
export function clearPagePositions() {
  pagePositions.set({});
  useCustomPositions.set(false);
  remove('pagePositions');
  remove('useCustomPositions');
}

