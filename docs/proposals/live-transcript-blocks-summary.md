# Live Transcript Blocks - Executive Summary

**Created:** January 2025  
**Status:** PROPOSAL  
**Full Spec:** [live-transcript-blocks-spec.md](./live-transcript-blocks-spec.md)

---

## The Problem

Currently, transcripts are stored as **static code blocks** in LogSeq:

```
## Transcribed Text
```
Meeting notes
  - Discussed roadmap
  - Action items
```
```

**Pain points:**
1. **All-or-nothing updates** - Adding one line requires re-saving entire transcript
2. **No granular control** - Can't update individual lines
3. **Manual block conversion** - Must copy/paste to use LogSeq features (TODO, tags)
4. **Lost stroke mapping** - No way to know which strokes created which text
5. **Incremental additions are painful** - Hard to merge new strokes with existing transcript

---

## The Solution

Store each line in a **live LogSeq block** with **vertical bounds property**:

```
## Transcribed Content
stroke-y-bounds:: 1000.0-1050.0
stroke-count:: 8
- Meeting notes

stroke-y-bounds:: 1050.0-1075.0  
stroke-count:: 5
  - Discussed roadmap
```

**Benefits:**
- ✅ Granular updates (only modify changed lines)
- ✅ Native LogSeq features (TODO, tags, references work immediately)
- ✅ Incremental workflow (add strokes → transcribe only new → append)
- ✅ Persistent mapping (Y-bounds link strokes to blocks)
- ✅ Reduced API calls (only transcribe new content)

---

## How It Works

### Vertical Bounds as Key

Y-coordinates define vertical bands for each line:

```javascript
{
  "stroke-y-bounds": "1234.56-1289.34",  // minY-maxY in Ncode units
  "stroke-count": 15,
  "last-transcribed": 1738259200000
}
```

**Why Y-coordinates?**
- Handwriting is horizontal (left-to-right)
- Lines are vertically distinct bands
- Y-positions stable across transcriptions
- Multiple wrapped lines share same vertical band
- New strokes easily categorized by Y position

### Update Algorithm

```
1. Get existing transcript blocks from LogSeq
2. For each new transcribed line:
   - Calculate vertical bounds from strokes
   - Find overlapping existing blocks
   - If no overlap → CREATE new block
   - If one overlap → UPDATE existing block (if changed)
   - If multiple overlaps → MERGE conflict resolution
3. Execute actions (CREATE/UPDATE/SKIP)
4. Handle deletions (orphaned blocks)
```

---

## Current Implementation Summary

### Storage (Current)

**File:** `logseq-api.js::updatePageTranscription()`

```javascript
// Creates single code block:
await insertBlock(parentUuid, '```\n' + plainText + '\n```');
```

**Data:**
- Single code block under "## Transcribed Text"
- Plain text with indentation formatting
- No properties, no mapping to strokes

### Transcription (Current)

**File:** `myscript-api.js::parseMyScriptResponse()`

```javascript
{
  text: "Full text with \\n line breaks",
  lines: [
    {
      text: "Meeting notes",
      indentLevel: 0,
      x: 123.45,         // Leftmost word X
      baseline: 234.56,  // Y position  
      words: [...],
      parent: null,
      children: [1, 2]
    },
    // ... more lines
  ],
  words: [...],  // All words with bounding boxes
  commands: [...] // Detected [command: value] patterns
}
```

**Missing:**
- No stroke ID tracking
- No vertical bounds calculation
- No LogSeq block UUID mapping

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Track stroke IDs and Y-bounds during transcription

**Changes:**
- `myscript-api.js`: Request stroke IDs in MyScript export config
- `parseMyScriptResponse()`: Extract stroke IDs, calculate Y-bounds
- `stores/transcription.js`: Add `strokeIds`, `yBounds` to line objects
- `stroke-storage.js`: Add utilities for stroke-to-line mapping

**Deliverable:** Lines now have `{ strokeIds: Set, yBounds: { minY, maxY } }`

### Phase 2: LogSeq Integration (Week 2)

**Goal:** Create and update live blocks

**New files:**
- `lib/transcript-updater.js`: Update detection algorithm
  - `updateTranscriptBlocks()` - main orchestrator
  - `detectBlockActions()` - determine CREATE/UPDATE/SKIP
  - `handleMergeConflict()` - collision resolution

**Changes:**
- `logseq-api.js`: Add functions
  - `getTranscriptBlocks(book, page)` - fetch existing
  - `createTranscriptBlock(content, properties)` - new block
  - `updateTranscriptBlock(uuid, content, properties)` - modify
  - `buildBlockHierarchy(lines, parentUuid)` - tree structure

