# Live Transcript Blocks - Visual Guide (v0.2.0)

**Focus:** Checkbox preservation and simplified properties

---

## Properties Schema (Before vs After)

### Version 0.1.0 (Original)

```
stroke-y-bounds:: 1234.56-1289.34
stroke-count:: 15
stroke-ids:: s1738259100123,s1738259100234,...
last-transcribed:: 1738259200000
transcription-version:: 1.0
- Meeting notes
```

**Problems:**
- Too many properties
- `stroke-count` needs updating on every change
- `last-transcribed` not used in logic
- `stroke-ids` too long for LogSeq

### Version 0.2.0 (Simplified)

```
stroke-y-bounds:: 1234.56-1289.34
canonical-transcript:: [ ] Review mockups
- TODO Review mockups
```

**Benefits:**
- Only 2 properties
- `canonical-transcript` enables preservation
- Simple comparison logic
- No maintenance overhead

---

## Checkbox Preservation Flow

### Problem Scenario

```
Day 1:
┌────────────────────────────────────────┐
│ User writes on paper: ☐ Review design │
└────────────────┬───────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│ MyScript transcribes: "☐ Review design"│
└────────────────┬───────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│ Create LogSeq block:                   │
│   Content: "TODO Review design"        │
│   Properties:                          │
│     canonical: "[ ] Review design"     │
└────────────────┬───────────────────────┘
                 │
Day 2:           ▼
┌────────────────────────────────────────┐
│ User checks off in LogSeq:             │
│   Content: "DONE Review design"        │
│   Properties (unchanged):              │
│     canonical: "[ ] Review design"     │
└────────────────┬───────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│ User re-transcribes SAME strokes       │
│ MyScript returns: "☐ Review design"   │
│ New canonical: "[ ] Review design"     │
└────────────────┬───────────────────────┘
                 │
                 ▼
          ┌──────────────┐
          │  COMPARISON  │
          └──────┬───────┘
                 │
    ┌────────────┴────────────┐
    │ Compare:                │
    │   Stored: "[ ] Review"  │
    │   New: "[ ] Review"     │
    │   → MATCH!              │
    └────────────┬────────────┘
                 │
                 ▼
┌────────────────────────────────────────┐
│ Result: SKIP UPDATE                    │
│   Content remains: "DONE Review design"│
│   User's check-off PRESERVED ✅        │
└────────────────────────────────────────┘
```

---

## Canonical Comparison (Key Innovation)

### What Gets Compared

```
╔════════════════════════════════════════╗
║         LogSeq Block State             ║
╠════════════════════════════════════════╣
║ content: "DONE Task #urgent @john"     ║ ← User can edit freely
║                                        ║
║ properties:                            ║
║   canonical: "[ ] Task"                ║ ← Compare against THIS
║   stroke-y-bounds: "1234-1289"         ║
╚════════════════════════════════════════╝

           ↓ User re-transcribes ↓

╔════════════════════════════════════════╗
║        New MyScript Result             ║
╠════════════════════════════════════════╣
║ Raw text: "☐ Task"                     ║
║ Normalized: "[ ] Task"                 ║ ← Compare with stored canonical
╚════════════════════════════════════════╝

           ↓ Comparison ↓

"[ ] Task" === "[ ] Task" → MATCH!
→ Skip update, preserve user edits ✅
```

### Without Canonical (Wrong Approach)

```
Compare: "DONE Task #urgent @john" vs "☐ Task"
         → DIFFERENT!
         → Triggers update
         → Overwrites user edits ❌
```

---

## Normalization Examples

### Checkbox Symbols → Canonical Form

```
Input                    Canonical
────────────────────────────────────────
"☐ Task"             →  "[ ] Task"
"☑ Completed"        →  "[x] Completed"
"☒ Done"             →  "[x] Done"
"  ☐  Spaced  "      →  "[ ] Spaced"
"Regular text"       →  "Regular text"
```

### Canonical Form → LogSeq Markers

```
Canonical              LogSeq Block Content
────────────────────────────────────────────
"[ ] Task"          →  "TODO Task"
"[x] Task"          →  "DONE Task"
"Regular text"      →  "Regular text"
```

---

## Update Decision Tree

```
                    New Transcript
                         │
                         ▼
              Calculate Y-bounds
                         │
                         ▼
           Find overlapping blocks
                         │
         ┌───────────────┴───────────────┐
         │                               │
    No overlap                    Single overlap
         │                               │
         ▼                               ▼
    CREATE NEW                   Compare canonicals
      BLOCK                              │
                        ┌────────────────┴────────────────┐
                        │                                 │
                   Match                             Different
                        │                                 │
                        ▼                                 ▼
                   SKIP UPDATE                       UPDATE BLOCK
              (preserve user edits)              (preserve markers)
                        │                                 │
                        ▼                                 ▼
              Block unchanged ✅                Content updated
                                              Properties updated
                                              Try to preserve TODO/DONE
```

---

## Preservation During Updates

### Scenario: Strokes Added to Existing Line

