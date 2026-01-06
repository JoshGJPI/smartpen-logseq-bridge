/**
 * Page Order Store - Manages custom ordering of pages in stroke list
 * Persists to localStorage so user's preferred order survives page refreshes
 */
import { writable, get } from 'svelte/store';

// Load saved order from localStorage
const savedOrder = localStorage.getItem('customPageOrder');
const savedUseCustom = localStorage.getItem('useCustomPageOrder');

// Custom page order (array of pageKeys in desired order)
export const customPageOrder = writable(
  savedOrder ? JSON.parse(savedOrder) : []
);

// Flag to indicate if custom order is active (vs auto-sort)
export const useCustomOrder = writable(
  savedUseCustom === 'true' // Convert string to boolean
);

// Subscribe to changes and persist to localStorage
customPageOrder.subscribe(order => {
  localStorage.setItem('customPageOrder', JSON.stringify(order));
});

useCustomOrder.subscribe(value => {
  localStorage.setItem('useCustomPageOrder', value.toString());
});

/**
 * Initialize page order with current pages (called when pages change)
 * @param {Array} pageKeys - Array of page keys in default sort order
 */
export function initializePageOrder(pageKeys) {
  const currentOrder = get(customPageOrder);
  const currentUseCustom = get(useCustomOrder);
  
  // If no custom order exists yet, or if pages have changed significantly
  if (currentOrder.length === 0 || !currentUseCustom) {
    customPageOrder.set(pageKeys);
  } else {
    // Merge new pages with existing order
    // Keep existing order for pages we know about, append new pages at end
    const existingPages = currentOrder.filter(key => pageKeys.includes(key));
    const newPages = pageKeys.filter(key => !currentOrder.includes(key));
    customPageOrder.set([...existingPages, ...newPages]);
  }
}

/**
 * Update page order after drag and drop
 * @param {Array} newOrder - New array of page keys in desired order
 */
export function setPageOrder(newOrder) {
  customPageOrder.set(newOrder);
  useCustomOrder.set(true);
}

/**
 * Reset to automatic sorting (by book and page number)
 */
export function resetPageOrder() {
  useCustomOrder.set(false);
  // Keep the array but disable custom ordering
}

/**
 * Clear all custom ordering data
 */
export function clearPageOrder() {
  customPageOrder.set([]);
  useCustomOrder.set(false);
  localStorage.removeItem('customPageOrder');
  localStorage.removeItem('useCustomPageOrder');
}
