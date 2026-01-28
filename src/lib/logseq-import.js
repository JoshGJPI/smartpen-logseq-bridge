/**
 * LogSeq Import - Import stored strokes back into the app
 * Handles transformation from simplified storage format to canvas format
 */
import { get } from 'svelte/store';
import { strokes, log, updatePageSyncStatus } from '$stores';
import { registerBookIds } from '$stores/book-aliases.js';
import { fetchStrokeData } from './logseq-scanner.js';

/**
 * Get unique identifier for a stroke
 * @param {Object} stroke - Stroke object (either format)
 * @returns {string} Unique ID
 */
function getStrokeId(stroke) {
  // Stored format uses 'id' field
  if (stroke.id) return stroke.id;
  // Raw format uses startTime
  return `s${stroke.startTime}`;
}

/**
 * Transform simplified storage format to canvas-renderable format
 * @param {Object} storedData - Full JSON object from LogSeq
 * @param {Function} onProgress - Optional callback(current, total)
 * @returns {Array} Array of strokes in raw pen format
 */
function transformStoredToCanvasFormat(storedData, onProgress = null) {
  const { pageInfo, strokes: storedStrokes } = storedData;

  if (!storedStrokes || !Array.isArray(storedStrokes)) {
    throw new Error('Invalid stroke data: missing strokes array');
  }

  const total = storedStrokes.length;
  const strokesWithBlockUuid = storedStrokes.filter(s => s.blockUuid).length;

  console.log(`[transformStoredToCanvasFormat] Importing ${total} strokes (${strokesWithBlockUuid} have blockUuid)`);

  return storedStrokes.map((stroke, index) => {
    // Report progress every 10 strokes or on last stroke
    if (onProgress && (index % 10 === 0 || index === total - 1)) {
      onProgress(index + 1, total);
    }
    const points = stroke.points;
    
    if (!points || !Array.isArray(points)) {
      throw new Error('Invalid stroke data: missing points array');
    }
    
    return {
      pageInfo: { ...pageInfo },  // Copy from document level
      startTime: stroke.startTime,
      endTime: stroke.endTime,
      blockUuid: stroke.blockUuid || null,  // CRITICAL: Preserve blockUuid from storage
      dotArray: points.map((point, index) => {
        const [x, y, timestamp] = point;

        // Determine dotType from position in array
        let dotType;
        if (index === 0) {
          dotType = 0;  // Pen Down
        } else if (index === points.length - 1) {
          dotType = 2;  // Pen Up
        } else {
          dotType = 1;  // Pen Move
        }

        return {
          x,
          y,
          f: 100,           // Default pressure (very light handwriting)
          dotType,
          timestamp,
          pageInfo: { ...pageInfo }
        };
      })
    };
  });
}

/**
 * Merge new strokes with existing strokes, removing duplicates
 * @param {Array} existingStrokes - Current strokes in app
 * @param {Array} newStrokes - Strokes to import
 * @returns {Object} Result with merged strokes and stats
 */
function mergeStrokes(existingStrokes, newStrokes) {
  // Build set of existing IDs
  const existingIds = new Set(existingStrokes.map(getStrokeId));
  
  // Filter new strokes
  const uniqueNew = [];
  const duplicates = [];
  
  for (const stroke of newStrokes) {
    const id = getStrokeId(stroke);
    if (existingIds.has(id)) {
      duplicates.push(stroke);
    } else {
      uniqueNew.push(stroke);
      existingIds.add(id); // Prevent duplicates within newStrokes
    }
  }
  
  // Merge and sort by time
  const merged = [...existingStrokes, ...uniqueNew]
    .sort((a, b) => {
      const timeA = a.startTime || parseInt(a.id?.slice(1) || '0');
      const timeB = b.startTime || parseInt(b.id?.slice(1) || '0');
      return timeA - timeB;
    });
  
  return {
    strokes: merged,
    imported: uniqueNew.length,
    duplicatesSkipped: duplicates.length
  };
}

/**
 * Import additional strokes for all currently loaded pages from LogSeq
 * @param {Function} onProgress - Optional callback(message, current, total)
 * @returns {Promise<Object>} Result with import stats
 */
