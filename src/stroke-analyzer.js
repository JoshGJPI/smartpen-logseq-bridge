/**
 * Stroke Analyzer
 * Analyzes strokes for shape detection, grouping, and spatial relationships
 * Improved rectangle detection using segment analysis
 */

export class StrokeAnalyzer {
  constructor(options = {}) {
    // Detection thresholds
    this.config = {
      // Rectangle detection
      minDotsForRectangle: 20,        // Minimum dots to consider as rectangle
      closureThreshold: 3.0,          // Max distance between start/end (mm)
      cornerAngleMin: 60,             // Minimum angle change for corner (degrees)
      cornerAngleMax: 120,            // Maximum angle change for corner (degrees)
      straightnessThreshold: 0.85,    // How straight segments must be (0-1)
      minSegmentLength: 2.0,          // Minimum segment length (mm)
      aspectRatioMin: 0.3,            // Min width/height ratio
      aspectRatioMax: 3.0,            // Max width/height ratio
      
      // Line height (calibrated from user's 2-line sample)
      // User wrote on 2 lines with y-range of ~2mm, so line height ≈ spacing between
      lineHeight: 5.0,                // Approximate line height in Ncode units
      indentThreshold: 3.0,           // X offset to consider as indented
      
      // Grouping
      temporalGap: 2000,              // ms gap to consider strokes in same group
      spatialProximity: 10.0,         // Ncode units for spatial grouping
      
      // Ncode to mm conversion
      ncodeToMm: 2.371,
      
      ...options
    };
  }
  
  /**
   * Analyze a single stroke for shape detection
   */
  analyzeStroke(stroke) {
    const dots = stroke.dotArray || [];
    if (dots.length < 3) {
      return { isRectangle: false, bounds: null };
    }
    
    const bounds = this.calculateBounds(dots);
    const pathLength = this.calculatePathLength(dots);
    const isClosed = this.checkClosure(dots);
    
    // Rectangle detection with improved algorithm
    const rectangleAnalysis = this.analyzeRectangle(dots, bounds);
    
    return {
      dotCount: dots.length,
      bounds,
      pathLength,
      isClosed,
      closureDistance: this.getClosureDistance(dots),
      duration: (stroke.endTime || 0) - (stroke.startTime || 0),
      
      // Rectangle analysis
      isRectangle: rectangleAnalysis.isRectangle,
      rectangleConfidence: rectangleAnalysis.confidence,
      rectangleDetails: rectangleAnalysis,
      
      // Segment analysis
      segments: rectangleAnalysis.segments,
      corners: rectangleAnalysis.corners
    };
  }
  
  /**
   * Improved rectangle detection using segment and corner analysis
   */
  analyzeRectangle(dots, bounds) {
    const result = {
      isRectangle: false,
      confidence: 0,
      segments: [],
      corners: [],
      reasons: []
    };
    
    // Must have enough dots
    if (dots.length < this.config.minDotsForRectangle) {
      result.reasons.push(`Too few dots: ${dots.length} < ${this.config.minDotsForRectangle}`);
      return result;
    }
    
    // Must be closed (start and end near each other)
    const closureDistance = this.getClosureDistance(dots);
    if (closureDistance > this.config.closureThreshold) {
      result.reasons.push(`Not closed: distance ${closureDistance.toFixed(2)} > ${this.config.closureThreshold}`);
      return result;
    }
    
    // Find corners (points where direction changes significantly)
    const corners = this.findCorners(dots);
    result.corners = corners;
    
    // Need exactly 4 corners for a rectangle
    if (corners.length < 4) {
      result.reasons.push(`Too few corners: ${corners.length} < 4`);
      return result;
    }
    
    if (corners.length > 6) {
      result.reasons.push(`Too many corners: ${corners.length} > 6 (likely not a rectangle)`);
      return result;
    }
    
    // Analyze segments between corners
    const segments = this.analyzeSegments(dots, corners);
    result.segments = segments;
    
    // Check if segments are straight enough
    const straightSegments = segments.filter(s => s.straightness >= this.config.straightnessThreshold);
    if (straightSegments.length < 4) {
      result.reasons.push(`Not enough straight segments: ${straightSegments.length} < 4`);
      return result;
    }
    
    // Check for approximately perpendicular segments (alternating H/V)
    const hasPerpendicularPattern = this.checkPerpendicularPattern(segments);
    if (!hasPerpendicularPattern) {
      result.reasons.push('Segments not perpendicular');
      return result;
    }
    
    // Check aspect ratio
    const aspectRatio = bounds.width / bounds.height;
    if (aspectRatio < this.config.aspectRatioMin || aspectRatio > this.config.aspectRatioMax) {
      result.reasons.push(`Aspect ratio out of range: ${aspectRatio.toFixed(2)}`);
      return result;
    }
    
    // Calculate confidence score
    let confidence = 0.5; // Base score for passing all checks
    
    // Bonus for exactly 4 corners
    if (corners.length === 4) confidence += 0.2;
    
    // Bonus for very straight segments
    const avgStraightness = segments.reduce((sum, s) => sum + s.straightness, 0) / segments.length;
    confidence += avgStraightness * 0.2;
    
    // Bonus for good closure
    confidence += Math.max(0, 0.1 - closureDistance / 10);
    
    result.isRectangle = true;
    result.confidence = Math.min(1, confidence);
    result.reasons.push('Passed all rectangle checks');
    
    return result;
  }
  