```
Initial:
┌─────────────────────────────────────┐
│ Strokes: ☐ Task                     │
│ Block content: "DONE Task"          │
│ Canonical: "[ ] Task"               │
└─────────────────────────────────────┘

User adds more handwriting:
┌─────────────────────────────────────┐
│ Strokes: ☐ Task - update mockups   │
│                                     │
│ MyScript: "☐ Task - update mockups"│
│ New canonical: "[ ] Task - update"  │
└─────────────────────────────────────┘

Comparison:
┌─────────────────────────────────────┐
│ Stored: "[ ] Task"                  │
│ New: "[ ] Task - update"            │
│ → DIFFERENT! Update needed          │
└─────────────────────────────────────┘

Preservation logic:
┌─────────────────────────────────────┐
│ Old content: "DONE Task"            │
│   → Had "DONE" marker               │
│                                     │
│ New transcript: "☐ Task - update"   │
│   → Converts to "TODO Task - update"│
│   → Sees old had "DONE"             │
│   → Preserves it                    │
│                                     │
│ Result: "DONE Task - update" ✅     │
└─────────────────────────────────────┘
```

---

## LogSeq API Operations

### Create Block (Single Call)

```
┌─────────────────────────────────────────┐
│ logseq.Editor.insertBlock               │
├─────────────────────────────────────────┤
│ Args:                                   │
│   parentUuid                            │
│   content: "TODO Review mockups"        │
│   options: {                            │
│     sibling: false,                     │
│     properties: {                       │
│       'stroke-y-bounds': '1234-1289',   │
│       'canonical-transcript': '[ ]...'  │
│     }                                   │
│   }                                     │
└─────────────────────────────────────────┘
```

### Update Block (Separate Calls)

```
┌─────────────────────────────────────────┐
│ Step 1: Update Content                  │
├─────────────────────────────────────────┤
│ logseq.Editor.updateBlock               │
│   blockUuid                             │
│   newContent: "DONE Task - updated"     │
└─────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────┐
│ Step 2: Upsert Property (bounds)        │
├─────────────────────────────────────────┤
│ logseq.Editor.upsertBlockProperty       │
│   blockUuid                             │
│   'stroke-y-bounds'                     │
│   '1234.5-1300.0'                       │
└─────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────┐
│ Step 3: Upsert Property (canonical)     │
├─────────────────────────────────────────┤
│ logseq.Editor.upsertBlockProperty       │
│   blockUuid                             │
│   'canonical-transcript'                │
│   '[ ] Task - updated'                  │
└─────────────────────────────────────────┘

Note: upsertBlockProperty preserves other
properties that user may have added
```

---

## Real-World Example

### Meeting Notes Workflow

```
Monday Morning:
Write 10 lines of meeting notes with checkboxes
  ☐ Review Q1 roadmap
  ☐ Schedule design review
  ☐ Update project timeline

Transcribe & Save:
  Creates 10 LogSeq blocks with properties
  All checkboxes → TODO markers

Monday Afternoon (in LogSeq):
  Check off 2 tasks: → DONE
  Add tags: #urgent, #design
  Fix typo in one line
  Add notes under another line

Tuesday Morning:
Add 3 more handwritten lines to same page

Re-transcribe:
  Algorithm:
    - Line 1-10: Canonical match → SKIP (preserves DONE, tags, fixes)
    - Line 11-13: No overlap → CREATE new blocks
  
Result:
  ✅ Your 2 DONE tasks still marked DONE
  ✅ Your tags still there
  ✅ Your typo fix preserved
  ✅ 3 new tasks added as TODO
```

---

## Migration Visual

### Old Format → New Format

```
BEFORE (Code Block):
┌──────────────────────────────────────┐
│ ## Transcribed Text                  │
│ ```                                  │
│ ☐ Review design                      │
│ ☐ Update timeline                    │
│ ☐ Schedule meeting                   │
│ ```                                  │
└──────────────────────────────────────┘

           ↓ Migration ↓

AFTER (Live Blocks):
┌──────────────────────────────────────┐
│ ## Transcribed Content               │
│                                      │
│ stroke-y-bounds:: 1000-1050          │
│ canonical-transcript:: [ ] Review    │
│ - TODO Review design                 │
│                                      │
│ stroke-y-bounds:: 1075-1125          │
│ canonical-transcript:: [ ] Update    │
│ - TODO Update timeline               │
│                                      │
│ stroke-y-bounds:: 1150-1200          │
│ canonical-transcript:: [ ] Schedule  │
│ - TODO Schedule meeting              │
└──────────────────────────────────────┘

Now each line is:
  ✅ Individually editable
  ✅ Can use native LogSeq features
  ✅ Has stroke mapping preserved
  ✅ Protected from accidental overwrites
```

---

## Key Takeaways

1. **Canonical transcript** is the secret sauce
   - Normalized form of MyScript output
   - Enables detecting actual changes vs user edits

2. **Two properties are enough**
   - `stroke-y-bounds` - maps to strokes
   - `canonical-transcript` - detects changes

3. **Comparison is everything**
   - Compare canonical forms, not final content
   - Preserves all user edits automatically

4. **Separate API calls for updates**
   - `updateBlock` for content
   - `upsertBlockProperty` for properties
   - Preserves user's other properties

5. **Checkbox normalization**
   - ☐☑☒ → [ ][x][x]
   - Consistent comparison
   - Reliable detection

---

**Full specification:** [live-transcript-blocks-spec-v2.md](./live-transcript-blocks-spec-v2.md)
