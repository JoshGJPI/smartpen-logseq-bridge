# Box Selection Bug Fix

## Issue Reported
1. **Auto-deselection bug**: Sometimes box selection would automatically deselect after completing
2. **Missing Shift-toggle**: Shift+drag should toggle strokes within the selection box
3. **Conflict with pan**: Shift+drag was used for panning, preventing its use for toggle

## Root Cause
The click event was firing after box selection completed, causing `clearSelection()` to be called when clicking on empty space. The timing was:
1. User completes box selection in `handleMouseUp`
2. Selection state is reset (`isBoxSelecting = false`)
3. Click event fires and calls `handleCanvasClick`
4. Click handler sees no box selection in progress, treats it as a normal click
5. If click location has no stroke and no modifiers, it clears selection

## Solution

### 1. Added `didBoxSelect` Flag
Similar to the existing `didPan` flag, this tracks whether a box selection was just completed:
- Set to `true` when box selection completes in `handleMouseUp`
- Checked in `handleCanvasClick` to skip processing
- Reset to `false` after click is handled

### 2. Enhanced `selectFromBox` with Mode Support
Changed from boolean `additive` parameter to string `mode` parameter:
- `'replace'` - Replace entire selection (default, plain drag)
- `'add'` - Add to existing selection (Ctrl+drag)
- `'toggle'` - Toggle each stroke (Shift+drag)

### 3. Changed Pan Trigger to Alt
Freed up Shift key for toggle selection:
- **Before**: Shift+drag = pan
- **After**: Alt+drag = pan
- Middle-click drag still works for panning

## Updated Behavior

| Action | Result |
|--------|--------|
| **Plain drag** | Box select (replaces selection) |
| **Ctrl+drag** | Box select (adds to selection) |
| **Shift+drag** | Box select (toggles strokes) |
| **Alt+drag** | Pan canvas |
| **Middle-click drag** | Pan canvas |
| **Ctrl+click on stroke** | Toggle individual stroke |
| **Click on empty space** | Clear selection |
| **Escape** | Cancel active box selection |

## Code Changes

### StrokeCanvas.svelte
1. Added `didBoxSelect` state variable
2. Modified `handleMouseUp` to set `didBoxSelect = true` after completing selection
3. Modified `handleCanvasClick` to check `didBoxSelect` and skip if true
4. Changed pan trigger from `event.shiftKey` to `event.altKey`
5. Updated `selectFromBox` call to pass mode string instead of boolean
6. Updated hint text to reflect new key bindings

### selection.js
1. Changed `selectFromBox` parameter from `additive` boolean to `mode` string
2. Implemented three modes: 'replace', 'add', 'toggle'
3. Toggle mode adds strokes that aren't selected, removes strokes that are selected

## Testing Verification

✅ Plain drag selects strokes and doesn't auto-deselect
✅ Ctrl+drag adds to existing selection
✅ Shift+drag toggles strokes (deselects if selected, selects if not)
✅ Alt+drag pans the canvas
✅ Middle-click drag still pans
✅ Ctrl+click on individual strokes still toggles
✅ Click on empty space still clears selection
✅ No interference between selection and pan modes
✅ didBoxSelect flag prevents click handler from firing after box selection

## User-Facing Changes

### Updated Hint Bar
**Before**: "Drag to select • Ctrl+drag to add • Shift+drag to pan • Esc to cancel"

**After**: "Drag to select • Ctrl+drag to add • Shift+drag to toggle • Alt+drag or middle-click to pan"

### New Selection Modes
Users can now:
1. **Replace selection**: Plain drag over strokes
2. **Add to selection**: Hold Ctrl and drag to add more strokes
3. **Toggle selection**: Hold Shift and drag to flip selection state of strokes

## Example Workflows

### Workflow 1: Build Complex Selection
```
1. Drag over first group → Selected
2. Ctrl+drag over second group → Both groups selected
3. Shift+drag over overlap → Only non-overlapping parts selected
```

### Workflow 2: Refine Selection
```
1. Drag over large area → Many strokes selected
2. Shift+drag over unwanted strokes → Those strokes deselected
3. Result: Precise selection without starting over
```

### Workflow 3: Symmetric Selection
```
1. Select left side of drawing
2. Shift+drag over right side (which includes some left side)
3. Result: Symmetric selection with overlap removed
```

## Technical Notes

- The `didBoxSelect` flag is reset on every click, pan completion, or Escape key
- Toggle mode uses Set operations for efficiency
- All three modes update `lastSelectedIndex` for Shift+click range selection
- Mode detection happens at mouse-up time, allowing users to add modifiers mid-drag
- Empty box selection with no modifiers still clears selection (user intent to reset)

## Compatibility

- Works with existing page filtering
- Compatible with zoom/pan operations
- No breaking changes to existing selection methods
- Keyboard shortcuts (Ctrl+A, Escape) still work
- List view selection unaffected
