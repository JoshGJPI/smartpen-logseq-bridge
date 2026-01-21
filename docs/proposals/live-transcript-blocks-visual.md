# Live Transcript Blocks - Visual Overview

This document provides visual diagrams to understand the transition from static code blocks to live transcript blocks.

---

## Before & After Comparison

### Current (Static Code Block)

```
# Smartpen Data/B3017/P42
book:: 3017
page:: 42

## Raw Stroke Data
[...stroke data in JSON...]

## Transcribed Text
```
Meeting notes - Q1 Planning
  Discussed roadmap priorities
  Need feedback from design team
Action Items
  Schedule follow-up meeting
```
```

**Characteristics:**
- Single code block contains all text
- No properties linking to strokes
- Plain text with indentation formatting
- Must replace entire block on updates
- Cannot use LogSeq features (TODO, tags, etc.)

---

### Proposed (Live Blocks with Vertical Bounds)

```
# Smartpen Data/B3017/P42
book:: 3017
page:: 42

## Raw Stroke Data
[...stroke data in JSON...]

## Transcribed Content
transcription-date:: 2025-01-20
total-lines:: 5
total-strokes:: 49

stroke-y-bounds:: 1000.0-1050.0
stroke-count:: 12
last-transcribed:: 1738259200000
- Meeting notes - Q1 Planning

stroke-y-bounds:: 1075.0-1125.0
stroke-count:: 8
last-transcribed:: 1738259200000
  - Discussed roadmap priorities

stroke-y-bounds:: 1125.0-1175.0
stroke-count:: 10
last-transcribed:: 1738259200000
  - Need feedback from design team

stroke-y-bounds:: 1200.0-1250.0
stroke-count:: 5
last-transcribed:: 1738259200000
- Action Items

stroke-y-bounds:: 1250.0-1300.0
stroke-count:: 9
last-transcribed:: 1738259200000
  - Schedule follow-up meeting
```

**Characteristics:**
- Each line is a separate LogSeq block
- Properties track vertical bounds (Y-coordinates)
- Hierarchy maintained via block nesting
- Can update individual blocks
- Native LogSeq features work immediately
- Stroke-to-block mapping preserved

---

## Vertical Bounds Concept

### Handwriting on Paper (Vertical View)

```
Y=1000 ─────────────────────────────────────────────
       Meeting notes - Q1 Planning
Y=1050 ─────────────────────────────────────────────
       [gap: 25 Ncode units]
Y=1075 ─────────────────────────────────────────────
         Discussed roadmap priorities
Y=1125 ─────────────────────────────────────────────
         Need feedback from design team
Y=1175 ─────────────────────────────────────────────
       [gap: 25 Ncode units]
Y=1200 ─────────────────────────────────────────────
       Action Items
Y=1250 ─────────────────────────────────────────────
         Schedule follow-up meeting
Y=1300 ─────────────────────────────────────────────
```

Each horizontal band (defined by minY-maxY) corresponds to one line of text.

### Stroke Distribution

```
Line 1: "Meeting notes..."
  Strokes at Y: 1005, 1010, 1015, 1020, 1025, 1030, 1035, 1040, 1045
  Bounds: 1000-1050 (50 Ncode units ≈ 0.12mm)

Line 2: "Discussed roadmap..."
  Strokes at Y: 1080, 1085, 1090, 1095, 1100, 1105, 1110, 1115
  Bounds: 1075-1125 (50 Ncode units)

[etc...]
```

---

## Update Workflow Comparison

