# Transcription Editing UI - Modal Interface Design Spec

**Document Type:** Brainstorming Specification  
**Date:** January 21, 2026  
**Status:** Discussion Draft  
**Purpose:** Guide design session for improved transcription editing

---

## Executive Summary

**Current Problem:** The transcription editing interface in the LogSeq DB tab uses inline edit buttons that make it difficult to:
1. Consolidate wrapped lines into single logical blocks
2. Understand which lines will become separate blocks in LogSeq
3. Restructure transcriptions before saving
4. Preview the final block structure

**Proposed Solution:** A modal editing interface that allows visual manipulation of transcription structure, line consolidation, and explicit block boundary definition before saving to LogSeq.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Core Challenges](#core-challenges)
3. [Design Goals](#design-goals)
4. [Proposed Modal Interface](#proposed-modal-interface)
5. [Key Features to Explore](#key-features-to-explore)
6. [Technical Considerations](#technical-considerations)
7. [User Workflows](#user-workflows)
8. [Open Questions](#open-questions)
9. [Implementation Approaches](#implementation-approaches)

---

## Current State Analysis

### Existing Edit Flow

**Location:** LogSeq DB Tab → Page Cards → Transcription Preview

**Current Interface:**
```
┌─────────────────────────────────────────┐
│ 📄 Page 42                              │
│ ⚙️ Sync Status • 150 strokes           │
│                                          │
│ Transcription:                          │
│ ┌────────────────────────────────────┐ │
│ │ Review mockups                     │ │
│ │ Meeting notes                      │ │
│ │   Need feedback                    │ │
│ │ Check emails                       │ │
│ └────────────────────────────────────┘ │
│                              [✏️ Edit]   │
└─────────────────────────────────────────┘
```

**Edit Mode (Textarea):**
```
┌─────────────────────────────────────────┐
│ ┌────────────────────────────────────┐ │
│ │ Review mockups                     │ │
│ │ Meeting notes                      │ │
│ │   Need feedback                    │ │
│ │ Check emails                       │ │
│ └────────────────────────────────────┘ │
│                    [Save] [Cancel]      │
└─────────────────────────────────────────┘
```

### Problems with Current Approach

#### 1. Line Wrapping Ambiguity
**Issue:** User doesn't know if this is:
```
"Review mockups for next week"
(one line that wrapped)
```
OR
```
"Review mockups"
"for next week"
(two separate lines)
```

**Impact:**
- Creates two blocks when user wanted one
- OR merges blocks when user wanted separation
- No visual feedback before save

#### 2. Block Boundary Invisibility
**Issue:** No clear indication of where LogSeq blocks will split

**Example:**
```
Meeting notes
  Action items
  Decisions
```

**Questions user can't answer:**
- Will "Meeting notes" be parent block?
- Will children be nested or siblings?
- How does indentation translate?

#### 3. Limited Editing Capabilities
**Current:** Simple textarea
- Can't see block structure
- Can't drag/drop to reorder
- Can't merge/split lines visually
- Can't see preview of LogSeq output

#### 4. No Undo/Preview
**Issue:** Changes are immediate on save
- Can't preview before committing
- Can't undo easily
- Risky to make structural changes

---

## Core Challenges

### Challenge 1: Line Consolidation

**Scenario:** Handwriting wrapped across lines

**Physical Paper:**
```
Review mockups for the
new dashboard design
```

**MyScript Output:**
```
Line 1: "Review mockups for the"
Line 2: "new dashboard design"
```

**User Intent:** One logical unit, one block

**Challenge:** How to let user visually merge these?

---

### Challenge 2: Block Hierarchy

**Scenario:** Nested bullet points

**Handwriting:**
```
Meeting notes
  Action items
    Review mockups
    Check emails
  Decisions
    Use blue theme
```

**Current:** Indentation preserved as spaces, but all blocks are siblings

**User Intent:** Nested block structure in LogSeq

**Challenge:** How to preview and confirm hierarchy?

---

### Challenge 3: MyScript Errors

**Scenario:** Transcription mistakes

**MyScript Says:**
```
Review rnockups
Meetirg notes
```

**User Wants:**
```
Review mockups
Meeting notes
```

**Current:** Edit in textarea (works)

**Challenge:** Make corrections while maintaining structure

---

### Challenge 4: Line Splitting

**Scenario:** Multiple items on one line

**Handwriting:** (user wrote fast, didn't separate)
```
Review mockups Check emails Call John
```

**MyScript Output:**
```
Line 1: "Review mockups Check emails Call John"
```

**User Intent:** Three separate tasks

**Challenge:** How to split one line into multiple blocks?

---

## Design Goals

### Primary Goals

1. **Visual Block Boundaries**
   - Clear indication of where blocks will split
   - Visual separators between logical units
   - Color-coding or styling for hierarchy levels

2. **Easy Line Consolidation**
   - Merge wrapped lines with single action
   - Drag-and-drop to combine
   - Keyboard shortcuts for common operations

3. **Block Structure Preview**
   - See exactly how LogSeq will render it
   - Live preview pane
   - Hierarchy visualization

4. **Non-Destructive Editing**
   - Undo/redo support
   - Preview before save
   - Cancel/revert option

5. **Efficient Workflow**
   - Fast to open, edit, save
   - Keyboard-friendly
   - Common operations accessible

### Secondary Goals

6. **Batch Operations**
   - Select multiple lines
   - Bulk merge/split/delete
   - Transform selections

7. **Smart Suggestions**
   - Auto-detect likely merges (short lines, same indent)
   - Suggest block boundaries
   - Flag potential issues

8. **Integration**
   - Access from multiple places (DB tab, transcription tab, canvas)
   - Consistent with app design
   - Works with v2.0 property system

---

## Proposed Modal Interface

### Concept: Split-Pane Editor

```
┌──────────────────────────────────────────────────────────────┐
│ ✏️ Edit Transcription - Book 3017 / Page 42        [✕ Close] │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  Edit Mode    │  Raw Lines    │  Structured    │  Preview    │
│  [Selected]   │               │                │             │
│                                                                │
├────────────────────────────┬─────────────────────────────────┤
│                            │                                  │
│  EDIT PANE                 │  PREVIEW PANE                    │
│                            │                                  │
│  ┌──────────────────────┐ │  ┌────────────────────────────┐ │
│  │ □ Review mockups     │ │  │ • Review mockups           │ │
│  │   [merge ↓]          │ │  │   • Meeting notes          │ │
│  ├──────────────────────┤ │  │     • Need feedback        │ │
│  │ □ Meeting notes      │ │  │   • Check emails           │ │
│  │   [split] [merge ↓]  │ │  │                            │ │
│  ├──────────────────────┤ │  └────────────────────────────┘ │
│  │   □ Need feedback    │ │                                  │
│  │     [unindent]       │ │  Property Preview:              │
│  ├──────────────────────┤ │  ┌────────────────────────────┐ │
│  │ □ Check emails       │ │  │ stroke-y-bounds::          │ │
│  │   [delete]           │ │  │ canonical-transcript:: [  ]│ │
│  └──────────────────────┘ │  └────────────────────────────┘ │
│                            │                                  │
│  [✓ Select All]            │  Block Count: 4                 │
│  [⚡ Smart Merge]          │  Characters: 67                 │
│                            │  Will create: 4 new blocks      │
│                            │                                  │
├────────────────────────────┴─────────────────────────────────┤
│                                                                │
│  [Cancel]              [Preview in LogSeq]        [💾 Save]  │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Key UI Elements

#### 1. Edit Pane (Left)
- **Line Cards:** Each transcribed line as a card/row
- **Checkboxes:** Multi-select for batch operations
- **Actions:** Per-line buttons (merge, split, delete, indent)
- **Drag Handles:** Reorder lines
- **Visual Hierarchy:** Indentation visually distinct

#### 2. Preview Pane (Right)
- **LogSeq Rendering:** Shows bullet structure
- **Live Update:** Changes reflect immediately
- **Property View:** Toggle to see properties
- **Statistics:** Block count, character count

#### 3. Mode Tabs (Top)
- **Edit Mode:** Visual block editor (proposed)
- **Raw Lines:** Simple list of lines
- **Structured:** Tree view with hierarchy
- **Preview:** LogSeq-style render

#### 4. Toolbar Actions
- **Select All:** Select all lines
- **Smart Merge:** Auto-detect and merge wrapped lines
- **Undo/Redo:** Step through changes
- **Import from LogSeq:** Pull existing blocks (for re-editing)

---

## Key Features to Explore

### Feature 1: Line Merging

**Visual Approach:**

```
┌────────────────────────┐
│ □ Review mockups for   │ ← Line 1
│   [merge ↓]            │ ← Merge button
├────────────────────────┤
│ □ the new dashboard    │ ← Line 2
└────────────────────────┘

After merge:
┌────────────────────────┐
│ □ Review mockups for   │
│   the new dashboard    │
│   [split]              │
└────────────────────────┘
```

**Interactions:**
- Click [merge ↓] → combines with line below
- Keyboard: `Ctrl+J` (Vim-style join)
- Drag line onto another → merge
- Auto-suggest: short lines, same indent level

**Technical:** Update transcription.lines array, recalculate Y-bounds

---

### Feature 2: Line Splitting

**Visual Approach:**

```
Before:
┌─────────────────────────────────────┐
│ □ Review mockups Check emails       │ ← Cursor at position
│   [split at cursor]                 │
└─────────────────────────────────────┘

After split at "Check":
┌─────────────────────────────────────┐
│ □ Review mockups                    │
├─────────────────────────────────────┤
│ □ Check emails                      │
└─────────────────────────────────────┘
```

**Interactions:**
- Click [split at cursor] → break into two lines
- Keyboard: `Ctrl+Enter` at cursor position
- Right-click → "Split line here"

**Technical:** Create new line object, split Y-bounds proportionally

---

### Feature 3: Hierarchy Adjustment

**Visual Approach:**

```
┌────────────────────────┐
│ □ Meeting notes        │ ← Parent
│   [indent →]           │
├────────────────────────┤
│   □ Action items       │ ← Child (indented)
│     [← unindent]       │
└────────────────────────┘
```

**Interactions:**
- Click [→ indent] → increase indent level
- Click [← unindent] → decrease indent level
- Keyboard: `Tab` / `Shift+Tab`
- Drag left/right to adjust

**Preview:** Shows nested bullets in preview pane

---

### Feature 4: Smart Merge Detection

**Auto-Suggest UI:**

```
┌────────────────────────────────────┐
│ 💡 Merge Suggestions (3)           │
├────────────────────────────────────┤
│ [Apply All] [Dismiss All]          │
│                                     │
│ ☑ Lines 1-2: "Review mockups for"  │
│   + "the new dashboard"            │
│   → "Review mockups for the new    │
│      dashboard"                    │
│   [Apply] [Dismiss]                │
│                                     │
│ ☐ Lines 5-6: "Meeting"             │
│   + "notes"                        │
│   → "Meeting notes"                │
│   [Apply] [Dismiss]                │
└────────────────────────────────────┘
```

**Detection Algorithm:**
```javascript
function detectMergeCandidates(lines) {
  const suggestions = [];
  
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    
    // Heuristics:
    // 1. Same indent level
    // 2. Current line ends mid-word (no punctuation)
    // 3. Next line is continuation (doesn't start with capital)
    // 4. Close Y-bounds (within 20 units)
    
    if (shouldMerge(current, next)) {
      suggestions.push({ lines: [i, i+1], confidence: 0.8 });
    }
  }
  
  return suggestions;
}
```

---

### Feature 5: Block Structure Tree View

**Alternative View Mode:**

```
┌─────────────────────────────────────┐
│ Tree View                            │
├─────────────────────────────────────┤
│ ▼ □ Meeting notes                   │
│   ├─ ▼ □ Action items               │
│   │   ├─ □ Review mockups           │
│   │   └─ □ Check emails             │
│   └─ ▼ □ Decisions                  │
│       └─ □ Use blue theme           │
└─────────────────────────────────────┘
```

**Features:**
- Collapse/expand sections
- Drag-and-drop to restructure
- Visual hierarchy clear
- Matches LogSeq's outline view

---

### Feature 6: Inline Editing

**Quick Corrections:**

```
┌────────────────────────────────────┐
│ □ Review rnockups      ← Click to edit
│   ─────────
│   └─ Inline: Review mockups
│      [✓ Save] [✕ Cancel]
└────────────────────────────────────┘
```

**For minor corrections without leaving context**

---

## Technical Considerations

### Data Structure

**Current:** Array of line objects
```javascript
{
  text: "Review mockups",
  indentLevel: 0,
  lineNumber: 0,
  canonical: "Review mockups",
  yBounds: { minY: 1234.5, maxY: 1289.3 }
}
```

**Enhanced for Modal:**
```javascript
{
  id: "line-0",  // NEW: Stable ID for UI
  text: "Review mockups",
  indentLevel: 0,
  originalLineNumber: 0,  // NEW: Track origin
  canonical: "Review mockups",
  yBounds: { minY: 1234.5, maxY: 1289.3 },
  merged: false,  // NEW: Merged from multiple lines?
  originalLines: [0],  // NEW: Which original lines?
  userModified: false,  // NEW: User edited this?
  suggestions: []  // NEW: Merge/split suggestions
}
```

### State Management

**Modal State:**
```javascript
{
  original: [...],  // Original lines (immutable)
  current: [...],   // Current edited lines
  history: [[...]], // Undo stack
  historyIndex: 0,  // Current position in history
  selectedIds: new Set(),  // Selected line IDs
  suggestions: [...],  // Auto-detected suggestions
  previewMode: 'logseq'  // Preview display mode
}
```

**Operations:**
```javascript
function mergeLine(lineId) {
  // Find line and next line
  // Combine text
  // Merge Y-bounds
  // Update canonical
  // Add to history
}

function splitLine(lineId, position) {
  // Split text at position
  // Calculate new Y-bounds
  // Create new line object
  // Add to history
}

function undo() {
  // Move back in history
  // Restore previous state
}
```

### Y-Bounds Recalculation

**Challenge:** When merging/splitting, Y-bounds need adjustment

**Approach 1: Preserve Original**
```javascript
// Merged line keeps Y-bounds of all source lines
merged.yBounds = {
  minY: Math.min(line1.yBounds.minY, line2.yBounds.minY),
  maxY: Math.max(line1.yBounds.maxY, line2.yBounds.maxY)
};
```

**Approach 2: Smart Allocation**
```javascript
// Split line divides Y-bounds proportionally
const midY = (line.yBounds.minY + line.yBounds.maxY) / 2;
split1.yBounds = { minY: line.yBounds.minY, maxY: midY };
split2.yBounds = { minY: midY, maxY: line.yBounds.maxY };
```

**Consideration:** Affects v2.0 property matching on re-save

### Integration with v2.0 System

**Key Question:** How does edited structure map to properties?

**Option A: Update Properties**
- Edited lines get new Y-bounds
- Properties updated on save
- Next transcription uses new bounds

**Option B: Preserve Original**
- Keep original Y-bounds
- Add `user-edited:: true` flag
- Merge operations tracked separately

**Recommendation:** Option A - update properties to reflect new structure

---

## User Workflows

### Workflow 1: Fix Wrapped Lines

**Starting State:** Handwriting wrapped
```
Line 1: "Review mockups for the"
Line 2: "new dashboard design"
```

**User Actions:**
1. Click "Edit Transcription" (opens modal)
2. See two lines in edit pane
3. Click [merge ↓] on Line 1
4. Preview pane shows single line
5. Click [Save]

**Result:** Single block in LogSeq
```
- Review mockups for the new dashboard design
```

---

### Workflow 2: Split Compound Line

**Starting State:** Multiple items on one line
```
Line 1: "Review mockups Check emails Call John"
```

**User Actions:**
1. Open modal
2. Click into line text, position cursor before "Check"
3. Click [split at cursor] or `Ctrl+Enter`
4. Repeat before "Call"
5. Preview shows three bullets
6. Click [Save]

**Result:** Three blocks in LogSeq
```
- Review mockups
- Check emails
- Call John
```

---

### Workflow 3: Build Hierarchy

**Starting State:** Flat list
```
Line 1: "Meeting notes"
Line 2: "Action items"
Line 3: "Review mockups"
Line 4: "Decisions"
```

**User Actions:**
1. Open modal
2. Select Lines 2-3
3. Click [→ indent]
4. Select Line 4
5. Click [→ indent]
6. Preview shows nested structure
7. Click [Save]

**Result:** Nested blocks in LogSeq
```
- Meeting notes
  - Action items
  - Review mockups
  - Decisions
```

---

### Workflow 4: Smart Merge All

**Starting State:** Multiple wrapped lines detected
```
Line 1: "Review mockups for"
Line 2: "the dashboard"
Line 3: "Meeting"
Line 4: "notes"
```

**User Actions:**
1. Open modal
2. See "💡 Merge Suggestions (2)" banner
3. Click [Apply All]
4. Lines automatically merged
5. Click [Save]

**Result:** Two blocks in LogSeq
```
- Review mockups for the dashboard
- Meeting notes
```

---

## Open Questions

### UX Questions

1. **Modal Size**
   - Full screen overlay?
   - Centered dialog (fixed size)?
   - Resizable window?
   - Side panel?

2. **Default View**
   - Start in Edit mode or Raw Lines mode?
   - Show preview pane by default?
   - Auto-open after transcription?

3. **Keyboard Shortcuts**
   - What feels natural?
   - Vim-style (`hjkl` navigation)?
   - VS Code-style (`Ctrl+/` for actions)?
   - Custom bindings?

4. **Multi-Select UX**
   - Checkboxes vs click-to-select?
   - Range select (Shift+click)?
   - Lasso select?

5. **Merge Confirmation**
   - Auto-apply smart suggestions?
   - Require explicit approval?
   - Undo-able so no confirmation needed?

### Technical Questions

6. **Y-Bounds Updates**
   - Recalculate after edit?
   - Keep original?
   - Hybrid approach?

7. **Property Preservation**
   - Update canonical after merge?
   - Add edit metadata?
   - Version tracking?

8. **Undo History**
   - How many levels?
   - Persist across sessions?
   - Clear on save?

9. **Performance**
   - Max lines before pagination?
   - Virtual scrolling needed?
   - Debounce preview updates?

10. **State Persistence**
    - Save draft edits?
    - Auto-save?
    - Warn on close with unsaved changes?

### Integration Questions

11. **Access Points**
    - Where can modal be opened from?
    - Replace current edit button?
    - Add to transcription tab?
    - Canvas shortcut?

12. **Existing Data**
    - Import from LogSeq blocks?
    - Round-trip edit existing transcriptions?
    - Merge with new transcription?

13. **Batch Operations**
    - Edit multiple pages at once?
    - Apply template to all pages?
    - Export/import structure?

---

## Implementation Approaches

### Approach 1: Full-Featured Modal

**Pros:**
- Complete editing experience
- All features in one place
- Professional feel

**Cons:**
- Complex to build (2-3 weeks)
- Large component
- Performance considerations

**Estimate:** 40-60 hours

---

### Approach 2: Progressive Enhancement

**Phase 1:** Basic modal with merge/split (10 hours)
```
- Open modal
- Show lines as editable list
- Merge button (combines adjacent)
- Split button (at cursor)
- Save
```

**Phase 2:** Add preview pane (5 hours)
```
- Split view
- Live preview
- Property view toggle
```

**Phase 3:** Smart suggestions (8 hours)
```
- Auto-detect merges
- Suggestion UI
- Apply/dismiss actions
```

**Phase 4:** Advanced features (15 hours)
```
- Drag-and-drop reorder
- Tree view mode
- Undo/redo
- Keyboard shortcuts
```

**Total:** 38 hours, delivered incrementally

---

### Approach 3: Lightweight Editor

**Minimal viable version:**
```
┌─────────────────────────────────┐
│ Edit Transcription               │
├─────────────────────────────────┤
│                                  │
│ [Line 1] Review mockups for     │
│          [x] Merge with next    │
│                                  │
│ [Line 2] the dashboard          │
│          [ ] Merge with next    │
│                                  │
│ [Line 3] Meeting notes          │
│          [ ] Merge with next    │
│                                  │
├─────────────────────────────────┤
│          [Cancel]    [Save]     │
└─────────────────────────────────┘
```

**Features:**
- Simple checkbox merge UI
- No preview pane (save to see result)
- Minimal JS (~200 lines)

**Estimate:** 8-12 hours

---

## Recommended Path Forward

### Phase 1: Build MVP Modal (Sprint 1)
- Basic split-pane layout
- Line list with merge buttons
- Simple preview pane
- Save/cancel actions
- **Goal:** Get user feedback quickly

### Phase 2: Smart Features (Sprint 2)
- Auto-detect merge suggestions
- Apply all / dismiss all
- Inline text editing
- **Goal:** Reduce manual work

### Phase 3: Polish (Sprint 3)
- Drag-and-drop reorder
- Tree view mode
- Undo/redo
- Keyboard shortcuts
- **Goal:** Professional UX

### Phase 4: Advanced (Future)
- Multi-page editing
- Templates
- Batch operations
- **Goal:** Power user features

---

## Discussion Topics for Brainstorming Session

### 1. Core UX
- [ ] Modal size and layout preferences
- [ ] Default view mode (edit / raw / tree / preview)
- [ ] Most important operations to prioritize

### 2. Line Operations
- [ ] Merge interaction design (button / drag / auto)
- [ ] Split interaction (cursor-based / dialog / double-enter)
- [ ] Hierarchy adjustment (indent buttons / drag / tab key)

### 3. Smart Features
- [ ] Auto-suggestion trust level (auto-apply / suggest / off)
- [ ] Detection algorithm tuning
- [ ] User override controls

### 4. Preview & Feedback
- [ ] Preview pane always visible / toggle / separate view
- [ ] Real-time vs on-demand updates
- [ ] Error indicators and validation

### 5. Technical Decisions
- [ ] Y-bounds recalculation strategy
- [ ] Property update approach
- [ ] Undo implementation depth

### 6. Integration
- [ ] Where to add "Edit Transcription" button
- [ ] Keyboard shortcut for opening modal
- [ ] Connection to v2.0 property system

### 7. Scope
- [ ] MVP features (must-have for v1)
- [ ] Nice-to-have features (v2)
- [ ] Future possibilities (backlog)

---

## Success Criteria

### User Success
- ✅ Can merge wrapped lines in <5 seconds
- ✅ Can fix transcription errors without leaving modal
- ✅ Understands block structure before saving
- ✅ Feels confident changes will be preserved

### Technical Success
- ✅ Modal loads in <500ms
- ✅ Preview updates in <100ms
- ✅ No data loss on save
- ✅ Compatible with v2.0 property system

### Product Success
- ✅ Reduces transcription cleanup time by 50%
- ✅ Users prefer modal to inline editing
- ✅ Minimal learning curve (intuitive)
- ✅ Enables complex restructuring workflows

---

## Next Steps

1. **Review this spec** - familiarize with concepts and questions
2. **Brainstorming session** - discuss and decide on approach
3. **Create detailed design** - mockups and interaction flows
4. **Technical spec** - implementation plan
5. **Build MVP** - iterate based on testing
6. **Gather feedback** - real user testing
7. **Iterate** - refine based on usage

---

## Appendix: Design Inspirations

### Similar Tools
- **Notion:** Block-based editor with drag-and-drop
- **Roam Research:** Outline manipulation
- **VS Code:** Split panes, tree view, inline actions
- **Obsidian:** Live preview, source/preview modes

### Key Learnings
- Users prefer visual manipulation over text editing
- Live preview reduces cognitive load
- Undo/redo is essential for experimentation
- Smart suggestions should be opt-in, not forced

---

**Document Version:** 1.0  
**Last Updated:** January 21, 2026  
**Status:** Ready for Discussion  
**Prepared for:** Design Brainstorming Session
