/**
 * Transcription Store - Manages transcription results from MyScript
 * Supports per-page transcriptions for multi-page/book scenarios
 */
import { writable, derived } from 'svelte/store';
import { setFilteredStrokes } from './filtered-strokes.js';

// Last transcription result (legacy - combined view)
export const lastTranscription = writable(null);

// Per-page transcription results: Map<pageKey, transcriptionResult>
export const pageTranscriptions = writable(new Map());

// Selected pages for import (Set of pageKeys)
export const selectedPagesForImport = writable(new Set());

// Is transcription in progress?
export const isTranscribing = writable(false);

// Derived: Transcribed text
export const transcribedText = derived(
  lastTranscription, 
  $t => $t?.text || ''
);

// Derived: Transcribed lines with hierarchy
export const transcribedLines = derived(
  lastTranscription, 
  $t => $t?.lines || []
);

// Derived: Detected commands (TODO, DEADLINE, etc.)
export const detectedCommands = derived(
  lastTranscription, 
  $t => $t?.commands || []
);

// Derived: Summary stats
export const transcriptionSummary = derived(
  lastTranscription,
  $t => $t?.summary || null
);

// Derived: Line metrics
export const lineMetrics = derived(
  lastTranscription,
  $t => $t?.lineMetrics || null
);

// Derived: Words with bounding boxes
export const transcribedWords = derived(
  lastTranscription,
  $t => $t?.words || []
);

// Derived: Has transcription data
export const hasTranscription = derived(
  lastTranscription,
  $t => $t !== null
);

// Derived: Pages/Books info from transcription source strokes (from pageTranscriptions)
export const transcriptionSourcePages = derived(
  pageTranscriptions,
  $pt => {
    const pages = [];
    $pt.forEach((transcription, pageKey) => {
      pages.push({
        key: pageKey,
        ...transcription.pageInfo,
        strokeCount: transcription.strokeCount
      });
    });
    return pages;
  }
);

// Derived: Transcription grouped by page (new structure)
export const transcriptionByPage = derived(
  pageTranscriptions,
  $pt => $pt
);

// Derived: List of page transcriptions as array for easier iteration
export const pageTranscriptionsArray = derived(
  pageTranscriptions,
  $pt => {
    const arr = [];
    $pt.forEach((transcription, pageKey) => {
      arr.push({ pageKey, ...transcription });
    });
    // Sort by book then page
    arr.sort((a, b) => {
      if (a.pageInfo.book !== b.pageInfo.book) {
        return a.pageInfo.book - b.pageInfo.book;
      }
      return a.pageInfo.page - b.pageInfo.page;
    });
    return arr;
  }
);

// Derived: Count of pages with transcriptions
export const pageTranscriptionCount = derived(
  pageTranscriptions,
  $pt => $pt.size
);

// Derived: Has any transcription data
export const hasPageTranscriptions = derived(
  pageTranscriptions,
  $pt => $pt.size > 0
);

/**
 * Set transcription result (legacy - for backward compatibility)
 * @param {Object} result - Transcription result from MyScript
 * @param {Array} filteredStrokes - Optional array of filtered decorative strokes
 */
export function setTranscription(result, filteredStrokes = null) {
  lastTranscription.set(result);
  isTranscribing.set(false);
  
  // Store filtered strokes if provided
  if (filteredStrokes) {
    setFilteredStrokes(filteredStrokes);
  }
}

/**
 * Set transcription for a specific page
 * @param {string} pageKey - Page identifier (e.g., "S0/O0/B1/P1")
 * @param {Object} transcription - Transcription result from MyScript
 * @param {Object} pageInfo - Page metadata { section, owner, book, page }
 * @param {number} strokeCount - Number of strokes in this page
 * @param {Array} transcribedStrokes - CRITICAL: The actual strokes that were sent to MyScript
 */
export function setPageTranscription(pageKey, transcription, pageInfo, strokeCount, transcribedStrokes = null) {
  // CRITICAL: Extract stroke IDs from the strokes that were actually transcribed
  // This enables us to assign blockUuid ONLY to these strokes, not all strokes on the page
  const transcribedStrokeIds = transcribedStrokes
    ? transcribedStrokes.map(s => String(s.startTime))
    : null;

  pageTranscriptions.update(pt => {
    const newMap = new Map(pt);
    newMap.set(pageKey, {
      ...transcription,
      pageInfo,
      strokeCount,
      transcribedStrokeIds, // NEW: Track which strokes were actually transcribed
      timestamp: Date.now()
    });
    return newMap;
  });

  // Auto-select newly transcribed page for import
  selectedPagesForImport.update(sp => {
    const newSet = new Set(sp);
    newSet.add(pageKey);
    return newSet;
  });
}

/**
 * Toggle page selection for import
 * @param {string} pageKey - Page identifier
 */
export function togglePageSelection(pageKey) {
  selectedPagesForImport.update(sp => {
    const newSet = new Set(sp);
    if (newSet.has(pageKey)) {
      newSet.delete(pageKey);
    } else {
      newSet.add(pageKey);
    }
    return newSet;
  });
}

/**
 * Select all pages for import
 */
export function selectAllPages() {
  pageTranscriptions.subscribe(pt => {
    selectedPagesForImport.set(new Set(pt.keys()));
  })();
}

/**
 * Deselect all pages
 */
export function deselectAllPages() {
  selectedPagesForImport.set(new Set());
}

/**
 * Clear transcription (both legacy and per-page)
 */
export function clearTranscription() {
  lastTranscription.set(null);
  pageTranscriptions.set(new Map());
  selectedPagesForImport.set(new Set());
}

/**
 * Clear transcription for a specific page
 * @param {string} pageKey - Page identifier
 */
export function clearPageTranscription(pageKey) {
  pageTranscriptions.update(pt => {
    const newMap = new Map(pt);
    newMap.delete(pageKey);
    return newMap;
  });
  selectedPagesForImport.update(sp => {
    const newSet = new Set(sp);
    newSet.delete(pageKey);
    return newSet;
  });
}

/**
 * Set transcribing state
 * @param {boolean} transcribing 
 */
export function setIsTranscribing(transcribing) {
  isTranscribing.set(transcribing);
}

/**
 * Update transcription lines for a specific page
 * Used when editing structure in TranscriptionEditorModal
 * @param {string} pageKey - Page identifier
 * @param {Array} updatedLines - New lines array
 */
export function updatePageTranscriptionLines(pageKey, updatedLines) {
  pageTranscriptions.update(pt => {
    const newMap = new Map(pt);
    const pageData = newMap.get(pageKey);
    
    if (!pageData) {
      console.warn(`Cannot update lines for unknown page: ${pageKey}`);
      return pt;
    }
    
    // Update the lines array and regenerate text
    const updatedText = updatedLines.map(l => l.text).join('\n');
    
    newMap.set(pageKey, {
      ...pageData,
      lines: updatedLines,
      text: updatedText,
      timestamp: Date.now()
    });
    
    return newMap;
  });
}