### Current Workflow (All-or-Nothing)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User writes 15 lines                                      │
│    [Pen] ──> [Canvas: 15 strokes]                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. User clicks "Transcribe"                                  │
│    [Canvas] ──> [MyScript API] ──> [15 lines returned]       │
│    Cost: 1 API call                                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. User clicks "Save to LogSeq"                              │
│    [15 lines] ──> [Single code block in LogSeq]              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. User adds 2 more lines later                              │
│    [Pen] ──> [Canvas: +2 strokes, total 17]                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. User must re-transcribe ALL 17 lines                      │
│    [Canvas: 17 strokes] ──> [MyScript API] ──> [17 lines]    │
│    Cost: 1 API call (wasteful - 15 lines unchanged)          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. User replaces entire code block                           │
│    [17 lines] ──> [Replace code block in LogSeq]             │
│    ⚠️  Any manual edits in LogSeq are lost                    │
└─────────────────────────────────────────────────────────────┘
```

**Total API calls:** 2 (initial + update)
**User friction:** High (must re-transcribe everything)

---

### Proposed Workflow (Incremental)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User writes 15 lines                                      │
│    [Pen] ──> [Canvas: 15 strokes]                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. User clicks "Transcribe"                                  │
│    [Canvas] ──> [MyScript API] ──> [15 lines + Y-bounds]     │
│    Cost: 1 API call                                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. User clicks "Update Blocks"                               │
│    Algorithm checks: No existing blocks                      │
│    Action: CREATE 15 new blocks with properties              │
│    [15 lines] ──> [15 LogSeq blocks with Y-bounds]           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. User adds 2 more lines later                              │
│    [Pen] ──> [Canvas: +2 strokes at Y=1350-1400]             │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. User transcribes ONLY new strokes                         │
│    [Canvas: 2 new strokes] ──> [MyScript API] ──> [2 lines]  │
│    Cost: 1 API call (efficient - only new content)           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. User clicks "Update Blocks"                               │
│    Algorithm checks:                                         │
│      - Line 1 (Y: 1350-1375): No overlap ──> CREATE          │
│      - Line 2 (Y: 1375-1400): No overlap ──> CREATE          │
│    Action: Append 2 new blocks to existing 15                │
│    ✅ Existing 15 blocks unchanged (user edits preserved)     │
└─────────────────────────────────────────────────────────────┘
```

**Total API calls:** 2 (initial + incremental)
**User friction:** Low (only transcribe new content)
**Benefit:** Existing blocks preserved, user edits maintained

---

## Stroke-to-Block Mapping

### Data Flow

```
┌──────────────┐
│   Strokes    │
│   (Canvas)   │
└──────┬───────┘
       │
       │ Group by Y-position
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Stroke Groups by Vertical Band                           │
│                                                           │
│ Band 1 (Y: 1000-1050):                                   │
│   s1738259100123, s1738259100145, ...                    │
│                                                           │
│ Band 2 (Y: 1075-1125):                                   │
│   s1738259100234, s1738259100267, ...                    │
│                                                           │
│ Band 3 (Y: 1125-1175):                                   │
│   s1738259100345, s1738259100389, ...                    │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ Send to MyScript
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│ MyScript Transcription                                    │
│                                                           │
│ Line 1: "Meeting notes"                                  │
│   Words: [Meeting, notes]                                │
│   Word bounds: { x, y, width, height }                   │
│   Stroke IDs: [s1738259100123, s1738259100145, ...]      │
│                                                           │
│ Line 2: "Discussed roadmap"                              │
│   Words: [Discussed, roadmap]                            │
│   Stroke IDs: [s1738259100234, s1738259100267, ...]      │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ Calculate Y-bounds
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│ Enhanced Lines with Bounds                                │
│                                                           │
│ {                                                         │
│   text: "Meeting notes",                                 │
│   strokeIds: Set(["s1738259100123", ...]),               │
│   yBounds: { minY: 1000, maxY: 1050 },                   │
│   indentLevel: 0                                          │
│ }                                                         │
└───────────────────┬──────────────────────────────────────┘
                    │
                    │ Create LogSeq blocks
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│ LogSeq Blocks with Properties                             │
│                                                           │
│ Block UUID: abc-123-def-456                              │
│ Content: "Meeting notes"                                 │
│ Properties: {                                             │
│   "stroke-y-bounds": "1000.0-1050.0",                    │
│   "stroke-count": 12,                                     │
│   "last-transcribed": 1738259200000                       │
│ }                                                         │
└──────────────────────────────────────────────────────────┘
```

---

## Update Detection Algorithm

### Scenario: Adding New Strokes

