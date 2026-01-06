/**
 * Page Order Store - Manages custom spatial positioning of pages on canvas
 * Each page can be positioned anywhere with X,Y coordinates
 * Persists to localStorage so layout survives page refreshes
 */
import { writable, get } from 'svelte/store';

// Load saved positions from localStorage
const savedPositions = localStorage.getItem('pagePositions');

// Map of pageKey -> {x, y} positions in Ncode space
export const pagePositions = writable(
  savedPositions ? JSON.parse(savedPositions) : {}
);

// Flag to indicate if custom positioning is active
export const useCustomPositions = writable(
  localStorage.getItem('useCustomPositions') === 'true'
);

// Subscribe to changes and persist to localStorage
pagePositions.subscribe(positions => {
  localStorage.setItem('pagePositions', JSON.stringify(positions));
});

useCustomPositions.subscribe(value => {
  localStorage.setItem('useCustomPositions', value.toString());
});

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
 * Get position for a specific page
 * @param {string} pageKey - Page identifier
 * @returns {{x: number, y: number}|null} Position or null if not set
 */
export function getPagePosition(pageKey) {
  const positions = get(pagePositions);
  return positions[pageKey] || null;
}

/**
 * Reset to automatic horizontal layout
 */
export function resetPagePositions() {
  useCustomPositions.set(false);
  // Keep the positions data but disable custom positioning
}

/**
 * Clear all custom positioning data
 */
export function clearPagePositions() {
  pagePositions.set({});
  useCustomPositions.set(false);
  localStorage.removeItem('pagePositions');
  localStorage.removeItem('useCustomPositions');
}

/**
 * Auto-arrange pages in a grid layout
 * @param {Array<string>} pageKeys - Array of page keys to arrange
 * @param {number} columns - Number of columns (default: 3)
 * @param {number} spacing - Spacing between pages in Ncode units (default: 1000)
 */
export function autoArrangePages(pageKeys, columns = 3, spacing = 1000) {
  const positions = {};
  
  pageKeys.forEach((pageKey, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    
    positions[pageKey] = {
      x: col * spacing,
      y: row * spacing
    };
  });
  
  pagePositions.set(positions);
  useCustomPositions.set(true);
}
