# Transcription BlockUuid Assignment Issue

## Problem Summary

When transcribing a **subset** of strokes on a page (e.g., 691 out of 1128 strokes), the system incorrectly assigns `blockUuid` to **ALL strokes on the page** (1127 out of 1128), not just the strokes that were actually transcribed.

**Expected Behavior:**
- User selects 691 strokes → Transcribe → Save
- Only those 691 strokes should get `blockUuid` assigned
- Remaining 437 strokes should keep `blockUuid: null`

**Actual Behavior:**
- User selects 691 strokes → Transcribe → Save
- System assigns `blockUuid` to 1127 strokes (nearly all strokes on the page)
- Only 1 stroke remains with `blockUuid: null`

## Evidence from Console Logs

### Test Scenario
1. Page has 1128 total strokes
2. User selects 691 strokes and transcribes them
3. MyScript returns 23 lines (blocks)
4. System saves transcription

### Console Output Analysis

```
[INFO] Transcribing 691 untranscribed selected strokes from 1 page(s)...
```
✅ **CORRECT**: Only 691 strokes sent to MyScript

```
MyScript returned 23 lines from 1128 untranscribed strokes
Transcription includes 1128 unique stroke IDs
```
❌ **PROBLEM 1**: Should say "from 691 untranscribed strokes", not 1128
❌ **PROBLEM 2**: Should include 691 stroke IDs, not 1128

```
Matching 691 transcribed strokes to 23 blocks (1128 total untranscribed on page)
```
✅ **CORRECT**: Filtering shows 691 strokes to match

```
[matchStrokesToLines] Results: 0 preserved, 1127 matched, 1 unmatched
Assigning 1127 strokes to blocks
```
❌ **PROBLEM 3**: Matched 1127 strokes instead of 691

```
[updateStrokeBlockUuids] Complete: 1127 updated, 1 skipped
After assignment: 1127 strokes now have blockUuid
```
❌ **PROBLEM 4**: 1127 strokes got blockUuid instead of 691

## Root Cause Analysis

The issue occurs in `transcript-updater.js` during the stroke→block matching phase. Here's the problematic flow:

### Step 1: Building `transcribedStrokeIds` Set (Lines 547-568)

```javascript
const transcribedStrokeIds = new Set();

const linesWithStrokeIds = newTranscription.lines.map(line => {
  const lineBounds = line.yBounds || calculateLineBounds(line, strokesWithoutBlockUuid);
  const strokeIds = estimateLineStrokeIds({ yBounds: lineBounds }, strokesWithoutBlockUuid);

  // Track which strokes were actually transcribed
  strokeIds.forEach(id => transcribedStrokeIds.add(id));

  return { ...line, yBounds: lineBounds, strokeIds: strokeIds };
});
```

**THE PROBLEM**:
- `estimateLineStrokeIds()` is called with `strokesWithoutBlockUuid` (all 1128 strokes on the page)
- It should be called with **only the 691 strokes that were sent to MyScript**
- But we don't have a reference to those specific 691 strokes at this point!

### Step 2: Y-Bounds Matching is Too Broad

The `estimateLineStrokeIds()` function (lines 253-280) matches strokes to lines using Y-coordinate overlap:

```javascript
function estimateLineStrokeIds(line, allStrokes, tolerance = 5) {
  const strokeIds = new Set();

  for (const stroke of allStrokes) {
    const strokeYs = stroke.dotArray.map(d => d.y);
    const strokeMinY = Math.min(...strokeYs);
    const strokeMaxY = Math.max(...strokeYs);

    // Check overlap
    if (!(strokeMaxY < line.yBounds.minY - tolerance ||
          strokeMinY > line.yBounds.maxY + tolerance)) {
      strokeIds.add(String(stroke.startTime));
    }
  }

  return strokeIds;
}
```

