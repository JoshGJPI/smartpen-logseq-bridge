# Fix: Remove Deleted Strokes from Canvas After Save

## Issue
After successfully saving to LogSeq with deleted strokes:
1. Deleted strokes were removed from LogSeq database ✅
2. `deletedIndices` was cleared ✅
3. **Problem:** Strokes remained in `strokes` store ❌
4. **Result:** Gray/dashed strokes became normal strokes again ❌

## Root Cause
The save workflow only cleared the `deletedIndices` Set but didn't remove the actual stroke objects from the `strokes` array. When `deletedIndices` was cleared, the canvas renderer no longer had any indication these strokes were deleted, so they appeared as normal strokes.

## Solution

### 1. Added `removeStrokesByIndices()` to Strokes Store
**File:** `src/stores/strokes.js`

```javascript
/**
 * Remove strokes by indices
 * @param {number[]} indices - Array of stroke indices to remove
 */
export function removeStrokesByIndices(indices) {
  if (!indices || indices.length === 0) return;
  
  strokes.update(s => {
    const indicesToRemove = new Set(indices);
    return s.filter((stroke, index) => !indicesToRemove.has(index));
  });
}
```

**Why this works:**
- Uses Set for O(1) lookup performance
- Filters out strokes at specified indices
- Returns new array (Svelte reactivity)

### 2. Added `adjustSelectionAfterDeletion()` to Selection Store
**File:** `src/stores/selection.js`

**Problem:** When strokes are removed, all indices after them shift down:
```
Before removal: [0, 1, 2, 3, 4, 5]  // indices
Remove index 2:  [0, 1, -, 3, 4, 5]
After removal:   [0, 1, 2, 3, 4]     // index 3 became 2, etc.
```

If we had indices 4 and 5 selected, they need to become 3 and 4 after removal.

**Solution:**
```javascript
export function adjustSelectionAfterDeletion(removedIndices) {
  const sorted = [...removedIndices].sort((a, b) => a - b);
  
  selectedIndices.update(sel => {
    const newSel = new Set();
    
    sel.forEach(index => {
      // Count how many removed indices are before this one
      let shift = 0;
      for (const removedIndex of sorted) {
        if (removedIndex < index) shift++;
        else break;
      }
      
      // Add adjusted index (if not in removed list)
      if (!removedIndices.includes(index)) {
        newSel.add(index - shift);
      }
    });
    
    return newSel;
  });
  
  // Also adjust lastSelectedIndex
  // ... (handles edge cases)
}
```

**Why this matters:**
- Preserves selection state after deletion
- Prevents selecting wrong strokes
- Handles `lastSelectedIndex` for shift-click ranges

### 3. Updated Save Flow in ActionBar
**File:** `src/components/header/ActionBar.svelte`

**New workflow:**
```javascript
if (savedStrokesCount > 0) {
  // 1. Capture deleted indices BEFORE clearing
  const deletedStrokeIndices = Array.from($deletedIndices).sort((a, b) => b - a);
  
  if (deletedStrokeIndices.length > 0) {
    // 2. Adjust selection indices for upcoming removal
    adjustSelectionAfterDeletion(deletedStrokeIndices);
    
    // 3. Remove the strokes from store
    removeStrokesByIndices(deletedStrokeIndices);
    
    log(`Removed ${deletedStrokeIndices.length} deleted stroke(s) from canvas`, 'info');
  }
  
  // 4. Clear deleted indices (now safe)
  clearDeletedIndices();
}
```

**Why this order matters:**
1. Must capture `$deletedIndices` before clearing
2. Must adjust selection before removal (uses old indices)
3. Removal happens, indices shift
4. Clear deleted tracking (no longer needed)

## Technical Details

### Index Shifting Example
```
Initial strokes: [A, B, C, D, E, F]  // indices [0,1,2,3,4,5]
Deleted indices: [1, 3]               // B and D marked for deletion
Selected: [4, 5]                      // E and F selected

After adjusting selection (before removal):
  - Index 4: count 2 indices before it (1,3) → shift by 2 → becomes index 2
  - Index 5: count 2 indices before it (1,3) → shift by 2 → becomes index 3
  - New selection: [2, 3]

After removing strokes:
  Strokes: [A, C, E, F]               // indices [0,1,2,3]
  Selected: [2, 3]                    // Still E and F ✅
```

### Edge Cases Handled

**1. Selected stroke is deleted:**
```javascript
if (!removedIndices.includes(index)) {
  newSel.add(index - shift);
}
// Deleted strokes are NOT added to new selection
```

**2. Last selected index is deleted:**
```javascript
if (removedIndices.includes(lastIndex)) {
  return null;  // Clear it
}
```

**3. No strokes deleted:**
```javascript
if (deletedStrokeIndices.length === 0) {
  // Skip adjustment and removal
}
```

## User Experience

### Before Fix
1. Delete 3 strokes (gray/dashed) ✅
2. Save to LogSeq ✅
3. LogSeq DB updated (3 strokes removed) ✅
4. **Canvas shows strokes as normal again** ❌

### After Fix
1. Delete 3 strokes (gray/dashed) ✅
2. Save to LogSeq ✅
3. LogSeq DB updated (3 strokes removed) ✅
4. **Canvas removes strokes completely** ✅
5. Log: "Removed 3 deleted stroke(s) from canvas" ✅

## Performance Considerations

### Time Complexity
- `removeStrokesByIndices()`: O(n) where n = total strokes
- `adjustSelectionAfterDeletion()`: O(s × d) where:
  - s = number of selected strokes
  - d = number of deleted strokes
  - Typically d << n, so this is fast

### Memory
- Creates new arrays (Svelte reactivity requirement)
- Old arrays are garbage collected
- No memory leaks

### Canvas Re-render
- Automatic via Svelte reactivity
- Strokes array change triggers canvas update
- No manual redraw needed

## Testing Scenarios

### Scenario 1: Delete and Save
```
1. Have 100 strokes on canvas
2. Delete strokes [10, 20, 30]
3. Save to LogSeq
4. Result: 97 strokes on canvas ✅
5. Indices: [0-9, 10-18, 19-96] (shifted correctly) ✅
```

### Scenario 2: Delete, Select, Save
```
1. Have 50 strokes
2. Delete strokes [5, 10, 15]
3. Select strokes [25, 30, 35]
4. Save to LogSeq
5. Result: 
   - 47 strokes on canvas ✅
   - Selected: [22, 27, 32] (adjusted) ✅
   - Original strokes [25, 30, 35] still selected ✅
```

### Scenario 3: Delete All Visible
```
1. Filter to show page with 20 strokes
2. Delete all 20
3. Save to LogSeq
4. Result: 
   - Empty page (as expected) ✅
   - Other pages unaffected ✅
```

## Export Updates
All new functions exported from `src/stores/index.js`:
- `removeStrokesByIndices` (from strokes.js)
- `adjustSelectionAfterDeletion` (from selection.js)

## Backward Compatibility
- Existing workflows unaffected
- No changes to data format
- Selection behavior preserved
- Canvas rendering unchanged (just fewer strokes)

## Related Files Modified
1. `src/stores/strokes.js` - Added removal function
2. `src/stores/selection.js` - Added adjustment function  
3. `src/stores/index.js` - Export new functions
4. `src/components/header/ActionBar.svelte` - Integrated removal into save flow
