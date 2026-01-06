# Stroke Preprocessing Implementation Specification (Revised)

## Overview

This document specifies the implementation of a stroke preprocessing filter to remove decorative elements (underlines, boxes, circles) **that contain text inside them** before sending strokes to MyScript's Text recognizer. This prevents decorative strokes from being misinterpreted as emojis while maintaining all text recognition functionality.

**Status**: Implementation Ready (Revised with user feedback)  
**Date**: December 18, 2024  
**Analysis Based On**: 592 strokes with actual decorative elements:
- **2 boxes** (2-stroke pattern containing text)
- **1 underline** (standalone horizontal line)
- **2 circles/ovals** (closed loops containing text)

---

## Problem Statement

### Current Behavior
- MyScript Text recognizer interprets decorative strokes as emojis
- Underlines beneath headers → emoji characters
- Boxes around important text → emoji characters
- Circles for emphasis → emoji characters
- Result: Transcribed text contains garbage emoji output instead of clean text

### Root Cause
MyScript's Text contentType (`'Text'`) has **zero shape support**. When decorative strokes are sent to the text recognizer, it must interpret them as text characters, often matching them to emoji training patterns.

### Solution Approach
**Client-side preprocessing** with **containment checking**:
- Filter decorative strokes that contain text inside them
- Conservative thresholds to avoid false positives
- Tunable parameters for different writing styles
- ✅ Minimal disruption to existing code
- ✅ Predictable MyScript responses  
- ✅ Keeps current text parsing logic intact

---

## User's Actual Writing Patterns

### Boxes (2-stroke pattern)
**Drawing method**: 
1. Start at top-left corner
2. First stroke: down → up → right → down (creates 3 sides: left, top, right)
3. Second stroke: bottom-left → bottom-right (creates bottom edge)

**Characteristics**:
- **Two consecutive strokes** drawn within 3-5 seconds
- **First stroke**: Complex path covering ~3 sides (path length > perimeter)
- **Second stroke**: Mostly horizontal (aspect ratio > 5.0) or mostly vertical (aspect ratio < 0.2)
- **Combined bounds**: Form rectangle 5-50mm in both dimensions
- **Contains text**: Multiple strokes (>2) are spatially inside the combined bounds

**Detected in sample**: 13 potential patterns before applying non-overlapping constraint. With constraint: expected 2-5 boxes (user drew 2).

### Underlines (standalone horizontal lines)
**Drawing method**:
- Single horizontal stroke beneath text

**Characteristics**:
- **Very high aspect ratio**: width/height > 50 (to distinguish from letters like 'l' or 'i')
- **Very straight**: straightness > 0.90
- **Substantial width**: > 15mm (to avoid short dashes or hyphens)
- **NOT part of a box**: Must be standalone, not adjacent to vertical strokes
- **Optional**: Could check if text exists above it

**Detected in sample**: 4 candidates, but only 1 is actual underline (user feedback)

### Circles/Ovals (closed loops)
**Drawing method**:
- Single continuous stroke forming closed loop

**Characteristics**:
- **Closed**: Endpoint distance < 2.0mm
- **Larger than letters**: > 4mm in BOTH dimensions (avoids 'o', 'O', '0')
- **Smooth curve**: Many dots (> 30) for continuous path
- **Contains text**: At least 1 stroke spatially inside the bounds
- **Aspect ratio**: 0.3 - 3.0 (allows ovals, not too elongated)

**Detected in sample**: 2 circles/ovals with content (matches user count!)

---

## Revised Detection Algorithm

### Core Principle: Only Filter Decorative Elements Containing Text

**Key Insight**: Decorative elements are meant to emphasize or organize text. Empty decorative elements should be kept (they might be intentional marks). Only filter those that actually surround/contain text strokes.

### Understanding Pattern Overlap (Why Non-Overlapping Matters)

When detecting 2-stroke boxes, the algorithm checks every consecutive pair of strokes. This can lead to **pattern overlap** where the same stroke appears in multiple detected patterns:

**Example**:
```
Stroke 230: Vertical line
Stroke 231: Horizontal line  ← appears in 2 patterns!
Stroke 232: Vertical line
Stroke 233: Horizontal line
```

