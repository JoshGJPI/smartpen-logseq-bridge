# Edit Structure Before Save - Feature Addition

**Date**: January 23, 2026  
**Feature**: Edit transcription structure in Transcription tab before saving to LogSeq  
**Status**: ✅ Complete

---

## What Was Added

Added an "Edit Structure" button to the Transcription tab that allows users to edit, merge, and reorganize transcription lines **before** saving them to LogSeq.

### The Workflow

**Before** (old workflow):
1. Transcribe strokes → MyScript returns results
2. Save to LogSeq → Results written immediately
3. Open LogSeq → Edit structure manually
4. Problems: Had to save first, then edit in LogSeq

**After** (new workflow):
1. Transcribe strokes → MyScript returns results
2. **Click "Edit Structure"** → Modal opens
3. Merge lines, adjust hierarchy, edit text
4. Save changes → Updated structure shown in preview
5. Save to LogSeq → Clean, organized structure

---

## Files Modified

| File | Changes | Purpose |
|------|---------|---------|
| `src/components/transcription/TranscriptionView.svelte` | +80 lines | Added Edit Structure button and modal integration |
| `src/stores/transcription.js` | +30 lines | Added `updatePageTranscriptionLines()` function |
| `src/stores/index.js` | +1 line | Exported new function |

**Total**: ~111 lines added

---

## Key Features

### 1. Edit Structure Button

Located in the expanded details of each transcription page:

```
📄 Book 3017 / Page 1 [✓]
  Stats: 15 lines, 87 words, 425 chars
  
  [Edit Structure] ← NEW BUTTON
  
  Transcribed Text
  LogSeq Preview
```

### 2. Full Editor Modal

Opens the same TranscriptionEditorModal used for post-save editing:
- ✅ Merge adjacent lines
- ✅ Split lines
- ✅ Edit text inline
- ✅ Adjust hierarchy (indentation)
- ✅ Smart merge suggestions
- ✅ Undo/Redo support

### 3. Live Preview Update

After saving changes:
- ✅ Transcription text updates in real-time
- ✅ LogSeq preview shows new structure
- ✅ Stats recalculate (line count, word count, etc.)
- ✅ Ready to save to LogSeq with clean structure

---

## User Experience

### Scenario: Merge Wrapped Lines

**Problem**: Handwriting wraps mid-sentence, MyScript sees 2 lines

```
This is a long sentence that
wrapped onto the next line
```

**Solution**:
1. Click "Edit Structure"
2. Select both lines
3. Click "Merge"
4. Result: `This is a long sentence that wrapped onto the next line`
5. Save → Goes to LogSeq as single block

### Scenario: Fix Hierarchy

**Problem**: MyScript misdetected indentation level

```
Main point
  Sub point (wrong indent)
```

**Solution**:
1. Click "Edit Structure"  
2. Adjust indentation in editor
3. Save → Hierarchy corrected
4. Save to LogSeq → Proper nested structure

---

## Technical Implementation

### State Flow

```
1. Transcription Store (pageTranscriptions Map)
   ↓
2. TranscriptionView displays results
   ↓
3. User clicks "Edit Structure"
   ↓
4. TranscriptionEditorModal opens with lines
   ↓
5. User edits (merge, split, etc.)
   ↓
6. Modal emits 'save' event with updated lines
   ↓
7. updatePageTranscriptionLines() called
   ↓
8. Store updates pageTranscriptions Map
   ↓
9. TranscriptionView re-renders with new structure
```

### New Store Function

```javascript
/**
 * Update transcription lines for a specific page
 * @param {string} pageKey - Page identifier (e.g., "S0/O0/B3017/P1")
 * @param {Array} updatedLines - New lines array from editor
 */
export function updatePageTranscriptionLines(pageKey, updatedLines) {
  pageTranscriptions.update(pt => {
    const newMap = new Map(pt);
    const pageData = newMap.get(pageKey);
    
    // Update lines array and regenerate text
    const updatedText = updatedLines.map(l => l.text).join('\n');
    
    newMap.set(pageKey, {
      ...pageData,
      lines: updatedLines,
      text: updatedText,
      timestamp: Date.now()
    });
    
    return newMap;
  });
}
```

---

## Benefits

### 1. Better Organization Before Save
- Clean up structure before committing to LogSeq
- Merge lines that should be together
- Fix indentation issues

### 2. Faster Workflow
- No need to save → open LogSeq → edit → come back
- Edit directly in the app
- See changes immediately

### 3. Consistent UX
- Same editor modal for pre-save and post-save editing
- Familiar interface
- All editing features available

### 4. Reduces LogSeq Clutter
- Only save clean, organized transcriptions
- No messy formatting to fix later
- Professional-looking notes from the start

---

## Usage Tips

### When to Use Edit Structure

**Good use cases**:
- ✅ Merge wrapped lines into complete sentences
- ✅ Fix misdetected indentation
- ✅ Combine related bullet points
- ✅ Remove extra blank lines
- ✅ Adjust hierarchy before saving

**Not needed when**:
- Transcription is already clean
- Structure is correct as-is
- You plan to edit in LogSeq anyway

### Best Practices

1. **Review First**: Expand the page details to see the transcription
2. **Edit Structure**: Click the button and make adjustments
3. **Verify Preview**: Check the LogSeq preview after editing
4. **Save to LogSeq**: Only save when structure looks good

---

## Integration Notes

### Works With Incremental Updates

The editor modal already has stroke→block persistence for post-save editing. This same functionality works for pre-save editing:

- If you edit structure pre-save, strokes aren't assigned to blocks yet
- After saving to LogSeq, strokes get matched to blocks
- Future edits use the stroke→block associations

### Works With Custom UUIDs

When you eventually save to LogSeq, the blocks will be created with Bridge UUIDs (`b12d` prefix) to prevent collisions.

---

## Testing

### Quick Test

1. Transcribe some strokes (multiple lines)
2. Click "Edit Structure" button
3. Merge two lines together
4. Save changes
5. **Verify**: Preview shows merged line
6. Save to LogSeq
7. **Verify**: LogSeq shows merged line as single block

### Expected Behavior

- ✅ Button appears in expanded page details
- ✅ Modal opens with current lines
- ✅ Edits save and update preview
- ✅ Stats recalculate correctly
- ✅ Can edit multiple times before saving to LogSeq

---

## Future Enhancements

### Potential Additions

1. **Batch Edit**: Edit multiple pages at once
2. **Templates**: Apply common structure patterns
3. **Auto-Merge**: Automatically merge obvious wrapped lines
4. **Inline Edit**: Edit structure directly in preview (no modal)

---

## Summary

This feature completes the transcription editing experience by allowing structure adjustments **before** committing to LogSeq. It uses the same powerful editor modal, maintains consistency with post-save editing, and provides a cleaner, more efficient workflow.

**Result**: Users can now produce clean, well-organized transcriptions in LogSeq without needing to edit after the fact.

---

*Feature completed: January 23, 2026*  
*Total implementation time: ~30 minutes*  
*All changes committed and ready to use*
