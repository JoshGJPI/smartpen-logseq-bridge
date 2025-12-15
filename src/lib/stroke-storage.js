/**
 * Stroke Storage Utilities
 * Transforms pen stroke data into LogSeq-optimized format
 */

/**
 * Generate unique stroke ID from timestamp
 * @param {Object} stroke - Raw stroke object
 * @returns {string} Unique ID (e.g., "s1765313505107")
 */
export function generateStrokeId(stroke) {
  return `s${stroke.startTime}`;
}

/**
 * Convert raw pen strokes to simplified storage format
 * Removes artistic metadata (pressure, tilt, color) to reduce storage by ~60%
 * 
 * @param {Array} strokes - Raw strokes from pen
 * @returns {Array} Simplified strokes with only essential data
 */
export function convertToStorageFormat(strokes) {
  return strokes.map(stroke => ({
    id: generateStrokeId(stroke),
    startTime: stroke.startTime,
    endTime: stroke.endTime,
    points: stroke.dotArray.map(dot => [
      dot.x,
      dot.y,
      dot.timestamp
    ])
  }));
}

/**
 * Calculate bounding box for strokes
 * @param {Array} strokes - Simplified stroke array
 * @returns {Object} Bounds { minX, maxX, minY, maxY }
 */
export function calculateBounds(strokes) {
  if (!strokes || strokes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  
  strokes.forEach(stroke => {
    stroke.points.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
  });
  
  return { minX, maxX, minY, maxY };
}

/**
 * Deduplicate strokes by ID
 * Used for incremental updates when offline strokes may overlap with real-time
 * 
 * @param {Array} existingStrokes - Strokes already in storage
 * @param {Array} newStrokes - New strokes to add
 * @returns {Array} Only unique new strokes (not in existing)
 */
export function deduplicateStrokes(existingStrokes, newStrokes) {
  const existingIds = new Set(existingStrokes.map(s => s.id));
  return newStrokes.filter(s => !existingIds.has(s.id));
}

/**
 * Build page storage object with metadata
 * @param {Object} pageInfo - Page info from pen (section, owner, book, page)
 * @param {Array} strokes - Simplified strokes array
 * @returns {Object} Complete storage object for LogSeq
 */
export function buildPageStorageObject(pageInfo, strokes) {
  const bounds = calculateBounds(strokes);
  
  return {
    version: "1.0",
    pageInfo: {
      section: pageInfo.section,
      owner: pageInfo.owner,
      book: pageInfo.book,
      page: pageInfo.page
    },
    strokes: strokes,
    metadata: {
      lastUpdated: Date.now(),
      strokeCount: strokes.length,
      bounds: bounds
    }
  };
}

/**
 * Build transcription storage object
 * @param {Object} transcription - Transcription result from MyScript
 * @param {number} strokeCount - Number of strokes transcribed
 * @returns {Object} Transcription storage object for LogSeq
 */
export function buildTranscriptionStorageObject(transcription, strokeCount) {
  return {
    version: "1.0",
    transcribedAt: Date.now(),
    engine: "myscript",
    engineVersion: "2.0",
    text: transcription.text || "",
    lines: transcription.lines || [],
    commands: transcription.commands || [],
    metadata: {
      strokeCount: strokeCount,
      confidence: transcription.confidence || 0,
      processingTime: transcription.processingTime || 0
    }
  };
}

/**
 * Format page name for LogSeq namespace
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {string} Page name (e.g., "Smartpen Data/B3017/P42")
 */
export function formatPageName(book, page) {
  return `Smartpen Data/B${book}/P${page}`;
}

/**
 * Parse JSON from LogSeq code block
 * @param {string} blockContent - Full block content with code fence
 * @returns {Object|null} Parsed JSON or null if invalid
 */
export function parseJsonBlock(blockContent) {
  try {
    // Extract JSON from code block (remove ```json and ```)
    const jsonMatch = blockContent.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      // Try without language specifier
      const plainMatch = blockContent.match(/```\n([\s\S]*?)\n```/);
      if (!plainMatch) return null;
      return JSON.parse(plainMatch[1]);
    }
    return JSON.parse(jsonMatch[1]);
  } catch (error) {
    console.error('Failed to parse JSON block:', error);
    return null;
  }
}

/**
 * Format JSON for LogSeq code block
 * @param {Object} data - Object to serialize
 * @returns {string} Formatted code block with JSON
 */
export function formatJsonBlock(data) {
  return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
}

/**
 * Format page properties for LogSeq (only Book and Page)
 * @param {Object} pageInfo - Page information
 * @returns {Object} Properties object for LogSeq
 */
export function getPageProperties(pageInfo) {
  return {
    'Book': pageInfo.book.toString(),
    'Page': pageInfo.page.toString()
  };
}

/**
 * Format transcribed text for LogSeq (with block dashes and indentation)
 * @param {Array} lines - Line objects with text and indentLevel
 * @returns {string} Formatted text with LogSeq block syntax
 */
export function formatTranscribedText(lines) {
  if (!lines || lines.length === 0) return '';
  
  return lines.map(line => {
    const indent = '  '.repeat(line.indentLevel || 0);
    const dash = '- ';
    return indent + dash + line.text;
  }).join('\n');
}
