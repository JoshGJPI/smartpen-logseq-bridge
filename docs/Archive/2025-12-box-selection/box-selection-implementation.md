# Box Selection Implementation Plan

## Overview
Add window/box selection to the stroke canvas, allowing users to drag-select multiple strokes at once, along with improved ctrl+click functionality for individual stroke selection/deselection.

## Current State Analysis

### What Works
- ✅ Selection state managed in `stores/selection.js` using a `Set` of indices
- ✅ Canvas click detection via `hitTest()` finds strokes at a point
- ✅ Ctrl+click and Shift+click work in the list view
- ✅ Canvas has basic click handler that calls `handleStrokeClick()`
- ✅ Visual highlighting of selected strokes (red color)

### What's Missing
- ❌ Box/window selection (drag to select multiple strokes)
- ❌ Ctrl+click on canvas doesn't properly toggle selection
- ❌ Visual feedback for selection box while dragging
- ❌ Logic to find all strokes within a rectangle

## Implementation Requirements

### 1. Box Selection UI State

**New Svelte store or component state needed:**
```javascript
// In StrokeCanvas.svelte
let isBoxSelecting = false;
let boxStartX = 0;
let boxStartY = 0;
let boxCurrentX = 0;
let boxCurrentY = 0;
```

### 2. Mouse Event Flow for Box Selection

**Current behavior:**
- `mousedown` → Start pan (if middle button or shift+left)
- `mousemove` → Pan if dragging
- `mouseup` → End pan
- `click` → Select stroke via `hitTest()`

**New behavior needed:**
- `mousedown` (left button, no modifiers) → Start potential box selection OR start pan
- `mousemove` → If dragging beyond threshold, activate box selection mode
- `mouseup` → Complete box selection, find intersecting strokes
- `click` → If no drag occurred, use existing stroke selection logic

### 3. Conflict Resolution

**Problem:** Current code uses Shift+drag for panning. Box selection typically uses plain drag.

**Solution options:**
1. **Option A (Recommended):** Keep Shift+drag for pan, use plain left-click-drag for box selection
   - Pros: Most intuitive for users expecting standard selection behavior
   - Cons: Removes plain click stroke selection (but we have list view for that)

2. **Option B:** Use Alt+drag for box selection
   - Pros: Preserves current click behavior
   - Cons: Less discoverable, non-standard modifier

3. **Option C:** Toggle mode with button/keyboard
   - Pros: No conflicts
   - Cons: Extra UI complexity

**Recommended: Option A** - Plain drag for box selection, keep Shift+drag for pan

### 4. Intersection Detection Algorithm

**Method 1: Bounding Box Intersection (Fast, Less Accurate)**
```javascript
/**
 * Check if a stroke's bounding box intersects with selection rectangle
 */
function strokeIntersectsBox(stroke, boxRect) {
  const strokeBounds = getStrokeBounds(stroke);
  
  return !(strokeBounds.right < boxRect.left || 
           strokeBounds.left > boxRect.right ||
           strokeBounds.bottom < boxRect.top ||
           strokeBounds.top > boxRect.bottom);
}

function getStrokeBounds(stroke) {
  const dots = stroke.dotArray || stroke.dots || [];
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  dots.forEach(dot => {
    const screen = ncodeToScreen(dot);
    minX = Math.min(minX, screen.x);
    minY = Math.min(minY, screen.y);
    maxX = Math.max(maxX, screen.x);
    maxY = Math.max(maxY, screen.y);
  });
  
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}
```

**Method 2: Point-in-Rectangle Check (More Accurate)**
```javascript
/**
 * Check if any dot of the stroke is inside the selection box
 */
function strokeIntersectsBox(stroke, boxRect) {
  const dots = stroke.dotArray || stroke.dots || [];
  
  return dots.some(dot => {
    const screen = ncodeToScreen(dot);
    return screen.x >= boxRect.left && 
           screen.x <= boxRect.right &&
           screen.y >= boxRect.top && 
           screen.y <= boxRect.bottom;
  });
}
```

**Recommendation:** Start with Method 1 (bounding box) for performance, add Method 2 as an option later.

### 5. Visual Feedback