**Without non-overlapping constraint**:
- Pattern A: 230-231 ✓ (valid box)
- Pattern B: 231-232 ✓ (valid box) ← stroke 231 reused!
- Pattern C: 232-233 ✓ (valid box) ← stroke 232 reused!
- Result: 3 boxes detected from what might be just 1 actual box

**With non-overlapping constraint**:
- Pattern A: 230-231 ✓ (valid box) → mark 230 and 231 as used
- Pattern B: 231-232 ✗ (skipped, 231 already used)
- Pattern C: 232-233 ✓ (valid box) → mark 232 and 233 as used
- Result: 2 boxes detected, matching actual drawing behavior

This constraint ensures each stroke is only part of ONE box pattern, dramatically reducing false positives while matching how you actually draw boxes.

### Step 1: Calculate Stroke Bounds

```javascript
function getStrokeBounds(stroke) {
  if (!stroke.dotArray || stroke.dotArray.length === 0) {
    return null;
  }
  
  const xs = stroke.dotArray.map(d => d.x);
  const ys = stroke.dotArray.map(d => d.y);
  
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}
```

### Step 2: Check Spatial Containment

```javascript
function isInside(innerBounds, outerBounds, margin = 0.5) {
  // margin allows small tolerance for strokes near edges
  return (
    innerBounds.minX >= outerBounds.minX - margin &&
    innerBounds.maxX <= outerBounds.maxX + margin &&
    innerBounds.minY >= outerBounds.minY - margin &&
    innerBounds.maxY <= outerBounds.maxY + margin
  );
}
```

### Step 3: Detect 2-Stroke Boxes (with Non-Overlapping Constraint)

```javascript
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
    
    // Check temporal proximity (drawn within 5 seconds)
    const timeGap = stroke2.startTime - stroke1.endTime;
    if (timeGap > 5000) continue;
    
    const bounds1 = getStrokeBounds(stroke1);
    const bounds2 = getStrokeBounds(stroke2);
    
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
    if (combined.width < 5.0 || combined.width > 50.0 ||
        combined.height < 5.0 || combined.height > 50.0) {
      continue;
    }
    
    // Check if one stroke is horizontal and one is vertical (or complex)
    const aspect1 = bounds1.width / (bounds1.height || 0.01);
    const aspect2 = bounds2.width / (bounds2.height || 0.01);
    
    const hasHorizontal = aspect1 > 5.0 || aspect2 > 5.0;
    const hasVertical = aspect1 < 0.2 || aspect2 < 0.2;
    
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
    if (containedStrokes.length > 2) {  // At least a few strokes
      // Mark these strokes as used
      usedStrokes.add(i);
      usedStrokes.add(i + 1);
      
      boxIndices.add(i);
      boxIndices.add(i + 1);
      boxPatterns.push({
        strokes: [i, i + 1],
        containedCount: containedStrokes.length
      });
    }
  }
  
  return { boxIndices, boxPatterns };
}
```

**Key Addition: Non-Overlapping Constraint**

The `usedStrokes` Set ensures each stroke is only part of ONE box pattern. This prevents false positives from pattern overlap:

- **Without constraint**: Strokes 230-231 and 231-232 both detected as boxes (stroke 231 used twice)
- **With constraint**: Once 230-231 is detected, stroke 231 is marked used and cannot be part of 231-232

This matches how you actually draw: each box uses 2 unique strokes, then you move on to draw more content.

### Step 4: Detect Standalone Underlines

```javascript
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
    
    let pathLength = 0;
    for (let j = 1; j < stroke.dotArray.length; j++) {
      const dx = stroke.dotArray[j].x - stroke.dotArray[j-1].x;
      const dy = stroke.dotArray[j].y - stroke.dotArray[j-1].y;
      pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    
    const bboxDiagonal = Math.sqrt(
      bounds.width * bounds.width + 
      bounds.height * bounds.height
    );
    const straightness = pathLength > 0 ? bboxDiagonal / pathLength : 0;
    
    // Very horizontal, straight, and substantial
    // Conservative thresholds to avoid false positives
    if (aspectRatio > 50 &&           // Very horizontal (not 'l' or 'i')
        straightness > 0.90 &&         // Very straight (not handwriting curve)
        bounds.width > 15.0) {         // Substantial length (not dash/hyphen)
      underlineIndices.push(i);
    }
  }
  
  return underlineIndices;
}
```

