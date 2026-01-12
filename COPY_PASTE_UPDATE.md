# Copy/Paste Strokes - Enhanced Implementation

## Overview
Updated the copy/paste feature to allow **selection-based group conversion** with automatic coordinate normalization. Pasted strokes can now be selected via box select, moved as groups, and converted to pages with proper anchor point calculation.

## Key Enhancements

### 1. **Unified Selection System**
- **Box Selection Works on Pasted Strokes**: Drag to create a selection box that captures both regular strokes (red) and pasted strokes (green)
- **Modifier Keys Work Consistently**:
  - Plain drag: Replace selection
  - Ctrl+drag: Add to selection
  - Shift+drag: Remove from selection
- **Visual Distinction**: Pasted strokes show green when selected (vs red for regular strokes)

### 2. **Group-Based Movement**
- Select multiple pasted strokes via box select or Ctrl+click
- Drag any selected pasted stroke to move the entire group
- All selected strokes maintain their relative positions during movement

### 3. **Selection-Based Page Creation**
- **"Save as Page" Button Shows Count**: 
  - If strokes are selected: `📄 Save as Page (3)` 
  - If none selected: `📄 Save as Page...`
- **Only Selected Strokes Are Saved**: If you have 10 pasted strokes but only select 3, only those 3 are converted to a page
- **Remaining Strokes Stay**: After conversion, the saved strokes are removed from the canvas, but other pasted strokes remain

### 4. **Automatic Anchor Point Calculation**
When converting selected pasted strokes to a page:
1. System finds the **minimum X and Y coordinates** across all selected strokes
2. This becomes the **top-left anchor (0, 0)** for the new page
3. All stroke coordinates are **normalized relative to this anchor**
4. Result: Strokes appear in LogSeq positioned exactly as they were arranged on canvas

**Example:**
```
Selected pasted strokes on canvas:
  Stroke 1: starts at (150, 200)
  Stroke 2: starts at (180, 250)
  Stroke 3: starts at (155, 210)

Anchor point: (150, 200) ← minimum X and Y

Normalized coordinates in LogSeq page:
  Stroke 1: starts at (0, 0)     ← 150-150=0, 200-200=0
  Stroke 2: starts at (30, 50)   ← 180-150=30, 250-200=50
  Stroke 3: starts at (5, 10)    ← 155-150=5, 210-200=10
```

## Workflow

### Complete Workflow Example:

1. **Select and Copy** from various pages:
   ```
   - Select tasks from Meeting Notes page → Ctrl+C
   - Select diagram from Brainstorm page → Ctrl+C (adds to clipboard)
   - Select important points from Research page → Ctrl+C
   ```

2. **Paste and Arrange**:
   ```
   - Press Ctrl+V → Strokes appear in dark gray/green
   - Drag individual pasted strokes to position them
   - Use box select to grab multiple strokes
   - Move groups together to create your composition
   ```

3. **Select What to Save**:
   ```
   - Box select the strokes you want in the new page
   - Or Ctrl+click individual strokes to build selection
   - Selected pasted strokes appear in GREEN
   - Status shows: "3 of 10 pasted selected"
   ```

4. **Save as New Page**:
   ```
   - Click "📄 Save as Page (3)" button
   - Dialog shows: "Save 3 selected pasted strokes as a new page"
   - Enter: Book 200, Page 1
   - Click "Create Page"
   ```

5. **Result**:
   ```
   - New page created at B200/P1 in LogSeq
   - Coordinates normalized (top-left at 0,0)
   - The 3 converted strokes are removed from canvas
   - Remaining 7 pasted strokes stay for further work
   ```

## New UI Elements

### Buttons (appear when pasted strokes exist):
- **📋 Copy** - Copy selected regular strokes (appears when selection exists)
- **📥 Paste** - Paste from clipboard (appears when clipboard has content)
- **📄 Save as Page (N)** - Save N selected pasted strokes, or all if none selected
- **🗑️ Delete (N)** - Delete N selected pasted strokes (appears when selection exists)
- **🗑️ Clear All** - Remove all pasted strokes from canvas

