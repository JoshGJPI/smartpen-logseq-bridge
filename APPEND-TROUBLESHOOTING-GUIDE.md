# Append Transcription Troubleshooting Guide

**Purpose:** Quick reference for debugging issues when appending new strokes to existing transcriptions
**Last Updated:** 2026-01-28

---

## Expected Behavior

When appending new strokes to a page that already has saved transcriptions:

1. ✅ User adds new strokes to canvas
2. ✅ Click "Transcribe" → ALL strokes sent to MyScript (old + new)
3. ✅ Click "Save to LogSeq"
4. ✅ **ONLY strokes without `blockUuid` create new blocks**
5. ✅ **Existing blocks with `blockUuid` are skipped entirely**
6. ✅ **No existing blocks are modified**
7. ✅ New blocks appended to LogSeq page

---

## Critical Code Paths for Append

### 1. Stroke Filtering (New Implementation)

**File:** `src/lib/transcript-updater.js`
**Line:** ~520-540

```javascript
// Partition strokes
const strokesWithBlockUuid = strokes.filter(s => s.blockUuid);
const strokesWithoutBlockUuid = strokes.filter(s => !s.blockUuid);

// Filter lines to only those with NEW strokes
const newLines = linesWithStrokeIds.filter(line => {
  const hasNewStrokes = Array.from(line.strokeIds).some(strokeId => {
    const stroke = strokes.find(s => String(s.startTime) === strokeId);
    return stroke && !stroke.blockUuid;
  });
  return hasNewStrokes;
});

// Early exit if no new strokes
if (newLines.length === 0) {
  return {
    success: true,
    message: 'No new strokes to save',
    ...
  };
}
```

**What to Check:**
- Are strokes properly loaded with `blockUuid` from storage?
- Is the filter correctly identifying strokes without `blockUuid`?
- Are `newLines` being filtered correctly?

---

### 2. Stroke Loading from LogSeq

**File:** `src/lib/logseq-api.js`
**Function:** `getPageStrokes()` (line ~554)

```javascript
// Loads strokes from LogSeq and converts from storage format
const fullStrokes = storedStrokes.map(stored => ({
  pageInfo: pageInfo,
  startTime: stored.startTime,
  endTime: stored.endTime,
  blockUuid: stored.blockUuid || null,  // ← CRITICAL: Must preserve blockUuid
  dotArray: stored.points.map(([x, y, timestamp]) => ({...}))
}));
```

**What to Check:**
- When loading page, are strokes getting their `blockUuid` restored?
- Check console: `loadPageStrokesIntoStore()` should log stroke count
- Verify in browser DevTools: `strokes` store should show `blockUuid` values

---

### 3. BlockUuid Preservation During Re-Matching

**File:** `src/lib/transcript-updater.js`
**Function:** `matchStrokesToLines()` (line ~435-480)

```javascript
function matchStrokesToLines(strokes, linesWithBlocks, tolerance = 5) {
  const strokeToBlockMap = new Map();

  for (const stroke of strokes) {
    // CRITICAL: Preserve existing blockUuid
    if (stroke.blockUuid) {
      strokeToBlockMap.set(String(stroke.startTime), stroke.blockUuid);
      continue; // Skip re-matching
    }

    // Only match strokes WITHOUT blockUuid
    // ...
  }
}
```

**What to Check:**
- Are strokes with `blockUuid` being skipped?
- Is `strokeToBlockMap` preserving old associations?
- Check console logs during save

---

### 4. Action Detection (Should Skip Existing)

**File:** `src/lib/transcript-updater.js`
**Function:** `detectBlockActions()` (line ~245-396)

**Expected:** If all strokes in a line have `blockUuid`, that line shouldn't match any action

**What to Check:**
- Are actions being generated for lines with all existing strokes?
- Should see: `actions.filter(a => a.type === 'CREATE').length` = number of NEW lines only
- Check console: `Detected actions: { create: X, update: 0, skip: Y }`

---

## Common Append Issues & Diagnosis

### Issue 1: "All Blocks Re-Created"

**Symptom:** Every transcription creates duplicate blocks in LogSeq

**Likely Cause:** Strokes not being loaded with `blockUuid` from storage

**Check:**
```javascript
// In browser console after loading page:
import { strokes } from './stores/strokes.js';
console.log($strokes.filter(s => s.blockUuid));
// Should return existing strokes with blockUuid
```