```
EXISTING BLOCKS IN LOGSEQ:
┌─────────────────────────────────────────────────────────────┐
│ Block 1: Y-bounds 1000-1050                                  │
│   Content: "Meeting notes"                                  │
│   UUID: abc-123                                             │
├─────────────────────────────────────────────────────────────┤
│ Block 2: Y-bounds 1075-1125                                  │
│   Content: "Discussed roadmap"                              │
│   UUID: def-456                                             │
├─────────────────────────────────────────────────────────────┤
│ Block 3: Y-bounds 1125-1175                                  │
│   Content: "Need feedback"                                  │
│   UUID: ghi-789                                             │
└─────────────────────────────────────────────────────────────┘

NEW STROKES ADDED:
┌─────────────────────────────────────────────────────────────┐
│ Stroke group at Y: 1200-1250                                 │
│   "Action Items"                                             │
├─────────────────────────────────────────────────────────────┤
│ Stroke group at Y: 1250-1300                                 │
│   "Schedule follow-up"                                       │
└─────────────────────────────────────────────────────────────┘

ALGORITHM EXECUTION:
┌─────────────────────────────────────────────────────────────┐
│ For each new line:                                           │
│                                                              │
│ Line 4 (Y: 1200-1250):                                       │
│   Check overlaps with existing blocks:                       │
│     Block 1 (1000-1050): No overlap                         │
│     Block 2 (1075-1125): No overlap                         │
│     Block 3 (1125-1175): No overlap                         │
│   → ACTION: CREATE new block                                │
│                                                              │
│ Line 5 (Y: 1250-1300):                                       │
│   Check overlaps with existing blocks:                       │
│     Block 1 (1000-1050): No overlap                         │
│     Block 2 (1075-1125): No overlap                         │
│     Block 3 (1125-1175): No overlap                         │
│     Block 4 (1200-1250): No overlap (just created)          │
│   → ACTION: CREATE new block                                │
└─────────────────────────────────────────────────────────────┘

RESULT:
┌─────────────────────────────────────────────────────────────┐
│ Block 1: Y-bounds 1000-1050 (unchanged)                      │
│   Content: "Meeting notes"                                  │
├─────────────────────────────────────────────────────────────┤
│ Block 2: Y-bounds 1075-1125 (unchanged)                      │
│   Content: "Discussed roadmap"                              │
├─────────────────────────────────────────────────────────────┤
│ Block 3: Y-bounds 1125-1175 (unchanged)                      │
│   Content: "Need feedback"                                  │
├─────────────────────────────────────────────────────────────┤
│ Block 4: Y-bounds 1200-1250 (NEW)                            │
│   Content: "Action Items"                                   │
│   UUID: jkl-012                                             │
├─────────────────────────────────────────────────────────────┤
│ Block 5: Y-bounds 1250-1300 (NEW)                            │
│   Content: "Schedule follow-up"                             │
│   UUID: mno-345                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Scenario: Updating Existing Content

```
EXISTING BLOCK:
┌─────────────────────────────────────────────────────────────┐
│ Block 1: Y-bounds 1000-1050                                  │
│   Content: "Meeting notes"                                  │
│   UUID: abc-123                                             │
└─────────────────────────────────────────────────────────────┘

USER ADDS STROKES IN SAME AREA (Y: 1010-1045):
- Adds " - Q1 Planning" to end of line

NEW TRANSCRIPTION:
┌─────────────────────────────────────────────────────────────┐
│ Line 1 (Y: 1000-1050):                                       │
│   Content: "Meeting notes - Q1 Planning"                    │
└─────────────────────────────────────────────────────────────┘

ALGORITHM EXECUTION:
┌─────────────────────────────────────────────────────────────┐
│ Line 1 (Y: 1000-1050):                                       │
│   Check overlaps with existing blocks:                       │
│     Block 1 (1000-1050): OVERLAP DETECTED                   │
│   Compare content:                                           │
│     Old: "Meeting notes"                                    │
│     New: "Meeting notes - Q1 Planning"                      │
│   → ACTION: UPDATE block abc-123                            │
└─────────────────────────────────────────────────────────────┘

RESULT:
┌─────────────────────────────────────────────────────────────┐
│ Block 1: Y-bounds 1000-1050 (UPDATED)                        │
│   Content: "Meeting notes - Q1 Planning"                    │
│   UUID: abc-123 (same UUID, content changed)                │
│   Properties updated:                                        │
│     stroke-count: 12 → 18                                   │
│     last-transcribed: updated timestamp                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Visual Canvas Integration

