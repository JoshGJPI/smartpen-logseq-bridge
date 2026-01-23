# Transcription Storage Architecture v2.0 - Technical Explanation

**Document Type:** Technical Specification & Rationale  
**Date:** January 21, 2026  
**Version:** 2.0  
**Status:** Implemented

---

## Executive Summary

The SmartPen-LogSeq Bridge transcription system was redesigned from **code block storage** (v1.0) to **property-based block storage** (v2.0) to solve a critical user experience problem: **user edits in LogSeq were being lost when re-transcribing the same handwritten strokes.**

This document explains the technical rationale, implementation approach, and tradeoffs considered during this architectural change.

---

## Table of Contents

1. [The Problem](#the-problem)
2. [Why Code Blocks Failed](#why-code-blocks-failed)
3. [Solution: Property-Based Blocks](#solution-property-based-blocks)
4. [Technical Architecture](#technical-architecture)
5. [Implementation Approach](#implementation-approach)
6. [Tradeoffs Considered](#tradeoffs-considered)
7. [Benefits Achieved](#benefits-achieved)
8. [Limitations & Future Work](#limitations--future-work)

---

## The Problem

### User Workflow

1. User writes notes by hand on Ncode paper
2. Strokes captured and transcribed via MyScript API
3. Transcription saved to LogSeq as text blocks
4. **User edits in LogSeq:**
   - Checks off TODO items → `DONE`
   - Adds tags: `#urgent @john`
   - Fixes transcription errors/typos
   - Reorganizes content
5. User adds more handwriting to same page
6. Re-transcribe the entire page (including old strokes)
7. **PROBLEM:** Save to LogSeq → **All user edits lost!**

### Impact

This made the system **unusable for iterative note-taking**:
- Users couldn't build on previous notes
- TODO tracking didn't work (items reset to unchecked)
- Tags and manual corrections lost
- Users had to choose: keep edits OR add new notes (not both)

---

## Why Code Blocks Failed

### v1.0 Architecture

```markdown
## Transcribed Text
```
Review mockups
Meeting notes
  Feedback from team
TODO Check emails
```
```

**Storage Format:**
- Single code block under "## Transcribed Text" header
- Plain text content with no metadata
- Entire block replaced on each save

### Fundamental Issues

1. **No Identity Tracking**
   - No way to identify which line corresponds to which strokes
   - Can't determine if a line changed vs user edited it

2. **All-or-Nothing Updates**
   - Entire code block replaced atomically
   - No concept of "this line is the same, preserve it"
   - No way to detect user modifications

3. **No Change Detection**
   - Can't distinguish:
     - Actual transcription change (handwriting improved)
     - vs. User edit (user checked off task)
   - Always overwrites everything "to be safe"

4. **Lack of Metadata**
   - No connection between lines and physical strokes
   - Can't map "TODO Check emails" → strokes at Y position 1500-1550
   - Can't do incremental updates

### Why Simple Diffing Won't Work

**Considered:** "Just diff old vs new text and only update changes"

**Problems:**
```
Old: "TODO Check emails"
New: "DONE Check emails"
```
Is this:
- A) User checked it off (preserve "DONE")
- B) Handwriting improved, MyScript now reads "DONE" (update to what MyScript says)

**Without context, impossible to distinguish!**

---

## Solution: Property-Based Blocks

### Core Insight

**Each transcribed line needs an identity independent of its content.**

We need to answer:
- "Is this line the **same line** as before?" (position/stroke-based)
- "Did the **transcription** of this line change?" (content-based)
- "Did the **user modify** this line?" (comparison-based)

### v2.0 Architecture

```markdown
## Transcribed Content #Display_No_Properties

stroke-y-bounds:: 1234.5-1289.3
canonical-transcript:: [ ] Review mockups
- TODO Review mockups

stroke-y-bounds:: 1300.0-1350.0
canonical-transcript:: Meeting notes
- Meeting notes

stroke-y-bounds:: 1350.0-1400.0
canonical-transcript::   Feedback from team
-   Feedback from team
```

**Key Innovation:** Each line is a separate block with **identity properties**

---

## Technical Architecture

### Property Schema

Each transcribed line has two properties:

#### 1. `stroke-y-bounds` (Identity)
```
stroke-y-bounds:: 1234.5-1289.3
```
- **Purpose:** Physical stroke position (Y-coordinate range)
- **Derived from:** MyScript word bounding boxes
- **Use:** Line identity - "is this the same line as before?"
- **Stability:** Constant for same handwriting, even if transcription changes

#### 2. `canonical-transcript` (Content Fingerprint)
```
canonical-transcript:: [ ] Review mockups
```
- **Purpose:** Normalized version of transcription
- **Normalization:** Checkboxes standardized (☐→`[ ]`, ☑→`[x]`)
- **Use:** Detect if **transcription actually changed**
- **Key Insight:** Compare canonical, not final content!

### Update Algorithm

**When re-transcribing and saving:**

```
For each new transcription line:
  1. Calculate Y-bounds from strokes
  2. Find existing blocks with overlapping Y-bounds
  
  IF no overlapping blocks:
    → CREATE new block (new handwriting added)
  
  ELSE IF one overlapping block:
    Compare canonical-transcript properties:
    
    IF canonical matches:
      → SKIP (preserve ALL user edits)
    ELSE:
      → UPDATE (transcription actually changed)
      - Preserve TODO/DONE markers when possible
      - Update text while keeping user modifications
  
  ELSE (multiple overlapping):
    → MERGE_CONFLICT (tight handwriting, resolve carefully)
```

### Canonical Comparison Example

**Scenario:** User checked off a task

```
Stored:
  canonical-transcript:: [ ] Check emails
  Content: DONE Check emails

Re-transcribe (MyScript returns same):
  New canonical: [ ] Check emails
  
Compare: "[ ] Check emails" === "[ ] Check emails" ✅

Action: SKIP update
Result: User's "DONE" preserved
```

**Scenario:** Handwriting actually changed

```
Stored:
  canonical-transcript:: [ ] Check emails
  Content: DONE Check emails

Re-transcribe (handwriting corrected):
  New canonical: [ ] Check email server
  
Compare: "[ ] Check emails" !== "[ ] Check email server" ❌

Action: UPDATE
Result: Text updated to "Check email server"
        DONE marker preserved if possible
```

---

## Implementation Approach

### Phase 1: MyScript API Enhancement

**File:** `src/lib/myscript-api.js`

**Changes:**
```javascript
// 1. Added normalization function
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')
    .replace(/☑/g, '[x]')
    .replace(/✓/g, '[x]')
    .trim();
}

// 2. Enhanced line parsing
{
  text: "TODO Review mockups",
  canonical: "[ ] Review mockups",  // NEW
  yBounds: { minY: 1234.5, maxY: 1289.3 },  // NEW
  indentLevel: 0,
  // ... existing fields
}
```

### Phase 2: LogSeq API Helpers

**File:** `src/lib/logseq-api.js`

**New Functions:**
```javascript
// Create block with properties
async function createTranscriptBlockWithProperties(parentUuid, line, host, token)

// Update block preserving user edits
async function updateTranscriptBlockWithPreservation(blockUuid, line, oldContent, host, token)

// Get existing transcript blocks
async function getTranscriptBlocks(book, page, host, token)
```

**Key Implementation Detail:**
```javascript
// Preserve TODO/DONE markers during update
function updateTranscriptBlockWithPreservation(blockUuid, line, oldContent) {
  const oldMarker = extractMarker(oldContent);  // "DONE" or "TODO"
  const newMarker = extractMarker(line.text);    // "TODO" (from MyScript)
  
  if (oldMarker === 'DONE' && newMarker === 'TODO') {
    // User completed it - keep DONE
    finalContent = line.text.replace('TODO', 'DONE');
  } else {
    // Use new transcription
    finalContent = line.text;
  }
  
  await updateBlock(blockUuid, finalContent);
  await upsertBlockProperty(blockUuid, 'canonical-transcript', line.canonical);
  await upsertBlockProperty(blockUuid, 'stroke-y-bounds', formatBounds(line.yBounds));
}
```

### Phase 3: Update Orchestrator

**File:** `src/lib/transcript-updater.js` (360+ lines)

**Core Logic:**
```javascript
async function updateTranscriptBlocks(book, page, strokes, transcription, host, token) {
  // 1. Get existing blocks from LogSeq
  const existingBlocks = await getTranscriptBlocks(book, page, host, token);
  
  // 2. Detect required actions for each line
  const actions = detectBlockActions(existingBlocks, transcription.lines, strokes);
  
  // 3. Execute actions
  for (const action of actions) {
    switch (action.type) {
      case 'CREATE': await createBlock(...); break;
      case 'UPDATE': await updateWithPreservation(...); break;
      case 'SKIP': /* do nothing */ break;
      case 'MERGE_CONFLICT': await resolveConflict(...); break;
    }
  }
  
  return { success: true, stats: { created, updated, skipped, merged } };
}
```

---

## Tradeoffs Considered

### 1. Property Storage vs JSON Metadata

**Considered Options:**

**A) Properties (Chosen)**
```markdown
stroke-y-bounds:: 1234.5-1289.3
canonical-transcript:: [ ] Task
- TODO Task
```

**B) JSON in block content**
```markdown
- TODO Task `{"bounds": [1234.5, 1289.3], "canonical": "[ ] Task"}`
```

**C) Dedicated metadata blocks**
```markdown
- TODO Task
  - metadata:: {"bounds": ..., "canonical": ...}
```

**Decision: Properties**

**Pros:**
- Native LogSeq feature (indexed, searchable)
- Can be hidden with `#Display_No_Properties`
- Clean separation of metadata and content
- Supports property queries in LogSeq

**Cons:**
- Visible when editing blocks (minor UX issue)
- Limited to simple key-value pairs
- Requires LogSeq property support (v0.8.0+)

**Rejected B (JSON in content):** Clutters content, fragile parsing

**Rejected C (Metadata blocks):** Doubles block count, complex navigation

### 2. Y-Bounds vs Stroke IDs

**Y-Bounds (Chosen):**
```
stroke-y-bounds:: 1234.5-1289.3
```

**Pros:**
- Simple single range
- Works even if strokes slightly different
- Robust to minor handwriting variations

**Cons:**
- Tight handwriting might overlap (Y ranges collide)
- Approximation, not perfect identity

**Alternative: Stroke IDs**
```
stroke-ids:: [s123, s124, s125, s126]
```

**Pros:**
- Perfect stroke-to-line mapping
- No ambiguity

**Cons:**
- Large property values (many stroke IDs)
- Breaks if strokes reordered/modified
- Complex property format

**Decision:** Y-bounds for simplicity, stroke IDs future enhancement

### 3. Single Canonical vs Multiple Properties

**Single Canonical (Chosen):**
```
canonical-transcript:: [ ] Task
```

**Alternative: Multiple Properties**
```
text-content:: Review mockups
has-checkbox:: true
checkbox-state:: unchecked
indent-level:: 0
```

**Decision:** Single canonical for simplicity. Current approach sufficient for 95% of cases.

### 4. Automatic Update vs Manual Review

**Options:**

**A) Automatic (Chosen)** - Skip when canonical matches, update when differs

**B) Always Prompt** - Ask user to confirm each change

**C) Track Dirty Flag** - Only update blocks user hasn't touched