**Deliverable:** Can create/update live blocks with properties

### Phase 3: UI/UX (Week 3)

**Goal:** Surface stroke↔block mapping in UI

**Changes:**
- `TranscriptionView.svelte`: 
  - Show Y-bounds for each line
  - Color-code by sync status (clean/modified/unsaved)
  - "Update blocks" button (vs "Save to LogSeq")
  
- `StrokeCanvas.svelte`:
  - Draw horizontal bands for Y-bounds
  - Highlight strokes when hovering line
  - Click line → select strokes in Y-band

**Deliverable:** Visual feedback for mapping, conflict resolution UI

### Phase 4: Migration (Week 4)

**Goal:** Convert existing code blocks to live blocks

**New file:**
- `lib/transcript-migration.js`:
  - `migrateCodeBlockToLiveBlocks(book, page)` - single page
  - `migrateAllPages(progressCallback)` - batch
  - Validation, rollback, archiving

**UI:**
- Migration dialog: scan, preview, execute
- Progress tracking
- Rollback option

**Deliverable:** Production-ready migration tool

---

## Data Structure Changes

### Enhanced Line Object (Phase 1)

```javascript
{
  // Existing fields
  text: "Meeting notes",
  indentLevel: 0,
  x: 123.45,
  baseline: 234.56,
  words: [...],
  parent: null,
  children: [1, 2],
  
  // NEW fields
  strokeIds: new Set([         // IDs of contributing strokes
    "s1738259100123",
    "s1738259100234",
  ]),
  yBounds: {                   // Vertical extent
    minY: 1234.56,
    maxY: 1289.34
  },
  blockUuid: "abc-123",        // LogSeq block UUID (after save)
  syncStatus: "clean"          // clean | modified | unsaved
}
```

### LogSeq Block Properties (Phase 2)

```javascript
// Stored in LogSeq block's properties map
{
  "stroke-y-bounds": "1234.56-1289.34",
  "stroke-count": 8,
  "last-transcribed": 1738259200000,
  "transcription-version": "1.0"
}
```

---

## Code Changes Required

### File: `myscript-api.js`

**Function:** `buildRequest(strokes, options)`

```javascript
// ADD stroke-id request
export: {
  jiix: {
    'bounding-box': true,
    strokes: true,
    'stroke-id': true,  // NEW: Request stroke IDs
    text: { chars: true, words: true }
  }
}
```

**Function:** `parseMyScriptResponse(response)`

```javascript
// ADD stroke ID extraction and Y-bounds calculation
lines.forEach(line => {
  // Extract stroke IDs from words
  const strokeIds = new Set();
  line.words.forEach(word => {
    if (word.items) {
      word.items.forEach(item => {
        if (item.strokeId) strokeIds.add(item.strokeId);
      });
    }
  });
  
  // Calculate Y-bounds from stroke IDs
  const yBounds = calculateLineBounds(line, strokeIds, allStrokes);
  
  line.strokeIds = strokeIds;
  line.yBounds = yBounds;
});
```

### File: `logseq-api.js`

**New function:** `getTranscriptBlocks(book, page)`

```javascript
export async function getTranscriptBlocks(book, page, host, token) {
  const pageName = formatPageName(book, page);
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
  
  const contentBlock = findBlockByHeading(blocks, "Transcribed Content");
  if (!contentBlock) return [];
  
  return parseTranscriptBlocks(contentBlock.children);
}
```

**New function:** `createTranscriptBlock(...)`

```javascript
export async function createTranscriptBlock(parentUuid, content, properties, host, token) {
  return await makeRequest(host, token, 'logseq.Editor.insertBlock', [
    parentUuid,
    content,
    { 
      sibling: false,
      properties 
    }
  ]);
}
```

**New function:** `updateTranscriptBlock(...)`

```javascript
export async function updateTranscriptBlock(uuid, content, properties, host, token) {
  // Update content
  await makeRequest(host, token, 'logseq.Editor.updateBlock', [uuid, content]);
  
  // Update properties
  for (const [key, value] of Object.entries(properties)) {
    await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
      uuid, key, value
    ]);
  }
}
```

### File: `lib/transcript-updater.js` (NEW)

**Main function:** `updateTranscriptBlocks(...)`