### Visual Indicators:
- **Pasted stroke count**: Shows "5 pasted" in header when pasted strokes exist
- **Selection count**: Shows "3 of 5 pasted selected" when some are selected
- **Green highlighting**: Selected pasted strokes appear in bright green
- **Canvas hint**: "Pasted strokes (green) are movable • Box select to choose • Drag to move group"

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selected strokes to clipboard |
| `Ctrl+V` | Paste strokes at viewport center |
| `Delete` | Delete selected pasted strokes |
| `Escape` | Clear pasted stroke selection |
| `Ctrl+A` | Select all visible strokes (regular) |

## Technical Implementation

### Modified Files:

1. **`pasted-strokes.js`**:
   - Updated `getPastedAsNewPage()` to accept optional `selectedIndices` parameter
   - Now performs two-pass coordinate transformation:
     - First pass: Apply offsets to get actual positions
     - Second pass: Normalize to anchor point (min X, min Y)
   - Updated `deleteSelectedPasted()` to return count

2. **`canvas-renderer.js`**:
   - Added `getPastedStrokeBounds()` - Get bounding box for pasted stroke
   - Added `pastedStrokeIntersectsBox()` - Check box intersection
   - Added `findPastedStrokesInRect()` - Find all pasted strokes in selection box

3. **`StrokeCanvas.svelte`**:
   - Enhanced box selection to work with pasted strokes
   - Added "Delete Selected" button with count display
   - Updated "Save as Page" button to show selection count
   - Updated canvas hints to explain pasted stroke workflow
   - Integrated pasted stroke selection with modifier keys (Ctrl/Shift)

4. **`CreatePageDialog.svelte`**:
   - Now checks if strokes are selected and shows appropriate message
   - Only converts selected pasted strokes (or all if none selected)
   - Removes converted strokes from canvas (keeps others)
   - Shows coordinate normalization hint

### Data Flow:

```
User selects pasted strokes (box select/click)
    ↓
pastedSelection store updated with indices
    ↓
User clicks "Save as Page (N)"
    ↓
CreatePageDialog opens, shows N strokes will be saved
    ↓
User enters book/page numbers
    ↓
getPastedAsNewPage(book, page, selectedIndices)
    ↓
  1. Filter to selected strokes only
  2. Apply offsets to get actual positions
  3. Find anchor point (min X, min Y)
  4. Normalize all coordinates relative to anchor
  5. Set pageInfo to new book/page
    ↓
updatePageStrokes() saves to LogSeq
    ↓
Remove converted strokes from pastedStrokes
Clear pastedSelection
    ↓
Remaining pasted strokes stay on canvas for further work
```

## Benefits

✅ **Flexible Composition**: Build complex pages from multiple sources  
✅ **Precise Control**: Choose exactly which strokes become a page  
✅ **Reusable Elements**: Keep pasted strokes for multiple page creations  
✅ **Automatic Positioning**: Coordinates normalize perfectly to page origin  
✅ **Familiar Interaction**: Works like regular stroke selection  
✅ **Visual Feedback**: Clear indication of what will be saved  

## Testing Checklist

- [ ] Copy strokes from a page
- [ ] Paste with Ctrl+V
- [ ] Box select some pasted strokes
- [ ] Drag selected group (should move together)
- [ ] Ctrl+click to add more to selection
- [ ] Shift+click to remove from selection
- [ ] Click "Save as Page (N)" 
- [ ] Verify dialog shows correct count
- [ ] Save to LogSeq with custom book/page
- [ ] Check that coordinates are normalized in LogSeq
- [ ] Verify remaining pasted strokes stay on canvas
- [ ] Delete some selected pasted strokes with Delete key
- [ ] Clear all pasted strokes

## Future Enhancements

Possible future improvements:
- Manual anchor point selection (click to set origin)
- Rotate/scale selected pasted strokes before conversion
- Preview mode showing how strokes will appear in LogSeq
- Multi-page creation (save different selections as different pages)
- Undo/redo for pasted stroke operations