**Decision:** Automatic with smart detection

**Rationale:**
- Users want automatic preservation (90% use case)
- Can always manually edit in LogSeq if needed
- Dirty flag tracking too complex (requires change listeners)

---

## Benefits Achieved

### 1. User Edit Preservation ⭐
- TODO→DONE status preserved
- User-added tags preserved
- Manual text corrections preserved
- **Zero user friction** - just works

### 2. Incremental Updates
- Add new handwriting → only new blocks created
- Old blocks untouched
- Efficient (no full rewrites)

### 3. Change Detection
- Knows if transcription actually changed
- Distinguishes user edits from content changes
- Intelligent merge strategy

### 4. LogSeq Integration
- Properties indexed and searchable
- Can query: `{{query (property stroke-y-bounds)}}`
- Hidden by default (`#Display_No_Properties`)
- Compatible with LogSeq workflows

### 5. Debugging & Auditing
- Can see what properties exist
- Clear mapping from strokes to blocks
- Easier to diagnose issues

---

## Limitations & Future Work

### Current Limitations

1. **No Perfect Hierarchy Support**
   - All blocks created at top level (under "Transcribed Content")
   - Indentation stored but not reflected in block structure
   - **Future:** Parse `line.parent` references for nested blocks

2. **Y-Bounds Approximation**
   - Uses word bounding boxes (available from MyScript)
   - Not stroke-precise
   - Tight handwriting can cause overlaps
   - **Future:** Add `stroke-ids` property for perfect mapping

