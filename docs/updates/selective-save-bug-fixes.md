# Selective Save Bug Fixes

**Date**: 2026-01-13  
**Issues Fixed**: Dialog width jumps, unselected pages being saved

## Issues & Solutions

### Issue 1: Jumpy Dialog Width ✅

**Problem**: Dialog width changed dramatically as items with 0 values were hidden/shown when selecting/deselecting pages, creating a jarring UX.

**Solution**: Always show all summary items, even when they're 0. Use opacity to dim zero items instead of hiding them.

**Changes**:
```html
<!-- BEFORE: Conditionally shown -->
{#if selectedStrokeAdditions > 0}
  <div class="summary-item additions">...</div>
{/if}

<!-- AFTER: Always shown, dimmed when zero -->
<div class="summary-item additions" class:zero={selectedStrokeAdditions === 0}>
  <span class="summary-label">Adding:</span>
  <span class="summary-value">+{selectedStrokeAdditions} strokes</span>
</div>
```

**CSS**:
```css
.summary-item.zero {
  opacity: 0.3;
}
```

**Result**: Dialog maintains consistent width, zero items appear grayed out

### Issue 2: Unselected Pages Being Saved ✅

**Problem**: When unchecking pages in the dialog, ALL pages were still being saved to LogSeq, not just the selected ones.

**Root Cause**: Transcription saves weren't checking if pages were in the selected set. While strokes were filtered correctly, transcriptions could be saved for any page that had them.

**Solution**: Added explicit checks for `selectedSet.has(key)` before saving transcriptions.

**Changes**:
```javascript
// Check if page is selected before saving transcription
if (pageTranscription && selectedSet.has(key)) {
  // Save page-specific transcription
  await updatePageTranscription(...);
}

// Also check for legacy transcription format
else if ($hasTranscription && selectedSet.has(key)) {
  // Save legacy transcription only if page is selected
  await updatePageTranscription(...);
}
```

**Debug Logging Added**:
```javascript
console.log('[SaveToLogseq] Selected page keys:', selectedPageKeys);
console.log('[SaveToLogseq] Selected set:', Array.from(selectedSet));
console.log(`[SaveToLogseq] Skipping stroke from unselected page: ${key}`);
console.log(`[SaveToLogseq] Processing page: ${key}`);
```

This logging helps verify which pages are selected and which are being processed during save.

## Testing Instructions

### Test 1: Verify No Width Jumping
1. Open save dialog with 4 pages
2. Uncheck 2 pages
3. **Verify**: Dialog width stays constant
4. **Verify**: Zero items appear dimmed (30% opacity)

### Test 2: Verify Selective Save
1. Open browser console (F12)
2. Make changes on 4 pages
3. Open save dialog
4. Uncheck 2 pages (e.g., leave only Book 3017/P1 and P2 checked)
5. Click "Confirm & Save (2)"
6. **Check console** for:
   - `[SaveToLogseq] Selected page keys: ["3017-1", "3017-2"]`
   - `[SaveToLogseq] Skipping stroke from unselected page: 3017-3`
   - `[SaveToLogseq] Skipping stroke from unselected page: 3017-4`
   - `[SaveToLogseq] Processing page: 3017-1`
   - `[SaveToLogseq] Processing page: 3017-2`
7. **Check LogSeq** - only pages 1 and 2 should be updated

### Test 3: Verify Transcription Filtering
1. Import 4 pages from LogSeq that already have transcriptions
2. Edit transcriptions on all 4 pages
3. Open save dialog (should show "Updated transcription" for all 4)
4. Uncheck 2 pages
5. Save
6. **Verify**: Only the 2 checked pages have updated transcriptions in LogSeq
7. **Verify**: The 2 unchecked pages still have their old transcriptions

## Files Modified

**`src/components/dialog/SaveConfirmDialog.svelte`**
- Removed conditional rendering of summary items
- Added `class:zero` bindings for 30% opacity on zero items
- Added CSS for `.summary-item.zero` fade effect

**`src/components/header/ActionBar.svelte`**
- Added `selectedSet.has(key)` check before saving page transcriptions
- Added `selectedSet.has(key)` check for legacy transcription format
- Added comprehensive console.log debug statements

## Debug Output Example

When you uncheck 2 of 4 pages and save, you should see console output like:

```
[SaveToLogseq] Selected page keys: ["3017-1", "3017-2"]
[SaveToLogseq] Selected set: ["3017-1", "3017-2"]
[SaveToLogseq] Skipping stroke from unselected page: 3017-3
[SaveToLogseq] Skipping stroke from unselected page: 3017-3
...
[SaveToLogseq] Skipping stroke from unselected page: 3017-4
[SaveToLogseq] Skipping stroke from unselected page: 3017-4
...
[SaveToLogseq] Processing page: 3017-1 (book=3017, page=1)
Saved Smartpen Data/B3017/P1: +42 new, 42 total
Saving transcription to Smartpen Data/B3017/P1...
Saved transcription to Smartpen Data/B3017/P1 (5 lines)
[SaveToLogseq] Processing page: 3017-2 (book=3017, page=2)
Saved Smartpen Data/B3017/P2: +25 new, 25 total
Saving transcription to Smartpen Data/B3017/P2...
Saved transcription to Smartpen Data/B3017/P2 (3 lines)
```

## Known Edge Cases

### Transcription-Only Changes
If a page has ONLY transcription changes and no strokes in the current session:
- The page won't appear in `pagesToSave` (since it's built from strokes)
- Transcription won't be saved (expected behavior)
- **Workaround**: Ensure pages have strokes before saving transcription updates

### Deleted Strokes on Unselected Pages
If you delete strokes on Page 1 but don't select Page 1 for save:
- Deleted strokes remain in local canvas (correct)
- LogSeq version unchanged (correct)
- Next time you select Page 1, deletions will be saved

### All Pages Deselected
- Confirm button disabled
- Button text: "Select pages to save"
- Cannot proceed (correct behavior)

## Future Improvements

Potential enhancements:
- [ ] Visual diff view showing what will change on selected pages
- [ ] Ability to save transcription-only updates without strokes
- [ ] Batch operations for multiple selections
- [ ] Keyboard shortcuts for selection (Ctrl+Click, Shift+Click for range)
- [ ] Remember last selection between dialog opens
- [ ] "Save All" shortcut button

## Summary

Both issues are now fixed:
1. ✅ **Dialog width stable** - Items always shown, zero items dimmed
2. ✅ **Selective save works** - Only selected pages saved (both strokes and transcriptions)
3. ✅ **Debug logging added** - Easy to verify what's being saved

Please test with the debug console open to verify the selective save is working correctly!
