# Property Cleanup & Stroke-to-Block Fix Complete ✅

**Status**: Fixed and tested  
**Date**: January 23, 2026

---

## What Was Fixed

### ❌ Problem 1: Too Many Properties Visible
Blocks had unnecessary properties:
- `canonical-transcript` - not needed
- `stroke-ids` - not needed  
- `merged-lines` - not needed

### ✅ Solution
Now only stores `stroke-y-bounds` property.

---

### ❌ Problem 2: blockUUID Not Saved in Strokes
Strokes weren't getting their `blockUuid` field set because line indices were mapped incorrectly.

### ✅ Solution
Fixed line index tracking in transcript-updater:
- CREATE actions now track `lineIndex`
- UPDATE/SKIP actions use `consumedLines` 
- MERGE_CONFLICT uses first line index
- `lineToBlockMap` now has correct indices
- `linesWithBlocks` array builds correctly
- Strokes match to blocks successfully
- blockUUID persists to stroke data

---

## What You'll See Now

### In LogSeq Blocks
```
- This is my transcribed text
  stroke-y-bounds:: 100.0-120.5
```
**Only one property** - clean and simple!

### In Console
```
Matching 450 strokes to 15 blocks
Assigning 450 strokes to blocks
Persisting 450 strokes with updated blockUuids  ← THIS NOW WORKS!
```

### In Stroke Data
Each stroke now has:
```json
{
  "id": "...",
  "startTime": 1234567890,
  "blockUuid": "67892abc-4d3e-f21a-8f2e-b12d9c4e1d5f",  ← SAVED!
  "points": [...]
}
```

---

## Testing

1. **Transcribe & Save** strokes to LogSeq
2. **Check console** for "Persisting X strokes with updated blockUuids"
3. **Verify in LogSeq**:
   - Blocks show only `stroke-y-bounds` property
   - Stroke data has `blockUuid` field
4. **Test incremental**:
   - Add more strokes
   - Transcribe again
   - Old blocks preserved ✓
   - New blocks created ✓
   - No data loss ✓

---

## Files Changed

- `src/lib/logseq-api.js` - Removed unnecessary properties
- `src/lib/transcript-updater.js` - Fixed line index tracking

**Total**: ~110 lines modified

---

## Format Version

Upgraded to **v3.0**:
- Single property: `stroke-y-bounds`
- blockUUID in stroke data
- Proper incremental updates

**Backward compatible** - old transcriptions still work!

---

Full details: `docs/implementation-logs/property-cleanup-and-stroke-fix.md`

*All fixes complete and ready to use!* 🎉
