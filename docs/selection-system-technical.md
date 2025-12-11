# Selection System - Technical Documentation

**Addendum to app-specification.md**  
**Version:** 1.0  
**Last Updated:** December 2025  
**Status:** Implemented and Tested

---

## Overview

This document provides technical documentation for the selection system implemented in the SmartPen-LogSeq Bridge application. The selection system allows users to select individual strokes or groups of strokes using multiple methods and modes.

## Selection Methods

### 1. Box Selection (Drag on Canvas)

Users can create a selection rectangle by clicking and dragging on the canvas. The system supports three modes based on keyboard modifiers:

#### Replace Mode (Plain Drag)
```
User Action: Click and drag
Modifier: None
Result: All strokes intersecting the box are selected
Previous Selection: Cleared
Use Case: Starting fresh selection of a region
```

#### Add Mode (Ctrl+Drag)
```
User Action: Click and drag
Modifier: Ctrl (Windows/Linux) or Cmd (Mac)
Result: Strokes in box are added to existing selection
Previous Selection: Preserved
Use Case: Building complex selections across multiple areas
```

#### Toggle Mode (Shift+Drag)
```
User Action: Click and drag
Modifier: Shift
Result: Strokes in box toggle their selection state
  - Selected strokes → Unselected
  - Unselected strokes → Selected
Previous Selection: Modified based on toggle logic
Use Case: Refining selections by removing or adding strokes
```

### 2. Individual Stroke Selection (Click)

#### Single Click
```
User Action: Click on stroke
Modifier: None
Result: Only that stroke is selected
Previous Selection: Cleared
Use Case: Selecting a single stroke
```

#### Toggle Click (Ctrl+Click or Shift+Click)
```
User Action: Click on stroke
Modifier: Ctrl/Cmd or Shift
Result: Stroke toggles its selection state
  - If selected → Unselected
  - If unselected → Selected
Previous Selection: All others preserved
Use Case: Adding/removing individual strokes from selection
```

**Note**: Both Ctrl and Shift behave identically for individual clicks. This simplifies the mental model—any modifier means "toggle this stroke."

### 3. Select All
```
Keyboard: Ctrl+A (Windows/Linux) or Cmd+A (Mac)
Result: All visible strokes are selected
Previous Selection: Replaced
Use Case: Quick selection of all strokes
```

### 4. Clear Selection
```
Action: Click on empty canvas space
Modifier: None
Result: All selections cleared
Use Case: Starting over with selection
```

---

## Technical Implementation

### Component Architecture

#### StrokeCanvas.svelte (Main Component)

**State Variables:**
```javascript
let isBoxSelecting = false;         // Currently dragging selection box
let boxSelectPending = false;       // Waiting to exceed drag threshold
let didBoxSelect = false;           // Just completed box selection (prevent click)
let boxStartX = 0;                  // Selection box start X
let boxStartY = 0;                  // Selection box start Y
let boxCurrentX = 0;                // Current mouse X during drag
let boxCurrentY = 0;                // Current mouse Y during drag
let dragThreshold = 5;              // Pixels before activating box mode
```

**Event Flow:**

```
handleMouseDown()
│
├─ Button 1 + Alt → Start pan
├─ Button 1 + Ctrl + on stroke → Toggle stroke immediately
└─ Button 1 (plain) → Start potential box selection
   │
   └─ Set boxSelectPending = true
      
handleMouseMove()
│
└─ If boxSelectPending
   │
   ├─ Calculate distance from start
   └─ If distance > threshold
      │
      └─ isBoxSelecting = true (activate box mode)
         canvasElement.style.cursor = 'crosshair'
      
handleMouseUp()
│
└─ If isBoxSelecting
   │
   ├─ Create rect from box coordinates
   ├─ Find intersecting strokes
   ├─ Determine mode from modifiers
   ├─ Call selectFromBox(indices, mode)
   └─ Set didBoxSelect = true
      
handleCanvasClick()
│
└─ If didBoxSelect
   │
   └─ didBoxSelect = false
      return (skip processing)
```

### Canvas Renderer (lib/canvas-renderer.js)

**New Methods:**

#### getStrokeBounds(stroke)
```javascript
/**
 * Calculate bounding box for a stroke in screen coordinates
 * @param {Object} stroke - Stroke object with dotArray
 * @returns {Object} {left, top, right, bottom} in pixels
 */
getStrokeBounds(stroke) {
  const dots = stroke.dotArray || stroke.dots || [];
  if (dots.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  dots.forEach(dot => {
    const screen = this.ncodeToScreen(dot);  // Apply zoom/pan
    minX = Math.min(minX, screen.x);
    minY = Math.min(minY, screen.y);
    maxX = Math.max(maxX, screen.x);
    maxY = Math.max(maxY, screen.y);
  });
  
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}
```

