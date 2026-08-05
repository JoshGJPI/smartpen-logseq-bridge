# Live Transcript Blocks Specification (Updated)

**Status:** PROPOSAL  
**Version:** 0.2.0  
**Created:** January 2025  
**Updated:** January 2025 (checkbox preservation + simplified properties)

---

## Executive Summary

Store each transcribed line in a **live LogSeq block** with **vertical bounds** and **canonical transcript** properties. This enables granular updates, native LogSeq features, and preservation of user edits (checked tasks, tags, typos fixed, etc.).

### Key Properties

```javascript
{
  "stroke-y-bounds": "1234.56-1289.34",        // Y-coordinate range in Ncode units
  "canonical-transcript": "☐ Review mockups"  // Normalized MyScript output
}
```

**Why these two properties?**

1. **stroke-y-bounds**: Maps block to specific strokes by vertical position
2. **canonical-transcript**: Detects actual transcript changes vs user edits

---

## Critical Innovation: Checkbox Preservation

### The Problem

Without proper handling, user edits get destroyed:

```
1. Write strokes: ☐ Review design mockups
2. MyScript transcribes: "☐ Review design mockups"
3. Create block: "TODO Review design mockups"
4. User checks it off: "DONE Review design mockups"
5. Re-transcribe same strokes: MyScript still returns "☐ Review design mockups"
6. Naive comparison sees: "DONE..." ≠ "☐..." → triggers UPDATE
7. User's DONE status gets overwritten back to TODO! 😱
```

### The Solution

Store what **MyScript returned** (canonical transcript) separately from **user-editable block content**:

```javascript
// LogSeq block structure
{
  uuid: "abc-123",
  content: "DONE Review design mockups #design @sarah",  // User can edit freely
  properties: {
    "stroke-y-bounds": "1234.56-1289.34",
    "canonical-transcript": "[ ] Review design mockups"  // Normalized MyScript output
  }
}
```

**Update detection:**
- Compare new transcript against `canonical-transcript` property (NOT block content)
- If canonical unchanged → SKIP update (preserve user edits)
- If canonical changed → UPDATE (try to preserve TODO/DONE markers)

---

## Properties Schema

### Minimal Property Set

```javascript
{
  "stroke-y-bounds": "1234.56-1289.34",        // Required: Y-coordinate range
  "canonical-transcript": "[ ] Review mockups" // Required: Normalized transcript
}
```

**Removed properties:**
- ❌ `stroke-count` - Not needed for update detection (purely informational)
- ❌ `last-transcribed` - Timestamp not used in algorithm
- ❌ `transcription-version` - Schema version unnecessary for simple structure

### Example LogSeq Page

```
# Smartpen Data/B3017/P42
book:: 3017
page:: 42

## Raw Stroke Data
[...chunked stroke data...]

## Transcribed Content

stroke-y-bounds:: 1000.0-1050.0
canonical-transcript:: Meeting notes - Q1 Planning
- Meeting notes - Q1 Planning

stroke-y-bounds:: 1075.0-1125.0
canonical-transcript:: [ ] Discussed roadmap priorities
  - TODO Discussed roadmap priorities

stroke-y-bounds:: 1125.0-1175.0
canonical-transcript:: [x] Need feedback from design team
  - DONE Need feedback from design team #design @sarah

stroke-y-bounds:: 1200.0-1250.0
canonical-transcript:: Action Items
- Action Items

stroke-y-bounds:: 1250.0-1300.0
canonical-transcript:: [ ] Schedule follow-up meeting
  - TODO Schedule follow-up meeting
```

---

## Checkbox Normalization

### Input Symbols → Canonical Form

```javascript
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')     // Empty checkbox
    .replace(/☑/g, '[x]')     // Checked (variant 1)
    .replace(/☒/g, '[x]')     // Checked (variant 2)
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}
```

### Canonical Form → LogSeq Markers

```javascript
function convertToLogSeqBlock(transcribedLine) {
  let text = transcribedLine.text;
  const canonical = normalizeTranscript(text);
  
  // Convert checkbox symbols to LogSeq markers
  if (canonical.match(/^\s*\[\s*\]/)) {
    // Empty checkbox → TODO
    text = text.replace(/^[\s☐\[\s\]]+/, 'TODO ');
  } else if (canonical.match(/^\s*\[x\]/i)) {
    // Checked box → DONE
    text = text.replace(/^[\s☑☒\[x\]]+/i, 'DONE ');
  }
  
  return {
    content: text,
    properties: {
      'stroke-y-bounds': formatBounds(transcribedLine.yBounds),
      'canonical-transcript': canonical
    }
  };
}
```

