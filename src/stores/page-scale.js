/**
 * Page Scale Store - Manages per-page display scale factors
 * Non-destructive: scales only affect rendering, not original stroke data
 */
import { writable, derived, get } from 'svelte/store';
import { readJson, write, remove, isPlainObject } from '../lib/safe-storage.js';

// Map of pageKey -> scale factor (default: 1.0)
// Scale range: 0.25 (25%) to 5.0 (500%). A missing, corrupt or blocked value
// means "no custom scales"; it must never stop the app loading.
export const pageScales = writable(readJson('pageScales', {}, isPlainObject));

// Flag to indicate if any pages have custom scales
export const hasScaledPages = derived(
  pageScales,
  $scales => Object.keys($scales).length > 0
);

// Subscribe to changes and persist to localStorage
pageScales.subscribe(scales => write('pageScales', scales));

/**
 * Set scale for a specific page
 * @param {string} pageKey - Page identifier (S#/O#/B#/P#)
 * @param {number} scale - Scale factor (0.25 - 5.0)
 */
export function setPageScale(pageKey, scale) {
  // Clamp to reasonable range
  const clampedScale = Math.max(0.25, Math.min(5.0, scale));
  
  pageScales.update(scales => ({
    ...scales,
    [pageKey]: clampedScale
  }));
}

/**
 * Get scale for a specific page
 * @param {string} pageKey - Page identifier
 * @returns {number} Scale factor (default: 1.0)
 */
export function getPageScale(pageKey) {
  return get(pageScales)[pageKey] || 1.0;
}

/**
 * Reset a specific page to original scale (1.0)
 * @param {string} pageKey - Page identifier
 */
export function resetPageScale(pageKey) {
  pageScales.update(scales => {
    const newScales = { ...scales };
    delete newScales[pageKey];
    return newScales;
  });
}

/**
 * Reset all pages to original scale
 */
export function resetAllPageScales() {
  pageScales.set({});
  remove('pageScales');
}

/**
 * Check if a specific page has a custom scale
 * @param {string} pageKey - Page identifier
 * @returns {boolean} True if page has non-default scale
 */
export function hasCustomScale(pageKey) {
  const scale = get(pageScales)[pageKey];
  return scale !== undefined && scale !== 1.0;
}
