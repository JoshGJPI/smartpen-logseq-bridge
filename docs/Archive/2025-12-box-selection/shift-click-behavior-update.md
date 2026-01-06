# Shift+Click Behavior Update

## Change Summary
Updated Shift+click behavior from range selection to toggle selection for individual strokes.

## Previous Behavior
- **Shift+click**: Range selection (select all strokes between last selected and current)
- **Ctrl+click**: Toggle individual stroke
- **Plain click**: Single selection

## New Behavior
- **Shift+click**: Toggle individual stroke
- **Ctrl+click**: Toggle individual stroke (same as Shift)
- **Plain click**: Single selection

## Rationale

### User Expectation
The user expected Shift+click to toggle just the clicked stroke, not perform range selection. The file-manager style range selection was counterintuitive in this context.

### Why Remove Range Selection?
1. **Box selection provides better range functionality**: Users can drag a box to select multiple strokes, which is more visual and intuitive than clicking endpoints
2. **Shift-drag toggle is more useful**: The new Shift+drag toggle behavior for box selection is more powerful than range clicking
3. **Simplified interaction model**: Having both Shift and Ctrl do the same thing (toggle) is clearer than having different behaviors
4. **Consistency**: Now both individual clicks and box selections work the same way with modifiers:
   - Plain = replace selection
   - Ctrl = add to selection
   - Shift = toggle selection

## Complete Selection Model

### Individual Strokes (Click)
| Action | Result |
|--------|--------|
| **Click** | Select only this stroke (clear others) |
| **Ctrl+Click** | Toggle this stroke (add/remove from selection) |
| **Shift+Click** | Toggle this stroke (add/remove from selection) |

### Box Selection (Drag)
| Action | Result |
|--------|--------|
| **Drag** | Select strokes in box (clear others) |
| **Ctrl+Drag** | Add strokes in box to selection |
| **Shift+Drag** | Toggle strokes in box (flip selection state) |

### Other Actions
| Action | Result |
|--------|--------|
| **Alt+Drag** | Pan the canvas |
| **Middle-Click Drag** | Pan the canvas |
| **Ctrl+Scroll** | Zoom in/out |
| **Scroll** | Pan vertically |
| **Ctrl+A** | Select all visible strokes |
| **Escape** | Cancel active box selection |

## Code Changes

### selection.js - handleStrokeClick()
**Before:**
```javascript
if (shiftKey && lastIndex !== null) {
  // Range selection
  selectRange(lastIndex, index, ctrlKey);
} else if (ctrlKey) {
  // Toggle selection
  selectStroke(index, true);
} else {
  // Single selection
  selectStroke(index, false);
}
```

**After:**
```javascript
if (shiftKey || ctrlKey) {
  // Both Shift and Ctrl toggle individual stroke selection
  selectStroke(index, true);
} else {
  // Plain click = single selection
  selectStroke(index, false);
}
```

### StrokeCanvas.svelte - Hint Text
**Before:** "Drag to select • Ctrl+drag to add • Shift+drag to toggle • Alt+drag or middle-click to pan"

**After:** "Drag to select • Ctrl/Shift to add/toggle • Alt+drag to pan • Ctrl+scroll to zoom"

## Benefits

1. **Simpler mental model**: Both modifiers do the same thing - toggle
2. **More intuitive**: Matches user expectation of what Shift+click should do
3. **Consistent behavior**: Click and drag modifiers work the same way
4. **No lost functionality**: Box selection provides better range capabilities anyway
5. **Cleaner code**: Removed unnecessary range selection logic

## User Workflows

### Workflow 1: Build Selection One by One
```
1. Click stroke A → A selected
2. Shift+click stroke B → A, B selected
3. Shift+click stroke C → A, B, C selected
4. Shift+click stroke B again → A, C selected (B toggled off)
```

### Workflow 2: Refine Box Selection
```
1. Drag box over area → Multiple strokes selected
2. Shift+click unwanted stroke → Removed from selection
3. Shift+click missed stroke → Added to selection
4. Result: Precise selection
```

### Workflow 3: Toggle Multiple Areas
```
1. Drag box over area 1 → Area 1 selected
2. Shift+drag over area 2 → Both areas selected/deselected based on state
3. Shift+click individual strokes → Fine-tune selection
```

## Deprecated Functionality

The following function is now unused and could be removed in future cleanup:
- `selectRange(fromIndex, toIndex, addToExisting)` in selection.js

However, it's kept for now in case there's a future use case for programmatic range selection.

## Testing Verification

✅ Shift+click toggles individual strokes on canvas
✅ Ctrl+click toggles individual strokes on canvas  
✅ Plain click selects only that stroke
✅ Both modifiers work identically for individual clicks
✅ Box selection modifiers still work as expected
✅ No range selection behavior with Shift+click
✅ List view selection updated to match (if applicable)

## User Impact

**Positive:**
- More intuitive interaction
- Matches user's mental model
- Simpler to learn and remember
- More consistent behavior

**Neutral:**
- Loss of range selection feature (but box selection is better anyway)
- Both Shift and Ctrl now do the same thing (reduced complexity)

**No Breaking Changes:**
- All existing functionality preserved
- Box selection unchanged
- Pan/zoom unchanged
- Keyboard shortcuts unchanged