---

## Update Detection Algorithm

### Core Logic

```javascript
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  
  for (const line of newLines) {
    const lineBounds = calculateLineBounds(line, strokes);
    const newCanonical = normalizeTranscript(line.text);
    
    // Find blocks with overlapping Y-bounds
    const overlapping = existingBlocks.filter(block => 
      boundsOverlap(parseYBounds(block.properties['stroke-y-bounds']), lineBounds)
    );
    
    if (overlapping.length === 0) {
      // No overlap → new block
      actions.push({
        type: 'CREATE',
        line,
        bounds: lineBounds,
        canonical: newCanonical
      });
      
    } else if (overlapping.length === 1) {
      // Single overlap → check if transcript actually changed
      const block = overlapping[0];
      const storedCanonical = block.properties['canonical-transcript'];
      
      if (storedCanonical === newCanonical) {
        // Transcript unchanged → preserve ALL user edits
        actions.push({
          type: 'SKIP',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid
        });
      } else {
        // Transcript changed → update needed
        actions.push({
          type: 'UPDATE',
          blockUuid: block.uuid,
          line,
          bounds: lineBounds,
          canonical: newCanonical,
          oldContent: block.content,
          preserveMarkers: true
        });
      }
      
    } else {
      // Multiple overlaps → conflict
      actions.push({
        type: 'MERGE_CONFLICT',
        blocks: overlapping,
        line,
        bounds: lineBounds,
        canonical: newCanonical
      });
    }
  }
  
  return actions;
}
```

### Preserving Markers During Updates

When transcript actually changes, try to preserve user's TODO/DONE status:

```javascript
function updateBlockWithPreservation(oldContent, newTranscript) {
  // Extract current TODO/DONE marker
  let marker = null;
  if (oldContent.match(/^\s*TODO\s/)) marker = 'TODO';
  if (oldContent.match(/^\s*DONE\s/)) marker = 'DONE';
  
  // Convert new transcript to LogSeq format
  let newContent = convertCheckboxToMarker(newTranscript);
  
  // If user had TODO/DONE and new content also starts with TODO, preserve user's choice
  if (marker && newContent.match(/^\s*TODO\s/)) {
    newContent = newContent.replace(/^\s*TODO\s/, `${marker} `);
  }
  
  return newContent;
}

function convertCheckboxToMarker(text) {
  const canonical = normalizeTranscript(text);
  
  if (canonical.match(/^\s*\[\s*\]/)) {
    return text.replace(/^[\s☐\[\s\]]+/, 'TODO ');
  } else if (canonical.match(/^\s*\[x\]/i)) {
    return text.replace(/^[\s☑☒\[x\]]+/i, 'DONE ');
  }
  
  return text;
}
```

---

## Update Scenarios

### Scenario 1: User Checks Off Task

```
Initial state:
  Strokes: ☐ Task
  Canonical: "[ ] Task"
  Block content: "TODO Task"

User edits in LogSeq:
  Block content: "DONE Task"
  (canonical property unchanged)

Re-transcribe same strokes:
  MyScript returns: "☐ Task"
  New canonical: "[ ] Task"
  
Comparison:
  Stored canonical: "[ ] Task"
  New canonical: "[ ] Task"
  → MATCH! Skip update ✅

Result:
  Block content remains: "DONE Task"
  User's check-off preserved ✅
```

### Scenario 2: User Adds Tags

```
Initial state:
  Strokes: ☐ Task
  Canonical: "[ ] Task"
  Block content: "TODO Task"

User edits in LogSeq:
  Block content: "TODO Task #urgent @john"
  (canonical property unchanged)

Re-transcribe same strokes:
  MyScript returns: "☐ Task"
  New canonical: "[ ] Task"
  
Comparison:
  Stored canonical: "[ ] Task"
  New canonical: "[ ] Task"
  → MATCH! Skip update ✅

Result:
  Block content remains: "TODO Task #urgent @john"
  User's additions preserved ✅
```

### Scenario 3: User Fixes Typo