**Selection rectangle overlay:**
```svelte
{#if isBoxSelecting}
  <div 
    class="selection-box"
    style="
      left: {Math.min(boxStartX, boxCurrentX)}px;
      top: {Math.min(boxStartY, boxCurrentY)}px;
      width: {Math.abs(boxCurrentX - boxStartX)}px;
      height: {Math.abs(boxCurrentY - boxStartY)}px;
    "
  ></div>
{/if}
```

**CSS:**
```css
.selection-box {
  position: absolute;
  border: 2px dashed var(--accent);
  background: rgba(233, 69, 96, 0.1);
  pointer-events: none;
  z-index: 10;
}
```

## Implementation Steps

### Phase 1: Add Box Selection State (30 min)

**File: `src/components/canvas/StrokeCanvas.svelte`**

1. Add box selection state variables
2. Add selection box overlay to template
3. Add CSS for selection box

### Phase 2: Implement Mouse Event Logic (1 hour)

**File: `src/components/canvas/StrokeCanvas.svelte`**

1. Modify `handleMouseDown`:
   - Detect if starting box selection (left click, no modifiers, not on pan mode)
   - Set `isBoxSelecting = true` if drag distance exceeds threshold

2. Modify `handleMouseMove`:
   - Update box coordinates if in box selection mode
   - Debounce/throttle for performance

3. Modify `handleMouseUp`:
   - Calculate final selection box
   - Find intersecting strokes
   - Update selection store
   - Reset box selection state

4. Update `handleCanvasClick`:
   - Skip if box selection occurred
   - Implement proper ctrl+click toggle behavior

### Phase 3: Add Intersection Detection (45 min)

**File: `src/lib/canvas-renderer.js`**

Add new methods:
```javascript
/**
 * Get bounding box for a stroke in screen coordinates
 */
getStrokeBounds(stroke) {
  // Implementation
}

/**
 * Find all strokes that intersect with a screen rectangle
 */
findStrokesInRect(strokes, rect) {
  return strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => this.strokeIntersectsBox(stroke, rect))
    .map(({ index }) => index);
}
```

### Phase 4: Integrate with Selection Store (30 min)

**File: `src/stores/selection.js`**

Add new action:
```javascript
/**
 * Set selection from box selection
 * @param {number[]} indices - Array of stroke indices
 * @param {boolean} additive - Whether to add to existing selection (Ctrl held)
 */
export function selectFromBox(indices, additive = false) {
  selectedIndices.update(sel => {
    const newSel = additive ? new Set(sel) : new Set();
    indices.forEach(i => newSel.add(i));
    return newSel;
  });
}
```

### Phase 5: Improve Ctrl+Click Behavior (15 min)

**Current issue:** Canvas click might not properly respect Ctrl for toggling.

**Fix in `src/components/canvas/StrokeCanvas.svelte`:**
```javascript
function handleCanvasClick(event) {
  if (didPan || isBoxSelecting) {
    didPan = false;
    isBoxSelecting = false;
    return;
  }
  
  if (!renderer) return;
  
  const rect = canvasElement.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  const strokeIndex = renderer.hitTest(x, y, filteredStrokes);
  
  if (strokeIndex !== -1) {
    handleStrokeClick(strokeIndex, event.ctrlKey || event.metaKey, event.shiftKey);
  } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
    clearSelection(); // Clear only if no modifiers
  }
}
```

### Phase 6: Add User Feedback & Polish (30 min)

1. **Cursor changes:**
   - Crosshair cursor during box selection
   - Default cursor otherwise

2. **Keyboard shortcuts:**
   - Escape to cancel active box selection
   - Ctrl+A to select all visible strokes

3. **Instructions/hints:**
   - Update the pan hint to include selection instructions

## Code Changes Required

### 1. StrokeCanvas.svelte

**New state variables:**
```javascript
// Box selection state
let isBoxSelecting = false;
let boxStartX = 0;
let boxStartY = 0;
let boxCurrentX = 0;
let boxCurrentY = 0;
let dragThreshold = 5; // pixels before activating box selection
```