3. **Sequential Operations**
   - Creates/updates blocks one at a time
   - Can be slow for large pages (50+ lines)
   - **Future:** Batch property updates via LogSeq API

4. **Basic Conflict Resolution**
   - Multiple overlapping blocks → merge to first
   - No UI for user resolution
   - **Future:** Conflict resolution dialog

5. **No Checkbox Type Preservation**
   - Converts all checkboxes to TODO/DONE
   - Loses other task types (DOING, WAITING, etc.)
   - **Future:** Preserve custom task markers

### Future Enhancements

#### 1. Stroke-to-Line Mapping
```javascript
// Instead of just Y-bounds:
stroke-y-bounds:: 1234.5-1289.3

// Add precise stroke IDs:
stroke-ids:: [s123, s124, s125, s126]
```

**Benefits:**
- Perfect line identity
- Can update individual strokes
- Handle overlapping handwriting

#### 2. Hierarchical Blocks
```markdown
## Transcribed Content

- Meeting notes
  - Action items
    - Review mockups
  - Decisions
    - Use blue theme
```

**Implementation:**
- Parse `line.parent` from MyScript result
- Track parent-child relationships
- Use `insertBlock` with correct parent UUID
- Maintain hierarchy in LogSeq

#### 3. Batch API Calls
```javascript
// Instead of:
await updateBlock(uuid1, content1);
await upsertProperty(uuid1, 'canonical', canonical1);
await upsertProperty(uuid1, 'bounds', bounds1);
await updateBlock(uuid2, content2);
// ... (slow!)

// Use batch API:
await batchUpdate([
  { uuid: uuid1, content: content1, properties: {...} },
  { uuid: uuid2, content: content2, properties: {...} }
]);
```

