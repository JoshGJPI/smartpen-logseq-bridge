# LogSeq Storage Implementation - Phase 1 Complete

**Date:** December 2024  
**Status:** ✅ Ready for Testing

---

## What Was Implemented

Phase 1 of the LogSeq storage system is complete. The app can now:

1. **Save raw stroke data** to LogSeq archive pages (`Smartpen Data/B{book}/P{page}`)
2. **Save transcription data** with hierarchy to the same pages
3. **Handle incremental updates** with automatic deduplication
4. **Group multi-page sessions** and save each page independently

---

## New Files Created

```
src/
├── lib/
│   └── stroke-storage.js          # Data transformation utilities (350 lines)
└── stores/
    └── storage.js                 # Storage state management (130 lines)

docs/
└── logseq-storage-spec.md         # Complete specification (900 lines)
```

---

## Modified Files

```
src/
├── lib/
│   └── logseq-api.js              # +280 lines - New storage methods
├── components/
│   ├── header/
│   │   └── ActionBar.svelte       # +80 lines - "Save Strokes" button
│   └── transcription/
│       └── TranscriptionView.svelte # +60 lines - "Save to Storage" button
└── stores/
    └── index.js                   # +13 lines - Export storage stores
```

---

## Key Features

### 1. Simplified Stroke Format

Raw pen data is reduced by ~60% by removing artistic metadata:

**Removed:**
- Pen tilt (angle.tx, angle.ty, angle.twist)
- Pressure (f)
- Color (always black for notes)
- Pen hardware details (dotType, penTipType)

**Kept:**
- x, y coordinates
- timestamps
- stroke start/end times
- page info (book, page, section, owner)

### 2. Smart Deduplication

Strokes are identified by unique IDs based on `startTime`:
- Real-time strokes saved immediately
- Offline batch uploads automatically skip duplicates
- Same page can be updated multiple times safely

### 3. Namespace Organization

Pages are organized hierarchically:
```
Smartpen Data/
├── B3017/
│   ├── P42
│   └── P43
└── B1234/
    └── P1
```

### 4. Page Structure

Each storage page contains:

```markdown
## Page Information
- **Book:** 3017
- **Page:** 42
- **Last Updated:** 2024-12-12 14:32:15
- **Stroke Count:** 145
- **Status:** Transcribed

## Raw Stroke Data
```json
{
  "version": "1.0",
  "pageInfo": { ... },
  "strokes": [ ... ],
  "metadata": { ... }
}
```

## Transcription Data
```json
{
  "version": "1.0",
  "transcribedAt": 1765368900000,
  "text": "...",
  "lines": [ ... ]
}
```

## Transcribed Text
Meeting Notes
  Discussed Q1 roadmap
```

---

## How to Use

### Saving Raw Strokes

1. Write on your smartpen (or download offline notes)
2. Strokes appear in the canvas
3. Click **"Save Strokes"** button in header
4. Strokes are saved to `Smartpen Data/B{book}/P{page}`
5. Activity log shows: "Saved to Smartpen Data/B3017/P42: 12 new, 145 total"

**Features:**
- Automatically groups strokes by page
- Handles multi-page sessions
- Deduplicates on subsequent saves
- Updates existing pages incrementally

### Saving Transcription

1. Transcribe your strokes using MyScript
2. Review transcription in right panel
3. Click **"Save to Storage"** button
4. Transcription + plain text saved to same page
5. Page status updates to "Transcribed"

**Features:**
- Associates transcription with correct page
- Stores hierarchy and indentation
- Includes plain text for readability
- Replaces old transcription if re-transcribed

### Sending to Journal (Existing Feature)

The **"Send to Journal"** button still works as before:
- Sends transcribed text to today's journal page
- Creates hierarchical blocks
- Different from storage (journal = working notes, storage = archive)

---

## Testing Instructions

### Test 1: Basic Stroke Storage

```
1. Connect pen
2. Write on page 42 of book 3017
3. Click "Save Strokes" in header
4. Expected: LogSeq page created "Smartpen Data/B3017/P42"
5. Check: Page has "Raw Stroke Data" JSON block
6. Verify: JSON contains simplified strokes (no tilt/pressure)
```

### Test 2: Incremental Update

```
1. Complete Test 1
2. Write more strokes on same page
3. Click "Save Strokes" again
4. Expected: Page updates with new strokes
5. Check: "Stroke Count" increases
6. Verify: No duplicate strokes (compare IDs)
```

### Test 3: Multi-Page Session

```
1. Write on page 42
2. Write on page 43
3. Write on page 44
4. Click "Save Strokes" once
5. Expected: 3 pages created (B3017/P42, P43, P44)
6. Check: Each page has correct strokes
7. Verify: Activity log shows all 3 saves
```

### Test 4: Transcription Storage

```
1. Write strokes on a page
2. Click "Transcribe"
3. Wait for MyScript results
4. Click "Save to Storage" in transcription panel
5. Expected: Transcription added to same page
6. Check: "Transcription Data" and "Transcribed Text" sections exist
7. Verify: Status updates to "Transcribed"
```

### Test 5: Re-transcription

