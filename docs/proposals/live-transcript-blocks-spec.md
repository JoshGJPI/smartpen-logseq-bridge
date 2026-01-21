# Live Transcript Blocks Specification

**Status:** PROPOSAL  
**Version:** 0.1.0  
**Created:** January 2025  
**Author:** Josh

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Implementation](#current-implementation)
3. [Pain Points & Motivation](#pain-points--motivation)
4. [Proposed Solution](#proposed-solution)
5. [Data Structure Design](#data-structure-design)
6. [Implementation Plan](#implementation-plan)
7. [Migration Strategy](#migration-strategy)
8. [Trade-offs & Considerations](#trade-offs--considerations)
9. [Alternative Approaches](#alternative-approaches)
10. [Success Criteria](#success-criteria)

---

## Executive Summary

### Problem

Currently, transcribed text is stored in a **single code block** under the "Transcribed Text" section in LogSeq pages. This creates workflow friction:

1. **Bulk updates required**: Any change to the transcript (checking off a task, fixing a typo, updating hierarchy) requires re-transcribing and re-saving the entire code block
2. **Manual hierarchy management**: Users must manually copy text from the code block into proper LogSeq blocks to leverage block-level features (tags, TODOs, references)
3. **Loss of granular control**: Cannot update individual lines without affecting the whole transcript
4. **Difficult incremental updates**: Adding new strokes requires regenerating and replacing the entire transcript

### Solution

Store each transcribed line in its own **live LogSeq block** with a **vertical bounds property** that links it back to specific strokes. This enables:

- **Granular updates**: Only re-transcribe and update blocks affected by new/changed strokes
- **Native LogSeq features**: Blocks can immediately use TODO markers, tags, block references without manual copying
- **Incremental workflow**: Add strokes → transcribe only new content → append to existing blocks or create new ones
- **Persistent mapping**: Always know which strokes correspond to which blocks via vertical bounds

### Key Innovation

Use **Y-coordinate ranges** (vertical bounds) as the primary mapping mechanism:

```javascript
// Block property format
{
  "stroke-y-bounds": "1234.56-1289.34"  // minY-maxY in Ncode units
}
```

This allows:
- Multiple wrapped lines consolidated into one block (same vertical band)
- Robust targeting when new strokes are added (fall within existing bounds → update that block)
- Simple collision detection (new strokes overlap multiple blocks → merge or split decision)

---

## Current Implementation

### Data Flow (Transcription → LogSeq)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. User selects strokes and clicks "Transcribe"                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. MyScript API Processing                                               │
│    - Strokes converted to MyScript format (pixels, pressure)            │
│    - API returns JIIX with text, words, bounding boxes                  │
│    - Label contains \n line breaks (trusted for line detection)         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Transcription Parsing (myscript-api.js)                              │
│    - Split text by \n to get lines                                      │
│    - Match words to lines by content                                    │
│    - Calculate indentation from word X positions                        │
│    - Build parent/child hierarchy based on indent levels                │
│    Result: { text, lines, words, commands }                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Store in Svelte Store (transcription.js)                             │
│    - lastTranscription = { text, lines, words, commands, ... }          │
│    - pageTranscriptions Map<pageKey, transcription>                     │
│    - Lines structure:                                                   │
│      {                                                                   │
│        text: "Meeting notes",                                           │
│        indentLevel: 0,                                                   │
│        x: 123.45,          // Leftmost word X position                  │
│        baseline: 234.56,   // Y position of line                        │
│        words: [...],       // Word objects with bounding boxes          │
│        parent: null,       // Parent line index (for hierarchy)         │
│        children: [1, 2]    // Child line indices                        │
│      }                                                                   │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. User clicks "Save to LogSeq"                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Update LogSeq (logseq-api.js::updatePageTranscription)               │
│    a. Get or create page "Smartpen Data/B{book}/P{page}"               │
│    b. Find and remove existing "## Transcribed Text" section           │
│    c. Create new "## Transcribed Text" parent block                    │
│    d. Add child block with code fence:                                  │
│       ```                                                                │
│       Meeting notes                                                     │
│         - Discussed roadmap                                             │
│         - Action items                                                  │
│       ```                                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Storage Format (Current)

**LogSeq Page Structure:**
```
# Smartpen Data/B3017/P42
book:: 3017
page:: 42

## Raw Stroke Data
```json
{
  "version": "1.0",
  "pageInfo": { ... },
  "metadata": { ... },
  "strokes": [ ... ]  // Or chunked format with multiple blocks
}
```

## Transcribed Text
```
Meeting notes
  - Discussed roadmap
  - Action items
```
```

### Code Locations

| File | Function | Purpose |
|------|----------|---------|
| `myscript-api.js` | `transcribeStrokes()` | Calls MyScript API, parses response into lines |
| `myscript-api.js` | `parseMyScriptResponse()` | Builds line objects with hierarchy |
| `logseq-api.js` | `updatePageTranscription()` | Writes transcript as code block to LogSeq |
| `stroke-storage.js` | `formatTranscribedText()` | Formats lines as plain text with indentation |
| `stores/transcription.js` | `setTranscription()` | Stores transcription result in app state |

---

## Pain Points & Motivation

### Current Workflow Friction

1. **All-or-nothing updates**
   - Example: You write 20 lines, transcribe, save to LogSeq
   - Later: You add 5 more lines or check off a task box
   - Problem: Must re-transcribe ALL 25 lines and replace entire code block
   - Impact: Wasted MyScript API calls, slow iteration

2. **Manual block conversion**
   - Transcript is "dead" text in a code block
   - To use LogSeq features (TODO, tags, references), you must:
     - Copy text from code block
     - Create new blocks
     - Paste and format manually
     - Now you have duplicate content (code block + live blocks)

3. **Hierarchy maintenance burden**
   - After initial transcription, you often refine the hierarchy
   - Example: Realize a sub-task should be promoted to top-level
   - Current: Edit code block text, re-save entire transcript
   - Desired: Just drag the block in LogSeq's native UI

4. **Loss of stroke → block mapping**
   - Once transcribed, there's no way to know which strokes produced which text
   - If you want to re-transcribe a portion, you must:
     - Figure out which strokes correspond to those lines
     - Manually select them in the canvas
     - Re-transcribe in isolation
   - No programmatic way to target updates

5. **Incremental additions are painful**
   - Add new strokes to an existing page
   - Want to transcribe just the new content
   - Problem: No way to merge with existing transcript
   - Must either:
     - Transcribe everything again (wasteful)
     - Manually append new text to code block (error-prone)

### Real-World Scenario

```
Day 1:
- Write 15 lines of meeting notes
- Transcribe, save to LogSeq
- Code block contains all 15 lines

Day 2:
- Review notes in LogSeq
- Check off 3 action items (add TODO DONE markers)
- Add 2 more sub-bullets under one section
- Realize one section should be moved to a different parent

Current approach:
1. Go back to canvas
2. Re-select all strokes
3. Transcribe all ~20 lines again
4. Manually merge your TODO markers and hierarchy changes
5. Replace code block
6. Lose any other manual edits you made

Desired approach:
1. Strokes for new lines are automatically detected
2. Only those 2 lines are transcribed
3. They're appended to the correct parent block based on vertical bounds
4. Your TODO markers and hierarchy changes are preserved
5. No re-transcription of existing content needed
```

---

## Proposed Solution

### Core Concept

Store each transcribed line in a **dedicated LogSeq block** with properties that link it back to the original strokes via **vertical bounds**.

### Vertical Bounds as the Key

**Why Y-coordinates?**
- Handwriting is inherently horizontal (left-to-right)
- Lines are vertically distinct bands
- Y-coordinates are stable across transcription runs
- Multiple wrapped lines naturally share the same vertical band
- New strokes can be easily categorized by their Y position

**Property format:**
```javascript
{
  "stroke-y-bounds": "1234.56-1289.34",  // minY-maxY in Ncode units
  "stroke-count": 15,                    // Number of strokes in this block
  "last-transcribed": 1738259200000      // Unix timestamp
}
```

### New LogSeq Page Structure

```
# Smartpen Data/B3017/P42
book:: 3017
page:: 42

## Raw Stroke Data
[...chunked stroke data blocks...]

## Transcribed Content
stroke-y-bounds:: 1000.0-1050.0
stroke-count:: 8
last-transcribed:: 1738259200000
- Meeting notes

stroke-y-bounds:: 1050.0-1075.0
stroke-count:: 5
last-transcribed:: 1738259200000
  - Discussed roadmap

stroke-y-bounds:: 1075.0-1100.0
stroke-count:: 7
last-transcribed:: 1738259200000
  - Action items
    stroke-y-bounds:: 1100.0-1125.0
    stroke-count:: 4
    last-transcribed:: 1738259200000
    - Follow up with design team
```

**Key observations:**
1. Each block has properties tracking its vertical bounds
2. Hierarchy is maintained naturally through LogSeq's block structure
3. Properties are on the blocks themselves (not children of blocks)
4. Indentation is reflected in the block nesting, not text formatting
5. Text is clean and directly editable

### Update Detection Algorithm

When new strokes are added or existing strokes modified:

```javascript
async function updateTranscriptBlocks(book, page, strokes, newTranscription) {
  // 1. Get existing transcript blocks from LogSeq
  const existingBlocks = await getTranscriptBlocks(book, page);
  
  // 2. Build vertical bounds map from existing blocks
  const blocksByBounds = existingBlocks.map(block => ({
    uuid: block.uuid,
    bounds: parseYBounds(block.properties['stroke-y-bounds']),
    content: block.content,
    children: block.children
  }));
  
  // 3. For each new transcribed line, determine update action
  const actions = newTranscription.lines.map(line => {
    const lineBounds = calculateLineBounds(line, strokes);
    
    // Find overlapping blocks
    const overlapping = blocksByBounds.filter(block => 
      boundsOverlap(block.bounds, lineBounds)
    );
    
    if (overlapping.length === 0) {
      // No overlap → new block
      return { type: 'CREATE', line, bounds: lineBounds };
      
    } else if (overlapping.length === 1) {
      // Single overlap → update existing
      const block = overlapping[0];
      if (block.content === line.text) {
        return { type: 'SKIP', reason: 'unchanged' };
      }
      return { 
        type: 'UPDATE', 
        uuid: block.uuid, 
        line, 
        bounds: lineBounds 
      };
      
    } else {
      // Multiple overlaps → merge decision needed
      return { 
        type: 'MERGE_CONFLICT', 
        blocks: overlapping, 
        line, 
        bounds: lineBounds 
      };
    }
  });
  
  // 4. Execute actions
  for (const action of actions) {
    switch (action.type) {
      case 'CREATE':
        await createTranscriptBlock(action.line, action.bounds);
        break;
      case 'UPDATE':
        await updateTranscriptBlock(action.uuid, action.line, action.bounds);
        break;
      case 'MERGE_CONFLICT':
        await handleMergeConflict(action);
        break;
    }
  }
  
  // 5. Handle deletions (existing blocks with no matching new content)
  // ... implementation details
}
```

### Calculating Line Bounds

```javascript
function calculateLineBounds(line, strokes) {
  // Get all strokes that contributed to this line's words
  const lineStrokeIds = new Set();
  
  // MyScript returns stroke IDs for each word
  line.words.forEach(word => {
    if (word.strokeIds) {
      word.strokeIds.forEach(id => lineStrokeIds.add(id));
    }
  });
  
  // Filter strokes to only those in this line
  const lineStrokes = strokes.filter(s => 
    lineStrokeIds.has(generateStrokeId(s))
  );
  
  if (lineStrokes.length === 0) {
    // Fallback: estimate from word bounding boxes
    const wordBounds = line.words.map(w => w['bounding-box']);
    const minY = Math.min(...wordBounds.map(b => b.y));
    const maxY = Math.max(...wordBounds.map(b => b.y + b.height));
    return { minY, maxY };
  }
  
  // Calculate Y bounds from actual strokes
  let minY = Infinity;
  let maxY = -Infinity;
  
  lineStrokes.forEach(stroke => {
    stroke.dotArray.forEach(dot => {
      minY = Math.min(minY, dot.y);
      maxY = Math.max(maxY, dot.y);
    });
  });
  
  // Add small padding to account for pen variance
  const padding = 50; // Ncode units (≈ 0.12mm)
  
  return { 
    minY: minY - padding, 
    maxY: maxY + padding 
  };
}
```

---

## Data Structure Design

### MyScript Enhancement

MyScript's JIIX format already includes stroke IDs in words:

```javascript
{
  "words": [
    {
      "label": "Hello",
      "bounding-box": { "x": 10, "y": 5, "width": 45, "height": 12 },
      "items": [
        { "timestamp": "...", "X": [1, 2], "Y": [3, 4] }
      ]
    }
  ]
}
```

However, we need to **explicitly request stroke-level data** in the export configuration:

```javascript
// In myscript-api.js buildRequest()
configuration: {
  export: {
    jiix: {
      'bounding-box': true,
      strokes: true,           // Request stroke data in response
      'stroke-id': true,       // Include stroke IDs in words
      text: { 
        chars: true, 
        words: true 
      }
    }
  }
}
```

This will allow us to map words → strokes → Y bounds reliably.

### Enhanced Line Object

```javascript
// In transcription store
{
  text: "Meeting notes",
  indentLevel: 0,
  x: 123.45,
  baseline: 234.56,
  words: [...],           // Word objects with bounding boxes
  parent: null,
  children: [1, 2],
  
  // NEW: Stroke mapping
  strokeIds: new Set([    // IDs of strokes that formed this line
    "s1738259100123",
    "s1738259100234",
    // ...
  ]),
  yBounds: {              // Vertical extent in Ncode coordinates
    minY: 1234.56,
    maxY: 1289.34
  },
  
  // NEW: LogSeq mapping (after save)
  blockUuid: "abc-123-def-456",  // UUID of corresponding LogSeq block
  syncStatus: "clean" | "modified" | "unsaved"
}
```

### LogSeq Block Properties

```javascript
// Block property format (stored in LogSeq)
{
  "stroke-y-bounds": "1234.56-1289.34",     // minY-maxY
  "stroke-count": 8,                        // Number of strokes
  "stroke-ids": "s1738259100123,s1738259100234,...",  // Optional: explicit list
  "last-transcribed": 1738259200000,        // Timestamp of last update
  "transcription-version": "1.0"            // Schema version
}
```

**Note:** LogSeq stores properties in the block's properties map, not as child blocks:

```clojure
{:block/uuid #uuid "abc-123-def-456"
 :block/content "Meeting notes"
 :block/properties {"stroke-y-bounds" "1234.56-1289.34"
                    "stroke-count" 8}}
```

### Metadata Block

Add a metadata summary under "## Transcribed Content":

```
## Transcribed Content
transcription-date:: 2025-01-20
transcription-source:: myscript-v2.0
total-lines:: 15
total-strokes:: 127
coverage:: 100%  (all strokes transcribed)
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Goal:** Enhance transcription parsing to track stroke IDs and Y bounds

**Tasks:**
1. **Update MyScript API request** (`myscript-api.js`)
   - Add `stroke-id: true` to export configuration
   - Verify response includes stroke data in JIIX

2. **Enhance line parsing** (`parseMyScriptResponse()`)
   - Extract stroke IDs from word items
   - Calculate Y bounds from stroke IDs
   - Store in line object: `{ strokeIds, yBounds }`

3. **Update transcription store** (`stores/transcription.js`)
   - Extend line type to include new fields
   - Add helper functions: `getLineByBounds()`, `getLinesInBounds()`

4. **Add stroke ID mapping utility** (`lib/stroke-storage.js`)
   ```javascript
   export function mapStrokesToLines(strokes, transcription) {
     // Build Map<strokeId, lineIndex>
   }
   
   export function calculateLineBounds(line, strokes) {
     // Compute { minY, maxY } from stroke IDs
   }
   ```

5. **Testing**
   - Verify stroke IDs are correctly extracted
   - Verify Y bounds match visual stroke positions
   - Test with various handwriting styles (tight lines, loose lines)

### Phase 2: LogSeq Integration (Week 2)

**Goal:** Implement live block creation and updates

**Tasks:**
1. **New API functions** (`logseq-api.js`)
   ```javascript
   // Get existing transcript blocks (with properties)
   async function getTranscriptBlocks(book, page)
   
   // Create block with properties
   async function createTranscriptBlock(parentUuid, content, properties)
   
   // Update block content and properties
   async function updateTranscriptBlock(uuid, content, properties)
   
   // Build block hierarchy (parent/child relationships)
   async function buildBlockHierarchy(lines, parentUuid)
   ```

2. **Update detection algorithm** (`lib/transcript-updater.js` - new file)
   ```javascript
   export async function updateTranscriptBlocks(book, page, strokes, transcription) {
     // Main orchestrator (see algorithm above)
   }
   
   function detectBlockActions(existingBlocks, newLines, strokes) {
     // Determine CREATE/UPDATE/SKIP/MERGE for each line
   }
   
   async function handleMergeConflict(conflict) {
     // Strategy for overlapping bounds (user prompt or auto-merge)
   }
   ```

3. **Replace old transcription save** 
   - Keep `updatePageTranscription()` for backward compatibility
   - Add new `updatePageTranscriptionLive()` function
   - Add setting toggle: "Use live blocks (experimental)"

4. **Testing**
   - Create simple page with 5 lines → verify blocks created
   - Add 3 new lines → verify only 3 new blocks added
   - Modify middle line → verify only that block updated
   - Delete strokes → verify orphaned blocks handling

### Phase 3: UI/UX (Week 3)

**Goal:** Surface the stroke → block mapping in the UI

**Tasks:**
1. **Transcription view enhancements** (`TranscriptionView.svelte`)
   - Show Y bounds for each line
   - Color-code lines by sync status
   - Add "Update blocks" button (vs "Save to LogSeq")

2. **Block status indicators**
   ```svelte
   <div class="line-card" class:clean class:modified class:unsaved>
     <div class="line-header">
       <span class="y-bounds">Y: {line.yBounds.minY.toFixed(0)}-{line.yBounds.maxY.toFixed(0)}</span>
       <span class="stroke-count">{line.strokeIds.size} strokes</span>
       <span class="sync-status">{line.syncStatus}</span>
     </div>
     <div class="line-content">{line.text}</div>
   </div>
   ```

3. **Canvas visualization**
   - Draw horizontal bands showing Y bounds of each line
   - Highlight strokes when hovering over corresponding line in UI
   - Click line → select all strokes in that Y band

4. **Conflict resolution UI**
   - When bounds overlap multiple blocks, show dialog
   - Options: "Merge into first", "Split into new block", "Manual review"

5. **Testing**
   - User testing with real handwriting samples
   - Edge cases: very tight lines, diagonal writing, large gaps

### Phase 4: Migration & Polish (Week 4)

**Goal:** Migrate existing code-block transcripts and production-ready polish

**Tasks:**
1. **Migration script** (`lib/transcript-migration.js`)
   ```javascript
   export async function migrateCodeBlockToLiveBlocks(book, page) {
     // 1. Read existing code block transcript
     // 2. Re-transcribe strokes to get Y bounds
     // 3. Create live blocks with properties
     // 4. Archive old code block (move to ## Archived Transcripts)
     // 5. Validate: all text preserved, hierarchy matches
   }
   
   export async function migrateAllPages(progressCallback) {
     // Batch migration for all pages with code blocks
   }
   ```

2. **Migration UI** (new dialog)
   - Scan LogSeq for pages with old format
   - Show list of candidates
   - Bulk or individual migration
   - Progress tracking and rollback option

3. **Backward compatibility**
   - Reading: Support both formats (detect which to use)
   - Writing: User preference for format (toggle in settings)
   - Validation: Ensure old code still works if feature disabled

4. **Error handling**
   - Handle missing stroke data gracefully
   - Recover from failed block updates (retry logic)
   - Warn when Y bounds have high overlap (tight handwriting)

5. **Documentation**
   - Update `app-specification.md` with new format
   - Add migration guide for existing users
   - Document properties schema

6. **Testing**
   - Migration of 10+ real pages
   - Performance testing (100+ line documents)
   - Edge case validation

---

## Migration Strategy

### Automated Migration

```javascript
// Pseudo-code for migration process

async function migratePageTranscript(book, page) {
  // Step 1: Validate prerequisites
  const strokeData = await getPageStrokes(book, page);
  if (!strokeData) {
    throw new Error('Cannot migrate: no stroke data found');
  }
  
  const existingTranscript = await getExistingTranscription(book, page);
  if (!existingTranscript) {
    return { status: 'skipped', reason: 'no transcript to migrate' };
  }
  
  // Step 2: Re-transcribe to get stroke mappings
  const strokes = transformStoredToCanvasFormat(strokeData);
  const transcription = await transcribeStrokes(strokes, appKey, hmacKey);
  
  // Step 3: Calculate Y bounds for each line
  const linesWithBounds = transcription.lines.map(line => ({
    ...line,
    yBounds: calculateLineBounds(line, strokes),
    strokeIds: extractStrokeIds(line, strokes)
  }));
  
  // Step 4: Create live blocks
  const pageObj = await getOrCreateSmartpenPage(book, page);
  
  // Remove old transcript section (keep as backup first)
  await archiveOldTranscript(pageObj.name, existingTranscript);
  
  // Create new "## Transcribed Content" section
  const parentBlock = await createBlock(pageObj.name, "## Transcribed Content");
  
  // Build block hierarchy
  const blockMap = await buildBlockHierarchy(linesWithBounds, parentBlock.uuid);
  
  // Step 5: Validate migration
  const newTranscript = await getTranscriptBlocks(book, page);
  const validation = validateMigration(existingTranscript, newTranscript);
  
  if (!validation.success) {
    // Rollback
    await rollbackMigration(book, page);
    throw new Error(`Migration validation failed: ${validation.errors.join(', ')}`);
  }
  
  return { 
    status: 'success', 
    linesCreated: blockMap.size,
    validation 
  };
}
```

### Manual Migration (User-Driven)

1. **Scan for candidates**
   ```javascript
   const pages = await scanLogSeqPages();
   const candidatesForMigration = pages.filter(p => 
     p.transcriptionText !== null &&  // Has old code block
     !p.hasLiveBlocks                 // Doesn't have new format
   );
   ```

2. **Migration dialog**
   - Show list of pages with old format
   - Checkbox to select which to migrate
   - Preview diff (old vs new)
   - "Migrate Selected" button

3. **Rollback option**
   - Keep archived copy in "## Archived Transcripts" section
   - Button to restore from archive if needed

### Fallback Compatibility

Support **reading both formats** to avoid breaking existing workflows:

```javascript
async function getPageTranscription(book, page) {
  const blocks = await getPageBlocksTree(pageName);
  
  // Try new format first
  const liveBlocks = findBlockByHeading(blocks, "Transcribed Content");
  if (liveBlocks && hasLiveBlockProperties(liveBlocks)) {
    return parseLiveBlocks(liveBlocks);
  }
  
  // Fall back to old format
  const codeBlock = findBlockByHeading(blocks, "Transcribed Text");
  if (codeBlock) {
    return parseCodeBlock(codeBlock);
  }
  
  return null;
}
```

---

## Trade-offs & Considerations

### Advantages

| Benefit | Description |
|---------|-------------|
| **Granular updates** | Only re-transcribe and update affected lines |
| **Native features** | Blocks immediately support TODO, tags, references |
| **Incremental workflow** | Add strokes → transcribe new → append seamlessly |
| **Persistent mapping** | Always know which strokes → which blocks |
| **User control** | Edit blocks in LogSeq, preserve changes during updates |
| **Better visualization** | Y-bounds enable stroke highlighting in canvas |
| **Reduced API calls** | Only transcribe new content, not entire page |

### Disadvantages

| Challenge | Impact | Mitigation |
|-----------|--------|------------|
| **Complexity** | More moving parts, more code to maintain | Phased rollout, thorough testing |
| **Migration burden** | Users must migrate existing pages | Automated script, clear documentation |
| **Block proliferation** | Pages with many lines get crowded | Collapsible parent blocks, filtering |
| **Y-bound collisions** | Tight handwriting may overlap bounds | Generous padding, conflict resolution UI |
| **MyScript API changes** | Requires stroke-id export (not default) | Fallback to word bounding boxes |
| **Performance** | More API calls to LogSeq (block-by-block) | Batch operations, caching |

### Risk Mitigation

1. **Feature flag**: Add `USE_LIVE_BLOCKS` setting (default: false during beta)
2. **Fallback**: Always support reading old code-block format
3. **Validation**: Automated checks that migration preserved all content
4. **Rollback**: Keep archived copies, easy restore mechanism
5. **Testing**: Extensive testing with real handwriting before GA

---

## Alternative Approaches

### Alternative 1: Block-per-word (Rejected)

**Concept:** Create a LogSeq block for each individual word.

**Pros:**
- Maximum granularity
- Could support inline edits

**Cons:**
- Excessive block count (100 words = 100 blocks)
- LogSeq UI becomes unusable
- Breaks natural sentence flow
- Hierarchy becomes nonsensical

**Verdict:** Too granular, hurts usability

### Alternative 2: Hybrid Code Block + Live Blocks (Considered)

**Concept:** Keep code block as "source of truth", but also maintain live blocks.

**Pros:**
- Backward compatible
- Always have readable plain text

**Cons:**
- Duplicate content (sync drift issues)
- Unclear which is authoritative
- More storage, more complexity

**Verdict:** Adds complexity without clear benefit

### Alternative 3: Stroke ID Properties Only (No Y-Bounds) (Rejected)

**Concept:** Use explicit stroke ID lists instead of Y-bounds.

**Pros:**
- Precise mapping (no ambiguity)
- Handles diagonal or scattered strokes

**Cons:**
- Stroke ID lists get very long (15 strokes = 300 char property)
- Property size limits in LogSeq
- Can't handle wrapped lines easily (must list all stroke IDs)
- Harder to target new strokes (can't just check Y position)

**Verdict:** Y-bounds are simpler and more robust for typical use cases

### Alternative 4: External Database (Rejected)

**Concept:** Store stroke → block mappings in a separate database (SQLite, IndexedDB).

**Pros:**
- No LogSeq property pollution
- Arbitrary metadata possible
- Fast queries

**Cons:**
- Data split across two systems
- Sync and backup complexity
- Loses "single source of truth" in LogSeq
- Defeats purpose (keep everything in LogSeq)

**Verdict:** Against design philosophy of LogSeq-first storage

---

## Success Criteria

### Functional Requirements

- ✅ All existing transcription features work with live blocks
- ✅ Incremental updates only modify affected blocks
- ✅ Y-bounds correctly identify which strokes belong to which blocks
- ✅ Hierarchy is preserved in LogSeq block structure
- ✅ Users can edit blocks in LogSeq without breaking mapping
- ✅ Migration script successfully converts all test pages

### Performance Requirements

- ✅ Block updates complete in <2s for typical pages (<50 lines)
- ✅ No regressions in canvas rendering speed
- ✅ Migration completes in <5s per page

### UX Requirements

- ✅ Clear visual indication of sync status (clean/modified/unsaved)
- ✅ Conflict resolution is intuitive (clear options, no data loss)
- ✅ Migration process is one-click for most users
- ✅ Rollback option is easily accessible

### Quality Requirements

- ✅ No data loss during migration (validated programmatically)
- ✅ Backward compatibility: can read old format indefinitely
- ✅ Error recovery: failed updates don't corrupt page
- ✅ Test coverage: 80%+ for new modules

---

## Next Steps

### Immediate Actions

1. **Prototype vertical bounds calculation**
   - Test with 5 sample pages of varying complexity
   - Measure accuracy of Y-bound targeting
   - Identify edge cases

2. **Spike: MyScript stroke ID export**
   - Verify JIIX includes stroke IDs when requested
   - Test mapping words → strokes → Y-bounds
   - Document any API limitations

3. **Design review**
   - Share this spec with stakeholders
   - Gather feedback on approach
   - Identify additional edge cases

### Future Considerations

1. **Temporal features integration**
   - Y-bounds enable temporal analysis (when was each line written?)
   - Could add `writing-time` property to blocks
   - Supports chronological vs spatial ordering

2. **Multi-page transcription**
   - Current: One page at a time
   - Future: Transcribe multiple pages, route to appropriate parent blocks
   - Y-bounds work within each page's coordinate space

3. **Collaborative editing**
   - Multiple users editing same LogSeq graph
   - Y-bounds allow merging edits from different sources
   - Conflict resolution at line granularity

4. **Export formats**
   - Could export to Markdown with YAML frontmatter
   - Y-bounds metadata preserved for re-import
   - Enables backup/restore workflows

---

## Appendix

### Y-Bounds Example Data

```javascript
// Sample page with 5 lines of handwriting
const exampleLines = [
  {
    text: "Meeting Notes - Q1 Planning",
    yBounds: { minY: 1000, maxY: 1050 },  // ~0.12mm band
    strokeIds: new Set(["s1738259100123", "s1738259100145", ...]),
    strokeCount: 12
  },
  {
    text: "Discussed roadmap priorities",
    yBounds: { minY: 1075, maxY: 1125 },  // 25 Ncode gap between lines
    strokeIds: new Set(["s1738259100234", ...]),
    strokeCount: 8,
    indentLevel: 1  // Indented child
  },
  {
    text: "Need feedback from design team",
    yBounds: { minY: 1125, maxY: 1175 },
    strokeIds: new Set(["s1738259100345", ...]),
    strokeCount: 10,
    indentLevel: 1
  },
  {
    text: "Action Items",
    yBounds: { minY: 1200, maxY: 1250 },  // Larger gap (new section)
    strokeIds: new Set(["s1738259100456", ...]),
    strokeCount: 5
  },
  {
    text: "Schedule follow-up meeting",
    yBounds: { minY: 1250, maxY: 1300 },
    strokeIds: new Set(["s1738259100567", ...]),
    strokeCount: 9,
    indentLevel: 1
  }
];
```

### LogSeq API Snippets

```javascript
// Create block with properties
const block = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
  pageName,
  "Meeting notes",
  { 
    properties: {
      'stroke-y-bounds': '1000.0-1050.0',
      'stroke-count': 12,
      'last-transcribed': Date.now()
    }
  }
]);

// Update block properties (preserving content)
await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
  blockUuid,
  'stroke-y-bounds',
  '1000.0-1055.0'  // Updated bounds
]);

// Query blocks by property
const results = await makeRequest(host, token, 'logseq.DB.datascriptQuery', [
  `[:find (pull ?b [:block/uuid :block/content :block/properties])
    :where 
    [?b :block/properties ?props]
    [(get ?props "stroke-y-bounds") ?bounds]]`
]);
```

---

**END OF SPECIFICATION**
