# Update: Preprocessing Shift to User-Controlled Deselection

**Date:** December 19, 2024
**Version:** 0.2.0+

## Summary

Changed decorative stroke handling from automatic filtering (behind-the-scenes preprocessing) to user-controlled deselection (explicit button action). This gives users control over what strokes to include in transcription while still streamlining the workflow of removing boxes, underlines, and circles.

## What Changed

### Before
- Strokes were automatically filtered before sending to MyScript
- Filtered strokes were stored separately and visualized with dashed lines
- Users had no control over whether decorative elements were included
- The filtering happened invisibly in the transcription pipeline

### After
- All strokes are sent to MyScript (no automatic filtering)
- New **"🎨 Deselect Decorative"** button in SelectionInfo panel
- Users explicitly choose when to deselect boxes/underlines/circles
- Deselected strokes turn black/transparent (standard deselection behavior)
- Users can reselect any strokes if the detection was wrong

## How to Use

### Quick Workflow
1. Import or capture strokes from your pen
2. Click **"🎨 Deselect Decorative"** button
   - If nothing is selected, it will first select all strokes, then deselect decorative ones
   - If you have a selection, it will only deselect decorative strokes from that selection
3. Review the selection (decorative strokes will be deselected/black)
4. Click **"Transcribe"** to send only the selected strokes to MyScript

### Advanced Usage

**Selective Transcription:**
1. Select specific strokes you want to transcribe
2. Click "Deselect Decorative" to remove any decorative elements from your selection
3. Transcribe the refined selection

**Manual Override:**
1. Use "Deselect Decorative" to auto-detect decorative strokes
2. Manually reselect any strokes that were incorrectly detected
3. Manually deselect any additional decorative strokes that were missed

**Fine-tuning Detection:**
- Click the "Advanced Filter Settings" section (if available)
- Adjust detection thresholds for your handwriting style
- Changes apply the next time you click "Deselect Decorative"

## Technical Changes

### Files Modified

1. **`src/lib/myscript-api.js`**
   - Removed automatic `filterDecorativeStrokes()` call
   - Removed decorative stroke tracking in transcription results
   - Simplified to just send all strokes to MyScript

2. **`src/lib/stroke-filter.js`**
   - Added new `detectDecorativeIndices()` function
   - Returns array of indices and stats instead of splitting strokes
   - Same detection logic (boxes, underlines, circles)

3. **`src/stores/selection.js`**
   - Added `deselectIndices(indices)` function
   - Added `selectIndices(indices)` function
   - Exported new functions via stores/index.js

4. **`src/components/strokes/SelectionInfo.svelte`**
   - Added "🎨 Deselect Decorative" button
   - Implemented detection and deselection logic
   - Auto-selects all if nothing selected (for convenience)
   - Shows detection stats in activity log

5. **`src/components/header/ActionBar.svelte`**
   - Removed filtered strokes collection
   - Removed `setFilteredStrokes()` calls
   - Simplified transcription flow

6. **`src/components/strokes/FilterSettings.svelte`**
   - Updated descriptions to reflect new user-controlled behavior
   - Clarified that settings affect the "Deselect Decorative" button

### Removed Functionality
- Automatic filtering pipeline removed
- Dashed stroke visualization for filtered strokes (no longer needed)
- `filteredStrokes` store still exists but is no longer populated
- Filter stats in transcription results (can be added back if needed)

## Benefits

### User Control
- Users decide what gets included/excluded
- Can override incorrect detections
- No surprises about what was filtered out

### Simplified Visual Feedback
- Deselected strokes use standard black/transparent appearance
- No need for special dashed line visualization
- Cleaner canvas with fewer visual modes

### Flexible Workflow
- Can use detection as a starting point
- Can manually refine the selection
- Can skip detection entirely if not needed

### Better for Edge Cases
- If detection algorithm misidentifies text as decorative, user can reselect
- If decorative strokes should be transcribed, user can keep them selected
- No need to adjust thresholds to fix automatic filtering mistakes

## Detection Algorithm

The detection algorithm remains the same:

### Boxes (2-stroke patterns)
- Two strokes drawn within 5 seconds
- One horizontal, one vertical (or complex)
- Contains at least 2 other strokes inside
- Size between 5-50mm

### Underlines
- Very horizontal (aspect ratio > 50:1)
- Very straight (>90% straightness)
- Substantial length (>15mm)
- Not part of a box pattern

### Circles/Ovals
- Closed loop (endpoints within 2mm)
- Smooth curve (>30 dots)
- Large enough to not be a letter (>4mm)
- Contains at least 1 other stroke inside
- Not part of a box pattern

## Migration Notes

### For Users
- Old behavior: Decorative strokes automatically filtered
- New behavior: Click "Deselect Decorative" button before transcribing
- One extra step, but gives you control

### For Developers
- `transcribeStrokes()` no longer returns `filterStats` or `decorativeStrokes`
- Use `detectDecorativeIndices()` if you need detection results
- Use `deselectIndices()` to programmatically deselect strokes

### Breaking Changes
- Transcription results no longer include `filterStats` field
- Transcription results no longer include `decorativeStrokes` field
- `filteredStrokes` store will remain empty (can be removed in future)

## Future Enhancements

Possible improvements to consider:

1. **Visual Preview Mode**
   - Highlight detected decorative strokes before deselecting
   - Show colored overlay: red for boxes, yellow for underlines, blue for circles
   - Add "Preview" and "Apply" buttons

2. **Undo/Redo**
   - Remember previous selection states
   - Quick undo of "Deselect Decorative" action

3. **Smart Selection Modes**
   - "Select Only Text" (opposite of current behavior)
   - "Select Only Decorative"
   - Toggle between modes

4. **Per-Page Detection**
   - Run detection separately for each page
   - Handle multi-page documents better

5. **Machine Learning**
   - Learn from user corrections
   - Adapt detection to user's handwriting style

## Testing Checklist

- [x] Button appears in SelectionInfo panel
- [x] Detection runs without errors
- [x] Correct strokes are deselected
- [x] Activity log shows detection stats
- [x] Can manually reselect deselected strokes
- [x] Works with no selection (auto-selects all first)
- [x] Works with partial selection
- [x] Transcription receives only selected strokes
- [x] No dashed stroke visualization appears
- [ ] Test with various handwriting samples
- [ ] Test with edge cases (overlapping decorations)
- [ ] Test performance with large stroke counts

## Feedback

This change was requested to give users more control over the transcription process. If you encounter issues or have suggestions for improvements, please provide feedback through:

1. Testing with your actual handwriting samples
2. Noting any false positives (text incorrectly detected as decorative)
3. Noting any false negatives (decorative strokes not detected)
4. Suggesting threshold adjustments for your handwriting style

---

**Implementation By:** Claude (AI Assistant)  
**Requested By:** Josh (SmartPen-LogSeq Bridge Developer)  
**Review Status:** Pending user testing
