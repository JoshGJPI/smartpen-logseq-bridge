# Selective Page Save Feature

**Date**: 2026-01-13  
**Feature**: Choose which pages to save in the confirmation dialog

## Overview

Added the ability to selectively save pages in the SaveConfirmDialog, allowing users to choose exactly which pages get updated in LogSeq instead of forcing a save of all changes at once.

## User Workflow

### Default Behavior
When the save dialog opens, **all pages are selected by default**. Users can immediately click "Confirm & Save" to save everything, maintaining the original quick-save workflow.

### Selective Save Workflow

1. Click "Save to LogSeq" button
2. **SaveConfirmDialog opens** with all pages selected
3. Review the list of changes
4. **Deselect pages** you don't want to save:
   - Click checkbox next to individual pages
   - Or click "✗ Deselect All" then select only desired pages
5. Summary updates to show only selected changes
6. Click "Confirm & Save (N)" where N is the count of selected pages
7. Only selected pages are saved to LogSeq

### UI Components

**Selection Controls Bar**
```
┌────────────────────────────────────────────┐
│ [✓ Select All] [✗ Deselect All]  3 of 5 selected │
└────────────────────────────────────────────┘
```

**Summary Section**
- Shows counts for **selected pages only**
- Updates reactively as selection changes
- Example: "Adding: +42 strokes" (only from selected pages)

**Page List Items**
```
┌────────────────────────────────────────────┐
│ ☑ 📄 Book 3017 / Page 1                    │  ← Selected (blue highlight)
│    +42 strokes  ✨ New transcription       │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ ☐ 📄 Book 3017 / Page 2                    │  ← Deselected (normal)
│    +25 strokes  📝 Updated transcription   │
└────────────────────────────────────────────┘
```

**Confirm Button**
- Disabled when no pages selected
- Shows count: "Confirm & Save (3)"
- Changes to "Select pages to save" when nothing selected

## Use Cases

### Use Case 1: Verify Before Batch Save
```
Scenario: User transcribed 5 pages, but wants to review each transcription individually

Workflow:
1. Open save dialog
2. Deselect all pages
3. Select Page 1 only
4. Save → Check in LogSeq → Looks good
5. Repeat for remaining pages one at a time
```

### Use Case 2: Partial Save with Errors
```
Scenario: User has changes on 3 pages, but Page 2 has errors that need fixing

Workflow:
1. Open save dialog
2. Uncheck Page 2
3. Save Pages 1 and 3
4. Fix errors in Page 2
5. Save again (only Page 2 selected)
```

### Use Case 3: Different Books Separate
```
Scenario: User has changes in Book A and Book B, wants to save them separately

Workflow:
1. Open save dialog
2. Deselect all Book B pages
3. Save Book A pages only
4. Later: Save Book B pages
```

### Use Case 4: Preserve Work in Progress
```
Scenario: User has finalized changes on some pages but others are WIP

Workflow:
1. Open save dialog
2. Select only finalized pages
3. Save those
4. Continue working on WIP pages
5. Save WIP pages when ready
```

## Implementation Details

### State Management

**Selected Pages Tracking**
```javascript
let selectedPages = new Set(); // Stores pageKeys

// Reactive computations
$: selectedStrokeAdditions = changesList
  .filter(item => selectedPages.has(item.pageKey))
  .reduce((sum, item) => sum + item.strokeAdditions, 0);

// Similar for deletions, transcriptions
```

**Page Key Format**
```javascript
const pageKey = `${book}-${page}`;  // Example: "3017-1"
```

### Selection Functions

**Toggle Individual Page**
```javascript
function togglePageSelection(pageKey) {
  selectedPages = new Set(selectedPages);
  if (selectedPages.has(pageKey)) {
    selectedPages.delete(pageKey);
  } else {
    selectedPages.add(pageKey);
  }
}
```

**Select/Deselect All**
```javascript
function selectAll() {
  selectedPages = new Set(changesList.map(item => item.pageKey));
}

function deselectAll() {
  selectedPages = new Set();
}
```

### Event Passing

**Dialog → ActionBar Communication**
```javascript
// SaveConfirmDialog
function handleConfirm() {
  dispatch('confirm', { 
    selectedPages: Array.from(selectedPages) 
  });
}

// ActionBar
async function handleSaveToLogseq(event) {
  const selectedPageKeys = event?.detail?.selectedPages || [];
  const selectedSet = new Set(selectedPageKeys);
  
  // Filter strokes to only selected pages
  $strokes.forEach(stroke => {
    const key = `${stroke.pageInfo.book}-${stroke.pageInfo.page}`;
    if (!selectedSet.has(key)) return; // Skip unselected
    // ... process stroke
  });
}
```

### UI State Management

**Reactive Values**
```javascript
// Derived states
$: hasSelection = selectedPages.size > 0;
$: allSelected = selectedPages.size === changesList.length;
$: selectedPagesCount = selectedPages.size;

// Button states
disabled={!hasSelection}          // Confirm button
disabled={allSelected}            // Select All button
disabled={!hasSelection}          // Deselect All button
```

