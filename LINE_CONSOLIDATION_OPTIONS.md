# Line Consolidation - Persistent UI Merge Options

**Document Type:** Technical Options Analysis  
**Date:** January 22, 2026  
**Status:** Proposal  
**Purpose:** Evaluate approaches for persisting user line merges across re-transcriptions

---

## Executive Summary

**Problem:** When users merge wrapped lines in the transcription editor UI, these consolidations need to persist in LogSeq's database so that future transcriptions (e.g., when adding more strokes) don't split them again.

**Current v2.0 Behavior:**
- Each MyScript line → separate LogSeq block
- Properties: `stroke-y-bounds` (Y-coordinate range), `canonical-transcript` (normalized text)
- Re-transcription matching: overlapping Y-bounds + canonical comparison
- **Issue:** No mechanism to remember user's "these lines are one unit" decision

**Requirements:**
1. UI allows merging lines (already spec'd in TRANSCRIPTION_EDITOR_MODAL_SPEC.md)
2. Merge decision persists in LogSeq properties/structure
3. Re-transcription respects merge (doesn't re-split)
4. Data integrity guaranteed (no loss/duplication/corruption)
5. Streamlined UX - "just works"
6. Handles edge cases (partial overlaps, reordering, additions)

---

## Understanding the Property Architecture

Before diving into the options, it's critical to understand how the two key properties work together:

### The `stroke-y-bounds` Property
- **Purpose:** Physical location matching
- **Captures:** The actual Y-coordinate range where strokes exist (e.g., `1234.0-1305.0`)
- **Used for:** Finding which MyScript lines overlap with this block
- **Example:** "Look for lines between Y=1234 and Y=1305"

### The `merged-lines` Property
- **Purpose:** Semantic interpretation guide
- **Captures:** User's consolidation intent (e.g., `2` = "these were merged")
- **Used for:** Deciding HOW to handle multiple overlapping lines
- **Set by:** Code automatically when user clicks "Merge" in UI
- **Used by:** Code during re-transcription matching
- **User interaction:** NEVER manually set by user

### Why Both Properties Are Required

Consider these two scenarios that look identical without `merged-lines`:

**Scenario A: Intentional Merge**
```
Block Y: 1234-1305
MyScript returns: Line 1 (Y: 1234-1249) + Line 2 (Y: 1290-1305)
merged-lines: 2

Correct behavior: Combine both lines, compare to stored canonical ✓
```

**Scenario B: Tight Handwriting (Accidental Overlap)**
```
Block Y: 1234-1305 (single tall line with descenders)
MyScript returns: Line 1 (Y: 1234-1249) + Line 2 (Y: 1290-1305)
merged-lines: 1 (or absent)

Correct behavior: Possible conflict! Warn or handle specially ⚠️
```

**The code distinguishes these cases:**
```javascript
if (mergedCount === 2 && overlappingLines.length === 2) {
  // Scenario A: Expected! Combine and compare
  combineAndCompare(overlappingLines);
} else if (mergedCount === 1 && overlappingLines.length === 2) {
  // Scenario B: Unexpected! Handle conflict
  handleConflict(block, overlappingLines);
}
```

Without the `merged-lines` property, the system cannot distinguish intentional merges from accidental overlaps.

### User Experience Flow

**User sees:**
```
┌─────────────────────────┐
│ ☑ Review mockups for    │  ← Simple merge action
│   the new dashboard     │
│   [Split]               │
└─────────────────────────┘
```

**Code automatically sets:**
```markdown
stroke-y-bounds:: 1234.0-1305.0
canonical-transcript:: Review mockups for the new dashboard
merged-lines:: 2  ← Set automatically, user never sees or edits this
```

### Troubleshooting Benefit

The `merged-lines` property provides invaluable debugging information:

```
User report: "My merged line got split again!"

Debug log shows:
  Block UUID: abc123
  stroke-y-bounds: 1234.0-1305.0
  merged-lines: 2  ← ✅ Confirms this WAS a merged block
  
  MyScript returned: 3 lines overlapping
  Expected: 2 lines
  Action: Updated with 3 merged lines
  
Diagnosis: User wrote additional content in the middle
```

Without this property, debugging becomes guesswork.

---

## Option 1: Merged Y-Bounds Strategy ⭐ RECOMMENDED

### Concept

When user merges lines, combine them into a single LogSeq block with expanded Y-bounds spanning all merged lines. On re-transcription, any MyScript lines overlapping this range are grouped and compared as a unit.

### Implementation

**UI Merge Action:**
```javascript
// User merges Line 1 (Y: 1234-1289) and Line 2 (Y: 1290-1345)
const mergedLine = {
  text: line1.text + ' ' + line2.text,
  canonical: normalizeTranscript(line1.text + ' ' + line2.text),
  yBounds: {
    minY: Math.min(line1.yBounds.minY, line2.yBounds.minY), // 1234
    maxY: Math.max(line1.yBounds.maxY, line2.yBounds.maxY)  // 1345
  },
  mergedLineCount: 2  // NEW: Track how many lines were merged
};
```

**LogSeq Block:**
```markdown
stroke-y-bounds:: 1234.0-1345.0
canonical-transcript:: Review mockups for the new dashboard
merged-lines:: 2
- Review mockups for the new dashboard
```

**Re-Transcription Matching Logic:**
```javascript
// MyScript returns two lines again:
// Line A: "Review mockups for" (Y: 1234-1289)
// Line B: "the new dashboard" (Y: 1290-1345)

// 1. Find existing blocks
const existingBlock = { yBounds: {minY: 1234, maxY: 1345}, ... };

// 2. Find new lines overlapping this range
const overlappingLines = [lineA, lineB]; // Both overlap 1234-1345

// 3. If multiple overlapping lines AND existing has merged-lines property:
//    → Combine overlapping lines
const combinedText = overlappingLines.map(l => l.text).join(' ');
const combinedCanonical = normalizeTranscript(combinedText);

// 4. Compare combined canonical to existing canonical
if (combinedCanonical === existingBlock.canonical) {
  // SKIP - preserve merged block with all user edits
} else {
  // UPDATE - handwriting actually changed
}
```

### Data Flow

**Initial State (No Merge):**
```
MyScript Output:
  Line 1: "Review mockups for" → Block A (Y: 1234-1289)
  Line 2: "the new dashboard"  → Block B (Y: 1290-1345)

LogSeq:
  Block A: stroke-y-bounds:: 1234.0-1289.0
  Block B: stroke-y-bounds:: 1290.0-1345.0
```

**After User Merge in UI:**
```
LogSeq (Updated):
  Merged Block: stroke-y-bounds:: 1234.0-1345.0
                merged-lines:: 2
                canonical-transcript:: Review mockups for the new dashboard
  (Block B deleted)
```

**Re-Transcription (MyScript still returns 2 lines):**
```
1. Find block overlapping Y: 1234-1345 → Merged Block found
2. Check merged-lines property → Yes, this is a user-merged block
3. Find all MyScript lines overlapping 1234-1345 → Line 1 + Line 2
4. Combine their text → "Review mockups for the new dashboard"
5. Compare to stored canonical → Match!
6. SKIP update → Preserve merged block exactly as is
```

### Code Changes Required

**1. Enhanced Line Object (in myscript-api.js):**
```javascript
{
  text: "Review mockups for the new dashboard",
  canonical: "Review mockups for the new dashboard",
  yBounds: { minY: 1234, maxY: 1345 },
  mergedLineCount: 2,        // NEW
  sourceLineIndices: [0, 1], // NEW: Which original lines
  userMerged: true           // NEW: Flag for UI
}
```

**2. Enhanced Block Actions (in transcript-updater.js):**
```javascript
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  
  for (const block of existingBlocks) {
    const blockBounds = parseYBounds(block.properties['stroke-y-bounds']);
    const mergedCount = parseInt(block.properties['merged-lines']) || 1;
    
    // Find overlapping lines
    const overlapping = newLines.filter(line => 
      boundsOverlap(blockBounds, line.yBounds)
    );
    
    if (mergedCount > 1 && overlapping.length > 1) {
      // This is a merged block - combine overlapping lines for comparison
      const combinedText = overlapping.map(l => l.text).join(' ');
      const combinedCanonical = normalizeTranscript(combinedText);
      const storedCanonical = block.properties['canonical-transcript'];
      
      if (combinedCanonical === storedCanonical) {
        // Canonical match - preserve merged block
        actions.push({
          type: 'SKIP_MERGED',
          blockUuid: block.uuid,
          consumedLines: overlapping.map(l => newLines.indexOf(l))
        });
        continue;
      } else {
        // Canonical changed - update
        actions.push({
          type: 'UPDATE_MERGED',
          blockUuid: block.uuid,
          newCombinedLine: {
            text: combinedText,
            canonical: combinedCanonical,
            yBounds: {
              minY: Math.min(...overlapping.map(l => l.yBounds.minY)),
              maxY: Math.max(...overlapping.map(l => l.yBounds.maxY))
            },
            mergedLineCount: overlapping.length
          },
          consumedLines: overlapping.map(l => newLines.indexOf(l))
        });
        continue;
      }
    }
    
    // ... existing single-line logic
  }
  
  return actions;
}
```

**3. Transcription Editor Modal (NEW UI Component):**
```javascript
// In modal UI:
function mergeLinesInEditor(lineIndices) {
  // Get selected lines
  const selectedLines = lineIndices.map(i => editedLines[i]);
  
  // Create merged line
  const mergedLine = {
    text: selectedLines.map(l => l.text).join(' '),
    canonical: normalizeTranscript(selectedLines.map(l => l.text).join(' ')),
    yBounds: {
      minY: Math.min(...selectedLines.map(l => l.yBounds.minY)),
      maxY: Math.max(...selectedLines.map(l => l.yBounds.maxY))
    },
    mergedLineCount: selectedLines.length,
    sourceLineIndices: lineIndices,
    userMerged: true
  };
  
  // Replace selected lines with merged line
  editedLines = [
    ...editedLines.slice(0, lineIndices[0]),
    mergedLine,
    ...editedLines.slice(lineIndices[lineIndices.length - 1] + 1)
  ];
}
```

**4. Enhanced Property Updates (in logseq-api.js):**
```javascript
export async function createTranscriptBlockWithProperties(parentUuid, line, host, token = '') {
  const properties = {
    'stroke-y-bounds': formatBounds(line.yBounds),
    'canonical-transcript': line.canonical
  };
  
  // Add merged-lines property if applicable
  if (line.mergedLineCount && line.mergedLineCount > 1) {
    properties['merged-lines'] = line.mergedLineCount;
  }
  
  return await makeRequest(host, token, 'logseq.Editor.insertBlock', [
    parentUuid,
    convertCheckboxToMarker(line.text),
    { sibling: false, properties }
  ]);
}
```

### Pros

✅ **Minimal Architecture Changes:**
- Uses existing Y-bounds property
- Only adds one new property: `merged-lines`
- Leverages existing canonical comparison system

✅ **Intuitive Semantics:**
- One block = one Y-range
- Naturally represents "this is a single unit"
- Easy to understand in LogSeq

✅ **Automatic Matching:**
- Re-transcription automatically finds overlapping lines
- No complex tracking or IDs needed
- "Just works" for most cases

✅ **Handles Variations:**
- MyScript can split differently (1 line, 2 lines, 3 lines)
- As long as combined text matches canonical → preserved
- Robust to minor Y-coordinate shifts

✅ **Data Integrity:**
- Clear audit trail (`merged-lines` count)
- Can validate expected vs actual overlapping lines
- Easy to detect issues

✅ **Backward Compatible:**
- Blocks without `merged-lines` property → treated as single line (current behavior)
- No migration needed

✅ **Simple UI Logic:**
- Merge = combine text + expand Y-bounds
- Split = divide Y-bounds proportionally
- Undo = restore original lines

### Cons

⚠️ **Y-Bounds Precision Loss:**
- Merged block spans larger Y-range than individual lines
- Could cause false matches if new handwriting overlaps
- Mitigation: Use `merged-lines` count to validate

⚠️ **Edge Case Handling:**
- What if MyScript returns 3 lines for a 2-line merge?
  - Solution: Compare combined text of all overlapping lines
- What if user writes tight handwriting with overlapping Y-ranges?
  - Already a limitation of Y-bounds approach

⚠️ **Split Ambiguity:**
- If user splits a merged block, how to allocate Y-bounds?
  - Solution: Use proportional division or re-calculate from strokes
  - Store original line Y-bounds in `source-lines` property?

⚠️ **No Explicit Line Identity:**
- Can't track "Line A + Line B = Merged"
- Only knows "these Y-ranges are one unit"
- Mitigation: Add optional `source-line-ids` for debugging

### Edge Cases

**Case 1: User Writes New Line Between Merged Lines**
```
Before: Merged Block (Y: 1234-1345, 2 lines)
User adds handwriting at Y: 1300
Re-transcription: 3 MyScript lines

Solution: All 3 overlap 1234-1345 → combine → compare canonical
If canonical matches (ignore new line) → SKIP
If canonical differs (new content) → UPDATE with 3 merged lines
```

**Case 2: MyScript Improves and Returns 1 Line Instead of 2**
```
Before: Merged Block (Y: 1234-1345, merged-lines: 2)
Re-transcription: 1 MyScript line "Review mockups for the new dashboard" (Y: 1234-1345)

Solution: 1 line overlaps → compare canonical
If match → SKIP (still counts as merged, even though MyScript improved)
If differs → UPDATE
```

**Case 3: User Corrects Handwriting, Changes Content**
```
Before: "Review mockups for the dashboard" (merged)
User erases "the" and writes "our"
Re-transcription: "Review mockups for our dashboard"

Solution: Canonical differs → UPDATE
Preserve merged-lines property if still 2+ overlapping lines
```

### Validation & Safety

**Validation Checks:**
```javascript
function validateMergedBlock(block, overlappingLines) {
  const expectedMerged = parseInt(block.properties['merged-lines']) || 1;
  const actualOverlapping = overlappingLines.length;
  
  if (Math.abs(expectedMerged - actualOverlapping) > 1) {
    // Significant mismatch - log warning
    console.warn(`Merged block expected ${expectedMerged} lines, found ${actualOverlapping}`);
    // Could prompt user in future: "Merge structure changed, review?"
  }
  
  return true; // Still proceed with comparison
}
```

**Conflict Resolution:**
```javascript
// If multiple merged blocks overlap the same line
function resolveMergeConflict(block1, block2, newLine) {
  // Option 1: Warn user and skip update
  // Option 2: Merge both blocks into one super-block
  // Option 3: Use block with closer Y-bounds match
  
  // Recommended: Option 3 - closest match
  const dist1 = Math.abs(block1.yBounds.minY - newLine.yBounds.minY);
  const dist2 = Math.abs(block2.yBounds.minY - newLine.yBounds.minY);
  
  return dist1 < dist2 ? block1 : block2;
}
```

---

## Option 2: Line Group ID Strategy

### Concept

Add a new property `line-group-id` to link related blocks. Each line keeps its original Y-bounds, but grouped lines share a group ID.

### Implementation

**UI Merge Action:**
```javascript
// User merges lines 1, 2, 3
const groupId = generateUUID(); // e.g., "lg-a1b2c3d4"

lines[0].lineGroupId = groupId;
lines[1].lineGroupId = groupId;
lines[2].lineGroupId = groupId;
```

**LogSeq Blocks:**
```markdown
stroke-y-bounds:: 1234.0-1289.0
canonical-transcript:: Review mockups for
line-group-id:: lg-a1b2c3d4
line-group-position:: 1
- Review mockups for

stroke-y-bounds:: 1290.0-1345.0
canonical-transcript:: the new dashboard
line-group-id:: lg-a1b2c3d4
line-group-position:: 2
- the new dashboard
```

**Re-Transcription Matching:**
```javascript
// 1. Find lines with same group ID
const groupedBlocks = existingBlocks.filter(b => 
  b.properties['line-group-id'] === 'lg-a1b2c3d4'
).sort((a, b) => 
  a.properties['line-group-position'] - b.properties['line-group-position']
);

// 2. Find new lines overlapping any grouped block
const overlappingLines = [];
for (const block of groupedBlocks) {
  const matching = newLines.filter(l => boundsOverlap(block.yBounds, l.yBounds));
  overlappingLines.push(...matching);
}

// 3. Combine and compare
const combinedText = overlappingLines.map(l => l.text).join(' ');
const combinedCanonical = normalizeTranscript(combinedText);
const storedCanonical = groupedBlocks.map(b => 
  b.properties['canonical-transcript']
).join(' ');

if (combinedCanonical === storedCanonical) {
  // SKIP - preserve all blocks in group
}
```

### Pros

✅ **Preserves Original Y-Bounds:**
- Each line keeps precise Y-coordinate
- No precision loss
- Better debugging

✅ **Clear Semantic Grouping:**
- Explicit "these lines belong together"
- Can track complex groupings
- Easy to visualize in LogSeq queries

✅ **Reversible:**
- Can ungroup by removing `line-group-id`
- Clear audit trail

### Cons

❌ **Complex State Management:**
- Need to generate/track UUIDs
- Multiple blocks to update atomically
- Group metadata to maintain

❌ **Property Proliferation:**
- 2 new properties per block (`line-group-id`, `line-group-position`)
- More visual clutter in LogSeq
- Harder for users to understand

❌ **Partial Match Complexity:**
- What if only 1 of 3 grouped lines overlaps?
- What if overlapping lines match different groups?
- Conflict resolution much harder

❌ **UI Complexity:**
- Need to show group boundaries in editor
- Harder to visualize "what's grouped?"
- More complex undo/redo logic

❌ **Performance:**
- Need to query by group ID across blocks
- More expensive matching algorithm
- Harder to optimize

### Recommendation

**Not recommended** due to complexity and maintenance burden. The grouped-blocks approach works better when blocks naturally have hierarchy (parent-child), not when artificial grouping is needed.

---

## Option 3: Merged Block with Source Line Metadata

### Concept

Store merged lines as single block, but preserve original line information in a structured property.

### Implementation

**UI Merge Action:**
```javascript
const mergedLine = {
  text: line1.text + ' ' + line2.text,
  canonical: normalizeTranscript(...),
  yBounds: { minY: 1234, maxY: 1345 },
  sourceLines: [
    { index: 0, yBounds: '1234.0-1289.0', canonical: 'Review mockups for' },
    { index: 1, yBounds: '1290.0-1345.0', canonical: 'the new dashboard' }
  ]
};
```

**LogSeq Block:**
```markdown
stroke-y-bounds:: 1234.0-1345.0
canonical-transcript:: Review mockups for the new dashboard
source-lines:: 0:1234.0-1289.0:Review mockups for|1:1290.0-1345.0:the new dashboard
- Review mockups for the new dashboard
```

### Pros

✅ **Complete Audit Trail:**
- Can reconstruct original lines
- Clear history of merge operation
- Easier to debug issues

✅ **Reversible:**
- Can split back to original lines
- Preserves precise Y-bounds

### Cons

❌ **Property Format Complexity:**
- Pipe-delimited, nested format
- Hard to parse/maintain
- Prone to escaping issues (what if text has `|`?)

❌ **Property Value Size:**
- Could be very long for many merged lines
- LogSeq property limits?

❌ **Redundant Data:**
- Source canonical duplicates overall canonical
- Storage inefficiency

### Recommendation

**Not recommended** due to property format complexity and parsing brittleness. The benefits of preserving original line info don't outweigh the maintenance cost.

---

## Option 4: Consolidation Rules Section

### Concept

Create a separate section in the page storing consolidation rules as a map.

### Implementation

**LogSeq Page Structure:**
```markdown
## Consolidation Rules

- rule:: Y:1234-1345 → merge-lines-2
- rule:: Y:1500-1600 → single-line

## Transcribed Content #Display_No_Properties

stroke-y-bounds:: 1234.0-1345.0
canonical-transcript:: Review mockups for the new dashboard
- Review mockups for the new dashboard
```

**Re-Transcription Logic:**
```javascript
// 1. Load consolidation rules from page
const rules = await getConsolidationRules(book, page, host, token);

// 2. Apply rules to new MyScript lines BEFORE creating blocks
const processedLines = applyConsolidationRules(newLines, rules);

// 3. Create blocks from processed lines
```

### Pros

✅ **Clean Separation:**
- Rules separate from content
- Easy to view all consolidation decisions
- Can modify rules independently

✅ **Source of Truth:**
- Single place to check "what's merged?"
- Clear documentation

### Cons

❌ **Extra Section to Maintain:**
- More code to parse/update rules section
- Rules could become stale
- Need UI to manage rules separately

❌ **Two-Phase Logic:**
- Must load rules, then apply, then create blocks
- More opportunities for errors
- Harder to ensure consistency

❌ **Rule Staleness:**
- What if handwriting Y-bounds shift?
- Rules might not match anymore
- Need UI for "rule health" monitoring

### Recommendation

**Not recommended** for this use case. Better suited for global configuration (e.g., "always merge lines on this page template") rather than per-line decisions.

---

## Option 5: Combined Canonical with Enhanced Matching

### Concept

Similar to Option 1, but with enhanced matching algorithm that handles more edge cases.

### Key Enhancement

**Smart Line Grouping:**
```javascript
function groupLinesByMergedBlocks(existingBlocks, newLines) {
  const groups = [];
  
  for (const block of existingBlocks) {
    const mergedCount = parseInt(block.properties['merged-lines']) || 1;
    
    if (mergedCount === 1) {
      // Single line - use existing logic
      const overlapping = findOverlappingLines(block, newLines);
      groups.push({ block, lines: overlapping, type: 'single' });
    } else {
      // Merged block - gather ALL overlapping lines
      const overlapping = findOverlappingLines(block, newLines);
      
      // Validate count
      if (overlapping.length < mergedCount - 1 || overlapping.length > mergedCount + 1) {
        console.warn(`Merged block count mismatch: expected ${mergedCount}, found ${overlapping.length}`);
      }
      
      groups.push({ block, lines: overlapping, type: 'merged' });
    }
  }
  
  return groups;
}
```

**Enhanced Validation:**
```javascript
function validateMergeIntegrity(block, overlappingLines) {
  const expectedCount = parseInt(block.properties['merged-lines']) || 1;
  const actualCount = overlappingLines.length;
  
  return {
    valid: Math.abs(expectedCount - actualCount) <= 1,
    confidence: actualCount / expectedCount,
    warning: expectedCount !== actualCount ? 
      `Line count mismatch: expected ${expectedCount}, found ${actualCount}` : null
  };
}
```

### Pros

✅ All benefits of Option 1, plus:
- Better edge case handling
- Validation and confidence scores
- More robust to variations

### Cons

⚠️ More complex implementation
⚠️ Requires thorough testing of edge cases

### Recommendation

**Recommended** if implementing Option 1. The enhanced validation is worth the extra complexity.

---

## Final Recommendation: Option 1 (Enhanced)

### Why Option 1 is Best

**Aligns with Josh's Requirements:**
1. ✅ **Streamlined UX:** Merge = expand Y-bounds, that's it
2. ✅ **Robust:** Canonical comparison ensures data integrity
3. ✅ **Just Works:** Automatic matching, no user intervention
4. ✅ **No Data Loss:** All user edits preserved via canonical comparison
5. ✅ **Minimal Architecture Changes:** Builds on existing v2.0 system

**Technical Soundness:**
- Leverages existing Y-bounds and canonical properties
- Only adds one new property (`merged-lines`)
- Natural extension of current matching logic
- Backward compatible (no migration needed)
- Clear semantics (one block = one Y-range)

**Implementation Simplicity:**
- ~200-300 lines of new code
- Modifications to 3 files (myscript-api.js, transcript-updater.js, logseq-api.js)
- Plus new modal UI component (already spec'd)
- Can be implemented incrementally

**Failure Modes:**
- Y-bounds shifts → canonical comparison still catches changes
- MyScript line count changes → compare combined text regardless
- User edits → canonical unchanged → preserved
- New handwriting → Y-bounds don't overlap → new block created

### Implementation Roadmap

**Phase 1: Core Merge Logic (8-12 hours)**
- Update `detectBlockActions` to handle merged blocks
- Add `merged-lines` property support
- Implement combined line comparison
- Add validation checks

**Phase 2: UI Integration (12-16 hours)**
- Build transcription editor modal (from spec)
- Implement merge/split actions
- Add preview pane showing results
- Wire up to save function

**Phase 3: Edge Case Handling (6-8 hours)**
- Handle count mismatches (more/fewer overlapping lines)
- Validate merge integrity
- Add conflict resolution for overlapping merged blocks
- Implement undo/redo for editor

**Phase 4: Testing & Polish (8-10 hours)**
- Test with real handwriting data
- Test re-transcription scenarios
- Test edge cases (tight handwriting, reordering, etc.)
- Performance testing with large pages

**Total Estimate:** 34-46 hours for complete implementation

---

## Next Steps

1. **Review & Approve:** Confirm Option 1 (Enhanced) as the approach
2. **Detailed Technical Spec:** Create implementation spec with code samples
3. **UI Mockup Refinement:** Finalize modal interface design
4. **Implement Core Logic:** Start with Phase 1 (merge matching)
5. **Build Modal UI:** Implement editor with merge/split actions
6. **Integration Testing:** Test full workflow end-to-end
7. **Documentation:** Update user docs and architecture docs

---

## Questions for Discussion

1. **Property Naming:**
   - `merged-lines` vs `line-count` vs `merged-from-count`?
   - Should we add optional `source-line-ids` for debugging?

2. **Edge Case Tolerance:**
   - How much count mismatch is acceptable? (currently: ±1)
   - Should we prompt user if validation fails?

3. **UI Preferences:**
   - Default to suggesting merges or require explicit action?
   - Show merge suggestions in preview pane?

4. **Undo Strategy:**
   - Store merge history in component state?
   - Allow re-opening editor to unmerge?

5. **Performance:**
   - Any concerns with large pages (100+ lines)?
   - Should we batch property updates?

---

## Appendix A: Complete Workflow Example

This section walks through a complete technical workflow showing how data flows at each step, from initial transcription through user merge to re-transcription.

### Step 1: Initial Transcription

**User writes on paper:**
```
Review mockups for
the new dashboard
```

**MyScript returns:**
```javascript
transcription.lines = [
  {
    text: "Review mockups for",
    canonical: "Review mockups for",
    yBounds: { minY: 1234, maxY: 1249 },
    mergedLineCount: 1  // default
  },
  {
    text: "the new dashboard",
    canonical: "the new dashboard",
    yBounds: { minY: 1290, maxY: 1305 },
    mergedLineCount: 1  // default
  }
]
```

**LogSeq Database (initial save):**
```markdown
## Transcribed Content #Display_No_Properties

stroke-y-bounds:: 1234.0-1249.0
canonical-transcript:: Review mockups for
- Review mockups for

stroke-y-bounds:: 1290.0-1305.0
canonical-transcript:: the new dashboard
- the new dashboard
```

### Step 2: User Merges Lines in UI

**User clicks [merge ↓] in editor modal:**
```javascript
function mergeLines(lineIndex) {
  const line1 = editState.lines[0];
  const line2 = editState.lines[1];
  
  const mergedLine = {
    text: "Review mockups for the new dashboard",
    canonical: "Review mockups for the new dashboard",
    yBounds: { minY: 1234, maxY: 1305 },  // EXPANDED
    mergedLineCount: 2,  // AUTOMATIC
    userMerged: true,
    deletedBlockUuid: line2.blockUuid
  };
}
```

**Saved to LogSeq:**
```markdown
## Transcribed Content #Display_No_Properties

stroke-y-bounds:: 1234.0-1305.0
canonical-transcript:: Review mockups for the new dashboard
merged-lines:: 2
- Review mockups for the new dashboard

(second block deleted)
```

### Step 3: User Adds More Handwriting

**User writes:**
```
Check emails
Call John
```

**User clicks "Transcribe" again with ALL strokes**

### Step 4: Re-Transcription Matching

**MyScript still returns 4 lines:**
```javascript
newLines = [
  { text: "Review mockups for", yBounds: { minY: 1234, maxY: 1249 } },
  { text: "the new dashboard", yBounds: { minY: 1290, maxY: 1305 } },
  { text: "Check emails", yBounds: { minY: 1400, maxY: 1415 } },
  { text: "Call John", yBounds: { minY: 1500, maxY: 1515 } }
]
```

**detectBlockActions logic:**
```javascript
// Load existing block:
existingBlock = {
  uuid: 'block-uuid-1',
  properties: {
    'stroke-y-bounds': '1234.0-1305.0',
    'merged-lines': '2'  // KEY!
  }
};

const blockBounds = { minY: 1234, maxY: 1305 };
const mergedCount = 2;  // Read from property

// Find overlapping lines:
const overlapping = [
  newLines[0],  // Y: 1234-1249 - OVERLAPS
  newLines[1]   // Y: 1290-1305 - OVERLAPS
];
// newLines[2] and [3] do NOT overlap

if (mergedCount > 1 && overlapping.length > 0) {
  // This is a merged block!
  const combinedText = "Review mockups for the new dashboard";
  const combinedCanonical = "Review mockups for the new dashboard";
  const storedCanonical = "Review mockups for the new dashboard";
  
  if (combinedCanonical === storedCanonical) {
    // ✅ MATCH! Preserve merged block
    actions.push({
      type: 'SKIP_MERGED',
      blockUuid: 'block-uuid-1',
      consumedLineIndices: [0, 1]
    });
  }
}

// Process remaining lines:
actions.push({ type: 'CREATE', line: newLines[2] });
actions.push({ type: 'CREATE', line: newLines[3] });
```

**Final LogSeq state:**
```markdown
## Transcribed Content #Display_No_Properties

stroke-y-bounds:: 1234.0-1305.0
canonical-transcript:: Review mockups for the new dashboard
merged-lines:: 2
- Review mockups for the new dashboard

stroke-y-bounds:: 1400.0-1415.0
canonical-transcript:: Check emails
- Check emails

stroke-y-bounds:: 1500.0-1515.0
canonical-transcript:: Call John
- Call John
```

**Result:** ✅ Merged block preserved, new blocks added!

### Step 5: User Edits in LogSeq

**User manually changes:**
```markdown
- DONE Review mockups for the new dashboard #urgent
```

**Next re-transcription:**
```javascript
// Canonical comparison:
stored: "Review mockups for the new dashboard"
new combined: "Review mockups for the new dashboard"

// ✅ MATCH! Even though block content has "DONE" and "#urgent"
// Result: User's edits preserved!
```

---

**Document Version:** 1.1  
**Prepared By:** Claude  
**Date:** January 22, 2026  
**Last Updated:** January 22, 2026