```javascript
export async function updateTranscriptBlocks(book, page, strokes, newTranscription, host, token) {
  // 1. Get existing blocks
  const existingBlocks = await getTranscriptBlocks(book, page, host, token);
  
  // 2. Detect actions for each new line
  const actions = detectBlockActions(existingBlocks, newTranscription.lines, strokes);
  
  // 3. Execute actions
  for (const action of actions) {
    switch (action.type) {
      case 'CREATE':
        await createTranscriptBlock(action.parentUuid, action.line.text, 
                                   buildProperties(action.line), host, token);
        break;
      case 'UPDATE':
        await updateTranscriptBlock(action.uuid, action.line.text,
                                   buildProperties(action.line), host, token);
        break;
      case 'MERGE_CONFLICT':
        await handleMergeConflict(action, host, token);
        break;
    }
  }
  
  return { success: true, actionsExecuted: actions.length };
}
```

### File: `stores/transcription.js`

**Type changes:**

```javascript
// Extend line type
export const transcribedLines = derived(
  lastTranscription,
  $t => ($t?.lines || []).map(line => ({
    ...line,
    strokeIds: line.strokeIds || new Set(),
    yBounds: line.yBounds || { minY: 0, maxY: 0 },
    blockUuid: null,
    syncStatus: 'unsaved'
  }))
);
```

---

## Migration Strategy

### Automated Migration Process

```javascript
async function migratePageTranscript(book, page) {
  // 1. Get existing code block transcript
  const oldTranscript = await getExistingTranscription(book, page);
  if (!oldTranscript) return { status: 'skipped' };
  
  // 2. Get strokes and re-transcribe
  const strokes = await getPageStrokes(book, page);
  const transcription = await transcribeStrokes(strokes);
  
  // 3. Calculate Y-bounds for each line
  const linesWithBounds = transcription.lines.map(line => ({
    ...line,
    yBounds: calculateLineBounds(line, strokes),
    strokeIds: extractStrokeIds(line)
  }));
  
  // 4. Archive old code block
  await archiveOldTranscript(book, page, oldTranscript);
  
  // 5. Create live blocks
  const parentBlock = await createBlock(pageName, "## Transcribed Content");
  await buildBlockHierarchy(linesWithBounds, parentBlock.uuid);
  
  // 6. Validate
  const validation = await validateMigration(oldTranscript, newBlocks);
  if (!validation.success) {
    await rollbackMigration(book, page);
    throw new Error('Migration failed validation');
  }
  
  return { status: 'success', linesCreated: linesWithBounds.length };
}
```

### User Flow

1. Settings → "Migrate to Live Blocks" button
2. App scans LogSeq for pages with old format
3. Shows list: "Found 23 pages to migrate"
4. User clicks "Migrate All" or selects specific pages
5. Progress bar shows migration status
6. Success message: "23 pages migrated, 0 errors"
7. Old transcripts archived under "## Archived Transcripts"

---

## Trade-offs

### Pros
- ✅ Granular updates (only changed lines)
- ✅ Native LogSeq features immediately available
- ✅ Persistent stroke→block mapping
- ✅ Reduced API calls (incremental transcription)
- ✅ Better visualization (highlight strokes by line)

### Cons
- ❌ More complex (more code, more state)
- ❌ Migration burden (existing users must migrate)
- ❌ Block proliferation (many lines = many blocks)
- ❌ Y-bound collisions (tight handwriting may overlap)
- ❌ Requires MyScript stroke-id feature

### Mitigation
- Feature flag (default: off during beta)
- Automated migration script
- Fallback: always support reading old format
- Validation: ensure no data loss
- Generous padding on Y-bounds

---

## Success Criteria

### Must Have
- ✅ All existing features work with live blocks
- ✅ Incremental updates only touch affected blocks
- ✅ Y-bounds correctly identify strokes
- ✅ Migration preserves all content (validated)
- ✅ Backward compatible (can read old format)

### Nice to Have
- ✅ Visual indicators of sync status
- ✅ Canvas highlighting by line
- ✅ One-click migration for all pages
- ✅ Conflict resolution UI

### Performance
- ✅ Block updates: <2s for 50-line pages
- ✅ Migration: <5s per page
- ✅ No canvas rendering regression

---

## Next Steps

### Immediate (This Week)
1. **Prototype Y-bounds calculation**
   - Test with 5 sample pages
   - Measure accuracy
   - Identify edge cases

2. **Spike: MyScript stroke-id export**
   - Verify API supports this
   - Test stroke ID extraction
   - Document limitations

3. **Design review**
   - Share spec with team
   - Gather feedback
   - Refine approach

### Short-term (Next Month)
- Phase 1: Foundation (stroke IDs, Y-bounds)
- Phase 2: LogSeq integration (live blocks)
- Phase 3: UI/UX (visualization, conflict resolution)

### Long-term (Quarter)
- Phase 4: Migration (automated tool, documentation)
- Beta testing with real users
- Production release

---

**Full details:** See [live-transcript-blocks-spec.md](./live-transcript-blocks-spec.md)
