# Transcription Editor & Incremental Update Specification

## Document History
- **Created**: 2026-01-22
- **Updated**: 2026-01-22
- **Status**: Implementation Ready
- **Version**: 3.0 (Stroke ID Tracking Solution)

---

## Executive Summary

The SmartPen-LogSeq Bridge has a transcription editing system that allows users to merge, split, and refine handwriting recognition results. However, **re-transcribing a page with additional strokes deletes previously edited content** instead of intelligently merging new content with existing blocks.

This document provides complete implementation guidance for the **Stroke ID Tracking** solution, which:
1. Tracks which strokes belong to each transcription block
2. Only transcribes new strokes (not already in a block)
3. Never deletes blocks unless their strokes are explicitly deleted

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

### Data Available vs. Missing

**Currently Available:**
- Block UUID
- Canonical transcript (original MyScript output)
- Y-bounds (coordinate range)
- Merged line count
- Current block content (with user edits)

**Missing (Critical):**
- ❌ Which stroke IDs compose each block
- ❌ Which strokes are "new" vs "already transcribed"
- ❌ Timestamp of last transcription per page

---

## Solution Overview

### Stroke ID Tracking Strategy

**Core Principle**: Every transcription block stores the stroke timestamps it represents. Matching is done by stroke ID overlap, not Y-bounds.

```
BEFORE (Y-Bounds Matching):
  Block Y: 10-50  ←→  New Lines Y: 10-30, 31-50
  Problem: Partial overlaps, merged blocks break

AFTER (Stroke ID Matching):
  Block Strokes: [1706234567890, 1706234567891, 1706234568000]
  ↕ exact match
  New Lines Strokes: [1706234567890, 1706234567891, 1706234568000]
  Result: Perfect matching regardless of merges
```

### Key Changes

1. **MyScript API**: Extract stroke-to-line mapping from JIIX response
2. **Block Properties**: Store `stroke-ids` for each block
3. **Matching Logic**: Match by stroke ID overlap instead of Y-bounds
4. **Orphan Handling**: Only delete blocks whose strokes were deleted from canvas
5. **Selective Transcription**: Option to transcribe only NEW strokes

---

## Implementation Guide

### Phase 1: Immediate Fix - Safe Orphan Handling
**Effort**: 30 minutes | **Impact**: HIGH - Stops data loss

