/**
 * Clipboard Store - Manages copied strokes
 * Provides simple copy/paste functionality for strokes
 */
import { writable, derived } from 'svelte/store';

/**
 * Clipboard strokes - copied stroke data
 */
export const clipboardStrokes = writable([]);

/**
 * Whether clipboard has content
 */
export const hasClipboardContent = derived(
  clipboardStrokes,
  $strokes => $strokes.length > 0
);

/**
 * Copy strokes to clipboard
 * Deep clones to avoid mutation issues
 * @param {Array} strokes - Strokes to copy
 */
export function copyToClipboard(strokes) {
  if (!strokes || strokes.length === 0) return;
  
  // Deep clone to avoid mutation
  const cloned = strokes.map(stroke => ({
    ...stroke,
    pageInfo: stroke.pageInfo ? { ...stroke.pageInfo } : null,
    dotArray: stroke.dotArray ? stroke.dotArray.map(dot => ({ ...dot })) : []
  }));
  
  clipboardStrokes.set(cloned);
  
  console.log('📋 Copied', cloned.length, 'strokes to clipboard');
}

/**
 * Clear clipboard
 */
export function clearClipboard() {
  clipboardStrokes.set([]);
}