**THE PROBLEM**:
- When `allStrokes` contains all 1128 strokes on the page
- And `line.yBounds` comes from MyScript's analysis of only 691 strokes
- The function matches ANY stroke that overlaps those Y-bounds
- This captures strokes that were never sent to MyScript!

### Step 3: Missing Context - Which Strokes Were Transcribed?

**THE CORE ISSUE**: The `updateTranscriptBlocks()` function receives:
- `strokes` - ALL strokes on the page (1128)
- `newTranscription` - MyScript result from 691 strokes

But it has **no way to know** which specific 691 strokes were sent to MyScript!

The transcription flow loses this critical information:
1. `ActionBar.svelte:284` - Sends 691 strokes to MyScript
2. `ActionBar.svelte:408` - Calls `updateTranscriptBlocks()` with ALL 1128 strokes
3. `transcript-updater.js` - Has no record of which strokes were transcribed

## Architecture Overview

### Key Files Involved

1. **ActionBar.svelte** (`src/components/header/ActionBar.svelte`)
   - Lines 170-299: `handleTranscribe()` - Filters and sends strokes to MyScript
   - Lines 302-510: `handleSaveToLogseq()` - Saves strokes and transcription

2. **transcript-updater.js** (`src/lib/transcript-updater.js`)
   - Lines 530-1001: `updateTranscriptBlocks()` - Main orchestrator
   - Lines 547-568: Builds `transcribedStrokeIds` set (PROBLEM AREA)
   - Lines 926-935: Filters strokes to match (PROBLEM AREA)
   - Lines 452-517: `matchStrokesToLines()` - Y-bounds matching

3. **stroke-storage.js** (`src/lib/stroke-storage.js`)
   - Lines 109-124: `convertToStorageFormat()` - Includes blockUuid in storage
   - Lines 117: `blockUuid: stroke.blockUuid || null` - Persists to JSON

4. **logseq-import.js** (`src/lib/logseq-import.js`)
   - Lines 28-76: `transformStoredToCanvasFormat()` - Restores blockUuid on import
   - Line 55: `blockUuid: stroke.blockUuid || null` - Preserves from storage

### Transcription Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User Action: Transcribe Selected Strokes                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ActionBar.handleTranscribe()                                    │
│ - Filters strokes: blockUuid === null (691 strokes)            │
│ - Sends to MyScript API                                         │
│ - Stores result in pageTranscriptions store                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. User Action: Save to LogSeq                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ActionBar.handleSaveToLogseq()                                  │
│ - Saves stroke data (all 1128 strokes)                         │
│ - Calls updateTranscriptBlocks() with:                          │
│   • ALL strokes on page (1128)                                  │
│   • pageTranscription (result from 691 strokes)                 │
│   ❌ MISSING: Which 691 strokes were transcribed                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ transcript-updater.updateTranscriptBlocks()                     │
│ - Creates 23 blocks in LogSeq                                   │
│ - Builds transcribedStrokeIds by Y-bounds matching              │
│   ❌ Uses ALL 1128 strokes for matching                         │
│   ❌ Captures 1127 strokes instead of 691                       │
│ - Assigns blockUuid to 1127 strokes                             │
│ - Persists to LogSeq                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Proposed Solutions

### Option 1: Pass Transcribed Stroke IDs Through the Stack (RECOMMENDED)

**Modify the data flow to preserve which strokes were transcribed:**

1. **Update `setPageTranscription()` to store stroke IDs**:
   ```javascript
   // In ActionBar.svelte:287-292
   setPageTranscription(
     pageKey,
     result,
     pageData.pageInfo,
     pageData.allStrokes.length,
     pageData.untranscribedStrokes.map(s => String(s.startTime)) // NEW: Pass IDs
   );
   ```

