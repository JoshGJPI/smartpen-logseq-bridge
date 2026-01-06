# Update: Canvas Hint Relocation & Selection Behavior Changes

**Date:** December 19, 2024
**Version:** 0.2.0+

## Summary

Made two UI/UX improvements to the canvas:
1. Moved keyboard hint text into the canvas area as static black text at the bottom
2. Changed selection modifier behavior: Ctrl always adds, Shift always removes (no more toggle)

## Changes Made

### 1. Canvas Hint Text Relocation

**Before:** Hint text was in a separate bar below the canvas controls
```
┌─────────────────────────────────┐
│         Canvas Area             │
└─────────────────────────────────┘
[Controls]
────────────────────────────────────
  Drag to select • Ctrl/Shift...
────────────────────────────────────
```

**After:** Hint text is inside the canvas at the bottom
```
┌─────────────────────────────────┐
│         Canvas Area             │
│                                 │
│ Drag to select • Ctrl • Shift  │
└─────────────────────────────────┘
[Controls]
```

**Styling:**
- Black text (`color: #000000`)
- 50% opacity for subtlety
- Positioned at bottom center of canvas
- Non-interactive (pointer-events: none)
- Small font (0.7rem)

### 2. Selection Modifier Behavior

Changed from toggle behavior to explicit add/remove:

**Before:**
- **Ctrl+click**: Toggle selection (add if not selected, remove if selected)
- **Shift+click**: Toggle selection (same as Ctrl)

**After:**
- **Ctrl+click**: Always ADD to selection
- **Shift+click**: Always REMOVE from selection
- **Plain click**: Replace selection (select only this stroke)

This applies to:
- Individual stroke clicks
- Box/window selections
- Direct clicks on strokes

## Updated Hint Text

**New text:**
```
Drag to select • Ctrl+click to add • Shift+click to deselect • Alt+drag to pan • Ctrl+scroll to zoom
```

**Changes from previous:**
- "Ctrl+click to add" (was "Ctrl+click multi")
- "Shift+click to deselect" (was "Shift+click range")
- Clearer, more explicit about what each modifier does

## Technical Implementation

### Files Modified

**StrokeCanvas.svelte:**
1. Removed `SelectionInfo` component import
2. Added `.canvas-hint` div inside canvas container
3. Updated `handleMouseDown()` - separate Ctrl and Shift logic
4. Updated `handleMouseUp()` - use 'remove' mode for Shift+box selection
5. Updated `handleCanvasClick()` - direct add/remove instead of toggle

**Removed:**
- `SelectionInfo.svelte` component usage (component file still exists but unused)

### Selection Logic Changes

#### Old Behavior (Toggle)
```javascript
// Both Ctrl and Shift toggled
if (event.ctrlKey || event.shiftKey) {
  handleStrokeClick(index, true, false); // toggle
}
```

#### New Behavior (Add/Remove)
```javascript
if (event.shiftKey) {
  // Remove from selection
  selectedIndices.update(sel => {
    const newSel = new Set(sel);
    newSel.delete(strokeIndex);
    return newSel;
  });
} else if (event.ctrlKey || event.metaKey) {
  // Add to selection
  selectedIndices.update(sel => {
    const newSel = new Set(sel);
    newSel.add(strokeIndex);
    return newSel;
  });
}
```

### Box Selection Changes

**Before:**
```javascript
const mode = (event.ctrlKey || event.metaKey) ? 'add' : 
             event.shiftKey ? 'toggle' : 'replace';
selectFromBox(intersectingIndices, mode);
```

**After:**
```javascript
const mode = (event.ctrlKey || event.metaKey) ? 'add' : 
             event.shiftKey ? 'remove' : 'replace';

if (mode === 'remove') {
  deselectIndices(intersectingIndices);
} else {
  selectFromBox(intersectingIndices, mode);
}
```

## Benefits

### Visual Benefits
- **Cleaner Layout**: One less UI bar to manage
- **Contextual Hints**: Instructions visible where they're needed
- **Less Clutter**: Canvas area better utilized
- **Subtle Appearance**: Black text at 50% opacity doesn't compete with strokes

### UX Benefits
- **Predictable Behavior**: Users know exactly what will happen
- **Easier Deselection**: Can now remove specific strokes with Shift
- **No Surprises**: No accidental toggling when adding to selection
- **Standard Pattern**: Matches common selection behavior in other apps

### Workflow Benefits
- **Additive Selection**: Build up selection with Ctrl
- **Subtractive Refinement**: Remove unwanted strokes with Shift
- **Clear Mental Model**: Add with Ctrl, remove with Shift, replace with plain click

## Use Cases

### Building a Selection
1. Click first stroke (selects it)
2. Ctrl+click additional strokes (adds each one)
3. Shift+click any mistakes (removes them)
4. Continue Ctrl+clicking to add more

### Refining a Selection
1. Click "Select All" button
2. Shift+click strokes you don't want (removes them)
3. Result: All strokes except the ones you removed

### Box Selection Refinement
1. Drag box to select region
2. Ctrl+drag another box to add more strokes
3. Shift+drag to remove unwanted strokes from selection

## Breaking Changes

### Behavioral Changes
- **Ctrl+click** no longer toggles (only adds)
- **Shift+click** no longer toggles (only removes)
- Users need to learn new pattern, but it's more intuitive

### Migration Notes
- No API changes
- No data structure changes
- Users may need to adjust muscle memory
- More predictable behavior should reduce confusion

## User Communication

Suggested messaging for users:
```
Selection behavior has changed for better control:
• Ctrl+click: Always ADDS strokes to selection
• Shift+click: Always REMOVES strokes from selection
• Plain click: Replaces selection with clicked stroke

This gives you precise control over your selection!
```

## Testing Checklist

- [x] Hint text appears at bottom of canvas
- [x] Hint text is black with 50% opacity
- [x] Hint text doesn't interfere with strokes
- [x] Ctrl+click adds to selection (doesn't toggle)
- [x] Shift+click removes from selection (doesn't toggle)
- [x] Plain click replaces selection
- [x] Ctrl+box adds strokes to selection
- [x] Shift+box removes strokes from selection
- [x] Plain box replaces selection
- [ ] Test with touch devices (if applicable)
- [ ] Verify hint text readable on various stroke densities
- [ ] Confirm no regression in other selection features

## Future Enhancements

Possible improvements:
1. **Dynamic Hint**: Show different text based on current action
2. **Hide on Hover**: Fade out when mouse is near to avoid obstruction
3. **Keyboard Shortcuts**: Add Ctrl+A hint to text
4. **Visual Feedback**: Brief highlight when adding/removing with modifiers
5. **Undo**: Add undo for selection changes

## Edge Cases Handled

1. **Clicking selected stroke with Ctrl**: Keeps it selected (adds it again, no effect)
2. **Clicking unselected stroke with Shift**: Has no effect (can't remove what's not there)
3. **Empty box selection**: Only clears if no modifiers held
4. **Clicking on empty canvas**: Clears selection if no modifiers

## Comparison to Other Applications

This behavior now matches:
- **Photoshop**: Ctrl adds, Shift removes from selection
- **Illustrator**: Ctrl adds, Shift removes
- **Figma**: Ctrl adds, Shift removes
- **Desktop File Managers**: Ctrl adds, Shift selects range (we use for remove instead)

Our implementation is consistent with graphics/design tools rather than file managers, which makes sense for a drawing application.

---

**Implementation By:** Claude (AI Assistant)  
**Requested By:** Josh (SmartPen-LogSeq Bridge Developer)  
**Status:** Complete