#### strokeIntersectsBox(stroke, rect)
```javascript
/**
 * Test if stroke bounding box intersects with selection rectangle
 * Uses AABB (Axis-Aligned Bounding Box) collision detection
 * @param {Object} stroke - Stroke object
 * @param {Object} rect - {left, top, right, bottom} in pixels
 * @returns {boolean} True if intersects
 */
strokeIntersectsBox(stroke, rect) {
  const bounds = this.getStrokeBounds(stroke);
  
  // No intersection if:
  // - Stroke is entirely to the left of rect
  // - Stroke is entirely to the right of rect
  // - Stroke is entirely above rect
  // - Stroke is entirely below rect
  return !(bounds.right < rect.left || 
           bounds.left > rect.right ||
           bounds.bottom < rect.top ||
           bounds.top > rect.bottom);
}
```

**AABB Collision Visual:**
```
Intersection detected:
┌────────┐
│ Stroke │
│  ┌──┼──┼───┐
│  │  │  │   │  Selection
└──┼──┘  │   │  Rectangle
   │     │   │
   └─────┴───┘

No intersection (stroke left of rect):
┌────────┐   ┌───────┐
│ Stroke │   │ Rect  │
└────────┘   └───────┘
```

#### findStrokesInRect(strokes, rect)
```javascript
/**
 * Find all stroke indices that intersect with selection rectangle
 * @param {Array} strokes - Array of stroke objects
 * @param {Object} rect - Selection rectangle
 * @returns {number[]} Array of indices
 */
findStrokesInRect(strokes, rect) {
  return strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => this.strokeIntersectsBox(stroke, rect))
    .map(({ index }) => index);
}
```

**Performance:**
- Time Complexity: O(n) where n = number of strokes
- Space Complexity: O(m) where m = selected strokes
- Tested with 100+ strokes: No perceptible lag
- AABB collision is very fast (simple arithmetic comparisons)

### Selection Store (stores/selection.js)

#### State
```javascript
export const selectedIndices = writable(new Set());
export const lastSelectedIndex = writable(null);

// Derived stores
export const selectedStrokes = derived([strokes, selectedIndices], ...);
export const selectionCount = derived(selectedIndices, $sel => $sel.size);
export const hasSelection = derived(selectedIndices, $sel => $sel.size > 0);
```

#### Actions

**selectFromBox(indices, mode)**
```javascript
/**
 * Set selection from box selection with mode support
 * @param {number[]} indices - Array of stroke indices
 * @param {string} mode - 'replace', 'add', or 'toggle'
 */
export function selectFromBox(indices, mode = 'replace') {
  selectedIndices.update(sel => {
    let newSel;
    
    if (mode === 'replace') {
      // Replace entire selection
      newSel = new Set(indices);
    } else if (mode === 'add') {
      // Add to existing selection
      newSel = new Set(sel);
      indices.forEach(i => newSel.add(i));
    } else if (mode === 'toggle') {
      // Toggle each index
      newSel = new Set(sel);
      indices.forEach(i => {
        if (newSel.has(i)) {
          newSel.delete(i);
        } else {
          newSel.add(i);
        }
      });
    } else {
      // Default to replace
      newSel = new Set(indices);
    }
    
    return newSel;
  });
  
  if (indices.length > 0) {
    lastSelectedIndex.set(indices[indices.length - 1]);
  }
}
```

**handleStrokeClick(index, ctrlKey, shiftKey)**
```javascript
/**
 * Handle stroke click with modifier keys
 * Both Ctrl and Shift now toggle for individual clicks
 */
export function handleStrokeClick(index, ctrlKey, shiftKey) {
  if (shiftKey || ctrlKey) {
    // Toggle selection (multi-select)
    selectStroke(index, true);
  } else {
    // Single selection (clear others)
    selectStroke(index, false);
  }
  
  lastSelectedIndex.set(index);
}
```

**selectStroke(index, multi)**
```javascript
/**
 * Core selection function
 * @param {number} index - Stroke index
 * @param {boolean} multi - If true, toggle; if false, replace
 */
export function selectStroke(index, multi = false) {
  selectedIndices.update(sel => {
    const newSel = multi ? new Set(sel) : new Set();
    if (newSel.has(index)) {
      newSel.delete(index);
    } else {
      newSel.add(index);
    }
    return newSel;
  });
  lastSelectedIndex.set(index);
}
```