### Current Canvas (No Mapping)

```
┌─────────────────────────────────────────────────────────────┐
│ Canvas View                                                  │
│                                                              │
│   [All strokes rendered]                                    │
│   User can select strokes manually                          │
│   No visual indication of lines/blocks                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Enhanced Canvas (With Y-Bounds Visualization)

```
┌─────────────────────────────────────────────────────────────┐
│ Canvas View                                                  │
│                                                              │
│ Y=1000 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│        Meeting notes - Q1 Planning                          │
│ Y=1050 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Y=1075 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│          Discussed roadmap priorities                        │
│ Y=1125 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Y=1200 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│        Action Items                                         │
│ Y=1250 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Horizontal bands show Y-bounds of each line                 │
│ Hover over line in UI → highlight band in canvas            │
│ Click line in UI → select all strokes in that Y-range       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Process Visual

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Scan Existing Pages                                 │
│                                                              │
│ App scans LogSeq for pages with:                            │
│   ✓ "## Transcribed Text" heading                          │
│   ✓ Code block child                                        │
│   ✓ "## Raw Stroke Data" (strokes available)               │
│                                                              │
│ Found 23 pages eligible for migration                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: User Selects Pages                                  │
│                                                              │
│ ☑ B3017/P1 - Meeting notes (15 lines)                      │
│ ☑ B3017/P2 - Action items (8 lines)                        │
│ ☐ B3017/P3 - Brainstorm (25 lines)                         │
│ ...                                                          │
│                                                              │
│ [Migrate Selected (2 pages)] [Migrate All (23 pages)]      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: For Each Page                                       │
│                                                              │
│ Processing B3017/P1...                                      │
│   ✓ Read stroke data (127 strokes)                         │
│   ✓ Re-transcribe via MyScript                             │
│   ✓ Calculate Y-bounds for 15 lines                        │
│   ✓ Archive old code block to "## Archived Transcripts"    │
│   ✓ Create 15 new live blocks with properties              │
│   ✓ Validate: all text preserved                           │
│                                                              │
│ Result: ✓ Success (15 blocks created)                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Summary                                              │
│                                                              │
│ Migration complete!                                          │
│   ✓ 2 pages migrated                                        │
│   ✓ 23 live blocks created                                  │
│   ✓ 0 errors                                                │
│   ✓ Old transcripts archived                                │
│                                                              │
│ [View Migrated Pages] [Close]                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Benefits Illustrated

### Benefit 1: Granular Updates

```
BEFORE (Static Code Block):
- Add 1 new line
- Must re-transcribe ALL lines (wasteful)
- Replace entire code block (lose edits)

AFTER (Live Blocks):
- Add 1 new line
- Transcribe ONLY that line
- Create ONLY that block (preserve existing)
```

### Benefit 2: Native LogSeq Features

```
BEFORE (Static Code Block):
```
Meeting notes
  - Discussed roadmap
  - Action items
```
↓ Must manually copy to use features ↓
- Meeting notes
  - Discussed roadmap
  - TODO Action items  ← manually added TODO

AFTER (Live Blocks):
- Meeting notes
  - Discussed roadmap
  - TODO Action items  ← just click TODO directly!
```

### Benefit 3: Persistent Mapping

```
BEFORE (Static Code Block):
Q: Which strokes created "Action items"?
A: Unknown - no mapping preserved

AFTER (Live Blocks):
Q: Which strokes created "Action items"?
A: stroke-y-bounds: 1200-1250
   Click line → strokes highlighted in canvas
```

---

## Summary

The transition from static code blocks to live transcript blocks with vertical bounds enables:

1. **Incremental updates** - Only transcribe and update what changed
2. **Native features** - Use LogSeq's TODO, tags, references immediately
3. **Persistent mapping** - Always know which strokes → which blocks
4. **Better UX** - Visual feedback, stroke highlighting, granular control
5. **Reduced costs** - Fewer MyScript API calls (only new content)

**Trade-off:** More complexity in implementation, but significant workflow improvements for users.

---

**For full technical details, see:**
- [live-transcript-blocks-spec.md](./live-transcript-blocks-spec.md) - Complete specification
- [live-transcript-blocks-summary.md](./live-transcript-blocks-summary.md) - Executive summary
