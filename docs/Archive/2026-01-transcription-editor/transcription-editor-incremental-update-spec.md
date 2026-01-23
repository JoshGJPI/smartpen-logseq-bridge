# Transcription Editor & Incremental Update Specification

## Document History
- **Created**: 2026-01-22
- **Updated**: 2026-01-23
- **Status**: Implementation Ready
- **Version**: 4.1 (Stroke → Block Reference with Persistence)

---

## Executive Summary

The SmartPen-LogSeq Bridge has a transcription editing system that allows users to merge, split, and refine handwriting recognition results. However, **re-transcribing a page with additional strokes deletes previously edited content** instead of intelligently merging new content with existing blocks.

This document provides complete implementation guidance for the **Stroke → Block Reference** solution with full persistence, which:
1. Stores the LogSeq block UUID on each stroke (not the reverse)
2. Persists blockUuid in the chunked stroke storage in LogSeq
3. Restores stroke→block associations when loading data between sessions
4. Detects new strokes by checking `!stroke.blockUuid`
5. Only transcribes new strokes, leaving existing blocks untouched

**Key Insight**: The stroke→block relationship must survive across app sessions. This requires updating the stroke storage format to include `blockUuid` and ensuring it's properly saved and loaded.

---

## Table of Contents
1. [Problem Analysis](#problem-analysis)
2. [Solution Overview](#solution-overview)
3. [Data Model](#data-model)
4. [Implementation Guide](#implementation-guide)
5. [Session Workflows](#session-workflows)
6. [Testing Plan](#testing-plan)

---

## Problem Analysis

### Previous Approach Issues

**Version 3.x (Stroke IDs on Block)** failed because:
1. **Block content too long** - Storing hundreds of stroke timestamps exceeded LogSeq's block size limits
2. **Y-bounds returning 0-0** - Separate bug to fix

**Version 4.0 (In-Memory Only)** would fail because:
1. **No persistence** - Stroke→block associations lost on page reload
2. **Session continuity** - Can't continue work across sessions

### Requirements

1. Stroke→block association must persist in LogSeq storage
2. Loading strokes must restore `blockUuid` values
3. Saving after transcription must update stored strokes with new `blockUuid` values
4. Merging blocks must update stored strokes with new associations

---

## Solution Overview

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LogSeq Storage                           │
├─────────────────────────────────────────────────────────────────┤
│  Smartpen Data/B123/P1                                          │
│  ├── ## Raw Stroke Data                                         │
│  │   ├── {metadata: {chunks: 3, totalStrokes: 450}}            │
│  │   ├── {chunkIndex: 0, strokes: [{id, blockUuid, ...}, ...]} │ ← NEW: blockUuid
│  │   ├── {chunkIndex: 1, strokes: [...]}                       │
│  │   └── {chunkIndex: 2, strokes: [...]}                       │
│  └── ## Transcribed Content                                     │
│      ├── Block A (uuid: abc-123)                                │
│      │   └── stroke-y-bounds:: 10.0-35.0                       │
│      └── Block B (uuid: def-456)                                │
│          └── stroke-y-bounds:: 40.0-60.0                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     In-Memory (strokes store)                   │
├─────────────────────────────────────────────────────────────────┤
│  [                                                              │
│    { startTime, dotArray, pageInfo, blockUuid: "abc-123" },    │
│    { startTime, dotArray, pageInfo, blockUuid: "abc-123" },    │
│    { startTime, dotArray, pageInfo, blockUuid: "def-456" },    │
│    { startTime, dotArray, pageInfo, blockUuid: null },  ← NEW  │
│  ]                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
SAVE STROKES (with blockUuid):
  In-memory strokes → convertToStorageFormat() → includes blockUuid
  → Write to LogSeq chunks → blockUuid persisted

LOAD STROKES:
  Read LogSeq chunks → parseChunkedJsonBlocks() → includes blockUuid
  → convertFromStorageFormat() → populate strokes store with blockUuid

TRANSCRIBE:
  Filter strokes where !blockUuid → Send to MyScript
  → Create blocks → Match strokes to blocks by Y-bounds
  → Update strokes with blockUuid → Save strokes (persist new blockUuids)

MERGE BLOCKS:
  Block B merged into Block A → Update strokes where blockUuid=B to blockUuid=A
  → Save strokes (persist updated blockUuids)
```

---

## Data Model

### Stroke Object (In-Memory)

```javascript
// In strokes store
{
  // Existing fields from pen
  pageInfo: { section: 0, owner: 0, book: 123, page: 1 },
  startTime: 1706234567890,        // Unique identifier
  endTime: 1706234568500,
  dotArray: [
    { x: 10.5, y: 20.3, f: 512, timestamp: 1706234567890 },
    // ...
  ],
  
  // NEW: LogSeq block reference (persisted)
  blockUuid: "64a3f2b1-8c2e-4f1a-9d3b-7e6c5a4b3c2d" | null
}
```

### Stroke Storage Format (JSON in LogSeq)

```javascript
// Simplified stroke format for storage (in chunks)
{
  id: "s1706234567890",
  startTime: 1706234567890,
  endTime: 1706234568500,
  blockUuid: "64a3f2b1-..." | null,  // NEW: Persisted block reference
  points: [[x, y, timestamp], ...]
}
```

### Block Properties (Simplified)

```javascript
{
  'stroke-y-bounds': '45.2-68.7'  // Y coordinate range for stroke assignment
}
```

---

## Implementation Guide

### Phase 1: Update Stroke Storage Format
**Effort**: 30 minutes | **Impact**: Foundation for persistence

Modify `stroke-storage.js` to include `blockUuid` in storage format.

**File**: `src/lib/stroke-storage.js`

#### 1.1 Update `convertToStorageFormat()`

```javascript
/**
 * Convert raw pen strokes to simplified storage format
 * Now includes blockUuid for persistence
 * 
 * @param {Array} strokes - Raw strokes from pen (with optional blockUuid)
 * @returns {Array} Simplified strokes with essential data + blockUuid
 */
export function convertToStorageFormat(strokes) {
  return strokes.map(stroke => ({
    id: generateStrokeId(stroke),
    startTime: stroke.startTime,
    endTime: stroke.endTime,
    blockUuid: stroke.blockUuid || null,  // NEW: Persist block reference
    points: stroke.dotArray.map(dot => [
      dot.x,
      dot.y,
      dot.timestamp
    ])
  }));
}
```

#### 1.2 Add `convertFromStorageFormat()`

```javascript
/**
 * Convert stored strokes back to in-memory format
 * Restores blockUuid from storage
 * 
 * @param {Array} storedStrokes - Simplified strokes from LogSeq
 * @param {Object} pageInfo - Page info to attach
 * @returns {Array} Full stroke objects for strokes store
 */
export function convertFromStorageFormat(storedStrokes, pageInfo) {
  return storedStrokes.map(stored => ({
    pageInfo: pageInfo,
    startTime: stored.startTime,
    endTime: stored.endTime,
    blockUuid: stored.blockUuid || null,  // Restore block reference
    dotArray: stored.points.map(([x, y, timestamp]) => ({
      x,
      y,
      f: 512,  // Default pressure (not stored)
      timestamp
    }))
  }));
}
```

#### 1.3 Update `parseChunkedJsonBlocks()` to Return blockUuid

The existing function already returns strokes - just ensure the strokes include `blockUuid`:

```javascript
/**
 * Parse chunked JSON blocks from LogSeq
 * @param {Array} childBlocks - All child blocks under "Raw Stroke Data"
 * @returns {Object|null} Reconstructed storage object or null
 */
export function parseChunkedJsonBlocks(childBlocks) {
  if (!childBlocks || childBlocks.length === 0) return null;
  
  try {
    // First block is metadata
    const metadata = parseJsonBlock(childBlocks[0].content);
    if (!metadata) return null;
    
    // Remaining blocks are stroke chunks
    const allStrokes = [];
    for (let i = 1; i < childBlocks.length; i++) {
      const chunk = parseJsonBlock(childBlocks[i].content);
      if (chunk && chunk.strokes) {
        // Strokes now include blockUuid (may be null for old data)
        allStrokes.push(...chunk.strokes);
      }
    }
    
    return {
      version: metadata.version,
      pageInfo: metadata.pageInfo,
      strokes: allStrokes,  // Each stroke has { id, startTime, endTime, blockUuid, points }
      metadata: metadata.metadata
    };
  } catch (error) {
    console.error('Failed to parse chunked blocks:', error);
    return null;
  }
}
```

---

### Phase 2: Update Stroke Store
**Effort**: 45 minutes | **Impact**: Enables all workflows

Add functions to manage `blockUuid` and load/hydrate strokes from storage.

**File**: `src/stores/strokes.js`

```javascript
import { writable, derived } from 'svelte/store';
import { registerBookId, registerBookIds } from './book-aliases.js';

// Raw stroke data
export const strokes = writable([]);

// ... existing code ...

/**
 * Load strokes from storage format into the store
 * Used when loading data from LogSeq
 * @param {Array} storedStrokes - Strokes from storage (with blockUuid)
 * @param {Object} pageInfo - Page info to attach
 */
export function loadStrokesFromStorage(storedStrokes, pageInfo) {
  if (!storedStrokes || storedStrokes.length === 0) return;
  
  // Register book ID
  if (pageInfo?.book) {
    registerBookId(pageInfo.book);
  }
  
  // Convert from storage format (restores blockUuid)
  const fullStrokes = storedStrokes.map(stored => ({
    pageInfo: pageInfo,
    startTime: stored.startTime,
    endTime: stored.endTime,
    blockUuid: stored.blockUuid || null,
    dotArray: stored.points.map(([x, y, timestamp]) => ({
      x,
      y,
      f: 512,
      timestamp
    }))
  }));
  
  // Add to store (avoiding duplicates by startTime)
  strokes.update(existing => {
    const existingIds = new Set(existing.map(s => s.startTime));
    const newStrokes = fullStrokes.filter(s => !existingIds.has(s.startTime));
    return [...existing, ...newStrokes];
  });
}

/**
 * Update blockUuid for specific strokes
 * @param {Map<string, string>} strokeToBlockMap - Map of stroke startTime -> blockUuid
 */
export function updateStrokeBlockUuids(strokeToBlockMap) {
  strokes.update(allStrokes => {
    return allStrokes.map(stroke => {
      const blockUuid = strokeToBlockMap.get(String(stroke.startTime));
      if (blockUuid !== undefined) {
        return { ...stroke, blockUuid };
      }
      return stroke;
    });
  });
}

/**
 * Get strokes that haven't been transcribed yet (no blockUuid)
 * @param {Array} strokeList - Array of strokes to filter
 * @returns {Array} Strokes without blockUuid
 */
export function getUntranscribedStrokes(strokeList) {
  return strokeList.filter(stroke => !stroke.blockUuid);
}

/**
 * Get strokes assigned to a specific block
 * @param {string} blockUuid - Block UUID to search for
 * @returns {Array} Strokes belonging to this block
 */
export function getStrokesForBlock(blockUuid) {
  let result = [];
  const unsubscribe = strokes.subscribe(allStrokes => {
    result = allStrokes.filter(s => s.blockUuid === blockUuid);
  });
  unsubscribe();
  return result;
}

/**
 * Reassign strokes from one block to another (for merges)
 * @param {string} fromBlockUuid - Source block UUID
 * @param {string} toBlockUuid - Target block UUID
 * @returns {number} Count of strokes reassigned
 */
export function reassignStrokes(fromBlockUuid, toBlockUuid) {
  let count = 0;
  strokes.update(allStrokes => {
    return allStrokes.map(stroke => {
      if (stroke.blockUuid === fromBlockUuid) {
        count++;
        return { ...stroke, blockUuid: toBlockUuid };
      }
      return stroke;
    });
  });
  return count;
}

/**
 * Clear blockUuid from strokes (for re-transcription)
 * @param {Array<number>} strokeTimestamps - Stroke startTimes to clear
 */
export function clearStrokeBlockUuids(strokeTimestamps) {
  const timestampSet = new Set(strokeTimestamps.map(Number));
  strokes.update(allStrokes => {
    return allStrokes.map(stroke => {
      if (timestampSet.has(stroke.startTime)) {
        return { ...stroke, blockUuid: null };
      }
      return stroke;
    });
  });
}

/**
 * Get current strokes array (for saving)
 * @returns {Array} Current strokes
 */
export function getStrokesSnapshot() {
  let snapshot = [];
  const unsubscribe = strokes.subscribe(s => snapshot = s);
  unsubscribe();
  return snapshot;
}
```

---

### Phase 3: Update Save Flow to Persist blockUuid
**Effort**: 30 minutes | **Impact**: Persistence works

The existing `updatePageStrokes()` already uses `convertToStorageFormat()`. 
After updating Phase 1, blockUuid will automatically be persisted.

**Verification**: Ensure `updatePageStrokes()` in `logseq-api.js` uses `convertToStorageFormat()`:

```javascript
// In updatePageStrokesSingle() - already exists
const simplifiedStrokes = convertToStorageFormat(newStrokes);
// ↑ This now includes blockUuid automatically after Phase 1 changes
```

---

### Phase 4: Load Strokes with blockUuid
**Effort**: 45 minutes | **Impact**: Session continuity

Add function to load strokes from LogSeq and hydrate the store.

**File**: `src/lib/logseq-api.js`

```javascript
import { loadStrokesFromStorage } from '$stores/strokes.js';
import { convertFromStorageFormat } from './stroke-storage.js';

/**
 * Load strokes from LogSeq storage into the strokes store
 * Restores blockUuid associations from previous sessions
 * 
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} { success, strokeCount, hasBlockUuids }
 */
export async function loadPageStrokesIntoStore(book, page, host, token = '') {
  try {
    const data = await getPageStrokes(book, page, host, token);
    
    if (!data || !data.strokes || data.strokes.length === 0) {
      return { success: true, strokeCount: 0, hasBlockUuids: false };
    }
    
    const pageInfo = data.pageInfo || { section: 0, owner: 0, book, page };
    
    // Load into store (converts from storage format, restores blockUuid)
    loadStrokesFromStorage(data.strokes, pageInfo);
    
    // Check how many have blockUuid
    const withBlockUuid = data.strokes.filter(s => s.blockUuid).length;
    
    console.log(`Loaded ${data.strokes.length} strokes for B${book}/P${page}, ${withBlockUuid} with blockUuid`);
    
    return {
      success: true,
      strokeCount: data.strokes.length,
      hasBlockUuids: withBlockUuid > 0,
      transcribedCount: withBlockUuid,
      untranscribedCount: data.strokes.length - withBlockUuid
    };
    
  } catch (error) {
    console.error(`Failed to load strokes for B${book}/P${page}:`, error);
    return { success: false, error: error.message };
  }
}
```

---

### Phase 5: Update Transcription Save Flow
**Effort**: 1-2 hours | **Impact**: Core functionality

After creating transcription blocks, match strokes to blocks and persist.

**File**: `src/lib/transcript-updater.js`

```javascript
import { 
  updateStrokeBlockUuids, 
  getStrokesSnapshot 
} from '$stores/strokes.js';
import { updatePageStrokes } from './logseq-api.js';

/**
 * Match strokes to transcription lines using Y-bounds overlap
 * Returns map of stroke startTime -> blockUuid
 */
function matchStrokesToLines(strokes, linesWithBlocks, tolerance = 5) {
  const strokeToBlockMap = new Map();
  
  for (const stroke of strokes) {
    if (!stroke.dotArray || stroke.dotArray.length === 0) continue;
    
    // Get stroke's Y range
    const strokeYs = stroke.dotArray.map(d => d.y);
    const strokeMinY = Math.min(...strokeYs);
    const strokeMaxY = Math.max(...strokeYs);
    
    // Find the line with best Y-bounds overlap
    let bestMatch = null;
    let bestOverlap = 0;
    
    for (const line of linesWithBlocks) {
      if (!line.yBounds || !line.blockUuid) continue;
      
      const lineMinY = line.yBounds.minY - tolerance;
      const lineMaxY = line.yBounds.maxY + tolerance;
      
      // Calculate overlap
      const overlapMin = Math.max(strokeMinY, lineMinY);
      const overlapMax = Math.min(strokeMaxY, lineMaxY);
      const overlap = Math.max(0, overlapMax - overlapMin);
      
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = line;
      }
    }
    
    if (bestMatch) {
      strokeToBlockMap.set(String(stroke.startTime), bestMatch.blockUuid);
    }
  }
  
  return strokeToBlockMap;
}

/**
 * Main orchestrator for transcript block updates
 * Creates blocks and assigns blockUuids to strokes, then persists
 */
export async function updateTranscriptBlocks(book, page, strokes, newTranscription, host, token = '') {
  try {
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    const sectionUuid = await getOrCreateTranscriptSection(pageName, host, token);
    
    const results = [];
    const linesWithBlocks = [];
    
    // Create blocks for each line
    for (const line of newTranscription.lines) {
      try {
        let parentUuid = sectionUuid;
        if (line.parent !== null && line.parent >= 0) {
          const parentLine = linesWithBlocks[line.parent];
          if (parentLine?.blockUuid) {
            parentUuid = parentLine.blockUuid;
          }
        }
        
        const newBlock = await createTranscriptBlockWithProperties(
          parentUuid,
          line,
          host,
          token
        );
        
        linesWithBlocks.push({
          ...line,
          blockUuid: newBlock.uuid
        });
        
        results.push({ 
          type: 'created', 
          uuid: newBlock.uuid, 
          text: line.text.substring(0, 30) 
        });
        
      } catch (error) {
        console.error(`Failed to create block for line:`, error);
        linesWithBlocks.push({ ...line, blockUuid: null });
        results.push({ type: 'error', error: error.message });
      }
    }
    
    // Match strokes to blocks by Y-bounds
    const strokeToBlockMap = matchStrokesToLines(strokes, linesWithBlocks);
    
    console.log(`Assigning ${strokeToBlockMap.size} strokes to ${linesWithBlocks.length} blocks`);
    
    // Update in-memory strokes with block references
    updateStrokeBlockUuids(strokeToBlockMap);
    
    // CRITICAL: Persist updated strokes (with blockUuid) to LogSeq
    const allStrokes = getStrokesSnapshot();
    const pageStrokes = allStrokes.filter(s => 
      s.pageInfo?.book === book && s.pageInfo?.page === page
    );
    
    if (pageStrokes.length > 0) {
      console.log(`Persisting ${pageStrokes.length} strokes with updated blockUuids`);
      await updatePageStrokes(book, page, pageStrokes, host, token);
    }
    
    return {
      success: true,
      page: pageName,
      results,
      strokesAssigned: strokeToBlockMap.size,
      stats: {
        created: results.filter(r => r.type === 'created').length,
        errors: results.filter(r => r.type === 'error').length
      }
    };
    
  } catch (error) {
    console.error('Failed to update transcript blocks:', error);
    return {
      success: false,
      error: error.message,
      stats: { created: 0, errors: 1 }
    };
  }
}
```

---

### Phase 6: Update Modal Merge Handling with Persistence
**Effort**: 1 hour | **Impact**: Editor workflow

When blocks are merged, update strokes and persist changes.

**File**: `src/components/dialog/TranscriptionEditorModal.svelte`

```javascript
import { 
  reassignStrokes, 
  getStrokesSnapshot,
  getStrokesInYRange 
} from '$stores/strokes.js';
import { updatePageStrokes } from '$lib/logseq-api.js';

/**
 * Handle save from editor modal
 * Updates stroke references for merged/deleted blocks and persists
 */
async function handleSave() {
  // ... existing save logic to update blocks in LogSeq ...
  
  let strokesChanged = false;
  
  // Handle merges - reassign strokes from deleted blocks
  for (const merge of mergedBlocks) {
    const count = reassignStrokes(merge.deletedBlockUuid, merge.survivingBlockUuid);
    if (count > 0) {
      strokesChanged = true;
      console.log(`Reassigned ${count} strokes from ${merge.deletedBlockUuid} to ${merge.survivingBlockUuid}`);
    }
  }
  
  // Handle splits - assign strokes to new blocks by Y-bounds
  for (const split of splitBlocks) {
    const pageStrokes = getStrokesForPage(currentBook, currentPage);
    const strokesForNewBlock = getStrokesInYRange(pageStrokes, split.newBlockYBounds);
    
    if (strokesForNewBlock.length > 0) {
      const strokeToBlockMap = new Map();
      for (const stroke of strokesForNewBlock) {
        strokeToBlockMap.set(String(stroke.startTime), split.newBlockUuid);
      }
      updateStrokeBlockUuids(strokeToBlockMap);
      strokesChanged = true;
      console.log(`Assigned ${strokesForNewBlock.length} strokes to new split block`);
    }
  }
  
  // CRITICAL: Persist stroke changes if any were made
  if (strokesChanged) {
    const { host, token } = getLogseqSettings();
    const pageStrokes = getStrokesForPage(currentBook, currentPage);
    
    if (pageStrokes.length > 0) {
      console.log(`Persisting ${pageStrokes.length} strokes with updated blockUuids`);
      await updatePageStrokes(currentBook, currentPage, pageStrokes, host, token);
    }
  }
}

// Helper to get strokes for a page
function getStrokesForPage(book, page) {
  const allStrokes = getStrokesSnapshot();
  return allStrokes.filter(s => 
    s.pageInfo?.book === book && s.pageInfo?.page === page
  );
}
```

---

### Phase 7: Incremental Transcription UI
**Effort**: 1 hour | **Impact**: User experience

Show users the transcription status and allow selective transcription.

**File**: `src/components/header/ActionBar.svelte`

```javascript
import { getUntranscribedStrokes } from '$stores/strokes.js';

// Reactive: count untranscribed strokes
$: untranscribedStrokes = getUntranscribedStrokes($strokes);
$: untranscribedCount = untranscribedStrokes.length;
$: allTranscribed = $strokeCount > 0 && untranscribedCount === 0;

// Filter for selected page's strokes
$: pageUntranscribedCount = (() => {
  if (!$hasSelection) return untranscribedCount;
  return getUntranscribedStrokes($selectedStrokes).length;
})();

async function handleTranscribe() {
  // ... existing code ...
  
  // Only send untranscribed strokes to MyScript (plus context)
  // User's selection determines context strokes
  const strokesToSend = strokesToTranscribe;
  
  // Filter to only create blocks for NEW strokes' lines
  const newStrokes = getUntranscribedStrokes(strokesToSend);
  
  if (newStrokes.length === 0 && !forceRetranscribe) {
    log('All selected strokes are already transcribed', 'info');
    return;
  }
  
  // ... rest of transcription logic ...
}
```

---

## Session Workflows

### Workflow A: First Transcription

```
1. User writes strokes → In-memory (blockUuid: null)
2. User saves strokes → LogSeq storage (blockUuid: null)
3. User transcribes → Creates blocks
4. System matches strokes → Sets blockUuid in memory
5. System persists strokes → LogSeq storage (blockUuid: "abc-123")
```

### Workflow B: Continue Across Sessions

```
Session 1:
  - Write + Transcribe + Save → Strokes have blockUuid

Session 2:
  1. App loads strokes from LogSeq → blockUuid restored ✓
  2. User writes MORE strokes → new strokes have blockUuid: null
  3. User transcribes → Only new strokes sent (no blockUuid)
  4. New blocks created → New strokes get blockUuid
  5. Save → All blockUuids persisted
  6. Existing blocks UNTOUCHED ✓
```

### Workflow C: Merge Lines

```
1. User opens editor modal
2. User merges Block A + Block B → Block B deleted
3. System finds strokes with blockUuid = B
4. System updates them to blockUuid = A
5. System persists strokes → Updated blockUuids saved
6. Next session → Associations preserved ✓
```

### Workflow D: Delete Strokes

```
1. User selects strokes → Deletes them
2. Strokes removed from store
3. Save → Strokes removed from LogSeq storage
4. Blocks remain in LogSeq (orphaned but not deleted)
5. Optional: "Clean up orphaned blocks" feature
```

---

## Code Changes Summary

| Phase | File | Change | Effort |
|-------|------|--------|--------|
| 1 | `stroke-storage.js` | Add blockUuid to storage format | 30 min |
| 2 | `stores/strokes.js` | Add blockUuid management functions | 45 min |
| 3 | `logseq-api.js` | Verify save includes blockUuid | 30 min |
| 4 | `logseq-api.js` | Add `loadPageStrokesIntoStore()` | 45 min |
| 5 | `transcript-updater.js` | Match strokes + persist after transcribe | 1-2 hr |
| 6 | `TranscriptionEditorModal.svelte` | Persist after merge/split | 1 hr |
| 7 | `ActionBar.svelte` | Show transcription status | 1 hr |

**Total Estimated Effort**: 6-8 hours

---

## Testing Plan

### Test Scenarios

#### Scenario 1: First Transcription + Persistence
1. Write strokes → Save to LogSeq
2. Transcribe → Save
3. Close app → Reopen
4. Load strokes from LogSeq
5. **Verify**: Strokes have `blockUuid` populated

#### Scenario 2: Incremental Add Across Sessions
1. Session 1: Write "Hello" → Transcribe → Save → Close
2. Session 2: Open → Load strokes (should have blockUuid)
3. Write "World" → New strokes have no blockUuid
4. Transcribe → Only "World" should create new blocks
5. Save → Close
6. Session 3: Open → Load → All strokes have blockUuid
7. **Verify**: "Hello" block untouched, "World" block exists

#### Scenario 3: Merge Then Reload
1. Write 3 lines → Transcribe → Save
2. Open editor → Merge lines 1+2 → Save
3. Close app → Reopen
4. Load strokes
5. **Verify**: Strokes from line 2 now point to merged block UUID

#### Scenario 4: Storage Format Verification
1. After saving, check LogSeq page source
2. Look at JSON in "Raw Stroke Data" chunks
3. **Verify**: Each stroke has `"blockUuid": "..."` or `"blockUuid": null`

### Debug Logging

```javascript
// In loadPageStrokesIntoStore()
console.log('Loading strokes:', {
  total: data.strokes.length,
  withBlockUuid: data.strokes.filter(s => s.blockUuid).length,
  sampleStroke: data.strokes[0]
});

// In updateTranscriptBlocks() after matching
console.log('Stroke assignments:', 
  [...strokeToBlockMap.entries()].slice(0, 5)
);

// In handleSave() after merge
console.log('Persisting strokes after merge:', {
  totalStrokes: pageStrokes.length,
  reassignedCount: count
});
```

---

## Appendix: Y-Bounds Bug (Separate Issue)

The Y-bounds returning 0-0 is a separate bug that affects stroke-to-line matching. This needs investigation in:

- `src/lib/myscript-api.js` - `parseMyScriptResponse()` 
- Word bounding box extraction from MyScript JIIX response

**Possible causes:**
1. MyScript not returning `bounding-box` for words
2. JIIX configuration missing `'bounding-box': true`
3. Coordinate system mismatch (pixels vs Ncode units)

This should be fixed independently as it affects both initial matching and ongoing functionality.

---

## Document Status

- [x] Problem identified
- [x] Solution designed (Stroke → Block with Persistence)
- [x] Session workflows documented
- [x] Implementation guide written
- [x] Code examples provided
- [ ] Phase 1: Storage format update
- [ ] Phase 2: Stroke store functions
- [ ] Phase 3: Save flow verification
- [ ] Phase 4: Load flow implementation
- [ ] Phase 5: Transcription save with persistence
- [ ] Phase 6: Modal merge with persistence
- [ ] Phase 7: Incremental transcription UI
- [ ] Y-bounds bug fixed (separate)
- [ ] Testing complete

---

*Last updated: 2026-01-23*