  /**
   * Find corners by detecting significant direction changes
   */
  findCorners(dots) {
    const corners = [];
    const windowSize = 5; // Points to consider for direction
    
    if (dots.length < windowSize * 2) return corners;
    
    for (let i = windowSize; i < dots.length - windowSize; i++) {
      // Calculate incoming direction
      const inDir = this.getDirection(
        dots[i - windowSize],
        dots[i]
      );
      
      // Calculate outgoing direction
      const outDir = this.getDirection(
        dots[i],
        dots[i + windowSize]
      );
      
      // Calculate angle change
      let angleDiff = Math.abs(outDir - inDir);
      if (angleDiff > 180) angleDiff = 360 - angleDiff;
      
      // Is this a corner?
      if (angleDiff >= this.config.cornerAngleMin && angleDiff <= this.config.cornerAngleMax) {
        // Check if we already have a nearby corner
        const lastCorner = corners[corners.length - 1];
        if (!lastCorner || i - lastCorner.index > windowSize) {
          corners.push({
            index: i,
            x: dots[i].x,
            y: dots[i].y,
            angle: angleDiff,
            inDirection: inDir,
            outDirection: outDir
          });
        }
      }
    }
    
    return corners;
  }
  
  /**
   * Get direction angle between two points (degrees)
   */
  getDirection(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }
  
  /**
   * Analyze segments between corners
   */
  analyzeSegments(dots, corners) {
    const segments = [];
    
    // Add start point as implicit first corner
    const allCorners = [
      { index: 0, x: dots[0].x, y: dots[0].y },
      ...corners,
      { index: dots.length - 1, x: dots[dots.length - 1].x, y: dots[dots.length - 1].y }
    ];
    
    for (let i = 0; i < allCorners.length - 1; i++) {
      const startIdx = allCorners[i].index;
      const endIdx = allCorners[i + 1].index;
      const segmentDots = dots.slice(startIdx, endIdx + 1);
      
      if (segmentDots.length < 2) continue;
      
      const start = segmentDots[0];
      const end = segmentDots[segmentDots.length - 1];
      
      // Calculate segment properties
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const direction = Math.atan2(dy, dx) * 180 / Math.PI;
      
      // Determine if horizontal or vertical
      const isHorizontal = Math.abs(direction) < 30 || Math.abs(direction) > 150;
      const isVertical = Math.abs(Math.abs(direction) - 90) < 30;
      
      // Calculate straightness (how close dots are to the line)
      const straightness = this.calculateStraightness(segmentDots);
      
      segments.push({
        startIndex: startIdx,
        endIndex: endIdx,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        length,
        direction,
        isHorizontal,
        isVertical,
        straightness,
        dotCount: segmentDots.length
      });
    }
    
    return segments;
  }
  
  /**
   * Calculate how straight a segment is (0-1)
   */
  calculateStraightness(dots) {
    if (dots.length < 3) return 1;
    
    const start = dots[0];
    const end = dots[dots.length - 1];
    const lineLength = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );
    
    if (lineLength < 0.1) return 0;
    
    // Calculate average distance from line
    let totalDeviation = 0;
    for (let i = 1; i < dots.length - 1; i++) {
      const dist = this.pointToLineDistance(dots[i], start, end);
      totalDeviation += dist;
    }
    
