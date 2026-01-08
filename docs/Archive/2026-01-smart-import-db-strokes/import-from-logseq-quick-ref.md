# Quick Reference: Import from LogSeq Feature

## Files Modified

### 1. `src/lib/logseq-import.js`
**Added:** New function `importStrokesForLoadedPages()`
- Lines: ~117 lines of new code
- Purpose: Imports additional strokes from LogSeq for currently loaded pages
- Key features: Duplicate detection, progress callbacks, comprehensive error handling

### 2. `src/components/strokes/StrokeList.svelte`
**Modified:** Added import button and progress UI
- Added imports: `logseqConnected`, `importStrokesForLoadedPages`
- Added state: `isImporting`, `importProgress`
- Added function: `handleImportFromLogSeq()`
- Added UI: Button, progress bar, progress text
- Added styles: Button, spinner animation, progress bar styles

## Visual Changes

### Before
```
┌─────────────────────────────────────────┐
│ Strokes Tab                             │
├─────────────────────────────────────────┤
│ 234 strokes across 2 books (3 pages)   │
│                           [5 selected]  │
├─────────────────────────────────────────┤
│ Book 3017                               │
│   Page 42 (120 strokes)                 │
│   Page 43 (114 strokes)                 │
└─────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────────────────┐
│ Strokes Tab                                         │
├─────────────────────────────────────────────────────┤
│ 234 strokes (2 books, 3 pages) [5 sel] [⬇ Import]│
├─────────────────────────────────────────────────────┤
│ [████████████░░░░░░░░] Importing B3017/P42 (2/3)   │
├─────────────────────────────────────────────────────┤
│ Book 3017                                           │
│   Page 42 (120 strokes)                             │
│   Page 43 (114 strokes)                             │
└─────────────────────────────────────────────────────┘
```

## Button States

| State | Visual | Clickable | Tooltip |
|-------|--------|-----------|---------|
| Ready | ⬇ Import from LogSeq | Yes | Import additional strokes... |
| Not Connected | ⬇ Import from LogSeq (grayed) | No | Connect to LogSeq first |
| Importing | [Spinner] Importing... | No | N/A |

## Usage Flow

```
1. User clicks "⬇ Import from LogSeq"
   ↓
2. Button changes to [Spinner] Importing...
   ↓
3. Progress bar appears showing page-by-page import
   ↓
4. Each page:
   - Extract book/page from current strokes
   - Find matching page in LogSeq DB
   - Import strokes (skip duplicates)
   - Update progress bar
   ↓
5. Complete: Show summary in Activity Log
   - "Import complete: X new strokes from Y pages (Z duplicates skipped)"
   ↓
6. Button returns to ready state
   ↓
7. Canvas updates with new strokes
```

## Data Flow

```
Current Strokes in Canvas
    ↓
Extract Unique Pages (B/P combinations)
    ↓
Query LogSeq DB for Matching Pages
    ↓
For Each Matching Page:
    ↓
    Fetch Stroke Data from LogSeq
    ↓
    Transform to Canvas Format
    ↓
    Merge with Deduplication
    ↓
    Update Canvas
    ↓
Report Final Stats
```

## Code Highlights

### Duplicate Detection
```javascript
function getStrokeId(stroke) {
  // Stored format uses 'id' field
  if (stroke.id) return stroke.id;
  // Raw format uses startTime
  return `s${stroke.startTime}`;
}
```

### Progress Callback
```javascript
await importStrokesForLoadedPages((message, current, total) => {
  // Update UI with current progress
  importProgress = { message, current, total };
});
```

### Error Handling
```javascript
if (currentStrokes.length === 0) {
  log('No strokes loaded to match against LogSeq', 'warning');
  return { success: false, error: 'No strokes currently loaded' };
}

if (allLogseqPages.length === 0) {
  log('No pages found in LogSeq DB. Scan LogSeq first.', 'warning');
  return { success: false, error: 'No pages in LogSeq DB' };
}
```

## Testing Commands

### Test Case 1: Normal Import
1. Connect pen
2. Download offline notes (creates strokes)
3. Click "Import from LogSeq"
4. Verify progress bar shows
5. Verify success message in Activity Log
6. Verify canvas updates

### Test Case 2: No LogSeq Connection
1. Ensure LogSeq is disconnected
2. Verify button is disabled and grayed out
3. Hover to see "Connect to LogSeq first" tooltip

### Test Case 3: No Matching Pages
1. Connect pen with new page (not in LogSeq)
2. Click "Import from LogSeq"
3. Verify message: "No matching pages found in LogSeq DB"

### Test Case 4: Duplicate Handling
1. Import strokes from pen (page X)
2. Save to LogSeq
3. Keep those strokes in canvas
4. Click "Import from LogSeq"
5. Verify duplicate count in success message
6. Verify stroke count doesn't change

## Common Issues & Solutions

### Issue: Button is disabled
**Solution:** Check LogSeq connection status in Settings

### Issue: "No pages found in LogSeq DB"
**Solution:** Go to LogSeq DB tab and click "Scan LogSeq"

### Issue: "No matching pages found"
**Solution:** The pages in your canvas haven't been saved to LogSeq yet

### Issue: Import seems stuck
**Solution:** Check browser console for errors, verify LogSeq API is responding

## Performance Notes

- Import is sequential (page by page) to avoid overwhelming LogSeq API
- Progress updates every page (not every stroke) to reduce UI overhead
- Duplicate detection uses Set for O(1) lookup performance
- Stroke sorting is done once at the end, not per-page

## Accessibility

- Button has descriptive tooltip
- Disabled state is visually distinct
- Progress is communicated via Activity Log for screen readers
- Color-coded success/error messages in Activity Log