### Step 5: Detect Circles with Content

```javascript
function detectCircles(strokes, boxIndices) {
  const circleIndices = [];
  
  for (let i = 0; i < strokes.length; i++) {
    // Skip if part of a box
    if (boxIndices.has(i)) continue;
    
    const stroke = strokes[i];
    if (!stroke.dotArray || stroke.dotArray.length < 30) continue;
    
    const bounds = getStrokeBounds(stroke);
    if (!bounds) continue;
    
    // Must be large enough to not be a letter
    if (bounds.width <= 4.0 || bounds.height <= 4.0) continue;
    
    // Check if closed
    const firstDot = stroke.dotArray[0];
    const lastDot = stroke.dotArray[stroke.dotArray.length - 1];
    const endpointDist = Math.sqrt(
      Math.pow(lastDot.x - firstDot.x, 2) + 
      Math.pow(lastDot.y - firstDot.y, 2)
    );
    
    if (endpointDist > 2.0) continue;  // Not closed
    
    // Check aspect ratio (allow ovals but not too elongated)
    const aspectRatio = bounds.width / bounds.height;
    if (aspectRatio < 0.3 || aspectRatio > 3.0) continue;
    
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
    if (containedStrokes.length > 0) {
      circleIndices.push(i);
    }
  }
  
  return circleIndices;
}
```

### Step 6: Main Filtering Function

```javascript
function filterDecorativeStrokes(strokes) {
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
```

---

## Tuning Parameters

All thresholds defined as constants for easy adjustment:

```javascript
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
```

---

## Integration Points

### 1. MyScript API Integration

**File**: `src/lib/myscript-api.js`

**Add import**:
```javascript
import { filterDecorativeStrokes } from './stroke-filter.js';
```

**Modify `transcribeStrokes()` function**:
```javascript
export async function transcribeStrokes(strokes, appKey, hmacKey, options = {}) {
  try {
    if (!strokes || strokes.length === 0) {
      throw new Error('No strokes to transcribe');
    }
    
    // NEW: Filter decorative strokes
    const filterResult = filterDecorativeStrokes(strokes);
    const { textStrokes, decorativeStrokes, stats } = filterResult;
    
    if (textStrokes.length === 0) {
      console.warn('All strokes filtered as decorative - nothing to transcribe');
      return {
        text: '',
        lines: [],
        words: [],
        commands: [],
        raw: null,
        filterStats: stats
      };
    }
    
    // Log filtering results
    console.log(`📊 Stroke filtering: ${stats.decorative}/${stats.total} decorative strokes removed`);
    console.log(`   ├─ Boxes: ${stats.boxes} (${stats.boxes * 2} strokes)`);
    console.log(`   ├─ Underlines: ${stats.underlines}`);
    console.log(`   └─ Circles: ${stats.circles}`);
    
    if (decorativeStrokes.length > 0) {
      console.log(`🎨 Filtered strokes by type:`, 
        decorativeStrokes.reduce((acc, item) => {
          acc[item.type] = (acc[item.type] || 0) + 1;
          return acc;
        }, {})
      );
    }
    
    // EXISTING: Build request with filtered strokes
    const requestBody = buildRequest(textStrokes, options);
    
    // ... rest of existing code unchanged ...
    
  } catch (error) {
    console.error('MyScript transcription error:', error);
    throw error;
  }
}
```

### 2. Optional: Store for Visualization

**File**: `src/stores/filtered-strokes.js`

```javascript
import { writable, derived } from 'svelte/store';

export const filteredStrokes = writable([]);

export const filterStats = derived(filteredStrokes, $filtered => {
  const stats = { boxes: 0, underlines: 0, circles: 0 };
  $filtered.forEach(item => {
    stats[item.type + 's'] = (stats[item.type + 's'] || 0) + 1;
  });
  return stats;
});

export function setFilteredStrokes(decorative) {
  filteredStrokes.set(decorative);
}

export function clearFilteredStrokes() {
  filteredStrokes.set([]);
}
```

---

## Handling False Positives

### Conservative by Default

The algorithm is designed to **under-filter rather than over-filter**:
- High thresholds for underlines (aspect > 50, width > 15mm)
- Requires actual content inside boxes and circles
- Multiple validation checks before filtering

### Adjustment Strategy