Modify `transcript-updater.js` to only delete blocks when their strokes are gone.

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
    // Legacy block without stroke IDs - DON'T delete (safe default)
    console.log(`Preserving legacy block ${block.uuid} - no stroke IDs to verify`);
    results.push({ 
      type: 'preserved', 
      uuid: block.uuid, 
      reason: 'legacy-no-stroke-ids'
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

### Phase 2: Extract Stroke IDs from MyScript
**Effort**: 1-2 hours | **Impact**: HIGH - Enables precise matching

The MyScript JIIX format includes stroke indices when configured with `strokes: true`. We need to:
1. Pass the original strokes array to the parser
2. Map MyScript stroke indices back to our stroke timestamps
3. Attach `strokeIds` to each parsed line

**File**: `src/lib/myscript-api.js`

#### 2.1 Update `transcribeStrokes()` to Pass Strokes Through

```javascript
// MODIFY transcribeStrokes() - around line 180
export async function transcribeStrokes(strokes, appKey, hmacKey, options = {}) {
  // ... existing validation code ...
  
  const data = await response.json();
  
  // NEW: Pass original strokes to parser for stroke ID extraction
  return parseMyScriptResponse(data, strokes);
}
```

#### 2.2 Update `parseMyScriptResponse()` Signature and Logic

```javascript
// MODIFY parseMyScriptResponse() - add strokes parameter
function parseMyScriptResponse(response, originalStrokes = []) {
  console.log('MyScript response:', response);
  
  const text = response.label || '';
  const words = response.words || [];
  
  // NEW: Build stroke timestamp lookup from original strokes
  // MyScript stroke indices correspond to our stroke array order
  const strokeTimestamps = originalStrokes.map(s => String(s.startTime));
  
  // NEW: Extract stroke indices from words (JIIX provides this)
  // Each word has a 'strokes' array of indices when configured
  const wordStrokeMapping = new Map(); // word index -> Set of stroke timestamps
  
  words.forEach((word, wordIdx) => {
    if (word.strokes && Array.isArray(word.strokes)) {
      const timestamps = new Set();
      word.strokes.forEach(strokeIdx => {
        if (strokeIdx >= 0 && strokeIdx < strokeTimestamps.length) {
          timestamps.add(strokeTimestamps[strokeIdx]);
        }
      });
      wordStrokeMapping.set(wordIdx, timestamps);
    }
  });
  
  // ... existing line parsing code ...
  
  // MODIFY the lines.push() call to include strokeIds:
  const labelLines = text.split('\n').filter(l => l.trim());
  
  labelLines.forEach((lineText, lineIdx) => {
    // ... existing word matching code ...
    
    // NEW: Collect stroke IDs for this line from matched words
    const lineStrokeIds = new Set();
    lineWords.forEach((word, idx) => {
      // Find this word's index in the original words array
      const wordIdx = words.indexOf(word);
      if (wordIdx >= 0 && wordStrokeMapping.has(wordIdx)) {
        wordStrokeMapping.get(wordIdx).forEach(ts => lineStrokeIds.add(ts));
      }
    });
    
    // If no stroke IDs found via words, fall back to Y-bounds estimation
    if (lineStrokeIds.size === 0 && originalStrokes.length > 0) {
      // Estimate from Y-bounds overlap with strokes
      const lineBounds = { minY, maxY };
      originalStrokes.forEach(stroke => {
        const strokeBounds = getStrokeBounds(stroke);
        if (boundsOverlap(lineBounds, strokeBounds)) {
          lineStrokeIds.add(String(stroke.startTime));
        }
      });
    }
    
    lines.push({
      text: lineText,
      canonical: normalizeTranscript(lineText),
      words: lineWords,
      strokeIds: lineStrokeIds,  // NEW: Set of stroke timestamps
      x: lineX,
      baseline: lineY,
      yBounds: { minY, maxY },
      mergedLineCount: 1,
      blockUuid: null,
      syncStatus: 'unsaved'
    });
  });
  
  // ... rest of existing code ...
}

// NEW: Helper function to get stroke Y-bounds
function getStrokeBounds(stroke) {
  if (!stroke.dotArray || stroke.dotArray.length === 0) {
    return { minY: 0, maxY: 0 };
  }
  
  let minY = Infinity;
  let maxY = -Infinity;
  
  stroke.dotArray.forEach(dot => {
    if (dot.y < minY) minY = dot.y;
    if (dot.y > maxY) maxY = dot.y;
  });
  
  return { minY, maxY };
}

// NEW: Helper function to check Y-bounds overlap
function boundsOverlap(bounds1, bounds2) {
  return !(bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
}
```

#### 2.3 Verify JIIX Configuration Includes Strokes

In `buildRequest()`, ensure strokes are included in export config:

```javascript
// VERIFY this exists in buildRequest() - around line 65
configuration: {
  lang: options.lang || 'en_US',
  text: {
    guides: { enable: false },
    mimeTypes: ['text/plain', 'application/vnd.myscript.jiix']
  },
  export: {
    jiix: {
      'bounding-box': true,
      strokes: true,  // ← CRITICAL: This enables stroke indices in response
      text: { chars: true, words: true }
    }
  }
}
```

---

### Phase 3: Store Stroke IDs in Block Properties
**Effort**: 1 hour | **Impact**: HIGH - Enables matching

**File**: `src/lib/logseq-api.js`

#### 3.1 Update `createTranscriptBlockWithProperties()`

Find this function and add stroke-ids property:

```javascript
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
  
  // ... rest of existing code ...
}
```

#### 3.2 Update `updateTranscriptBlockWithPreservation()`

Ensure stroke IDs are updated when blocks are modified:

```javascript
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

### Phase 4: Implement Stroke ID Matching
**Effort**: 2-3 hours | **Impact**: HIGH - Proper merge handling

**File**: `src/lib/transcript-updater.js`

#### 4.1 Add Stroke ID Parsing Helper

Add at top of file:

```javascript
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
 * Merge two stroke ID sets
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

#### 4.2 Replace `detectBlockActions()` with Stroke ID Logic

Replace the existing function with this new implementation:

```javascript
/**
 * Detect what action to take for each transcription line
 * Uses STROKE ID MATCHING as primary strategy, Y-bounds as fallback
 * 
 * @param {Array} existingBlocks - Existing transcript blocks from LogSeq
 * @param {Array} newLines - New transcription lines (with strokeIds)
 * @param {Array} strokes - All strokes for fallback Y-bounds calculation
 * @returns {Promise<Array>} Array of action objects
 */
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  const consumedLineIndices = new Set();
  const usedBlockUuids = new Set();
  
  // Build stroke timestamp set for existence checks
  const currentStrokeTimestamps = new Set(strokes.map(s => String(s.startTime)));
  
  // STRATEGY 1: Match blocks by stroke ID overlap (preferred)
  for (const block of existingBlocks) {
    const blockStrokeIds = parseStrokeIds(block.properties?.['stroke-ids']);
    const blockBounds = parseYBounds(block.properties?.['stroke-y-bounds'] || '0-0');
    const mergedCount = parseInt(block.properties?.['merged-lines']) || 1;
    const storedCanonical = block.properties?.['canonical-transcript'] || '';
    
    // Find lines with overlapping stroke IDs
    let overlappingLines = [];
    
    if (blockStrokeIds.size > 0) {
      // Primary: Match by stroke IDs
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        if (line.strokeIds && strokeSetsOverlap(blockStrokeIds, line.strokeIds)) {
          const lineBounds = calculateLineBounds(line, strokes);
          overlappingLines.push({ line, index, bounds: lineBounds });
        }
      });
    }
    
    // Fallback: If no stroke ID matches, try Y-bounds (for edge cases)
    if (overlappingLines.length === 0 && blockStrokeIds.size === 0) {
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        const lineBounds = calculateLineBounds(line, strokes);
        if (boundsOverlap(blockBounds, lineBounds)) {
          overlappingLines.push({ line, index, bounds: lineBounds });
        }
      });
    }
    
    // Process matches
    if (overlappingLines.length === 0) {
      // No matches - check if block's strokes still exist
      const strokesExist = blockStrokeIds.size > 0 && 
        [...blockStrokeIds].some(id => currentStrokeTimestamps.has(id));
      
      if (strokesExist || blockStrokeIds.size === 0) {
        // Strokes exist OR legacy block - PRESERVE
        actions.push({
          type: 'PRESERVE',
          reason: strokesExist ? 'strokes-exist-no-new-lines' : 'legacy-block',
          blockUuid: block.uuid
        });
        usedBlockUuids.add(block.uuid);
      }
      // If strokes don't exist, block will be deleted later
      continue;
    }
    
    // Handle matched lines
    if (overlappingLines.length >= 1) {
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
        actions.push({
          type: overlappingLines.length > 1 ? 'SKIP_MERGED' : 'SKIP',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid,
          mergedCount: overlappingLines.length,
          consumedLines: overlappingLines.map(ol => ol.index)
        });
      } else {
        // Text changed - update
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
  }
  
  // STRATEGY 2: Create blocks for unconsumed lines (new content)
  newLines.forEach((line, index) => {
    if (consumedLineIndices.has(index)) return;
    
    const lineBounds = calculateLineBounds(line, strokes);
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
  
  return actions;
}
```

---

### Phase 5: Selective Transcription Mode (Optional Enhancement)
**Effort**: 1-2 hours | **Impact**: MEDIUM - Workflow improvement

This allows users to transcribe ONLY new strokes, skipping already-transcribed content.

**File**: `src/components/header/ActionBar.svelte`

#### 5.1 Add Helper to Detect New Strokes

```javascript
import { getTranscriptBlocks } from '$lib/logseq-api.js';

/**
 * Get strokes that aren't already in any transcription block
 * @param {Array} strokes - All strokes for a page
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {Promise<Array>} Strokes not yet transcribed
 */
async function getNewStrokes(strokes, book, page) {
  const { host, token } = getLogseqSettings();
  
  try {
    const existingBlocks = await getTranscriptBlocks(book, page, host, token);
    
    // Collect all stroke IDs from existing blocks
    const existingStrokeIds = new Set();
    existingBlocks.forEach(block => {
      const ids = block.properties?.['stroke-ids']?.split(',') || [];
      ids.forEach(id => existingStrokeIds.add(id.trim()));
    });
    
    // Filter to strokes not in any block
    return strokes.filter(stroke => 
      !existingStrokeIds.has(String(stroke.startTime))
    );
  } catch (error) {
    console.warn('Could not check existing blocks:', error);
    return strokes; // Fall back to all strokes
  }
}
```

#### 5.2 Add UI for Selective Transcription

```svelte
<!-- In the button section, replace single transcribe button with: -->

{#if $logseqConnected && $hasPageTranscriptions}
  <!-- Page has existing transcription - offer options -->
  <div class="transcribe-group">
    <button 
      class="action-btn transcribe-btn"
      on:click={handleTranscribeNew}
      disabled={!canTranscribe}
      title="Transcribe only new strokes (preserves existing blocks)"
    >
      <svg><!-- pen icon --></svg>
      {#if $isTranscribing}
        Transcribing...
      {:else}
        Transcribe New
      {/if}
    </button>
    
    <button 
      class="action-btn"
      on:click={handleRetranscribeAll}
      disabled={!canTranscribe}
      title="Re-transcribe all strokes (may update existing blocks)"
    >
      Re-transcribe All
    </button>
  </div>
{:else}
  <!-- No existing transcription - single button -->
  <button 
    class="action-btn transcribe-btn"
    on:click={handleTranscribe}
    disabled={!canTranscribe}
    title="Transcribe handwriting to text"
  >
    <svg><!-- pen icon --></svg>
    {#if $isTranscribing}
      Transcribing...
    {:else}
      Transcribe ({transcribeCount})
    {/if}
  </button>
{/if}
```

#### 5.3 Implement `handleTranscribeNew()`

```javascript
async function handleTranscribeNew() {
  if (!$hasMyScriptCredentials || !hasStrokes) return;
  
  setIsTranscribing(true);
  
  try {
    const { appKey, hmacKey } = getMyScriptCredentials();
    
    // Group strokes by page and filter to new strokes only
    const strokesByPage = new Map();
    // ... existing grouping code ...
    
    let totalNewStrokes = 0;
    const pagesToTranscribe = new Map();
    
    for (const [pageKey, pageData] of strokesByPage) {
      const { book, page, strokes: pageStrokes } = pageData;
      const newStrokes = await getNewStrokes(pageStrokes, book, page);
      
      if (newStrokes.length > 0) {
        pagesToTranscribe.set(pageKey, {
          ...pageData,
          strokes: newStrokes
        });
        totalNewStrokes += newStrokes.length;
      }
    }
    
    if (totalNewStrokes === 0) {
      log('No new strokes to transcribe', 'info');
      return;
    }
    
    log(`Transcribing ${totalNewStrokes} new strokes...`, 'info');
    
    // Transcribe only new strokes for each page
    for (const [pageKey, pageData] of pagesToTranscribe) {
      const result = await transcribeStrokes(pageData.strokes, appKey, hmacKey);
      
      // APPEND to existing transcription (don't replace)
      appendPageTranscription(pageKey, result, pageData.pageInfo);
      
      log(`✓ Added ${result.lines?.length || 0} new lines`, 'success');
    }
    
    setActiveTab('transcription');
    
  } catch (error) {
    log(`Transcription failed: ${error.message}`, 'error');
  } finally {
    setIsTranscribing(false);
  }
}
```

---

## Code Changes Summary

| File | Function/Section | Change Type | Priority |
|------|-----------------|-------------|----------|
| `src/lib/transcript-updater.js` | Orphan deletion (lines 280-305) | Replace | P1 - Critical |
| `src/lib/myscript-api.js` | `parseMyScriptResponse()` | Modify | P2 - High |
| `src/lib/myscript-api.js` | `transcribeStrokes()` | Modify | P2 - High |
| `src/lib/logseq-api.js` | `createTranscriptBlockWithProperties()` | Modify | P2 - High |
| `src/lib/logseq-api.js` | `updateTranscriptBlockWithPreservation()` | Modify | P2 - High |
| `src/lib/transcript-updater.js` | `detectBlockActions()` | Replace | P3 - High |
| `src/lib/transcript-updater.js` | Add helper functions | Add | P3 - High |
| `src/components/header/ActionBar.svelte` | Transcribe button section | Modify | P4 - Medium |
| `src/stores/transcription.js` | `appendPageTranscription()` | Add | P4 - Medium |

---

## Testing Plan

### Test Scenarios

#### Scenario 1: Basic Incremental Add
1. Write "Hello World" → Transcribe → Save ✅
2. Write "Goodbye Moon" below → Transcribe → Save
3. **Expected**: Both blocks exist, original preserved

#### Scenario 2: Merge Then Add
1. Write three lines → Transcribe → Save
2. Edit: Merge lines 1+2 → Save
3. Write new line → Transcribe → Save
4. **Expected**: Merged block preserved, new block created

#### Scenario 3: Edit Text Then Add
1. Write "Reveew document" → Transcribe → Save
2. Edit: Fix to "Review document" → Save
3. Write new line → Transcribe → Save
4. **Expected**: User's spelling fix preserved

#### Scenario 4: Delete Strokes
1. Write three lines → Transcribe → Save
2. Select middle strokes → Delete → Save
3. **Expected**: Middle block deleted, others preserved

#### Scenario 5: Selective Transcription
1. Write first half of page → Transcribe → Save
2. Write second half → Click "Transcribe New"
3. **Expected**: Only new strokes sent to MyScript

### Edge Cases

- [ ] Empty page (no strokes)
- [ ] Single stroke
- [ ] Very long merged block (5+ lines)
- [ ] Re-transcribe with no changes
- [ ] Transcribe → Delete all → Add new
- [ ] Multiple pages in single session

### Debug Logging

Add these console logs during testing:

```javascript
// In detectBlockActions()
console.log('Block matching:', {
  blockUuid: block.uuid,
  blockStrokeIds: [...blockStrokeIds],
  matchedLines: overlappingLines.length,
  action: action.type
});

// In orphan handling
console.log('Orphan check:', {
  blockUuid: block.uuid,
  strokesExist: strokesExist,
  decision: strokesExist ? 'PRESERVE' : 'DELETE'
});
```

---

## Appendix: Data Model Reference

### Block Properties Schema

```javascript
{
  'stroke-y-bounds': '45.2-68.7',           // Y coordinate range
  'canonical-transcript': 'Original text',   // MyScript output (normalized)
  'stroke-ids': '1706234567890,1706234567891', // Stroke timestamps
  'merged-lines': '2'                        // Count if merged (optional)
}
```

### Line Object Schema (from MyScript parser)

```javascript
{
  text: 'User visible text',
  canonical: 'normalized text',
  words: [...],                    // Word objects with bounding boxes
  strokeIds: Set(['1706234567890', '1706234567891']),  // NEW
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
  startTime: 1706234567890,        // ← Used as stroke ID
  endTime: 1706234568500,
  dotArray: [
    { x: 10.5, y: 20.3, f: 512, timestamp: 1706234567890 },
    // ...
  ]
}
```

---

## Document Status

- [x] Problem identified
- [x] Solution designed
- [x] Implementation guide written
- [x] Code examples provided
- [ ] Phase 1 implemented (safe orphan handling)
- [ ] Phase 2 implemented (stroke ID extraction)
- [ ] Phase 3 implemented (stroke ID storage)
- [ ] Phase 4 implemented (stroke ID matching)
- [ ] Phase 5 implemented (selective transcription)
- [ ] Testing complete
- [ ] Documentation updated

---

*Last updated: 2026-01-22*