## Visual Design

### Colors & States

**Unselected Page**
- Background: `var(--bg-secondary)`
- Border: `1px solid var(--border)`

**Selected Page**
- Background: `rgba(33, 150, 243, 0.05)` (light blue tint)
- Border: `1px solid var(--accent)` (blue border)

**Hover States**
- Unselected hover: `var(--bg-tertiary)`
- Selected hover: `rgba(33, 150, 243, 0.08)` (slightly darker blue)

**Checkbox**
- Size: 18x18px
- Margin: 12px right
- Native browser checkbox styling

**Selection Control Buttons**
- Background: `var(--bg-secondary)`
- Hover: `var(--accent)` (blue background, white text)
- Disabled: 40% opacity

### Layout Structure

```
Dialog
├─ Selection Controls Bar
│  ├─ Select All button
│  ├─ Deselect All button
│  └─ Selection info (N of M selected)
│
├─ Summary (filtered by selection)
│  ├─ Pages count
│  ├─ Stroke additions/deletions
│  └─ Transcription changes
│
├─ Changes List
│  └─ For each page:
│     ├─ Checkbox
│     ├─ Page name
│     └─ Change badges
│
└─ Footer
   ├─ Cancel button
   └─ Confirm button (shows count)
```

## Edge Cases Handled

### Empty Selection
- Confirm button disabled
- Button text: "Select pages to save"
- Shows warning if user somehow triggers save with no selection

### Single Page
- Selection controls still shown (consistent UX)
- "1 of 1 selected" display
- Can still deselect the only page

### All Pages Selected
- "Select All" button disabled (already all selected)
- Normal save operation (backward compatible)

### Deselect During Save
- Once save starts, dialog closes
- Selection state is passed to save handler
- No way to change mid-save (by design)

### Multiple Sequential Saves
- Dialog reopens with all pages selected again
- Previous selections NOT remembered (clean slate)
- Each save is independent

## Backward Compatibility

✅ **Default behavior unchanged**: All pages selected by default  
✅ **Quick save preserved**: Can still click through immediately  
✅ **No data migration**: All existing code still works  
✅ **Event structure compatible**: Optional detail parameter  

## Performance Considerations

- **Reactive computations**: O(n) filtering per selection change
- **Set operations**: O(1) lookup for membership checks
- **Re-rendering**: Only affected items re-render on selection change
- **Memory**: Minimal overhead (Set of strings)

## Testing Checklist

✅ All pages selected by default on open  
✅ Individual checkbox toggles selection  
✅ Select All button selects all pages  
✅ Deselect All button clears selection  
✅ Summary counts update with selection  
✅ Selected pages highlighted with blue tint  
✅ Confirm button disabled when nothing selected  
✅ Confirm button shows count of selected pages  
✅ Only selected pages are saved to LogSeq  
✅ Unselected pages remain unchanged  
✅ Dialog can be opened multiple times  
✅ Selection resets between dialog opens  

## Files Modified

1. **`src/components/dialog/SaveConfirmDialog.svelte`**
   - Added `selectedPages` Set state
   - Added reactive computed values for selected items
   - Added selection control UI (buttons, checkboxes)
   - Added checkbox to each page item
   - Updated summary to show selected counts
   - Added toggle/select/deselect functions
   - Modified confirm event to pass selected pages

2. **`src/components/header/ActionBar.svelte`**
   - Modified `handleSaveToLogseq()` to accept event parameter
   - Added selectedPages extraction from event
   - Added filtering to only process selected pages
   - Updated logging to indicate "selected pages"

## Future Enhancements

Potential improvements:
- [ ] Remember selection between dialog opens (same session)
- [ ] Keyboard shortcuts (Space to toggle, Ctrl+A for select all)
- [ ] Shift+Click for range selection
- [ ] Right-click context menu on pages
- [ ] Save selection presets ("Save Book A", "Save Transcriptions Only")
- [ ] Visual grouping by book
- [ ] Drag to reorder save priority
- [ ] Undo last save for selected pages

## User Benefits

- ✅ **Granular control**: Save exactly what you want
- ✅ **Error recovery**: Skip problematic pages, fix later
- ✅ **Review workflow**: Save pages after individual review
- ✅ **Work in progress**: Save finalized work, keep WIP separate
- ✅ **Organized saves**: Group by book, topic, or quality
- ✅ **No forced batch**: Not required to save everything at once
- ✅ **Quick default**: Still fast for "save all" use case

## Summary

The selective page save feature provides power users with fine-grained control while maintaining the simplicity of the default "save all" workflow. The checkbox-based UI is intuitive and familiar, the selection state is clear through visual highlighting, and the summary counts update in real-time to show exactly what will be saved.

This feature complements the enhanced change detection and editable transcriptions, creating a complete workflow for reviewing, editing, and selectively saving changes to LogSeq.