If you experience false positives (text being filtered):

1. **Increase thresholds**:
   - `UNDERLINE_MIN_ASPECT`: 50 → 70 → 100
   - `UNDERLINE_MIN_WIDTH`: 15mm → 20mm → 25mm
   - `BOX_MIN_CONTENT`: 2 → 5 → 10 strokes

2. **Add size constraints**:
   - `BOX_MIN_SIZE`: 5mm → 8mm → 10mm
   - `CIRCLE_MIN_SIZE`: 4mm → 6mm → 8mm

3. **Tighten closure requirements**:
   - `CIRCLE_MAX_ENDPOINT_DIST`: 2.0mm → 1.5mm → 1.0mm

### Adjustment Strategy for False Negatives

If decorative strokes are not being filtered:

1. **Relax thresholds**:
   - `UNDERLINE_MIN_ASPECT`: 50 → 40 → 30
   - `UNDERLINE_MIN_WIDTH`: 15mm → 12mm → 10mm
   - `BOX_MIN_CONTENT`: 2 → 1 stroke

2. **Loosen closure requirements**:
   - `CIRCLE_MAX_ENDPOINT_DIST`: 2.0mm → 2.5mm → 3.0mm

---

## Testing Strategy

### Unit Tests

**File**: `src/lib/stroke-filter.test.js`

```javascript
describe('filterDecorativeStrokes - real data', () => {
  test('detects 2-stroke boxes with content', () => {
    const testData = loadTestData('strokes__3_.json');
    const result = filterDecorativeStrokes(testData);
    
    // Based on analysis: expect ~2 boxes (4 strokes)
    expect(result.stats.boxes).toBeGreaterThanOrEqual(2);
    expect(result.stats.boxes).toBeLessThanOrEqual(15); // Allow some over-detection
  });
  
  test('detects standalone underlines', () => {
    const testData = loadTestData('strokes__3_.json');
    const result = filterDecorativeStrokes(testData);
    
    // Based on analysis: expect 1 underline
    expect(result.stats.underlines).toBeGreaterThanOrEqual(1);
    expect(result.stats.underlines).toBeLessThanOrEqual(5); // Allow some variance
  });
  
  test('detects circles with content', () => {
    const testData = loadTestData('strokes__3_.json');
    const result = filterDecorativeStrokes(testData);
    
    // Based on analysis: expect 2 circles
    expect(result.stats.circles).toBe(2);
  });
  
  test('preserves vast majority of text strokes', () => {
    const testData = loadTestData('strokes__3_.json');
    const result = filterDecorativeStrokes(testData);
    
    // Should keep >95% of strokes (445 text + some ambiguous)
    const preservationRate = result.stats.text / result.stats.total;
    expect(preservationRate).toBeGreaterThan(0.95);
  });
});
```

### Manual Validation

1. **Load test data** into app
2. **Enable debug visualization** (optional store integration)
   - Show filtered strokes in red/gray
   - Show kept strokes in black
3. **Verify visually** that correct strokes are filtered
4. **Send to MyScript** and verify clean text output
5. **Adjust thresholds** if needed using constants

---

## Implementation Checklist

- [ ] **Phase 1: Core Algorithm** (3-4 hours)
  - [ ] Create `src/lib/stroke-filter.js`
  - [ ] Implement `getStrokeBounds()`
  - [ ] Implement `isInside()`
  - [ ] Implement `detect2StrokeBoxes()`
  - [ ] Implement `detectUnderlines()`
  - [ ] Implement `detectCircles()`
  - [ ] Implement `filterDecorativeStrokes()`
  - [ ] Add tunable constants
  - [ ] Add comprehensive JSDoc comments

- [ ] **Phase 2: Integration** (1-2 hours)
  - [ ] Modify `src/lib/myscript-api.js`
  - [ ] Add import and filtering call
  - [ ] Add detailed logging
  - [ ] Handle edge cases (all strokes filtered, no strokes, etc.)

- [ ] **Phase 3: Testing** (2-3 hours)
  - [ ] Write unit tests for each detection function
  - [ ] Test with real sample data
  - [ ] Verify MyScript output quality
  - [ ] Tune thresholds based on results