**Updated event handlers:**
```javascript
function handleMouseDown(event) {
  // Panning (Shift+drag or middle button)
  if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
    event.preventDefault();
    isPanning = true;
    didPan = false;
    panStartX = event.clientX;
    panStartY = event.clientY;
    canvasElement.style.cursor = 'grabbing';
    return;
  }
  
  // Start potential box selection (plain left click)
  if (event.button === 0) {
    event.preventDefault();
    const rect = canvasElement.getBoundingClientRect();
    boxStartX = event.clientX - rect.left;
    boxStartY = event.clientY - rect.top;
    boxCurrentX = boxStartX;
    boxCurrentY = boxStartY;
    
    // Check if clicking on a stroke for direct selection
    const strokeIndex = renderer.hitTest(boxStartX, boxStartY, filteredStrokes);
    if (strokeIndex !== -1 && (event.ctrlKey || event.metaKey)) {
      // Ctrl+click on stroke - toggle it immediately
      handleStrokeClick(strokeIndex, true, false);
      return;
    }
    
    // Otherwise, prepare for box selection
    isBoxSelecting = false; // Will activate on move
  }
}

function handleMouseMove(event) {
  if (isPanning && renderer) {
    const deltaX = event.clientX - panStartX;
    const deltaY = event.clientY - panStartY;
    
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      didPan = true;
      renderer.pan(deltaX, deltaY);
      renderStrokes();
      panStartX = event.clientX;
      panStartY = event.clientY;
    }
    return;
  }
  
  // Update box selection
  if (boxStartX !== 0 || boxStartY !== 0) {
    const rect = canvasElement.getBoundingClientRect();
    boxCurrentX = event.clientX - rect.left;
    boxCurrentY = event.clientY - rect.top;
    
    const dx = boxCurrentX - boxStartX;
    const dy = boxCurrentY - boxStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > dragThreshold) {
      isBoxSelecting = true;
      canvasElement.style.cursor = 'crosshair';
    }
  }
}

function handleMouseUp(event) {
  if (isPanning) {
    isPanning = false;
    canvasElement.style.cursor = 'default';
    return;
  }
  
  if (isBoxSelecting) {
    // Complete box selection
    const rect = {
      left: Math.min(boxStartX, boxCurrentX),
      top: Math.min(boxStartY, boxCurrentY),
      right: Math.max(boxStartX, boxCurrentX),
      bottom: Math.max(boxStartY, boxCurrentY)
    };
    
    const intersectingIndices = renderer.findStrokesInRect(filteredStrokes, rect);
    
    if (intersectingIndices.length > 0) {
      selectFromBox(intersectingIndices, event.ctrlKey || event.metaKey);
    }
    
    // Reset
    isBoxSelecting = false;
    boxStartX = 0;
    boxStartY = 0;
    boxCurrentX = 0;
    boxCurrentY = 0;
    canvasElement.style.cursor = 'default';
  }
}
```

**Template addition:**
```svelte
{#if isBoxSelecting}
  <div 
    class="selection-box"
    style="
      left: {Math.min(boxStartX, boxCurrentX)}px;
      top: {Math.min(boxStartY, boxCurrentY)}px;
      width: {Math.abs(boxCurrentX - boxStartX)}px;
      height: {Math.abs(boxCurrentY - boxStartY)}px;
    "
  ></div>
{/if}
```

**New CSS:**
```css
.selection-box {
  position: absolute;
  border: 2px dashed var(--accent);
  background: rgba(233, 69, 96, 0.1);
  pointer-events: none;
  z-index: 10;
}
```

### 2. canvas-renderer.js