2. **Update transcription store to include stroke IDs**:
   ```javascript
   // In stores/transcription.js
   export function setPageTranscription(pageKey, transcription, pageInfo, strokeCount, transcribedStrokeIds) {
     pageTranscriptions.update(pt => {
       const newMap = new Map(pt);
       newMap.set(pageKey, {
         ...transcription,
         pageInfo,
         strokeCount,
         transcribedStrokeIds: new Set(transcribedStrokeIds) // NEW
       });
       return newMap;
     });
   }
   ```

3. **Use stored stroke IDs in `updateTranscriptBlocks()`**:
   ```javascript
   // In transcript-updater.js:547-568
   // Replace Y-bounds matching with direct lookup
   const transcribedStrokeIds = newTranscription.transcribedStrokeIds || new Set();

   console.log(`Transcription includes ${transcribedStrokeIds.size} stroke IDs (from ActionBar)`);

   // No need to call estimateLineStrokeIds - we have the exact IDs!
   ```

**Advantages:**
- ✅ Precise - knows exactly which strokes were transcribed
- ✅ No Y-bounds ambiguity
- ✅ Simple to implement
- ✅ Works for all cases (including partial page transcription)

**Disadvantages:**
- ⚠️ Requires changes to transcription store schema
- ⚠️ Must ensure IDs are properly serialized/deserialized

### Option 2: Fix Y-Bounds Calculation to Use Only Transcribed Strokes

**Calculate Y-bounds using only the strokes that were sent to MyScript:**

```javascript
// In transcript-updater.js:547-568

// OPTION A: Get stroke IDs from MyScript's original input
// This requires MyScript to return which strokes it analyzed
// (Not currently available in API response)

// OPTION B: Recalculate using tighter Y-bounds
const transcribedStrokeIds = new Set();

const linesWithStrokeIds = newTranscription.lines.map(line => {
  // CRITICAL: Only pass strokes that are in the Y-bounds range returned by MyScript
  // This is circular - we're trying to determine which strokes were transcribed
  // by using Y-bounds that were derived from those strokes!

  // Use a MUCH tighter tolerance to avoid capturing extra strokes
  const strokeIds = estimateLineStrokeIds({ yBounds: line.yBounds }, strokesWithoutBlockUuid, 0.5); // Tighter tolerance

  strokeIds.forEach(id => transcribedStrokeIds.add(id));

  return { ...line, yBounds: line.yBounds, strokeIds: strokeIds };
});
```

**Advantages:**
- ⚠️ No schema changes needed

**Disadvantages:**
- ❌ Still uses Y-bounds matching (imprecise)
- ❌ Tighter tolerance may miss legitimate strokes
- ❌ Looser tolerance may capture extra strokes
- ❌ Fundamentally flawed approach - trying to reverse-engineer which strokes were transcribed

### Option 3: Store Transcription Context in MyScript Result

**Modify the MyScript API wrapper to track input strokes:**

```javascript
// In myscript-api.js
export async function transcribeStrokes(strokes, appKey, hmacKey) {
  // ... existing code ...

  const result = await callMyScriptAPI(strokesData, appKey, hmacKey);

  // Add metadata about which strokes were transcribed
  result.sourceStrokeIds = strokes.map(s => String(s.startTime));
  result.sourceStrokeCount = strokes.length;

  return result;
}
```

**Advantages:**
- ✅ Clean separation of concerns
- ✅ Precise stroke tracking
- ✅ Works with all transcription scenarios

**Disadvantages:**
- ⚠️ Requires updating MyScript API wrapper
- ⚠️ May need to handle edge cases (retries, errors, etc.)

## Current Workaround

The existing code attempts to filter strokes (line 928-930 in transcript-updater.js):

```javascript
const strokesToMatch = strokesWithoutBlockUuid.filter(s =>
  transcribedStrokeIds.has(String(s.startTime))
);
```

But this filter is **ineffective** because `transcribedStrokeIds` is already polluted with 1128 stroke IDs due to the overly broad Y-bounds matching.

## Testing Recommendations