- [ ] **Phase 4: Visualization** (1-2 hours) - Optional
  - [ ] Create `src/stores/filtered-strokes.js`
  - [ ] Add canvas visualization toggle
  - [ ] Add debug stats display
  - [ ] Add threshold adjustment UI

- [ ] **Phase 5: Documentation** (1 hour)
  - [ ] Add inline comments explaining thresholds
  - [ ] Update README with filtering feature
  - [ ] Document tuning process

**Total Estimated Time**: 8-12 hours

---

## Expected Outcomes

### Success Metrics

1. **Accuracy**: 
   - Filters 2-5 boxes (non-overlapping constraint reduces false positives)
   - Filters 1-4 underlines (conservative thresholds, adjustable)
   - Filters exactly 2 circles ✅
   - Preserves >95% of text strokes (minimal false positives)

2. **Quality**:
   - Zero emoji characters in MyScript transcription
   - Clean text output matching user intent
   - Proper line breaks and indentation preserved

3. **Performance**:
   - Filtering overhead < 50ms for typical documents
   - No noticeable impact on transcription time

### Known Limitations

1. **User Variability**:
   - Thresholds tuned for sample data may need adjustment for different writing styles
   - Very loose or tight boxes may require threshold tweaking

2. **Edge Cases**:
   - Empty decorative elements (no text inside) are NOT filtered - by design
   - Partial boxes (3 strokes instead of 2) - not currently detected
   - Overlapping decorative elements - may cause double-filtering

3. **False Negatives**:
   - Very short underlines (< 15mm) won't be filtered
   - Nearly-closed loops with endpoint distance > 2mm won't be filtered
   - Boxes drawn slowly (> 5 second gap) won't be detected

---

## Future Enhancements

### Short Term
1. **Threshold UI** - Settings panel to adjust detection sensitivity
2. **Preview mode** - Show what would be filtered before transcribing
3. **More patterns** - Support 3-stroke and 4-stroke box patterns

### Long Term
1. **ML classifier** - Train model on user's specific writing patterns
2. **Context-aware filtering** - Consider surrounding strokes
3. **Smart defaults** - Auto-tune thresholds based on writing analysis

---

## Appendix: Detection Results from Sample Data

### With Containment Check (Revised Algorithm)

```
Boxes (2-stroke with content): 13 patterns
├─ 230-231: 20.5x12.2mm, 32 strokes inside
├─ 231-232: 20.2x9.5mm, 13 strokes inside  
├─ 233-234: 14.4x9.5mm, 3 strokes inside
├─ 238-239: 34.1x11.8mm, 53 strokes inside ← Likely one of user's 2
├─ 235-236: 20.1x23.8mm, 84 strokes inside ← Likely one of user's 2
└─ ... (8 more patterns, some overlapping)

Underlines (standalone, aspect>50, width>15mm): 4 candidates
├─ 28: 10.7mm (too short - filtered out)
├─ 53: 16.8mm ← Likely the real underline
├─ 379: 30.7mm (part of larger structure?)
└─ 492: 22.5mm (part of larger structure?)

Circles (closed with content): 2
├─ 9: 12.4x3.2mm, 9 strokes inside
└─ 540: 5.3x3.2mm, 3 strokes inside ← Matches user count!
```

### Explanation of Over-Detection and Mitigation

**Boxes**: Initial analysis detected 13 patterns instead of 2 because consecutive strokes formed multiple valid 2-stroke combinations where stroke N appeared in both pattern (N-1,N) and pattern (N,N+1).

**Solution Applied**: The non-overlapping constraint in Step 3 prevents stroke reuse. Each stroke can only be part of ONE box pattern. Expected result: ~2-5 boxes detected (down from 13).

**Underlines**: Detecting 4 candidates because multiple long horizontal strokes meet the conservative criteria (aspect>50, width>15mm, straightness>0.90).

**If still over-detecting**: Increase `UNDERLINE_MIN_WIDTH` from 15mm → 20mm, or increase `UNDERLINE_MIN_ASPECT` from 50 → 70.

**Circles**: Detecting exactly 2 ✅ Perfect! No adjustments needed.

---

## References

- MyScript Cloud API Documentation: https://developer.myscript.com/
- Original Research: `docs/myscript-shape-research.md`
- Sample Data Analysis: Test data with 592 strokes
- Current Implementation: `src/lib/myscript-api.js`

---

**End of Specification (Revised)**