```
1. Complete Test 4
2. Transcribe again (maybe with different selection)
3. Click "Save to Storage"
4. Expected: Old transcription replaced
5. Check: Only one "Transcription Data" section
6. Verify: "Last Updated" timestamp changed
```

### Test 6: Offline Batch Upload

```
1. Write offline (pen not connected)
2. Write on multiple pages
3. Connect pen
4. Click "Fetch Notes"
5. Click "Save Strokes"
6. Expected: All pages saved
7. Verify: No duplicates if re-downloaded
```

### Test 7: Error Handling

```
1. Disconnect from LogSeq (disable HTTP API)
2. Try to save strokes
3. Expected: Error message in activity log
4. Expected: "Configure LogSeq connection" hint
5. Reconnect to LogSeq
6. Try again - should succeed
```

---

## API Methods Reference

### Storage Utilities (`stroke-storage.js`)

```javascript
// Convert raw pen strokes to storage format
convertToStorageFormat(strokes) → simplifiedStrokes

// Generate unique stroke ID
generateStrokeId(stroke) → "s1765313505107"

// Calculate bounding box
calculateBounds(strokes) → { minX, maxX, minY, maxY }

// Remove duplicate strokes
deduplicateStrokes(existing, new) → uniqueStrokes

// Build complete page object
buildPageStorageObject(pageInfo, strokes) → storageObject

// Build transcription object
buildTranscriptionStorageObject(transcription, count) → transcriptionObject

// Format page name
formatPageName(book, page) → "Smartpen Data/B3017/P42"

// Parse/format JSON blocks
parseJsonBlock(content) → object
formatJsonBlock(data) → "```json\n...\n```"

// Format transcribed text with indentation
formatTranscribedText(lines) → indented text
```

### LogSeq API Methods (`logseq-api.js`)

```javascript
// Get or create storage page
await getOrCreateSmartpenPage(book, page, host, token)
  → pageObject

// Get existing stroke data
await getPageStrokes(book, page, host, token)
  → storageObject or null

// Update with new strokes (incremental)
await updatePageStrokes(book, page, newStrokes, host, token)
  → { success, added, total, page }

// Update transcription data
await updatePageTranscription(book, page, transcription, count, host, token)
  → { success, page, lineCount }
```

### Storage Store (`storage.js`)

```javascript
// State
$storageStatus → { isSaving, lastSave, lastError, savedPages }
$storageStats → { totalPages, totalStrokes, lastUpdate }
$storageStatusMessage → formatted status string
$hasSavedPages → boolean

// Actions
setStorageSaving(true/false)
recordSuccessfulSave(pageKey, result)
recordStorageError(errorMessage)
clearStorageStatus()
isPageSaved(book, page) → boolean
```

---

## Next Steps: Phase 2 (LogSeq Renderer Plugin)

Once storage is tested and working, we'll build the native LogSeq renderer:

1. Create LogSeq plugin project
2. Register `{{renderer smartpen, B3017, P42}}` macro
3. Parse stroke JSON from page blocks
4. Generate inline SVG preview
5. Add interactive features (zoom, pan)
6. Publish to LogSeq marketplace

**Estimated Time:** 4-6 hours

---

## Troubleshooting

### "Configure LogSeq connection" error
- Open Settings → LogSeq
- Ensure HTTP API is enabled in LogSeq app
- Test connection with "Test Connection" button

### Strokes not saving
- Check Activity Log for specific error
- Verify page info exists in strokes (book, page)
- Ensure LogSeq is running and API is accessible

### Duplicate strokes after re-save
- This shouldn't happen (deduplication is automatic)
- If it does, report as bug with:
  - Stroke IDs from JSON
  - Steps to reproduce

### Transcription not saving
- Ensure strokes were saved first
- Check that transcription completed successfully
- Verify LogSeq connection is active

### Pages not appearing in LogSeq
- Check namespace: `Smartpen Data/B{book}/P{page}`
- Try page search in LogSeq
- Verify blocks weren't accidentally deleted

---

## Known Limitations

1. **Page updates are full rewrites** - For simplicity, we delete and recreate blocks on update. This is fine for storage pages (not frequently accessed) but could be optimized later.

2. **No version history** - Updates replace previous data. LogSeq's native versioning handles this at the graph level.

3. **Single graph only** - Currently saves to active graph only. Multi-graph support could be added.

4. **No conflict resolution** - Last write wins. If same page is edited in LogSeq and app simultaneously, app overwrites.

---

## Files Changed Summary

| File | Lines Added | Purpose |
|------|-------------|---------|
| `lib/stroke-storage.js` | 350 | Data transformation |
| `lib/logseq-api.js` | 280 | Storage API methods |
| `stores/storage.js` | 130 | Storage state |
| `header/ActionBar.svelte` | 80 | Save strokes button |
| `transcription/TranscriptionView.svelte` | 60 | Save transcription button |
| `stores/index.js` | 13 | Export storage |
| **Total** | **913 lines** | **Phase 1 complete** |

---

**Status:** ✅ Ready for testing  
**Next:** Test thoroughly, then proceed to Phase 2 (renderer plugin)