---

## Visual Feedback

### Selection Box Overlay
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

```css
.selection-box {
  position: absolute;
  border: 2px dashed var(--accent);  /* Red dashed border */
  background: rgba(233, 69, 96, 0.1); /* Semi-transparent red */
  pointer-events: none;               /* Don't block mouse events */
  z-index: 10;                        /* Above canvas */
}
```

### Stroke Highlighting
```javascript
// In canvas-renderer.js drawStroke()
const color = highlighted ? '#e94560' : '#000000';  // Red if selected
const baseWidth = highlighted ? 3 : 2;              // Thicker if selected
```

### Cursor Changes
```javascript
// Default
canvasElement.style.cursor = 'default';

// During box selection
canvasElement.style.cursor = 'crosshair';

// During pan
canvasElement.style.cursor = 'grabbing';
```

### UI Indicators
- Selection count badge in stroke list
- Selection info panel below canvas
- Highlighted stroke items in list view

---

## Interaction Conflict Resolution

### Problem 1: Pan vs. Selection (Both Use Drag)

**Original Design:**
- Shift+drag = Pan
- Plain drag = ???

**Problem:** If plain drag is selection, Shift+drag can't also be toggle selection

**Solution:**
```
Alt+drag = Pan
Plain drag = Box selection (replace)
Shift+drag = Box selection (toggle)
Ctrl+drag = Box selection (add)
Middle-click drag = Pan (alternative)
```

No overlap between pan and selection triggers.

### Problem 2: Click After Box Selection

**Sequence:**
```
1. User completes box selection
2. handleMouseUp() processes selection
3. isBoxSelecting = false
4. Mouse button is released
5. Click event fires (native browser behavior)
6. handleCanvasClick() sees isBoxSelecting === false
7. Treats it as normal click on empty space
8. Clears selection! ❌
```

**Solution: didBoxSelect Flag**
```javascript
// In handleMouseUp()
if (isBoxSelecting && renderer) {
  // ... process box selection ...
  didBoxSelect = true;  // ← Set flag
}

// In handleCanvasClick()
if (didBoxSelect) {
  didBoxSelect = false;  // ← Reset flag
  return;                // ← Skip processing
}
```

Now click handler knows to skip processing after a box selection.

### Problem 3: Ctrl+Click on Empty Space

**Issue:** Should Ctrl+click on empty space clear selection?

