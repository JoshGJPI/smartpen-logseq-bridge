# Transcription Editor & Incremental Update Specification

## Document History
- **Created**: 2026-01-22
- **Updated**: 2026-01-23
- **Status**: Implementation Ready
- **Version**: 3.1 (Y-Bounds Stroke Estimation)

---

## Executive Summary

The SmartPen-LogSeq Bridge has a transcription editing system that allows users to merge, split, and refine handwriting recognition results. However, **re-transcribing a page with additional strokes deletes previously edited content** instead of intelligently merging new content with existing blocks.

This document provides complete implementation guidance for the **Stroke ID Tracking** solution using Y-bounds estimation, which:
1. Tracks which strokes belong to each transcription block (using pen timestamps)
2. Matches blocks by stroke ID overlap instead of Y-bounds
3. Never deletes blocks unless their strokes are explicitly deleted

**Key Insight**: Stroke IDs are pen timestamps (`stroke.startTime`), not MyScript data. We estimate which strokes belong to each line by checking which strokes fall within the line's Y-bounds.

---

## Table of Contents
1. [Problem Analysis](#problem-analysis)
2. [Solution Overview](#solution-overview)
3. [Implementation Guide](#implementation-guide)
4. [Code Changes](#code-changes)
5. [Testing Plan](#testing-plan)

---

## Problem Analysis

### The Failing Workflow

#### Initial State
1. User writes on page → has 20 strokes
2. User transcribes → creates 10 blocks in LogSeq
3. User edits in modal → merges lines, fixes typos → saves
4. Result: 7 clean, edited blocks in LogSeq ✅

#### Adding More Content (THE PROBLEM)
5. User writes more on same page → now has 40 strokes (20 old + 20 new)
6. User re-transcribes all strokes → gets 20 lines (10 old + 10 new)
7. System matches by Y-bounds:
   - Old blocks (7) → some match, some don't (because merged)
   - New lines (10) → create new blocks
   - **Merged blocks** → Y-bounds mismatch → deleted as "orphaned" ❌
8. Result: All user edits from step 3 are **lost**

### Root Cause Analysis

The current `updateTranscriptBlocks()` in `transcript-updater.js` uses **Y-bounds overlap detection**:

```javascript
// Current problematic logic (lines 47-55)
const overlappingLines = newLines.filter(line => {
  const lineBounds = calculateLineBounds(line, strokes);
  return boundsOverlap(blockBounds, lineBounds);
});

// If no overlaps → block is "orphaned" → DELETED
```

**Why this fails for merged blocks:**

| Scenario | Block Y-Bounds | New Lines | Result |
|----------|---------------|-----------|--------|
| Original 2 lines | Line 1: 10-30, Line 2: 31-50 | 2 lines match | ✅ Works |
| After merge | Single block: 10-50 | 2 lines partially overlap | ⚠️ Fragile |
| Transcribe NEW only | Single block: 10-50 | 0 overlapping lines | ❌ DELETED |

### Data Available

**From Pen:**
- `stroke.startTime` - Unique timestamp for each stroke (our Stroke ID)
- `stroke.dotArray` - All points with X/Y coordinates
- `stroke.pageInfo` - Book/page identification

**From MyScript:**
- Line text and canonical form
- Word bounding boxes (gives us line Y-bounds)
- Indentation (X position)

**Key Insight**: We can estimate which strokes belong to each transcribed line by checking which strokes have dots within the line's Y-bounds. No additional MyScript data needed.

---

## Solution Overview

### Stroke ID Tracking via Y-Bounds Estimation

**Core Principle**: When creating a transcription block, calculate which strokes fall within the line's Y-bounds and store their timestamps. Future matching uses stroke ID overlap instead of Y-bounds.

```
STEP 1 - Block Creation:
  Line Y-Bounds: 10-50
  Strokes in range: [stroke A, stroke B, stroke C]
  Store: stroke-ids = "1706234567890,1706234567891,1706234568000"

STEP 2 - Future Matching:
  Block Stroke IDs: {1706234567890, 1706234567891, 1706234568000}
  New Line Stroke IDs: {1706234567890, 1706234567891, 1706234568000}
  Match? YES (sets overlap) → Update or Skip based on canonical
```

### Why This Works for Merged Blocks

When user merges Line 1 + Line 2:
- Merged block gets combined stroke IDs from both lines
- Future transcription produces Line 1 and Line 2 separately
- Both lines' stroke IDs overlap with the merged block → matched correctly

```
Before Merge:
  Block 1: stroke-ids = "A,B"     (Line 1)
  Block 2: stroke-ids = "C,D"     (Line 2)

After Merge:
  Merged Block: stroke-ids = "A,B,C,D"

Re-transcription produces:
  New Line 1: stroke-ids = {A,B}  → overlaps with merged block ✅
  New Line 2: stroke-ids = {C,D}  → overlaps with merged block ✅
  
Result: Merged block is matched and preserved!
```

---

## Implementation Guide

### Phase 1: Immediate Fix - Safe Orphan Handling
**Effort**: 30 minutes | **Impact**: HIGH - Stops data loss immediately

Modify `transcript-updater.js` to only delete blocks when their strokes are gone from the canvas.

**File**: `src/lib/transcript-updater.js`
**Location**: Lines 280-305 (orphan deletion section)

```javascript
// REPLACE the current orphan deletion logic with this:

// Build set of all current stroke timestamps for existence check
const currentStrokeTimestamps = new Set(
  strokes.map(s => String(s.startTime))
);

// Check orphaned blocks - only delete if strokes no longer exist
const orphanedBlocks = existingBlocks.filter(b => !usedBlockUuids.has(b.uuid));

for (const block of orphanedBlocks) {
  // Parse stroke IDs from block (if available)
  const strokeIdsStr = block.properties?.['stroke-ids'];
  
  if (strokeIdsStr) {
    // Block has stroke IDs - check if any strokes still exist
    const blockStrokeIds = strokeIdsStr.split(',').map(id => id.trim());
    const strokesStillExist = blockStrokeIds.some(id => 
      currentStrokeTimestamps.has(id)
    );
    
    if (strokesStillExist) {
      // Strokes exist but block wasn't matched - PRESERVE IT
      console.log(`Preserving unmatched block ${block.uuid} - strokes still exist`);
      results.push({ 
        type: 'preserved', 
        uuid: block.uuid, 
        reason: 'strokes-exist-unmatched'
      });
      continue; // Don't delete
    }
  } else {
    // Block without stroke IDs - DON'T delete (safe default)
    console.log(`Preserving block ${block.uuid} - no stroke IDs to verify`);
    results.push({ 
      type: 'preserved', 
      uuid: block.uuid, 
      reason: 'no-stroke-ids'
    });
    continue;
  }
  
  // Only reach here if block has stroke IDs AND none of those strokes exist
  try {
    await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
    results.push({ 
      type: 'deleted', 
      uuid: block.uuid, 
      reason: 'strokes-deleted'
    });
  } catch (error) {
    console.error(`Failed to delete orphaned block ${block.uuid}:`, error);
    results.push({ 
      type: 'error', 
      action: 'DELETE', 
      error: error.message,
      uuid: block.uuid
    });
  }
}
```

---

### Phase 2: Add Stroke ID Estimation Function
**Effort**: 30 minutes | **Impact**: HIGH - Enables stroke tracking

Add a helper function to estimate which strokes belong to a line based on Y-bounds overlap.

**File**: `src/lib/transcript-updater.js`
**Location**: Add near top of file with other helpers

```javascript
/**
 * Estimate which strokes belong to a transcription line
 * Uses Y-bounds overlap between stroke dots and line bounding box
 * 
 * @param {Object} line - Transcription line with yBounds
 * @param {Array} strokes - All strokes from the page
 * @param {number} tolerance - Y-tolerance for overlap detection (default 5 units)
 * @returns {Set<string>} Set of stroke timestamps (as strings)
 */
function estimateLineStrokeIds(line, strokes, tolerance = 5) {
  const strokeIds = new Set();
  
  if (!line.yBounds || !strokes || strokes.length === 0) {
    return strokeIds;
  }
  
  const lineMinY = line.yBounds.minY - tolerance;
  const lineMaxY = line.yBounds.maxY + tolerance;
  
  for (const stroke of strokes) {
    if (!stroke.dotArray || stroke.dotArray.length === 0) continue;
    
    // Check if any dot in the stroke falls within line's Y-bounds
    const strokeIntersects = stroke.dotArray.some(dot => 
      dot.y >= lineMinY && dot.y <= lineMaxY
    );
    
    if (strokeIntersects) {
      strokeIds.add(String(stroke.startTime));
    }
  }
  
  return strokeIds;
}

/**
 * Parse stroke IDs from block property string
 * @param {string} strokeIdsStr - Comma-separated stroke timestamps
 * @returns {Set<string>} Set of stroke ID strings
 */
function parseStrokeIds(strokeIdsStr) {
  if (!strokeIdsStr || typeof strokeIdsStr !== 'string') {
    return new Set();
  }
  return new Set(strokeIdsStr.split(',').map(id => id.trim()).filter(Boolean));
}

/**
 * Check if two stroke ID sets have any overlap
 * @param {Set<string>} set1 
 * @param {Set<string>} set2 
 * @returns {boolean}
 */
function strokeSetsOverlap(set1, set2) {
  if (!set1 || !set2 || set1.size === 0 || set2.size === 0) {
    return false;
  }
  for (const id of set1) {
    if (set2.has(id)) return true;
  }
  return false;
}

/**
 * Merge stroke ID sets (for merged lines)
 * @param {Set<string>} set1 
 * @param {Set<string>} set2 
 * @returns {Set<string>}
 */
function mergeStrokeSets(set1, set2) {
  const merged = new Set(set1 || []);
  if (set2) {
    set2.forEach(id => merged.add(id));
  }
  return merged;
}
```

---

### Phase 3: Store Stroke IDs When Creating Blocks
**Effort**: 1 hour | **Impact**: HIGH - Enables future matching

Modify block creation to estimate and store stroke IDs.

**File**: `src/lib/logseq-api.js`

#### 3.1 Update `createTranscriptBlockWithProperties()`

Find this function and add stroke-ids property:

```javascript
/**
 * Create a transcript block with properties
 * @param {string} parentUuid - Parent block UUID
 * @param {Object} line - Line object with text, yBounds, strokeIds, etc.
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 */
export async function createTranscriptBlockWithProperties(parentUuid, line, host, token = '') {
  // Build properties object
  const properties = {
    'stroke-y-bounds': `${line.yBounds.minY.toFixed(1)}-${line.yBounds.maxY.toFixed(1)}`,
    'canonical-transcript': line.canonical || line.text
  };
  
  // NEW: Add stroke IDs if available
  if (line.strokeIds && line.strokeIds.size > 0) {
    properties['stroke-ids'] = Array.from(line.strokeIds).join(',');
  }
  
  // Add merged line count if > 1
  if (line.mergedLineCount && line.mergedLineCount > 1) {
    properties['merged-lines'] = String(line.mergedLineCount);
  }
  
  // ... rest of existing code (block creation) ...
}
```

#### 3.2 Update `updateTranscriptBlockWithPreservation()`

Ensure stroke IDs are preserved/updated when blocks are modified:

```javascript
/**
 * Update a transcript block while preserving user edits
 */
export async function updateTranscriptBlockWithPreservation(blockUuid, newLine, oldContent, host, token = '') {
  // ... existing preservation logic ...
  
  // Build updated properties
  const properties = {
    'stroke-y-bounds': `${newLine.yBounds.minY.toFixed(1)}-${newLine.yBounds.maxY.toFixed(1)}`,
    'canonical-transcript': newLine.canonical || newLine.text
  };
  
  // NEW: Update stroke IDs if available
  if (newLine.strokeIds && newLine.strokeIds.size > 0) {
    properties['stroke-ids'] = Array.from(newLine.strokeIds).join(',');
  }
  
  if (newLine.mergedLineCount && newLine.mergedLineCount > 1) {
    properties['merged-lines'] = String(newLine.mergedLineCount);
  }
  
  // ... rest of existing code ...
}
```

---

### Phase 4: Add Stroke IDs to Lines Before Block Creation
**Effort**: 30 minutes | **Impact**: HIGH - Connects estimation to storage

Modify `updateTranscriptBlocks()` to estimate stroke IDs for each line before creating blocks.

**File**: `src/lib/transcript-updater.js`
**Location**: In `updateTranscriptBlocks()`, before calling `detectBlockActions()`

```javascript
export async function updateTranscriptBlocks(book, page, strokes, newTranscription, host, token = '') {
  try {
    // Ensure page exists
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get existing transcript blocks
    const existingBlocks = await getTranscriptBlocks(book, page, host, token);
    
    console.log(`Found ${existingBlocks.length} existing transcript blocks`);
    
    // NEW: Estimate stroke IDs for each transcription line
    const linesWithStrokeIds = newTranscription.lines.map(line => {
      const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
      const strokeIds = estimateLineStrokeIds({ yBounds: lineBounds }, strokes);
      
      return {
        ...line,
        yBounds: lineBounds,
        strokeIds: strokeIds
      };
    });
    
    console.log('Lines with stroke IDs:', linesWithStrokeIds.map(l => ({
      text: l.text.substring(0, 30),
      strokeCount: l.strokeIds.size
    })));
    
    // Detect actions using lines WITH stroke IDs
    const actions = await detectBlockActions(existingBlocks, linesWithStrokeIds, strokes);
    
    // ... rest of existing code ...
  }
}
```

---

### Phase 5: Implement Stroke ID Matching
**Effort**: 1-2 hours | **Impact**: HIGH - Proper merge handling

Replace the existing `detectBlockActions()` with stroke ID-based matching.

**File**: `src/lib/transcript-updater.js`

```javascript
/**
 * Detect what action to take for each transcription line
 * Uses STROKE ID MATCHING as primary strategy, Y-bounds as fallback
 * 
 * @param {Array} existingBlocks - Existing transcript blocks from LogSeq
 * @param {Array} newLines - New transcription lines (with strokeIds)
 * @param {Array} strokes - All strokes for reference
 * @returns {Promise<Array>} Array of action objects
 */
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  const consumedLineIndices = new Set();
  const usedBlockUuids = new Set();
  
  // Build stroke timestamp set for existence checks
  const currentStrokeTimestamps = new Set(strokes.map(s => String(s.startTime)));
  
  console.log('=== Block Matching Debug ===');
  console.log(`Existing blocks: ${existingBlocks.length}`);
  console.log(`New lines: ${newLines.length}`);
  console.log(`Current strokes: ${currentStrokeTimestamps.size}`);
  
  // STRATEGY 1: Match blocks by stroke ID overlap (preferred)
  for (const block of existingBlocks) {
    const blockStrokeIds = parseStrokeIds(block.properties?.['stroke-ids']);
    const blockBounds = parseYBounds(block.properties?.['stroke-y-bounds'] || '0-0');
    const mergedCount = parseInt(block.properties?.['merged-lines']) || 1;
    const storedCanonical = block.properties?.['canonical-transcript'] || '';
    
    console.log(`\nChecking block ${block.uuid.substring(0, 8)}...`);
    console.log(`  Stroke IDs: ${blockStrokeIds.size}, Y-bounds: ${block.properties?.['stroke-y-bounds']}`);
    
    // Find lines with overlapping stroke IDs
    let overlappingLines = [];
    
    if (blockStrokeIds.size > 0) {
      // Primary: Match by stroke IDs
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        if (line.strokeIds && strokeSetsOverlap(blockStrokeIds, line.strokeIds)) {
          const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
          overlappingLines.push({ line, index, bounds: lineBounds });
          console.log(`  → Matched line ${index} by stroke IDs: "${line.text.substring(0, 30)}..."`);
        }
      });
    }
    
    // Fallback: If no stroke ID matches AND block has no stroke IDs, try Y-bounds
    if (overlappingLines.length === 0 && blockStrokeIds.size === 0) {
      console.log(`  No stroke IDs - falling back to Y-bounds matching`);
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
        if (boundsOverlap(blockBounds, lineBounds)) {
          overlappingLines.push({ line, index, bounds: lineBounds });
          console.log(`  → Matched line ${index} by Y-bounds: "${line.text.substring(0, 30)}..."`);
        }
      });
    }
    
    // Process matches
    if (overlappingLines.length === 0) {
      // No matches - check if block's strokes still exist on canvas
      const strokesExist = blockStrokeIds.size > 0 && 
        [...blockStrokeIds].some(id => currentStrokeTimestamps.has(id));
      
      if (strokesExist || blockStrokeIds.size === 0) {
        // Strokes exist OR no stroke IDs to verify - PRESERVE
        console.log(`  → PRESERVE (${strokesExist ? 'strokes exist' : 'no stroke IDs'})`);
        actions.push({
          type: 'PRESERVE',
          reason: strokesExist ? 'strokes-exist-no-new-lines' : 'no-stroke-ids',
          blockUuid: block.uuid
        });
        usedBlockUuids.add(block.uuid);
      } else {
        console.log(`  → Will be deleted (strokes removed from canvas)`);
      }
      continue;
    }
    
    // Handle matched lines
    // Combine all overlapping lines for comparison
    const combinedCanonical = overlappingLines.map(ol => ol.line.canonical).join(' ');
    const combinedStrokeIds = new Set();
    overlappingLines.forEach(ol => {
      if (ol.line.strokeIds) {
        ol.line.strokeIds.forEach(id => combinedStrokeIds.add(id));
      }
    });
    
    // Check if canonical text matches
    if (combinedCanonical === storedCanonical) {
      // No change - skip
      console.log(`  → SKIP (canonical unchanged)`);
      actions.push({
        type: overlappingLines.length > 1 ? 'SKIP_MERGED' : 'SKIP',
        reason: 'canonical-unchanged',
        blockUuid: block.uuid,
        mergedCount: overlappingLines.length,
        consumedLines: overlappingLines.map(ol => ol.index)
      });
    } else {
      // Text changed - update
      console.log(`  → UPDATE (canonical changed)`);
      const combinedText = overlappingLines.map(ol => ol.line.text).join(' ');
      const newMinY = Math.min(...overlappingLines.map(ol => ol.bounds.minY));
      const newMaxY = Math.max(...overlappingLines.map(ol => ol.bounds.maxY));
      
      actions.push({
        type: overlappingLines.length > 1 ? 'UPDATE_MERGED' : 'UPDATE',
        blockUuid: block.uuid,
        line: {
          text: combinedText,
          canonical: combinedCanonical,
          yBounds: { minY: newMinY, maxY: newMaxY },
          strokeIds: combinedStrokeIds,
          mergedLineCount: overlappingLines.length,
          indentLevel: overlappingLines[0].line.indentLevel || 0
        },
        oldContent: block.content,
        consumedLines: overlappingLines.map(ol => ol.index)
      });
    }
    
    // Mark lines and block as used
    overlappingLines.forEach(ol => consumedLineIndices.add(ol.index));
    usedBlockUuids.add(block.uuid);
  }
  
  // STRATEGY 2: Create blocks for unconsumed lines (new content)
  newLines.forEach((line, index) => {
    if (consumedLineIndices.has(index)) return;
    
    console.log(`\nNew line ${index}: "${line.text.substring(0, 30)}..." → CREATE`);
    
    const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
    actions.push({
      type: 'CREATE',
      line: {
        ...line,
        yBounds: lineBounds,
        strokeIds: line.strokeIds || new Set()
      },
      bounds: lineBounds,
      canonical: line.canonical,
      parentUuid: null
    });
  });
  
  console.log('\n=== Action Summary ===');
  console.log(`SKIP: ${actions.filter(a => a.type === 'SKIP' || a.type === 'SKIP_MERGED').length}`);
  console.log(`UPDATE: ${actions.filter(a => a.type === 'UPDATE' || a.type === 'UPDATE_MERGED').length}`);
  console.log(`CREATE: ${actions.filter(a => a.type === 'CREATE').length}`);
  console.log(`PRESERVE: ${actions.filter(a => a.type === 'PRESERVE').length}`);
  
  return actions;
}
```

---

### Phase 6: Handle PRESERVE Action in Executor
**Effort**: 15 minutes | **Impact**: MEDIUM - Completes the flow

Add handling for the new PRESERVE action type in the action executor loop.

**File**: `src/lib/transcript-updater.js`
**Location**: In the action execution switch statement

```javascript
// Add this case to the switch statement in updateTranscriptBlocks()
case 'PRESERVE': {
  usedBlockUuids.add(action.blockUuid);
  results.push({ 
    type: 'preserved', 
    uuid: action.blockUuid, 
    reason: action.reason
  });
  break;
}
```

Also update the stats at the end:

```javascript
return {
  success: true,
  page: pageName,
  results,
  stats: {
    created: results.filter(r => r.type === 'created').length,
    updated: results.filter(r => r.type === 'updated' || r.type === 'updated-merged').length,
    skipped: results.filter(r => r.type === 'skipped' || r.type === 'skipped-merged').length,
    preserved: results.filter(r => r.type === 'preserved').length,  // NEW
    merged: results.filter(r => r.type === 'merged').length,
    deleted: results.filter(r => r.type === 'deleted').length,
    errors: results.filter(r => r.type === 'error').length
  }
};
```

---

## Code Changes Summary

| Phase | File | Function/Section | Change | Priority |
|-------|------|-----------------|--------|----------|
| 1 | `transcript-updater.js` | Orphan deletion loop | Replace | P1 - Critical |
| 2 | `transcript-updater.js` | Top of file | Add helper functions | P1 - Critical |
| 3 | `logseq-api.js` | `createTranscriptBlockWithProperties()` | Add stroke-ids | P1 - Critical |
| 3 | `logseq-api.js` | `updateTranscriptBlockWithPreservation()` | Add stroke-ids | P1 - Critical |
| 4 | `transcript-updater.js` | `updateTranscriptBlocks()` | Add stroke ID estimation | P1 - Critical |
| 5 | `transcript-updater.js` | `detectBlockActions()` | Replace entirely | P1 - Critical |
| 6 | `transcript-updater.js` | Action executor switch | Add PRESERVE case | P2 - High |

**Total Estimated Effort**: 3-4 hours

---

## Testing Plan

### Test Scenarios

#### Scenario 1: Basic Incremental Add ✅
1. Write "Hello World" → Transcribe → Save
2. Write "Goodbye Moon" below → Transcribe → Save
3. **Expected**: Both blocks exist, original preserved
4. **Verify**: First block has stroke-ids property

#### Scenario 2: Merge Then Add (THE KEY TEST) ✅
1. Write three lines → Transcribe → Save
2. Edit: Merge lines 1+2 in modal → Save
3. Write new line below → Transcribe → Save
4. **Expected**: Merged block preserved with combined stroke-ids, new block created
5. **Verify**: Merged block stroke-ids contains IDs from both original lines

#### Scenario 3: Edit Text Then Add ✅
1. Write "Reveew document" → Transcribe → Save
2. Edit: Fix to "Review document" in modal → Save
3. Write new line → Transcribe → Save
4. **Expected**: User's spelling fix preserved (canonical unchanged, content different)

#### Scenario 4: Delete Strokes ✅
1. Write three lines → Transcribe → Save
2. Select middle strokes on canvas → Delete → Save
3. **Expected**: Middle block deleted (strokes gone), others preserved

#### Scenario 5: Re-transcribe Without Changes ✅
1. Write some text → Transcribe → Save
2. Transcribe again (no new strokes)
3. **Expected**: All blocks SKIPPED (canonical unchanged)

### Console Output to Verify

When running, you should see debug output like:

```
=== Block Matching Debug ===
Existing blocks: 3
New lines: 4
Current strokes: 25

Checking block abc12345...
  Stroke IDs: 5, Y-bounds: 10.0-35.0
  → Matched line 0 by stroke IDs: "Hello world this is..."
  → Matched line 1 by stroke IDs: "a test of the..."
  → SKIP (canonical unchanged)

Checking block def67890...
  Stroke IDs: 3, Y-bounds: 40.0-55.0
  → Matched line 2 by stroke IDs: "Another line here..."
  → SKIP (canonical unchanged)

New line 3: "Brand new content..." → CREATE

=== Action Summary ===
SKIP: 2
UPDATE: 0
CREATE: 1
PRESERVE: 0
```

### Edge Cases to Test

- [ ] Empty page (no strokes) - should handle gracefully
- [ ] Single stroke - should work
- [ ] Very long merged block (5+ lines) - stroke IDs should accumulate
- [ ] Overlapping Y-bounds between lines - stroke ID matching should disambiguate
- [ ] Re-transcribe with MyScript variations - stroke IDs should still match

---

## Appendix: Data Model Reference

### Block Properties Schema

```javascript
{
  'stroke-y-bounds': '45.2-68.7',              // Y coordinate range (for display/debug)
  'canonical-transcript': 'Original text',     // MyScript output (normalized)
  'stroke-ids': '1706234567890,1706234567891', // Pen timestamps - THE KEY!
  'merged-lines': '2'                          // Count if merged (optional)
}
```

### Line Object Schema (with stroke IDs)

```javascript
{
  text: 'User visible text',
  canonical: 'normalized text',
  words: [...],
  strokeIds: Set(['1706234567890', '1706234567891']),  // Estimated from Y-bounds
  x: 10.5,
  baseline: 25.3,
  yBounds: { minY: 20.1, maxY: 35.7 },
  mergedLineCount: 1,
  blockUuid: null,
  syncStatus: 'unsaved'
}
```

### Stroke Object Schema (from pen)

```javascript
{
  pageInfo: { section: 0, owner: 0, book: 123, page: 1 },
  startTime: 1706234567890,        // ← THIS IS THE STROKE ID
  endTime: 1706234568500,
  dotArray: [
    { x: 10.5, y: 20.3, f: 512, timestamp: 1706234567890 },
    // ... more dots
  ]
}
```

---

## Document Status

- [x] Problem identified
- [x] Solution designed (Y-bounds stroke estimation)
- [x] Implementation guide written
- [x] Code examples provided
- [ ] Phase 1 implemented (safe orphan handling)
- [ ] Phase 2 implemented (helper functions)
- [ ] Phase 3 implemented (stroke ID storage)
- [ ] Phase 4 implemented (stroke ID estimation)
- [ ] Phase 5 implemented (stroke ID matching)
- [ ] Phase 6 implemented (PRESERVE action)
- [ ] Testing complete

---

*Last updated: 2026-01-23*
