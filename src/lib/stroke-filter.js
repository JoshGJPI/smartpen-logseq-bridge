/**
 * Stroke Preprocessing Filter
 * Removes decorative elements (boxes, underlines, circles) before MyScript transcription
 * 
 * This filter prevents decorative strokes from being misinterpreted as emojis by MyScript's
 * Text recognizer. Only filters decorative elements that contain text inside them.
 * 
 * @see docs/stroke-preprocessing-spec.md for complete specification
 */

// ============================================================================
// TUNABLE PARAMETERS
// ============================================================================

// Box Detection
const BOX_TIME_THRESHOLD = 5000;      // ms - max time between 2 strokes
const BOX_MIN_SIZE = 5.0;             // mm - minimum box dimension
const BOX_MAX_SIZE = 50.0;            // mm - maximum box dimension
const BOX_HORIZONTAL_ASPECT = 5.0;    // width/height for horizontal stroke
const BOX_VERTICAL_ASPECT = 0.2;      // width/height for vertical stroke
const BOX_MIN_CONTENT = 2;            // minimum strokes inside to be decorative

// Underline Detection
const UNDERLINE_MIN_ASPECT = 50;      // width/height ratio (very horizontal)
const UNDERLINE_MIN_STRAIGHTNESS = 0.90;  // bbox_diagonal / path_length
const UNDERLINE_MIN_WIDTH = 15.0;     // mm - substantial length

// Circle Detection
const CIRCLE_MIN_DOTS = 30;           // dots for smooth curve
const CIRCLE_MIN_SIZE = 4.0;          // mm - larger than letters
const CIRCLE_MAX_ENDPOINT_DIST = 2.0; // mm - closed loop
const CIRCLE_MIN_ASPECT = 0.3;        // minimum width/height
const CIRCLE_MAX_ASPECT = 3.0;        // maximum width/height (allows ovals)
const CIRCLE_MIN_CONTENT = 1;         // minimum strokes inside

// Containment Check
const CONTAINMENT_MARGIN = 0.5;       // mm - tolerance for edge strokes

// Ncode to MM conversion (from pen SDK)
const NCODE_TO_MM = 2.371;            // 1 Ncode unit × 2.371 = 1mm

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate bounding box for a stroke in millimeters
 * @param {Object} stroke - Stroke with dotArray
 * @returns {Object|null} Bounds {minX, maxX, minY, maxY, width, height} or null
 */