**Debug Path:**
1. `logseq-import.js` → `loadPageStrokesIntoStore()`
2. `logseq-api.js` → `getPageStrokes()`
3. `stroke-storage.js` → `convertFromStorageFormat()`

**Fix Location:** Ensure `blockUuid` is preserved in conversion

---

### Issue 2: "New Strokes Not Saved"

**Symptom:** Adding new strokes doesn't create any blocks

**Likely Cause:** Filter is too aggressive, filtering out all lines

**Check:**
```javascript
// During save, check console:
"Filtered to X lines containing new strokes (out of Y total lines)"
// X should be > 0 if you added new strokes
```

**Debug Path:**
1. Verify new strokes have `blockUuid = null`
2. Check `newLines` array length
3. Confirm `estimateLineStrokeIds()` finds new strokes

---

### Issue 3: "Existing Blocks Updated"

**Symptom:** User's corrections in LogSeq are overwritten

**Likely Cause:** `newLines` filter not working, or UPDATE actions being generated

**Check:**
```javascript
// During save, check console:
"Detected actions: { create: X, update: Y, ... }"
// Y (update) should be 0 for append-only
```

**Debug Path:**
1. Check `newLines` filter logic
2. Verify `detectBlockActions()` not matching existing blocks
3. Look for UPDATE actions in console

---

### Issue 4: "Y-Bounds Reset"

**Symptom:** Block properties show different Y-bounds after save

**Likely Cause:** `updateTranscriptBlockWithPreservation()` called with `updateYBounds=true`

**Check:**
```javascript
// In logseq-api.js, line ~1004-1029
// Default parameter should be: updateYBounds = false
```

**Fix:** Y-bounds should only be updated if explicitly set to true

---

## Debugging Checklist

When append fails, check in order:

1. **Load Phase:**
   - [ ] Open browser DevTools → Console
   - [ ] Navigate to page with existing transcription
   - [ ] Search console for: "Loaded X strokes from storage"
   - [ ] Verify: Strokes have `blockUuid` property

2. **Add Strokes Phase:**
   - [ ] Add new strokes to canvas
   - [ ] Check: New strokes have `blockUuid = null` (not undefined)
   - [ ] Verify: Both old and new strokes visible on canvas

3. **Transcribe Phase:**
   - [ ] Click "Transcribe"
   - [ ] Verify: MyScript processes all strokes (old + new)
   - [ ] Check: Transcription includes both old and new content

4. **Save Phase:**
   - [ ] Click "Save to LogSeq"
   - [ ] Watch console for:
     - "X strokes with blockUuid, Y without"
     - "Filtered to Z lines containing new strokes"
   - [ ] Verify: Z > 0 (should be number of new lines)
   - [ ] Verify: "Detected actions: { create: Z, update: 0, ... }"

5. **Verify in LogSeq:**
   - [ ] Open LogSeq
   - [ ] Navigate to saved page
   - [ ] Count blocks before and after
   - [ ] Verify: New blocks added, old blocks unchanged
   - [ ] Check block properties: Y-bounds should be stable

---

## Console Log Patterns

### Successful Append:

```
[updateTranscriptBlocks] Partitioning strokes...
Strokes: 42 with blockUuid, 15 without

[updateTranscriptBlocks] Filtering lines...
Filtered to 3 lines containing new strokes (out of 10 total lines)

[detectBlockActions] Analyzing...
Detected actions: {
  create: 3,
  update: 0,
  skip: 0
}

[updateTranscriptBlocks] Processing level 0...
Creating line 7 (indent 0): "New content..."
✓ Created block: a1b2c3d4...

[matchStrokesToLines] Matching strokes...
Matching 15 NEW strokes to 3 blocks
Assigning 15 strokes to blocks

✓ Success: 3 created, 0 updated
```

### Failed Append (All Re-Created):

```
[updateTranscriptBlocks] Partitioning strokes...
Strokes: 0 with blockUuid, 57 without  ← ❌ Problem: No existing blockUuids!

Filtered to 10 lines containing new strokes (out of 10 total lines)  ← ❌ All lines treated as new

Detected actions: {
  create: 10,  ← ❌ All lines being created
  update: 0,
  skip: 0
}
```

**Root Cause:** Strokes not loaded with `blockUuid` from storage

---

## Key Files for Append Logic