export async function importStrokesForLoadedPages(onProgress = null) {
  try {
    // Get current strokes and identify unique pages
    const currentStrokes = get(strokes);
    
    if (currentStrokes.length === 0) {
      log('No strokes loaded to match against LogSeq', 'warning');
      return {
        success: false,
        error: 'No strokes currently loaded'
      };
    }
    
    // Extract unique book/page combinations from current strokes
    const loadedPages = new Map();
    currentStrokes.forEach(stroke => {
      const pageInfo = stroke.pageInfo || {};
      const book = pageInfo.book || 0;
      const page = pageInfo.page || 0;
      const key = `B${book}/P${page}`;
      
      if (!loadedPages.has(key)) {
        loadedPages.set(key, { book, page });
      }
    });
    
    log(`Found ${loadedPages.size} unique pages in current strokes`, 'info');
    
    // Get LogSeq pages from store
    const { logseqPages: logseqPagesStore } = await import('$stores/logseqPages.js');
    const allLogseqPages = get(logseqPagesStore);
    
    if (allLogseqPages.length === 0) {
      log('No pages found in LogSeq DB. Scan LogSeq first.', 'warning');
      return {
        success: false,
        error: 'No pages in LogSeq DB'
      };
    }
    
    // Find matching pages in LogSeq
    const matchingPages = [];
    for (const [key, pageRef] of loadedPages.entries()) {
      const match = allLogseqPages.find(p => 
        p.book === pageRef.book && p.page === pageRef.page
      );
      
      if (match) {
        matchingPages.push(match);
      }
    }
    
    if (matchingPages.length === 0) {
      log('No matching pages found in LogSeq DB', 'info');
      return {
        success: true,
        imported: 0,
        duplicatesSkipped: 0,
        pagesProcessed: 0
      };
    }
    
    log(`Found ${matchingPages.length} matching pages in LogSeq`, 'info');
    
    // Import strokes from each matching page
    let totalImported = 0;
    let totalDuplicates = 0;
    let pagesProcessed = 0;
    
    for (const pageData of matchingPages) {
      if (onProgress) {
        onProgress(
          `Importing B${pageData.book}/P${pageData.page}...`,
          pagesProcessed + 1,
          matchingPages.length
        );
      }
      
      const result = await importStrokesFromLogSeq(pageData, null);
      
      if (result.success) {
        totalImported += result.imported;
        totalDuplicates += result.duplicatesSkipped;
        pagesProcessed++;
      }
    }
    
    // Final summary
    const message = `Import complete: ${totalImported} new strokes from ${pagesProcessed} pages` +
      (totalDuplicates > 0 ? ` (${totalDuplicates} duplicates skipped)` : '');
    
    log(message, 'success');
    
    return {
      success: true,
      imported: totalImported,
      duplicatesSkipped: totalDuplicates,
      pagesProcessed
    };
    
  } catch (error) {
    console.error('Failed to import strokes for loaded pages:', error);
    log(`Import failed: ${error.message}`, 'error');
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Import strokes from LogSeq into the canvas
 * @param {Object} pageData - Page data object from logseqPages store
 * @param {Function} onProgress - Optional callback(current, total) for progress updates
 * @returns {Promise<Object>} Result with import stats
 */
export async function importStrokesFromLogSeq(pageData, onProgress = null) {
  try {
    // Fetch stroke JSON if not already loaded
    let strokeData = pageData.strokeData;
    
    if (!strokeData) {
      log(`Fetching stroke data for B${pageData.book}/P${pageData.page}...`, 'info');
      strokeData = await fetchStrokeData(pageData.pageName);
      
      if (!strokeData) {
        throw new Error('No stroke data found in page');
      }
      
      // Cache it for future use
      pageData.strokeData = strokeData;
    }
    
    // Transform to canvas format
    const canvasStrokes = transformStoredToCanvasFormat(strokeData, onProgress);
    
    if (canvasStrokes.length === 0) {
      throw new Error('No strokes to import');
    }
    
    // Register book IDs from imported strokes
    const bookIds = [...new Set(canvasStrokes
      .map(s => s.pageInfo?.book)
      .filter(Boolean))];
    if (bookIds.length > 0) {
      registerBookIds(bookIds);
    }
    
    // Get current strokes and merge with deduplication
    const currentStrokes = get(strokes);
    const result = mergeStrokes(currentStrokes, canvasStrokes);
    
    // Update store
    strokes.set(result.strokes);
    
    // Update sync status
    updatePageSyncStatus(pageData.book, pageData.page, 'in-canvas');
    
    // Log result
    const message = `Imported ${result.imported} strokes from B${pageData.book}/P${pageData.page}` +
      (result.duplicatesSkipped > 0 ? ` (${result.duplicatesSkipped} duplicates skipped)` : '');
    
    log(message, 'success');
    
    return {
      success: true,
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      total: result.strokes.length
    };
    
  } catch (error) {
    console.error('Failed to import strokes:', error);
    log(`Import failed: ${error.message}`, 'error');
    
    return {
      success: false,
      error: error.message
    };
  }
}