**Benefits:** 5-10x faster for large pages

#### 4. User Conflict Resolution UI
```
┌─────────────────────────────────────┐
│ Multiple blocks overlap this line   │
│                                      │
│ Block 1: "Review mockups"           │
│ Block 2: "Review design mockups"    │
│                                      │
│ New transcription: "Review mockups" │
│                                      │
│ [Merge to Block 1]                  │
│ [Merge to Block 2]                  │
│ [Create New Block]                  │
└─────────────────────────────────────┘
```

#### 5. Migration Tool
```javascript
// Convert old v1.0 pages to v2.0 format
async function migratePageToV2(book, page) {
  // 1. Read old code block
  // 2. Parse line-by-line
  // 3. Match to strokes (if available)
  // 4. Create property-based blocks
  // 5. Delete old code block
}
```

---

## Technical Decisions Summary

| Decision | Chosen Approach | Alternative | Rationale |
|----------|----------------|-------------|-----------|
| **Storage Format** | Property-based blocks | Code blocks, JSON metadata | Native LogSeq, hide-able, searchable |
| **Line Identity** | Y-bounds | Stroke IDs, line numbers | Simple, robust to minor variations |
| **Change Detection** | Canonical comparison | Content hash, user flags | Distinguishes edits from changes |
| **Update Strategy** | Automatic preservation | Manual review, dirty flags | Zero user friction, just works |
| **Conflict Resolution** | Merge-first | UI dialog, skip | Simple for MVP, can enhance later |
| **Hierarchy** | Flat (future: nested) | Immediate nested blocks | Simpler initial implementation |
| **Performance** | Sequential operations | Batch API | Works for current scale, optimize later |

---

## Conclusion

The v2.0 property-based storage architecture successfully solves the **critical user edit preservation problem** while maintaining:
- ✅ Simple, understandable implementation
- ✅ Clean LogSeq integration
- ✅ Automatic, zero-friction UX
- ✅ Extensibility for future enhancements

The tradeoffs made prioritize **user experience** and **reliability** over perfect technical purity, with clear paths forward for future optimization.

**Result:** Users can now iteratively build notes without losing their work. The system is **finally usable** for real-world note-taking workflows.

---

## References

- MyScript Cloud API: https://developer.myscript.com/
- LogSeq HTTP API: https://docs.logseq.com/#/page/api
- Implementation: `src/lib/transcript-updater.js`
- Migration Guide: `docs/INTEGRATION_COMPLETE_v2.0.md`
- Testing Checklist: `docs/TESTING_CHECKLIST_v2.0.md`

---

**Document Version:** 1.0  
**Last Updated:** January 21, 2026  
**Author:** SmartPen-LogSeq Bridge Development Team