```
Initial state:
  Strokes: ☐ Reveiw design
  Canonical: "[ ] Reveiw design"
  Block content: "TODO Reveiw design"

User edits in LogSeq:
  Block content: "TODO Review design" (fixed typo)
  (canonical property unchanged)

Re-transcribe same strokes:
  MyScript returns: "☐ Reveiw design" (still wrong)
  New canonical: "[ ] Reveiw design"
  
Comparison:
  Stored canonical: "[ ] Reveiw design"
  New canonical: "[ ] Reveiw design"
  → MATCH! Skip update ✅

Result:
  Block content remains: "TODO Review design"
  User's correction preserved ✅
```

### Scenario 4: New Strokes Added

```
Initial state:
  Strokes: ☐ Task
  Canonical: "[ ] Task"
  Block content: "DONE Task"

User adds more handwriting:
  Strokes: ☐ Task - update mockups

Re-transcribe:
  MyScript returns: "☐ Task - update mockups"
  New canonical: "[ ] Task - update mockups"
  
Comparison:
  Stored canonical: "[ ] Task"
  New canonical: "[ ] Task - update mockups"
  → DIFFERENT! Update needed ✅

Preservation logic:
  Old content: "DONE Task"
  New transcript: "☐ Task - update mockups"
  → Converts to: "TODO Task - update mockups"
  → Sees old had "DONE", preserves it
  → Final: "DONE Task - update mockups" ✅

Result:
  Block content: "DONE Task - update mockups"
  Canonical updated: "[ ] Task - update mockups"
  User's DONE status preserved ✅
```

---

## LogSeq Block Update Operations

### Creating New Blocks

```javascript
async function createTranscriptBlock(parentUuid, line, host, token) {
  const { content, properties } = convertToLogSeqBlock(line);
  
  // Single API call creates block with content AND properties
  const block = await makeRequest(host, token, 'logseq.Editor.insertBlock', [
    parentUuid,
    content,
    {
      sibling: false,
      properties: properties
    }
  ]);
  
  return block;
}
```

### Updating Existing Blocks

LogSeq requires separate operations for content vs properties:

```javascript
async function updateTranscriptBlock(blockUuid, newLine, oldContent, host, token) {
  const newCanonical = normalizeTranscript(newLine.text);
  const newContent = updateBlockWithPreservation(oldContent, newLine.text);
  const newBounds = formatBounds(newLine.yBounds);
  
  // 1. Update block content
  await makeRequest(host, token, 'logseq.Editor.updateBlock', [
    blockUuid,
    newContent
  ]);
  
  // 2. Upsert properties (preserves any other properties user may have added)
  await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
    blockUuid,
    'stroke-y-bounds',
    newBounds
  ]);
  
  await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
    blockUuid,
    'canonical-transcript',
    newCanonical
  ]);
  
  // Note: upsertBlockProperty preserves existing properties
  // Only updates the specific properties we're changing
}
```

**Alternative: Batch Property Updates**

If LogSeq supports batch property updates, we could optimize:

```javascript
// Check if this is available in LogSeq API
async function updateBlockPropertiesBatch(blockUuid, properties, host, token) {
  // Hypothetical batch operation
  await makeRequest(host, token, 'logseq.Editor.updateBlockProperties', [
    blockUuid,
    properties  // { 'stroke-y-bounds': '...', 'canonical-transcript': '...' }
  ]);
}
```

### Retrieving Existing Blocks

```javascript
async function getTranscriptBlocks(book, page, host, token) {
  const pageName = formatPageName(book, page);
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
  
  // Find "Transcribed Content" section
  const contentBlock = blocks.find(b => 
    b.content && b.content.includes('## Transcribed Content')
  );
  
  if (!contentBlock || !contentBlock.children) {
    return [];
  }
  
  // Parse child blocks (actual transcript lines)
  return contentBlock.children.map(block => ({
    uuid: block.uuid,
    content: block.content,
    properties: block.properties || {},
    children: block.children || []
  }));
}
```

---

## Enhanced Line Object

Store normalized canonical form alongside raw MyScript output:

```javascript
{
  // Original MyScript fields
  text: "☐ Review design mockups",
  indentLevel: 0,
  x: 123.45,
  baseline: 234.56,
  words: [...],
  parent: null,
  children: [1, 2],
  
  // NEW: Stroke mapping
  strokeIds: new Set([
    "s1738259100123",
    "s1738259100234"
  ]),
  yBounds: {
    minY: 1234.56,
    maxY: 1289.34
  },
  
  // NEW: Canonical form
  canonical: "[ ] Review design mockups",  // Normalized for comparison
  
  // NEW: LogSeq mapping (after save)
  blockUuid: "abc-123-def-456",
  syncStatus: "clean" | "modified" | "unsaved"
}
```