| File | Function | Purpose |
|------|----------|---------|
| `src/lib/transcript-updater.js` | `updateTranscriptBlocks()` | Main save orchestrator |
| `src/lib/transcript-updater.js` | `matchStrokesToLines()` | Preserve blockUuid associations |
| `src/lib/logseq-api.js` | `getPageStrokes()` | Load strokes from LogSeq |
| `src/lib/stroke-storage.js` | `convertFromStorageFormat()` | Restore blockUuid from storage |
| `src/lib/logseq-import.js` | `loadPageStrokesIntoStore()` | Import page to canvas |
| `src/stores/strokes.js` | `addStroke()` | Add stroke to store |

---

## Testing Append Flow

### Manual Test:

1. Create page with 3 lines, save to LogSeq
2. Verify in LogSeq: 3 blocks exist
3. Close app, reopen
4. Load that page back into app
5. **Check console:** "Loaded X strokes from storage"
6. **Check DevTools:** Strokes have `blockUuid`
7. Add 2 new strokes to canvas
8. Transcribe (should see 5 lines total)
9. Save to LogSeq
10. **Expected:** 2 new blocks added (total 5), old 3 unchanged
11. **Check console:** "Filtered to 2 lines containing new strokes"

### Automated Check:

```javascript
// In browser console after loading page
import { strokes } from './stores/strokes.js';
const all = $strokes;
const withUuid = all.filter(s => s.blockUuid);
const withoutUuid = all.filter(s => !s.blockUuid);

console.log({
  total: all.length,
  withBlockUuid: withUuid.length,
  withoutBlockUuid: withoutUuid.length
});

// Expected after loading existing page:
// { total: 42, withBlockUuid: 42, withoutBlockUuid: 0 }

// Expected after adding 5 new strokes:
// { total: 47, withBlockUuid: 42, withoutBlockUuid: 5 }
```

---

## Session Continuity Notes

For a future session to debug append issues:

1. **Start Here:** Read this document first
2. **Check Console Logs:** Pattern matching against examples above
3. **Key Question:** Are strokes being loaded with `blockUuid`?
4. **Secondary Question:** Is the filter working correctly?
5. **Reference:** TRANSCRIPT-STORAGE-SPEC.md for full data flow

---

## Quick Fixes to Try

### Fix 1: Force blockUuid Preservation

**Location:** `src/lib/stroke-storage.js` line ~273-286

Ensure:
```javascript
convertFromStorageFormat(storedStroke, pageInfo) {
  return {
    ...
    blockUuid: storedStroke.blockUuid || null,  // NOT undefined!
    ...
  };
}
```

### Fix 2: Verify Filter Logic

**Location:** `src/lib/transcript-updater.js` line ~535

Add debug logging:
```javascript
const newLines = linesWithStrokeIds.filter(line => {
  const hasNewStrokes = Array.from(line.strokeIds).some(strokeId => {
    const stroke = strokes.find(s => String(s.startTime) === strokeId);
    const isNew = stroke && !stroke.blockUuid;
    if (isNew) console.log(`Found new stroke: ${strokeId}`);
    return isNew;
  });
  return hasNewStrokes;
});
```

### Fix 3: Check Import Loading

**Location:** `src/lib/logseq-import.js` line ~60-80

Add logging:
```javascript
const strokesWithUuid = fullStrokes.filter(s => s.blockUuid);
console.log(`Importing: ${strokesWithUuid.length}/${fullStrokes.length} strokes have blockUuid`);
```

---

## Summary for Future Sessions

**Key Points:**
1. Append works by filtering lines that contain strokes without `blockUuid`
2. Critical: Strokes must be loaded WITH their `blockUuid` from storage
3. Main file: `transcript-updater.js` → `updateTranscriptBlocks()` line ~492-850
4. Check console logs to see partition counts and filtering results
5. Use browser DevTools to inspect `strokes` store directly

**Most Likely Issue:**
- Strokes not being loaded with `blockUuid` from LogSeq storage
- Check: `getPageStrokes()` → `convertFromStorageFormat()`

**Documentation to Reference:**
- This file (APPEND-TROUBLESHOOTING-GUIDE.md)
- TRANSCRIPT-STORAGE-SPEC.md (complete data flow)
- IMPLEMENTATION-SUMMARY.md (recent fixes)
- CLAUDE.MD (architecture overview)

---

**Last Known State:** Hierarchical block creation fixed, append logic implemented but needs debugging