### Test Case 1: Partial Page Transcription
1. Create page with 1128 strokes
2. Select 691 strokes (specific subset)
3. Transcribe → Should create N blocks
4. Save to LogSeq
5. **Verify**: Only 691 strokes have `blockUuid` set
6. **Verify**: Remaining 437 strokes have `blockUuid: null`

### Test Case 2: Incremental Transcription
1. Start with page from Test Case 1 (691 transcribed, 437 not)
2. Reload app, import from LogSeq
3. **Verify**: 691 strokes imported with `blockUuid`
4. Select all 1128 strokes
5. Transcribe → Should only send 437 to MyScript
6. Save to LogSeq
7. **Verify**: All 1128 strokes now have `blockUuid`
8. **Verify**: No duplicate blocks created

### Test Case 3: Full Page Transcription
1. Create page with 500 strokes (all untranscribed)
2. Select all strokes
3. Transcribe and save
4. **Verify**: All 500 strokes have `blockUuid`
5. Reload and import
6. Select all strokes → "All strokes already transcribed" message
7. **Verify**: No strokes sent to MyScript

## Debug Commands

Add these console logs to trace the issue:

```javascript
// In transcript-updater.js after line 568
console.log('[DEBUG] transcribedStrokeIds sample:',
  Array.from(transcribedStrokeIds).slice(0, 10));
console.log('[DEBUG] strokesWithoutBlockUuid count:', strokesWithoutBlockUuid.length);
console.log('[DEBUG] strokesWithoutBlockUuid sample IDs:',
  strokesWithoutBlockUuid.slice(0, 10).map(s => s.startTime));

// In transcript-updater.js after line 930
console.log('[DEBUG] strokesToMatch IDs:',
  strokesToMatch.map(s => s.startTime).slice(0, 10));
console.log('[DEBUG] Does first stroke match?',
  transcribedStrokeIds.has(String(strokesToMatch[0]?.startTime)));
```

## Additional Context

### BlockUuid Property
- **Purpose**: Associates a stroke with a LogSeq block UUID
- **Format**: String UUID (e.g., `"51706ff9-..."`)
- **Lifecycle**:
  - Initially `null` when stroke captured from pen
  - Set after transcription and block creation
  - Persisted in LogSeq stroke storage
  - Restored on import from LogSeq
  - Used to filter strokes for incremental transcription

### Y-Bounds Matching
- **Purpose**: Determine which strokes belong to which text line
- **How it works**: Compares stroke Y-coordinates with line Y-bounds from MyScript
- **Tolerance**: Default 5 units (configurable)
- **Limitations**:
  - Can match strokes that weren't analyzed by MyScript
  - Overlapping lines can cause ambiguity
  - Not precise for partial page transcription

### Incremental Transcription Goals
1. User can transcribe subset of page strokes
2. Only transcribed strokes get `blockUuid` assigned
3. On reload, system recognizes which strokes are transcribed
4. User can transcribe remaining strokes without duplicating blocks
5. System appends new blocks without modifying existing ones

## Related Files

- `src/components/header/ActionBar.svelte` - Transcription and save UI logic
- `src/lib/transcript-updater.js` - Block creation and stroke matching
- `src/lib/myscript-api.js` - MyScript API wrapper
- `src/lib/logseq-api.js` - LogSeq API operations
- `src/lib/stroke-storage.js` - Storage format conversion
- `src/lib/logseq-import.js` - Import from LogSeq
- `src/stores/transcription.js` - Transcription state management
- `src/stores/strokes.js` - Stroke state management

## Version History

- **2026-01-28**: Initial implementation of incremental transcription
- **2026-01-28**: Added blockUuid filtering in ActionBar (partial fix)
- **2026-01-28**: Added transcribedStrokeIds filtering (incomplete fix)
- **Current**: Issue persists - Y-bounds matching captures all page strokes

---

**Status**: 🔴 OPEN - Requires senior developer review and decision on solution approach