function getStrokeBounds(stroke) {
  if (!stroke.dotArray || stroke.dotArray.length === 0) {
    return null;
  }
  
  const xs = stroke.dotArray.map(d => d.x * NCODE_TO_MM);
  const ys = stroke.dotArray.map(d => d.y * NCODE_TO_MM);
  
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Check if one bounding box is spatially contained within another
 * @param {Object} innerBounds - Inner bounding box
 * @param {Object} outerBounds - Outer bounding box
 * @param {number} margin - Tolerance in mm (default: 0.5mm)
 * @returns {boolean} True if inner is inside outer
 */
function isInside(innerBounds, outerBounds, margin = CONTAINMENT_MARGIN) {
  return (
    innerBounds.minX >= outerBounds.minX - margin &&
    innerBounds.maxX <= outerBounds.maxX + margin &&
    innerBounds.minY >= outerBounds.minY - margin &&
    innerBounds.maxY <= outerBounds.maxY + margin
  );
}

/**
 * Calculate path length of a stroke
 * @param {Object} stroke - Stroke with dotArray
 * @returns {number} Total path length in mm
 */
function getPathLength(stroke) {
  if (!stroke.dotArray || stroke.dotArray.length < 2) {
    return 0;
  }
  
  let length = 0;
  for (let i = 1; i < stroke.dotArray.length; i++) {
    const dx = (stroke.dotArray[i].x - stroke.dotArray[i-1].x) * NCODE_TO_MM;
    const dy = (stroke.dotArray[i].y - stroke.dotArray[i-1].y) * NCODE_TO_MM;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  
  return length;
}

/**
 * Calculate straightness ratio (0-1, higher is straighter)
 * @param {Object} bounds - Stroke bounding box
 * @param {number} pathLength - Stroke path length
 * @returns {number} Straightness ratio
 */
function getStraightness(bounds, pathLength) {
  if (pathLength === 0) return 0;
  
  const bboxDiagonal = Math.sqrt(
    bounds.width * bounds.width + 
    bounds.height * bounds.height
  );
  
  return bboxDiagonal / pathLength;
}

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Detect 2-stroke boxes with content inside
 * Uses non-overlapping constraint to prevent false positives
 * 
 * @param {Array} strokes - Array of stroke objects
 * @returns {Object} {boxIndices: Set, boxPatterns: Array}
 */
function detect2StrokeBoxes(strokes) {
  const usedStrokes = new Set();  // Track strokes already assigned to a box
  const boxIndices = new Set();
  const boxPatterns = [];
  
  for (let i = 0; i < strokes.length - 1; i++) {
    // CRITICAL: Skip if either stroke already used in a box
    // This prevents the same stroke from appearing in multiple box patterns
    if (usedStrokes.has(i) || usedStrokes.has(i + 1)) {
      continue;
    }
    
    const stroke1 = strokes[i];
    const stroke2 = strokes[i + 1];
    
    if (!stroke1.dotArray || !stroke2.dotArray) continue;
    
    // Check temporal proximity (drawn within threshold)
    const timeGap = stroke2.startTime - stroke1.endTime;
    if (timeGap > BOX_TIME_THRESHOLD) continue;
    
    const bounds1 = getStrokeBounds(stroke1);
    const bounds2 = getStrokeBounds(stroke2);
    
    if (!bounds1 || !bounds2) continue;
    
    // Calculate combined bounding box
    const combined = {
      minX: Math.min(bounds1.minX, bounds2.minX),
      maxX: Math.max(bounds1.maxX, bounds2.maxX),
      minY: Math.min(bounds1.minY, bounds2.minY),
      maxY: Math.max(bounds1.maxY, bounds2.maxY)
    };
    combined.width = combined.maxX - combined.minX;
    combined.height = combined.maxY - combined.minY;
    
    // Check if dimensions are reasonable for a box
    if (combined.width < BOX_MIN_SIZE || combined.width > BOX_MAX_SIZE ||
        combined.height < BOX_MIN_SIZE || combined.height > BOX_MAX_SIZE) {
      continue;
    }
    
    // Check if one stroke is horizontal and one is vertical (or complex)
    const aspect1 = bounds1.width / (bounds1.height || 0.01);
    const aspect2 = bounds2.width / (bounds2.height || 0.01);
    
    const hasHorizontal = aspect1 > BOX_HORIZONTAL_ASPECT || aspect2 > BOX_HORIZONTAL_ASPECT;
    const hasVertical = aspect1 < BOX_VERTICAL_ASPECT || aspect2 < BOX_VERTICAL_ASPECT;
    
    if (!hasHorizontal && !hasVertical) continue;
    
    // CRITICAL: Check if text exists inside
    const containedStrokes = [];
    for (let j = 0; j < strokes.length; j++) {
      if (j === i || j === i + 1) continue; // Skip box strokes themselves
      
      const otherBounds = getStrokeBounds(strokes[j]);
      if (otherBounds && isInside(otherBounds, combined)) {
        containedStrokes.push(j);
      }
    }
    
    // Only consider it a decorative box if it contains content
    if (containedStrokes.length >= BOX_MIN_CONTENT) {
      // Mark these strokes as used
      usedStrokes.add(i);
      usedStrokes.add(i + 1);
      
      boxIndices.add(i);
      boxIndices.add(i + 1);
      boxPatterns.push({
        strokes: [i, i + 1],
        containedCount: containedStrokes.length,
        bounds: combined
      });
    }
  }
  
  return { boxIndices, boxPatterns };
}

/**
 * Detect standalone underlines (not part of boxes)
 * 
 * @param {Array} strokes - Array of stroke objects
 * @param {Set} boxIndices - Indices of strokes that are part of boxes
 * @returns {Array} Array of underline stroke indices
 */
function detectUnderlines(strokes, boxIndices) {
  const underlineIndices = [];
  
  for (let i = 0; i < strokes.length; i++) {
    // Skip if part of a box
    if (boxIndices.has(i)) continue;
    
    const stroke = strokes[i];
    if (!stroke.dotArray || stroke.dotArray.length < 10) continue;
    
    const bounds = getStrokeBounds(stroke);
    if (!bounds || bounds.height < 0.01) continue;
    
    // Calculate aspect ratio and straightness
    const aspectRatio = bounds.width / bounds.height;
    const pathLength = getPathLength(stroke);
    const straightness = getStraightness(bounds, pathLength);
    
    // Very horizontal, straight, and substantial
    // Conservative thresholds to avoid false positives
    if (aspectRatio > UNDERLINE_MIN_ASPECT &&
        straightness > UNDERLINE_MIN_STRAIGHTNESS &&
        bounds.width > UNDERLINE_MIN_WIDTH) {
      underlineIndices.push(i);
    }
  }
  
  return underlineIndices;
}

/**
 * Detect circles/ovals with content inside (not part of boxes)
 * 
 * @param {Array} strokes - Array of stroke objects
 * @param {Set} boxIndices - Indices of strokes that are part of boxes
 * @returns {Array} Array of circle stroke indices
 */
function detectCircles(strokes, boxIndices) {
  const circleIndices = [];
  
  for (let i = 0; i < strokes.length; i++) {
    // Skip if part of a box
    if (boxIndices.has(i)) continue;
    
    const stroke = strokes[i];
    if (!stroke.dotArray || stroke.dotArray.length < CIRCLE_MIN_DOTS) continue;
    
    const bounds = getStrokeBounds(stroke);
    if (!bounds) continue;
    
    // Must be large enough to not be a letter
    if (bounds.width <= CIRCLE_MIN_SIZE || bounds.height <= CIRCLE_MIN_SIZE) continue;
    
    // Check if closed
    const firstDot = stroke.dotArray[0];
    const lastDot = stroke.dotArray[stroke.dotArray.length - 1];
    const dx = (lastDot.x - firstDot.x) * NCODE_TO_MM;
    const dy = (lastDot.y - firstDot.y) * NCODE_TO_MM;
    const endpointDist = Math.sqrt(dx * dx + dy * dy);
    
    if (endpointDist > CIRCLE_MAX_ENDPOINT_DIST) continue;  // Not closed
    
    // Check aspect ratio (allow ovals but not too elongated)
    const aspectRatio = bounds.width / bounds.height;
    if (aspectRatio < CIRCLE_MIN_ASPECT || aspectRatio > CIRCLE_MAX_ASPECT) continue;
    
    // CRITICAL: Check if text exists inside
    const containedStrokes = [];
    for (let j = 0; j < strokes.length; j++) {
      if (j === i) continue; // Skip self
      
      const otherBounds = getStrokeBounds(strokes[j]);
      if (otherBounds && isInside(otherBounds, bounds)) {
        containedStrokes.push(j);
      }
    }
    
    // Only consider it decorative if it contains content
    if (containedStrokes.length >= CIRCLE_MIN_CONTENT) {
      circleIndices.push(i);
    }
  }
  
  return circleIndices;
}

// ============================================================================
// MAIN FILTERING FUNCTION
// ============================================================================

/**
 * Filter decorative strokes from a stroke array
 * Separates text strokes from decorative elements (boxes, underlines, circles)
 * 
 * @param {Array} strokes - Array of stroke objects
 * @returns {Object} {textStrokes, decorativeStrokes, stats}
 */
export function filterDecorativeStrokes(strokes) {
  if (!strokes || strokes.length === 0) {
    return {
      textStrokes: [],
      decorativeStrokes: [],
      stats: {
        total: 0,
        text: 0,
        decorative: 0,
        boxes: 0,
        underlines: 0,
        circles: 0
      }
    };
  }
  
  // Step 1: Detect 2-stroke boxes with content
  const { boxIndices, boxPatterns } = detect2StrokeBoxes(strokes);
  
  // Step 2: Detect standalone underlines (not part of boxes)
  const underlineIndices = detectUnderlines(strokes, boxIndices);
  
  // Step 3: Detect circles/ovals with content (not part of boxes)
  const circleIndices = detectCircles(strokes, boxIndices);
  
  // Combine all decorative indices
  const decorativeIndices = new Set([
    ...boxIndices,
    ...underlineIndices,
    ...circleIndices
  ]);
  
  // Separate text from decorative
  const textStrokes = [];
  const decorativeStrokes = [];
  
  strokes.forEach((stroke, index) => {
    if (decorativeIndices.has(index)) {
      // Determine type
      let type = 'box';
      if (underlineIndices.includes(index)) type = 'underline';
      if (circleIndices.includes(index)) type = 'circle';
      
      decorativeStrokes.push({
        stroke,
        index,
        type
      });
    } else {
      textStrokes.push(stroke);
    }
  });
  
  return {
    textStrokes,
    decorativeStrokes,
    stats: {
      total: strokes.length,
      text: textStrokes.length,
      decorative: decorativeStrokes.length,
      boxes: boxPatterns.length,
      underlines: underlineIndices.length,
      circles: circleIndices.length
    }
  };
}

/**
 * Detect decorative strokes and return their indices
 * Useful for user-controlled deselection rather than automatic filtering
 * 
 * @param {Array} strokes - Array of stroke objects
 * @returns {Object} {indices: number[], stats: {boxes, underlines, circles}}
 */
export function detectDecorativeIndices(strokes) {
  if (!strokes || strokes.length === 0) {
    return {
      indices: [],
      stats: { boxes: 0, underlines: 0, circles: 0 }
    };
  }
  
  // Step 1: Detect 2-stroke boxes with content
  const { boxIndices, boxPatterns } = detect2StrokeBoxes(strokes);
  
  // Step 2: Detect standalone underlines (not part of boxes)
  const underlineIndices = detectUnderlines(strokes, boxIndices);
  
  // Step 3: Detect circles/ovals with content (not part of boxes)
  const circleIndices = detectCircles(strokes, boxIndices);
  
  // Combine all decorative indices
  const allIndices = [
    ...Array.from(boxIndices),
    ...underlineIndices,
    ...circleIndices
  ];
  
  return {
    indices: allIndices,
    stats: {
      boxes: boxPatterns.length,
      underlines: underlineIndices.length,
      circles: circleIndices.length
    }
  };
}

/**
 * Export configuration constants for external access/tuning
 */
export const config = {
  BOX_TIME_THRESHOLD,
  BOX_MIN_SIZE,
  BOX_MAX_SIZE,
  BOX_HORIZONTAL_ASPECT,
  BOX_VERTICAL_ASPECT,
  BOX_MIN_CONTENT,
  UNDERLINE_MIN_ASPECT,
  UNDERLINE_MIN_STRAIGHTNESS,
  UNDERLINE_MIN_WIDTH,
  CIRCLE_MIN_DOTS,
  CIRCLE_MIN_SIZE,
  CIRCLE_MAX_ENDPOINT_DIST,
  CIRCLE_MIN_ASPECT,
  CIRCLE_MAX_ASPECT,
  CIRCLE_MIN_CONTENT,
  CONTAINMENT_MARGIN,
  NCODE_TO_MM
};
