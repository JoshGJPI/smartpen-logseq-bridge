/**
 * LogSeq Import - Import stored strokes back into the app
 * Handles transformation from simplified storage format to canvas format
 */
import { get } from 'svelte/store';
import { strokes, log, updatePageSyncStatus } from '$stores';
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
 * @returns {Array} Array of strokes in raw pen format
 */
function transformStoredToCanvasFormat(storedData) {
  const { pageInfo, strokes: storedStrokes } = storedData;
  
  if (!storedStrokes || !Array.isArray(storedStrokes)) {
    throw new Error('Invalid stroke data: missing strokes array');
  }
  
  return storedStrokes.map(stroke => {
    const points = stroke.points;
    
    if (!points || !Array.isArray(points)) {
      throw new Error('Invalid stroke data: missing points array');
    }
    
    return {
      pageInfo: { ...pageInfo },  // Copy from document level
      startTime: stroke.startTime,
      endTime: stroke.endTime,
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
          f: 200,           // Default pressure (lighter handwriting)
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
 * Import strokes from LogSeq into the canvas
 * @param {Object} pageData - Page data object from logseqPages store
 * @returns {Promise<Object>} Result with import stats
 */
export async function importStrokesFromLogSeq(pageData) {
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
    const canvasStrokes = transformStoredToCanvasFormat(strokeData);
    
    if (canvasStrokes.length === 0) {
      throw new Error('No strokes to import');
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