    const avgDeviation = totalDeviation / (dots.length - 2);
    // Convert to 0-1 score (lower deviation = higher straightness)
    return Math.max(0, 1 - avgDeviation / (lineLength * 0.2));
  }
  
  /**
   * Distance from point to line segment
   */
  pointToLineDistance(point, lineStart, lineEnd) {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    
    const param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    
    return Math.sqrt(Math.pow(point.x - xx, 2) + Math.pow(point.y - yy, 2));
  }
  
  /**
   * Check if segments follow a perpendicular pattern (H-V-H-V or V-H-V-H)
   */
  checkPerpendicularPattern(segments) {
    if (segments.length < 4) return false;
    
    // Get the first 4 significant segments
    const mainSegments = segments
      .filter(s => s.length >= this.config.minSegmentLength)
      .slice(0, 4);
    
    if (mainSegments.length < 4) return false;
    
    // Check alternating H/V pattern
    let lastWasHorizontal = mainSegments[0].isHorizontal;
    for (let i = 1; i < mainSegments.length; i++) {
      const isHorizontal = mainSegments[i].isHorizontal;
      const isVertical = mainSegments[i].isVertical;
      
      // Should alternate
      if (lastWasHorizontal && !isVertical) return false;
      if (!lastWasHorizontal && !isHorizontal) return false;
      
      lastWasHorizontal = isHorizontal;
    }
    
    return true;
  }
  
  /**
   * Calculate bounding box of dots
   */
  calculateBounds(dots) {
    if (!dots || dots.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    dots.forEach(dot => {
      minX = Math.min(minX, dot.x);
      minY = Math.min(minY, dot.y);
      maxX = Math.max(maxX, dot.x);
      maxY = Math.max(maxY, dot.y);
    });
    
    return {
      minX, minY, maxX, maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }
  
  /**
   * Calculate total path length
   */
  calculatePathLength(dots) {
    let length = 0;
    for (let i = 1; i < dots.length; i++) {
      const dx = dots[i].x - dots[i-1].x;
      const dy = dots[i].y - dots[i-1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }
  
  /**
   * Check if stroke is closed (start near end)
   */
  checkClosure(dots) {
    if (dots.length < 2) return false;
    return this.getClosureDistance(dots) <= this.config.closureThreshold;
  }
  
  /**
   * Get distance between first and last dot
   */
  getClosureDistance(dots) {
    if (dots.length < 2) return Infinity;
    const first = dots[0];
    const last = dots[dots.length - 1];
    return Math.sqrt(
      Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2)
    );
  }
  
  /**
   * Analyze line structure of strokes
   */
  analyzeLines(strokes) {
    if (strokes.length === 0) return { lines: [], lineHeight: this.config.lineHeight };
    
    // Collect all Y coordinates with their strokes
    const yPositions = [];
    strokes.forEach((stroke, index) => {
      const bounds = this.calculateBounds(stroke.dotArray || []);
      if (bounds.height < Infinity) {
        yPositions.push({
          y: bounds.centerY,
          minY: bounds.minY,
          maxY: bounds.maxY,
          strokeIndex: index
        });
      }
    });
    
    // Sort by Y position
    yPositions.sort((a, b) => a.y - b.y);
    
    // Group into lines based on Y proximity
    const lines = [];
    let currentLine = [];
    let lastY = null;
    
    yPositions.forEach(pos => {
      if (lastY === null || Math.abs(pos.y - lastY) < this.config.lineHeight * 0.5) {
        currentLine.push(pos);
      } else {
        if (currentLine.length > 0) {
          lines.push(this.summarizeLine(currentLine));
        }
        currentLine = [pos];
      }
      lastY = pos.y;
    });
    
    if (currentLine.length > 0) {
      lines.push(this.summarizeLine(currentLine));
    }
    
    // Calculate actual line height from data
    let detectedLineHeight = this.config.lineHeight;
    if (lines.length >= 2) {
      const gaps = [];
      for (let i = 1; i < lines.length; i++) {
        gaps.push(lines[i].centerY - lines[i-1].centerY);
      }
      detectedLineHeight = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }
    
    return {
      lines,
      lineCount: lines.length,
      detectedLineHeight,
      configuredLineHeight: this.config.lineHeight
    };
  }
  
  /**
   * Summarize a line of strokes
   */
  summarizeLine(positions) {
    const strokeIndices = positions.map(p => p.strokeIndex);
    const minY = Math.min(...positions.map(p => p.minY));
    const maxY = Math.max(...positions.map(p => p.maxY));
    const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
    
    return {
      strokeIndices,
      strokeCount: strokeIndices.length,
      minY,
      maxY,
      centerY,
      height: maxY - minY
    };
  }
  
  /**
   * Find strokes contained within a rectangle stroke
   */
  findContainedStrokes(rectangleStroke, allStrokes, rectangleIndex) {
    const rectBounds = this.calculateBounds(rectangleStroke.dotArray || []);
    const contained = [];
    
    allStrokes.forEach((stroke, index) => {
      if (index === rectangleIndex) return;
      
      const strokeBounds = this.calculateBounds(stroke.dotArray || []);
      
      // Check if stroke center is inside rectangle bounds
      if (strokeBounds.centerX >= rectBounds.minX &&
          strokeBounds.centerX <= rectBounds.maxX &&
          strokeBounds.centerY >= rectBounds.minY &&
          strokeBounds.centerY <= rectBounds.maxY) {
        contained.push({
          index,
          stroke,
          bounds: strokeBounds
        });
      }
    });
    
    return contained;
  }
  
  /**
   * Set line height from calibration
   */
  setLineHeight(height) {
    this.config.lineHeight = height;
  }
}
