# Per-Page Transcription Update

**Date:** December 16, 2024  
**Version:** 0.2.1 (unreleased)

## Problem

When transcribing strokes from multiple pages/books, all strokes were being sent to MyScript as a single batch. This caused coordinate overlap since each page has its own coordinate system, resulting in "funky" transcription results where text from different pages would interfere with each other.

## Solution

Implemented per-page transcription processing:

1. **Separate Transcription by Page** - Each page's strokes are now transcribed independently
2. **Individual Page Results** - Each page maintains its own transcription result
3. **Import Selection** - Checkboxes allow selective import of pages to LogSeq

## Changes Made

### 1. Enhanced Transcription Store (`src/stores/transcription.js`)

**New Stores:**
- `pageTranscriptions` - Map of pageKey → transcription result
- `selectedPagesForImport` - Set of selected page keys
- `pageTranscriptionsArray` - Sorted array of page transcriptions
- `pageTranscriptionCount` - Count of transcribed pages
- `hasPageTranscriptions` - Boolean for any transcriptions

**New Functions:**
- `setPageTranscription(pageKey, transcription, pageInfo, strokeCount)` - Store result for a page
- `togglePageSelection(pageKey)` - Toggle page selection
- `selectAllPages()` / `deselectAllPages()` - Bulk selection
- `clearPageTranscription(pageKey)` - Remove specific page

### 2. Updated ActionBar (`src/components/header/ActionBar.svelte`)

**Transcription Logic:**
- Groups strokes by page before transcription
- Sends separate MyScript API requests for each page
- Shows progress per page: "Transcribing Book 1, Page 2..."
- Reports success/failure for each page individually

**Key Changes:**
```javascript
// OLD: Transcribe all strokes together
const result = await transcribeStrokes(allStrokes, appKey, hmacKey);

// NEW: Transcribe each page separately
for (const [pageKey, pageData] of strokesByPage) {
  const result = await transcribeStrokes(pageData.strokes, appKey, hmacKey);
  setPageTranscription(pageKey, result, pageInfo, strokeCount);
}
```

### 3. Complete Rewrite of TranscriptionView (`src/components/transcription/TranscriptionView.svelte`)

**New UI Features:**

**Action Bar:**
- Shows count of transcribed pages
- "Select All" / "Deselect All" toggle button
- "Send X Pages to Journal" button (disabled when none selected)
- Shows which pages are selected for import

**Page Cards:**
- Checkbox for import selection
- Book/Page badge display
- Stroke count indicator
- Expand/collapse details button
- Delete transcription button
- Visual indicator when selected (green border)

**Page Statistics (always visible):**
- Line count
- Word count
- Character count
- Indentation detection
- Command count

**Expandable Details:**
- Full transcribed text
- LogSeq preview with hierarchy
- Detected commands list

### 4. Updated Store Exports (`src/stores/index.js`)

Added exports for new transcription functions and stores to make them available throughout the app.

## Usage

### Transcribing Multiple Pages

1. **Connect Pen** and download offline notes (or write in real-time)
2. Click **"Transcribe (N)"** button
3. System will:
   - Detect pages: "Transcribing 3 all strokes from 3 page(s)..."
   - Process each page: "Transcribing Book 1, Page 2..."
   - Show results: "✓ Book 1/Page 2: 145 characters, 8 lines"
4. Switch to **Transcription** tab to see results

### Reviewing and Selecting Pages

1. Each page shows as a separate card
2. **Statistics** visible at a glance (lines, words, chars, etc.)
3. Click **expand arrow** to see full text and LogSeq preview
4. **Check/uncheck** boxes to select pages for import
5. Use **"Select All"** / **"Deselect All"** for bulk operations

### Importing to LogSeq

1. Select desired pages via checkboxes
2. Click **"Send X Pages to Journal"**
3. System sends each page separately:
   - "✓ Sent Book 1/Page 2: 8 blocks"
   - "✓ Sent Book 1/Page 3: 12 blocks"
4. Summary: "Import complete: 2 page(s) sent successfully"

## Benefits

### Accuracy
- **No More Coordinate Overlap** - Each page transcribed in its own coordinate space
- **Better Line Detection** - MyScript can properly detect baselines per page
- **Correct Indentation** - Hierarchy detection works within each page

### Control
- **Selective Import** - Choose which pages to send to LogSeq
- **Review Before Import** - Expand pages to verify transcription quality
- **Easy Cleanup** - Delete individual page transcriptions

### Clarity
- **Clear Attribution** - Always know which book/page text came from
- **Organized Display** - Pages sorted by book then page number
- **Quick Stats** - See word/line counts without expanding

## Technical Details

### Page Key Format
```
S{section}/O{owner}/B{book}/P{page}
```
Example: `S0/O0/B1/P2` = Section 0, Owner 0, Book 1, Page 2

### Data Flow
```
User clicks Transcribe
  ↓
Group strokes by page key
  ↓
For each page:
  - Extract page strokes
  - Send to MyScript API
  - Store result with setPageTranscription()
  - Auto-select for import
  ↓
Display in TranscriptionView
  ↓
User reviews & selects pages
  ↓
Send selected pages to LogSeq
```

### Storage Structure
```javascript
pageTranscriptions: Map {
  "S0/O0/B1/P1" => {
    text: "Transcribed text...",
    lines: [...],
    words: [...],
    commands: [...],
    pageInfo: { section: 0, owner: 0, book: 1, page: 1 },
    strokeCount: 45,
    timestamp: 1702768800000
  },
  "S0/O0/B1/P2" => { ... }
}

selectedPagesForImport: Set {
  "S0/O0/B1/P1",
  "S0/O0/B1/P2"
}
```

## Backward Compatibility

- `lastTranscription` store still exists for backward compatibility
- `setTranscription()` still works (legacy mode)
- Old transcription components still receive data via derived stores
- Gradual migration path for any dependent code

## Future Enhancements

Potential improvements:
1. **Page Filtering** - Filter view by book number
2. **Bulk Operations** - Delete multiple pages, export as batch
3. **Transcription Editing** - Manual text corrections before import
4. **Page Merging** - Combine multiple pages into single import
5. **Sorting Options** - Sort by date, stroke count, etc.
6. **Search** - Find text across all transcribed pages

## Migration Notes

If you have custom code that uses the old transcription system:

**Old Way:**
```javascript
import { lastTranscription } from '$stores';
// ...transcribe all strokes together
setTranscription(result);
```

**New Way:**
```javascript
import { pageTranscriptions, setPageTranscription } from '$stores';
// ...transcribe per page
setPageTranscription(pageKey, result, pageInfo, strokeCount);
```

The old way still works but won't benefit from per-page features.

## Testing Checklist

- [x] Transcribe single page - works correctly
- [x] Transcribe multiple pages - separate results
- [x] Select/deselect pages - checkbox state tracking
- [x] Select all / Deselect all - bulk operations
- [x] Send to LogSeq - respects selection
- [x] Expand/collapse details - state management
- [x] Delete page transcription - removal works
- [ ] Test with many pages (10+) - performance
- [ ] Test with large pages (100+ strokes) - MyScript limits
- [ ] Test error handling - API failures per page

## Known Issues

None currently identified. If you encounter issues:

1. Check browser console for errors
2. Verify MyScript API credentials are set
3. Ensure LogSeq connection is active
4. Check that strokes have valid pageInfo data
5. Review activity log for detailed error messages

## Questions?

If you have questions about these changes or encounter issues:
- Review the activity log for detailed transcription progress
- Check console for any error messages
- Verify page info is present in stroke data (Book/Page numbers)