---

## Implementation Changes

### File: `myscript-api.js`

**Function: `parseMyScriptResponse()`**

Add canonical transcript generation:

```javascript
function parseMyScriptResponse(response) {
  // ... existing parsing logic ...
  
  const lines = labelLines.map((lineText, lineIdx) => {
    // ... existing line building ...
    
    return {
      text: lineText,
      canonical: normalizeTranscript(lineText),  // NEW: Add canonical form
      indentLevel: /* ... */,
      x: /* ... */,
      baseline: /* ... */,
      words: lineWords,
      parent: null,
      children: []
    };
  });
  
  // ... rest of function ...
}

// NEW: Normalization function
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')
    .replace(/☑/g, '[x]')
    .replace(/☒/g, '[x]')
    .replace(/\s+/g, ' ')
    .trim();
}
```

### File: `logseq-api.js`

**New function: `createTranscriptBlockWithProperties()`**

```javascript
export async function createTranscriptBlockWithProperties(parentUuid, line, host, token) {
  const canonical = normalizeTranscript(line.text);
  const content = convertCheckboxToMarker(line.text);
  const bounds = formatBounds(line.yBounds);
  
  return await makeRequest(host, token, 'logseq.Editor.insertBlock', [
    parentUuid,
    content,
    {
      sibling: false,
      properties: {
        'stroke-y-bounds': bounds,
        'canonical-transcript': canonical
      }
    }
  ]);
}

// Helper: Convert checkbox symbols to LogSeq TODO/DONE
function convertCheckboxToMarker(text) {
  const canonical = normalizeTranscript(text);
  
  if (canonical.match(/^\s*\[\s*\]/)) {
    return text.replace(/^[\s☐\[\s\]]+/, 'TODO ');
  } else if (canonical.match(/^\s*\[x\]/i)) {
    return text.replace(/^[\s☑☒\[x\]]+/i, 'DONE ');
  }
  
  return text;
}

// Helper: Normalize transcript for comparison
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')
    .replace(/☑/g, '[x]')
    .replace(/☒/g, '[x]')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: Format Y-bounds for property storage
function formatBounds(yBounds) {
  return `${yBounds.minY.toFixed(1)}-${yBounds.maxY.toFixed(1)}`;
}

// Helper: Parse Y-bounds from property string
function parseYBounds(boundsString) {
  const [minY, maxY] = boundsString.split('-').map(parseFloat);
  return { minY, maxY };
}
```

**New function: `updateTranscriptBlockWithPreservation()`**

```javascript
export async function updateTranscriptBlockWithPreservation(blockUuid, line, oldContent, host, token) {
  const newCanonical = normalizeTranscript(line.text);
  const newContent = updateBlockWithPreservation(oldContent, line.text);
  const newBounds = formatBounds(line.yBounds);
  
  // Update content
  await makeRequest(host, token, 'logseq.Editor.updateBlock', [
    blockUuid,
    newContent
  ]);
  
  // Update properties (upsert preserves other properties)
  await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
    blockUuid,
    'stroke-y-bounds',
    newBounds
  ]);
  
  await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
    blockUuid,
    'canonical-transcript',
    newCanonical
  ]);
}

function updateBlockWithPreservation(oldContent, newTranscript) {
  // Extract current marker
  let marker = null;
  if (oldContent.match(/^\s*TODO\s/)) marker = 'TODO';
  if (oldContent.match(/^\s*DONE\s/)) marker = 'DONE';
  
  // Convert new transcript
  let newContent = convertCheckboxToMarker(newTranscript);
  
  // Preserve user's marker if applicable
  if (marker && newContent.match(/^\s*TODO\s/)) {
    newContent = newContent.replace(/^\s*TODO\s/, `${marker} `);
  }
  
  return newContent;
}
```

### File: `lib/transcript-updater.js` (NEW)

Complete update orchestration:

