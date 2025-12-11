# Box Selection User Guide

## Quick Start

The canvas now supports multiple selection methods to make working with your handwritten strokes easier and more intuitive.

## Selection Methods

### 1. Box Selection (Drag to Select)

**How to use:**
- Click and drag on the canvas to create a selection rectangle
- All strokes that intersect with the rectangle will be selected
- Release the mouse to complete the selection

**Visual feedback:**
- A dashed red rectangle shows your selection area while dragging
- Selected strokes appear in red

**Example:**
```
1. Click at top-left of area you want to select
2. Hold mouse button and drag to bottom-right
3. Release mouse button
→ All strokes in the box are now selected
```

### 2. Additive Box Selection (Ctrl+Drag)

**How to use:**
- Hold `Ctrl` (Windows/Linux) or `Cmd` (Mac)
- Click and drag to create a selection rectangle
- Release the mouse
- New strokes are added to your existing selection

**Use case:**
- Selecting multiple disconnected areas
- Building up a complex selection gradually
- Adding strokes without losing previous selection

**Example:**
```
1. Select first group of strokes with normal drag
2. Hold Ctrl/Cmd
3. Drag over second group of strokes
4. Release mouse
→ Both groups are now selected
```

### 3. Click Selection

**Single Click:**
- Click on a stroke to select only that stroke
- Previous selection is cleared

**Ctrl+Click (Toggle):**
- Hold `Ctrl/Cmd` and click on a stroke
- If the stroke is selected, it becomes unselected
- If the stroke is unselected, it becomes selected
- Other selections remain unchanged

**Shift+Click (Range):**
- Select a stroke first
- Hold `Shift` and click another stroke
- All strokes between them are selected

### 4. Select All

**Keyboard shortcut:**
- Press `Ctrl+A` (Windows/Linux) or `Cmd+A` (Mac)
- Selects all visible strokes on the current page

### 5. Clear Selection

**Click on empty space:**
- Click on the canvas (not on a stroke)
- All selections are cleared

**Or use the Clear Selection button:**
- Located below the canvas
- Clears all selections with one click

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Cancel active box selection |
| `Ctrl+A` / `Cmd+A` | Select all visible strokes |
| `Ctrl+Click` | Toggle individual stroke |

## Canvas Controls

### Mouse Actions

| Action | Result |
|--------|--------|
| **Drag** | Box selection |
| **Ctrl+Drag** | Add to selection |
| **Shift+Drag** | Pan the canvas |
| **Middle-Click Drag** | Pan the canvas |
| **Scroll** | Pan up/down/left/right |
| **Ctrl+Scroll** | Zoom in/out |
| **Click on stroke** | Select single stroke |
| **Ctrl+Click on stroke** | Toggle stroke |
| **Click on empty space** | Clear selection |

### Cursor Changes

- **Default** - Normal pointing cursor
- **Crosshair** - Active box selection
- **Grabbing hand** - Panning mode

## Workflow Examples

### Example 1: Transcribe Specific Lines

**Goal:** Transcribe only lines 3-5 from your handwriting

```
1. Drag a box around lines 3-5
2. Click "Transcribe Selected"
3. Only those lines are sent to MyScript
```

### Example 2: Send Multiple Sections to LogSeq

**Goal:** Send two separate paragraphs to LogSeq

```
1. Drag a box around first paragraph
2. Hold Ctrl, drag a box around second paragraph
3. Click "Send to LogSeq"
4. Both paragraphs are inserted
```

### Example 3: Remove One Stroke from Selection

**Goal:** You selected too much and need to remove one stroke

```
1. Make your initial box selection
2. Hold Ctrl and click the stroke you want to remove
3. That stroke is deselected, others remain selected
```

### Example 4: Build Complex Selection

**Goal:** Select scattered strokes across the page

```
1. Click first stroke
2. Hold Ctrl, click second stroke (adds to selection)
3. Hold Ctrl, click third stroke (adds to selection)
4. Hold Ctrl, drag box around a group (adds all in box)
→ All individual and boxed strokes are selected
```

## Tips & Tricks

### Tip 1: Quick Selection of Dense Areas
Use box selection for areas with many strokes close together. It's much faster than clicking individual strokes.

### Tip 2: Precise Control with Ctrl+Click
For fine-tuned selection, use box selection for bulk, then Ctrl+click to add/remove individual strokes.

### Tip 3: Cancel Accidental Selection
Started dragging a box by mistake? Press `Escape` before releasing the mouse to cancel.

### Tip 4: Work with Page Filter
Combine page filtering with selection to work on specific pages. Select a page from the dropdown, then use any selection method on just those strokes.

### Tip 5: Zoom for Precision
Zoom in (Ctrl+scroll) for precise selection of overlapping strokes, then zoom out (Ctrl+scroll) to see your full selection.

## Selection Indicators

### In Canvas
- **Red strokes** = Selected
- **Black strokes** = Not selected
- **Dashed red rectangle** = Active box selection

### Selection Info Panel
Located below the canvas, shows:
- Total number of strokes
- Number of selected strokes
- "Select All" button
- "Clear Selection" button

### Stroke List Panel
- **Highlighted rows** = Selected strokes
- Click any row to select that stroke
- Ctrl+click to toggle
- Shift+click for range

## Common Issues

### Issue: Can't Draw Selection Box

**Symptom:** Dragging moves the canvas instead of creating a box

**Solution:** Make sure you're not holding Shift. Use plain drag for selection, Shift+drag for panning.

### Issue: Selection Box Not Selecting

**Symptom:** Box appears but strokes don't get selected

**Solution:** Drag needs to be at least 5 pixels. Very tiny drags are treated as clicks.

### Issue: Lost My Selection

**Symptom:** Selection disappeared unexpectedly

**Solution:** Clicking on empty space without Ctrl clears selection. Use Ctrl+click or Ctrl+drag to preserve selection.

### Issue: Can't Select Specific Stroke

**Symptom:** Clicking stroke doesn't select it

**Solution:** Stroke might be under another stroke. Try:
1. Zoom in for better precision
2. Use box selection to get all overlapping strokes
3. Ctrl+click to deselect unwanted ones

## Integration with Other Features

### With Transcription
1. Select strokes you want to transcribe
2. Click "Transcribe Selected" in settings
3. Only selected strokes are sent to MyScript

### With LogSeq
1. Select strokes to send
2. Configure target page if needed
3. Click "Send to LogSeq"
4. Selected strokes become blocks in LogSeq

### With Export
1. Select strokes to export
2. Click "Export SVG" or "Export JSON"
3. Only selected strokes are exported

### With Page Filtering
1. Select a page from dropdown
2. Use selection methods on filtered strokes
3. "Select All" selects all on current page
4. Change page to work with different strokes

## Accessibility

- All selection methods work with keyboard
- Clear visual feedback for all actions
- Consistent behavior across all platforms
- No mouse-only features

## Performance

- Smooth operation with 100+ strokes
- Efficient intersection detection
- No lag during box selection
- Responsive even at high zoom levels
