# Import Additional Strokes from LogSeq Feature

## Overview

Added a new feature that allows importing additional strokes from LogSeq DB for pages that are currently loaded in the canvas. This simplifies the workflow of getting the complete picture before sending strokes for transcription.

## How It Works

### User Workflow

1. **Connect pen and import strokes** (either real-time or offline sync)
2. **Click "⬇ Import from LogSeq" button** in the Strokes tab header
3. **Wait for import to complete** - Progress is shown with a progress bar
4. **Review combined strokes** - All strokes from both sources are now visible
5. **Proceed with transcription** - Send the complete stroke set to MyScript

### Technical Implementation

The feature adds two key components:

#### 1. New Function: `importStrokesForLoadedPages()`

Location: `src/lib/logseq-import.js`

This function:
- Identifies all unique book/page combinations from currently loaded strokes
- Queries the LogSeq DB to find matching pages
- Imports strokes from each matching page
- Merges with existing strokes, removing duplicates
- Provides progress feedback during import
- Logs detailed import statistics

**Function Signature:**
```javascript
async function importStrokesForLoadedPages(onProgress = null)
```

**Parameters:**
- `onProgress`: Optional callback function `(message, current, total) => void`

**Returns:**
```javascript
{
  success: boolean,
  imported: number,         // Count of new strokes added
  duplicatesSkipped: number, // Count of duplicates skipped
  pagesProcessed: number    // Count of pages successfully imported
}
```

#### 2. Updated Component: `StrokeList.svelte`

Location: `src/components/strokes/StrokeList.svelte`

Added:
- "Import from LogSeq" button in the list header
- Progress indicator showing import status
- Disabled state when LogSeq is not connected
- Loading state with spinner during import
- Progress bar showing page-by-page import progress

**UI States:**

1. **Ready State** (LogSeq connected, not importing):
   - Button shows "⬇ Import from LogSeq"
   - Clickable and enabled

2. **Disabled State** (LogSeq not connected):
   - Button is grayed out
   - Tooltip: "Connect to LogSeq first"

3. **Importing State**:
   - Button shows spinner and "Importing..."
   - Progress bar displays below header
   - Progress text shows: "Importing B{book}/P{page}... (current/total)"

## Key Features

### Duplicate Detection

The function uses intelligent duplicate detection:
- Creates unique stroke IDs from either the `id` field (stored format) or `startTime` (raw format)
- Skips strokes that already exist in the canvas
- Logs the number of duplicates skipped for transparency

### Progress Tracking

Real-time progress updates during import:
- Message showing current page being imported
- Current/total page count
- Visual progress bar
- All updates logged to Activity Log

### Error Handling

Comprehensive error handling:
- Validates strokes are loaded before attempting import
- Checks LogSeq connection status
- Verifies LogSeq DB has been scanned
- Provides helpful error messages for each failure case
- Logs all errors to Activity Log

## Use Cases

### 1. Incremental Writing Sessions

**Scenario:** You write some notes, save to LogSeq, then add more notes in a later session.

**Workflow:**
1. Connect pen and download latest offline notes
2. Click "Import from LogSeq" to merge with previous session
3. Transcribe the complete combined content

### 2. Multi-Device Workflows

**Scenario:** You've written on multiple pens but want to see all strokes together.

**Workflow:**
1. Import strokes from Pen A
2. Save to LogSeq
3. Import strokes from Pen B
4. Click "Import from LogSeq" to combine Pen A + Pen B strokes
5. Transcribe everything together

### 3. Reviewing Transcribed Content

**Scenario:** You've already transcribed and saved notes, but want to review the original strokes.

**Workflow:**
1. Scan LogSeq DB to see available pages
2. Navigate to LogSeq DB tab and import a page
3. Canvas shows those strokes
4. Click "Import from LogSeq" to ensure nothing was missed
5. Review the complete stroke picture

## Technical Details

### Stroke Merging Algorithm

```javascript
// 1. Build set of existing stroke IDs
const existingIds = new Set(existingStrokes.map(getStrokeId));

// 2. Filter new strokes
for (const stroke of newStrokes) {
  const id = getStrokeId(stroke);
  if (existingIds.has(id)) {
    duplicates.push(stroke);
  } else {
    uniqueNew.push(stroke);
    existingIds.add(id); // Prevent duplicates within newStrokes
  }
}

// 3. Merge and sort by time
const merged = [...existingStrokes, ...uniqueNew]
  .sort((a, b) => {
    const timeA = a.startTime || parseInt(a.id?.slice(1) || '0');
    const timeB = b.startTime || parseInt(b.id?.slice(1) || '0');
    return timeA - timeB;
  });
```

### Page Matching Logic

```javascript
// Extract unique book/page combinations from current strokes
const loadedPages = new Map();
currentStrokes.forEach(stroke => {
  const book = stroke.pageInfo.book || 0;
  const page = stroke.pageInfo.page || 0;
  const key = `B${book}/P${page}`;
  
  if (!loadedPages.has(key)) {
    loadedPages.set(key, { book, page });
  }
});

// Find matching pages in LogSeq
const matchingPages = [];
for (const [key, pageRef] of loadedPages.entries()) {
  const match = allLogseqPages.find(p => 
    p.book === pageRef.book && p.page === pageRef.page
  );
  
  if (match) {
    matchingPages.push(match);
  }
}
```

## Dependencies

This feature relies on:
- `lib/logseq-import.js` - Import logic
- `lib/logseq-scanner.js` - LogSeq DB querying
- `stores/strokes.js` - Stroke data management
- `stores/logseqPages.js` - LogSeq page tracking
- `stores/settings.js` - LogSeq connection status

## Testing Checklist

- [ ] Button is disabled when LogSeq not connected
- [ ] Button shows correct tooltip when disabled
- [ ] Import works with single page loaded
- [ ] Import works with multiple pages loaded
- [ ] Import works with multiple books loaded
- [ ] Duplicate strokes are correctly skipped
- [ ] Progress bar updates during import
- [ ] Success message shows correct counts
- [ ] Error handling works when LogSeq DB not scanned
- [ ] Error handling works when no matching pages found
- [ ] Activity Log shows all status updates
- [ ] Canvas updates with new strokes after import
- [ ] Page sync status updates correctly

## Future Enhancements

Potential improvements:
1. **Selective Import** - Checkbox to select which pages to import
2. **Conflict Resolution** - UI to handle stroke conflicts differently
3. **Smart Merging** - Detect and highlight overlapping strokes
4. **Auto-Import** - Option to automatically import from LogSeq when opening a page
5. **Batch Operations** - Import all pages in LogSeq DB at once

## Related Documentation

- See `docs/app-specification.md` for overall architecture
- See `lib/logseq-import.js` for detailed import logic
- See `lib/stroke-storage.js` for stroke format specifications
- See `stores/strokes.js` for stroke data structure