**New methods:**
```javascript
/**
 * Get bounding box for a stroke in screen coordinates
 * @param {Object} stroke - Stroke object
 * @returns {Object} Bounds object with left, top, right, bottom
 */
getStrokeBounds(stroke) {
  const dots = stroke.dotArray || stroke.dots || [];
  if (dots.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  dots.forEach(dot => {
    const screen = this.ncodeToScreen(dot);
    minX = Math.min(minX, screen.x);
    minY = Math.min(minY, screen.y);
    maxX = Math.max(maxX, screen.x);
    maxY = Math.max(maxY, screen.y);
  });
  
  return { 
    left: minX, 
    top: minY, 
    right: maxX, 
    bottom: maxY 
  };
}

/**
 * Check if stroke bounding box intersects with rectangle
 * @param {Object} stroke - Stroke object
 * @param {Object} rect - Rectangle with left, top, right, bottom
 * @returns {boolean} True if intersects
 */
strokeIntersectsBox(stroke, rect) {
  const bounds = this.getStrokeBounds(stroke);
  
  return !(bounds.right < rect.left || 
           bounds.left > rect.right ||
           bounds.bottom < rect.top ||
           bounds.top > rect.bottom);
}

/**
 * Find all stroke indices that intersect with a rectangle
 * @param {Array} strokes - Array of stroke objects
 * @param {Object} rect - Rectangle with left, top, right, bottom
 * @returns {number[]} Array of intersecting stroke indices
 */
findStrokesInRect(strokes, rect) {
  return strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => this.strokeIntersectsBox(stroke, rect))
    .map(({ index }) => index);
}
```

### 3. selection.js

**New action:**
```javascript
/**
 * Set selection from box selection
 * @param {number[]} indices - Array of stroke indices to select
 * @param {boolean} additive - Whether to add to existing selection
 */
export function selectFromBox(indices, additive = false) {
  selectedIndices.update(sel => {
    const newSel = additive ? new Set(sel) : new Set();
    indices.forEach(i => newSel.add(i));
    return newSel;
  });
  
  if (indices.length > 0) {
    lastSelectedIndex.set(indices[indices.length - 1]);
  }
}
```

## Testing Plan

### Manual Testing Checklist

1. **Box Selection**
   - [ ] Plain drag creates selection box
   - [ ] Selection box is visible with dashed border
   - [ ] Releasing mouse selects all intersecting strokes
   - [ ] Strokes are highlighted in red when selected
   - [ ] Selection count updates correctly

2. **Additive Selection**
   - [ ] Ctrl+drag adds to existing selection
   - [ ] Previously selected strokes remain selected
   - [ ] New strokes are added to selection

3. **Ctrl+Click**
   - [ ] Ctrl+click on unselected stroke adds it
   - [ ] Ctrl+click on selected stroke removes it
   - [ ] Works correctly with canvas zoom/pan

4. **Interaction with Pan**
   - [ ] Shift+drag still pans the canvas
   - [ ] Middle-click drag still pans
   - [ ] Box selection doesn't interfere with panning

5. **Edge Cases**
   - [ ] Dragging beyond canvas bounds works correctly
   - [ ] Empty selection box (no strokes) doesn't error
   - [ ] Very small drags are treated as clicks, not box selection
   - [ ] Clicking empty space clears selection (without Ctrl)

6. **Visual Feedback**
   - [ ] Cursor changes to crosshair during box selection
   - [ ] Cursor returns to default after selection
   - [ ] Selection box disappears after mouse up

7. **Performance**
   - [ ] Box selection is smooth with 100+ strokes
   - [ ] No lag when dragging selection box
   - [ ] Hit detection is responsive

## Estimated Time

- **Phase 1:** 30 minutes
- **Phase 2:** 1 hour
- **Phase 3:** 45 minutes
- **Phase 4:** 30 minutes
- **Phase 5:** 15 minutes
- **Phase 6:** 30 minutes

**Total: ~4 hours**

## Future Enhancements

1. **More selection methods:**
   - Lasso selection (freehand draw)
   - Select by page
   - Select by time range

2. **Selection operations:**
   - Invert selection
   - Select similar strokes (by color, pressure, etc.)
   - Selection history (undo/redo)

3. **Visual improvements:**
   - Animated selection box
   - Show count of strokes during selection
   - Preview selection before releasing mouse

4. **Keyboard shortcuts:**
   - Arrow keys to extend selection
   - Tab to cycle through strokes
   - Ctrl+D to duplicate selected strokes

## Dependencies

- No new npm packages required
- Uses existing Svelte store system
- Uses existing canvas renderer infrastructure
- Compatible with current Svelte 4 setup

## Compatibility Notes

- Works with existing pan/zoom functionality
- Compatible with current selection store
- Does not break list view selection
- Works across all supported browsers (Chrome/Edge)