**Decision:** No
- With modifier = preserve selection (don't clear)
- Without modifier = clear selection

**Implementation:**
```javascript
if (strokeIndex !== -1) {
  handleStrokeClick(strokeIndex, ctrlKey, shiftKey);
} else if (!ctrlKey && !metaKey && !shiftKey) {
  clearSelection();  // ← Only clear if NO modifiers
}
```

---

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action | Implementation |
|----------|--------|----------------|
| **Ctrl+A** / **Cmd+A** | Select all | `window.addEventListener('keydown')` |
| **Escape** | Cancel box selection | `window.addEventListener('keydown')` |

### Implementation
```javascript
const handleKeyDown = (e) => {
  // Escape - cancel box selection
  if (e.key === 'Escape' && (isBoxSelecting || boxSelectPending)) {
    isBoxSelecting = false;
    boxSelectPending = false;
    didBoxSelect = false;
    // ... reset coordinates ...
    canvasElement.style.cursor = 'default';
  }
  
  // Ctrl/Cmd+A - select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && filteredStrokes.length > 0) {
    e.preventDefault();
    selectAll(filteredStrokes.length);
  }
};

window.addEventListener('keydown', handleKeyDown);

// Cleanup in onDestroy
return () => {
  window.removeEventListener('keydown', handleKeyDown);
};
```

---

## Common Workflows

### Workflow 1: Build Complex Selection
```
Step 1: Drag over first area
Result: Area 1 selected

Step 2: Ctrl+drag over second area
Result: Area 1 + Area 2 selected

Step 3: Shift+click unwanted stroke
Result: Area 1 + Area 2 minus that stroke
```

### Workflow 2: Refine Large Selection
```
Step 1: Ctrl+A (select all)
Result: All strokes selected

Step 2: Shift+drag over section to remove
Result: All strokes except that section selected

Step 3: Click "Transcribe Selected"
Result: Everything but that section is transcribed
```

### Workflow 3: Precise Manual Selection
```
Step 1: Click stroke A
Result: Only A selected

Step 2: Shift+click stroke B
Result: A and B selected

Step 3: Shift+click stroke C
Result: A, B, and C selected

Step 4: Shift+click stroke A again
Result: B and C selected (A removed)
```

---

## Testing Verification

### Unit Tests
- `selectFromBox()` with each mode
- `strokeIntersectsBox()` boundary cases
- `getStrokeBounds()` with various stroke shapes

### Integration Tests
- Box selection end-to-end
- Modifier combinations
- Pan/selection interaction
- Click after box selection

### Manual Test Cases
✅ Plain drag selects strokes
✅ Ctrl+drag adds to selection
✅ Shift+drag toggles strokes
✅ Ctrl+click toggles individual stroke
✅ Shift+click toggles individual stroke
✅ Alt+drag pans canvas
✅ Escape cancels box selection
✅ Ctrl+A selects all
✅ No auto-deselect bug
✅ Works at all zoom levels
✅ Works with page filtering
✅ List view matches canvas behavior

---

## Performance Characteristics

### Time Complexity
- Box selection: O(n) where n = number of strokes
- Individual click: O(1)
- AABB intersection test: O(1)

### Space Complexity
- Selection Set: O(m) where m = selected strokes
- Box coordinates: O(1)
- Event handlers: O(1)

### Tested Scenarios
- 10 strokes: Instant
- 100 strokes: No perceptible delay
- 500 strokes: Smooth operation
- 1000 strokes: May benefit from virtualization

### Optimization Opportunities
- ✅ Use Set for O(1) membership testing
- ✅ AABB for fast collision detection
- ✅ Debounce unnecessary redraws
- ❌ Spatial indexing (not needed at current scale)
- ❌ Web Workers (not needed at current scale)

---

## Browser Compatibility

### Required APIs
- Canvas 2D Context ✅
- Mouse Events ✅
- Keyboard Events ✅
- Set ✅
- Arrow Functions ✅

### Supported Browsers
- Chrome 56+ ✅
- Edge 79+ ✅
- Opera 43+ ✅
- Firefox ❌ (no Web Bluetooth anyway)
- Safari ❌ (no Web Bluetooth anyway)

---

## Future Enhancements

### Potential Features
1. **Lasso Selection** - Freehand selection path
2. **Smart Selection** - Select by time, color, pressure
3. **Selection History** - Undo/redo selection changes
4. **Selection Groups** - Save named selection sets
5. **Keyboard Navigation** - Arrow keys to move selection
6. **Point-in-Polygon** - More precise intersection testing
7. **Selection Preview** - Show count during drag

### Not Planned
- Range selection (Shift+click between two strokes)
  - Reason: Box selection is more intuitive
- Marquee selection (animated border)
  - Reason: Adds complexity without benefit
- Selection persistence across sessions
  - Reason: Strokes are session-based

---

## API Reference

### Store Exports (stores/selection.js)

```typescript
// State
export const selectedIndices: Writable<Set<number>>;
export const lastSelectedIndex: Writable<number | null>;
export const selectedStrokes: Readable<Stroke[]>;
export const selectionCount: Readable<number>;
export const hasSelection: Readable<boolean>;

// Actions
export function selectStroke(index: number, multi?: boolean): void;
export function selectRange(fromIndex: number, toIndex: number, addToExisting?: boolean): void;
export function selectAll(count: number): void;
export function clearSelection(): void;
export function handleStrokeClick(index: number, ctrlKey: boolean, shiftKey: boolean): void;
export function selectFromBox(indices: number[], mode: 'replace' | 'add' | 'toggle'): void;
```

### Renderer Methods (lib/canvas-renderer.js)

```typescript
class CanvasRenderer {
  getStrokeBounds(stroke: Stroke): BoundingBox;
  strokeIntersectsBox(stroke: Stroke, rect: Rectangle): boolean;
  findStrokesInRect(strokes: Stroke[], rect: Rectangle): number[];
  hitTest(x: number, y: number, strokes: Stroke[]): number;
}

interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Rectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
```

---

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 2024 | Initial implementation |
| | | - Box selection with 3 modes |
| | | - Individual stroke toggle |
| | | - Keyboard shortcuts |
| | | - Conflict resolution |

---

## References

- Main specification: `app-specification.md`
- User guide: `box-selection-user-guide.md`
- Implementation plan: `box-selection-implementation.md`
- Bug fixes: `box-selection-bug-fix.md`
- Behavior changes: `shift-click-behavior-update.md`
- Final summary: `selection-behavior-final.md`