```javascript
/**
 * Main orchestrator for transcript block updates
 */
export async function updateTranscriptBlocks(book, page, strokes, newTranscription, host, token) {
  // 1. Get existing blocks
  const existingBlocks = await getTranscriptBlocks(book, page, host, token);
  
  // 2. Detect actions for each new line
  const actions = await detectBlockActions(existingBlocks, newTranscription.lines, strokes);
  
  // 3. Execute actions
  const results = [];
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'CREATE':
          const newBlock = await createTranscriptBlockWithProperties(
            action.parentUuid,
            action.line,
            host,
            token
          );
          results.push({ type: 'created', uuid: newBlock.uuid });
          break;
          
        case 'UPDATE':
          await updateTranscriptBlockWithPreservation(
            action.blockUuid,
            action.line,
            action.oldContent,
            host,
            token
          );
          results.push({ type: 'updated', uuid: action.blockUuid });
          break;
          
        case 'SKIP':
          results.push({ type: 'skipped', uuid: action.blockUuid, reason: action.reason });
          break;
          
        case 'MERGE_CONFLICT':
          const resolution = await handleMergeConflict(action, host, token);
          results.push({ type: 'merged', ...resolution });
          break;
      }
    } catch (error) {
      results.push({ 
        type: 'error', 
        action: action.type, 
        error: error.message 
      });
    }
  }
  
  return {
    success: true,
    results,
    created: results.filter(r => r.type === 'created').length,
    updated: results.filter(r => r.type === 'updated').length,
    skipped: results.filter(r => r.type === 'skipped').length,
    errors: results.filter(r => r.type === 'error').length
  };
}

/**
 * Detect what action to take for each line
 */
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  
  for (const line of newLines) {
    const lineBounds = calculateLineBounds(line, strokes);
    const newCanonical = line.canonical || normalizeTranscript(line.text);
    
    // Find overlapping blocks
    const overlapping = existingBlocks.filter(block => {
      const blockBounds = parseYBounds(block.properties['stroke-y-bounds'] || '0-0');
      return boundsOverlap(blockBounds, lineBounds);
    });
    
    if (overlapping.length === 0) {
      actions.push({
        type: 'CREATE',
        line,
        bounds: lineBounds,
        canonical: newCanonical,
        parentUuid: determineParentUuid(line, existingBlocks)
      });
      
    } else if (overlapping.length === 1) {
      const block = overlapping[0];
      const storedCanonical = block.properties['canonical-transcript'] || '';
      
      if (storedCanonical === newCanonical) {
        actions.push({
          type: 'SKIP',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid
        });
      } else {
        actions.push({
          type: 'UPDATE',
          blockUuid: block.uuid,
          line,
          bounds: lineBounds,
          canonical: newCanonical,
          oldContent: block.content
        });
      }
      
    } else {
      actions.push({
        type: 'MERGE_CONFLICT',
        blocks: overlapping,
        line,
        bounds: lineBounds,
        canonical: newCanonical
      });
    }
  }
  
  return actions;
}

// Helper functions
function boundsOverlap(bounds1, bounds2) {
  return !(bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
}

function determineParentUuid(line, existingBlocks) {
  // Logic to determine parent based on indentation hierarchy
  // ... implementation details ...
}

async function handleMergeConflict(action, host, token) {
  // For now, merge into first block
  // Future: show UI dialog for user decision
  const firstBlock = action.blocks[0];
  
  await updateTranscriptBlockWithPreservation(
    firstBlock.uuid,
    action.line,
    firstBlock.content,
    host,
    token
  );
  
  return { blockUuid: firstBlock.uuid, strategy: 'merge-first' };
}
```

---

## Testing Checklist

### Checkbox Preservation Tests

- [ ] Write empty checkbox → transcribe → check it off in LogSeq → re-transcribe same strokes → verify DONE preserved
- [ ] Write checked checkbox → transcribe → uncheck in LogSeq → re-transcribe → verify TODO preserved
- [ ] Write task → transcribe → add tags in LogSeq → re-transcribe → verify tags preserved
- [ ] Write task with typo → transcribe → fix typo in LogSeq → re-transcribe → verify correction preserved

### Update Detection Tests

- [ ] Add new strokes below existing → verify only new block created
- [ ] Add strokes to existing line → verify that block updated
- [ ] Delete strokes → verify orphaned blocks handled
- [ ] Overlapping Y-bounds → verify conflict resolution works

### Property Tests

- [ ] Verify stroke-y-bounds stored correctly
- [ ] Verify canonical-transcript stored correctly  
- [ ] Verify properties preserved during updates
- [ ] Verify LogSeq upsertBlockProperty preserves other properties

---

## Migration Notes

When migrating existing pages:

1. Re-transcribe to get canonical forms
2. Store canonical-transcript for each block
3. Block content may differ from canonical (if user edited)
4. This is expected and correct behavior

---

**END OF SPECIFICATION (v0.2.0)**
