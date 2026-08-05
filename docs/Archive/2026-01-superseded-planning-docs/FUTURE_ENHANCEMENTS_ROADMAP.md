# Line Consolidation - Future Enhancements Roadmap

**Current Version:** 1.0 (MVP Complete)  
**Date:** January 22, 2026

---

## Implementation Status

### ✅ Phase 1: Complete (Current Version)
- Core merge logic with `merged-lines` property
- Transcription editor modal with merge/split/undo
- Smart merge suggestions
- Re-transcription persistence
- User edit preservation

---

## Phase 2: Enhanced Usability (Estimated 12-16 hours)

### 2.1 Unmerge Action
**Problem:** No way to reverse a merge after saving  
**Solution:** Add "Unmerge" button that splits merged blocks back to original lines

**Implementation:**
```javascript
function unmergeBlock(blockUuid) {
  // 1. Fetch original source lines from sourceLines property
  // 2. Calculate proportional Y-bounds for each
  // 3. Create separate blocks in LogSeq
  // 4. Delete merged block
}
```

**UI Changes:**
- Add "↕ Unmerge" button to merged line cards
- Show confirmation dialog: "Split into {count} lines?"

**Estimated Time:** 3-4 hours

---

### 2.2 Better Conflict Resolution
**Problem:** When multiple merged blocks overlap same line, just merges to first  
**Solution:** Show dialog letting user choose resolution strategy

**UI Mockup:**
```
┌─────────────────────────────────────┐
│ ⚠️ Merge Conflict Detected          │
├─────────────────────────────────────┤
│ The following blocks overlap:       │
│                                     │
│ Block 1: "Review mockups"          │
│ Block 2: "Review design mockups"   │
│                                     │
│ New transcription: "Review mockups"│
│                                     │
│ Choose action:                      │
│ ○ Merge into Block 1               │
│ ○ Merge into Block 2               │
│ ○ Create new block                 │
│ ○ Skip (keep both)                 │
│                                     │
│        [Cancel]    [Apply]          │
└─────────────────────────────────────┘
```

**Estimated Time:** 4-5 hours

---

### 2.3 Merge Templates
**Problem:** Same merge patterns repeated across multiple pages  
**Solution:** Save and apply merge patterns as templates

**Features:**
- "Save as Template" button after merging
- Template library in settings
- "Apply Template" button in editor
- Pattern matching: "lines at Y:1200-1400 usually wrap"

**Estimated Time:** 5-7 hours

---

## Phase 3: Performance & Scale (Estimated 10-12 hours)

### 3.1 Batch Property Updates
**Problem:** Sequential API calls slow for large pages (50+ lines)  
**Solution:** Use LogSeq batch API (if available) or custom batching

**Implementation:**
```javascript
// Instead of:
for (const line of lines) {
  await updateBlock(line);
  await upsertProperty('canonical', ...);
  await upsertProperty('bounds', ...);
}

// Use:
await batchUpdateBlocks([
  { uuid: uuid1, content: ..., properties: {...} },
  { uuid: uuid2, content: ..., properties: {...} },
  // ...
]);
```

**Expected Improvement:** 5-10x faster for large pages

**Estimated Time:** 4-5 hours

---

### 3.2 Virtual Scrolling
**Problem:** Editor laggy with 100+ lines  
**Solution:** Only render visible lines in viewport

**Library:** Use svelte-virtual-list or custom implementation

**Estimated Time:** 3-4 hours

---

### 3.3 Pagination
**Problem:** Loading 200+ lines takes too long  
**Solution:** Load in chunks of 50, with "Load More" button

**Estimated Time:** 3-4 hours

---

## Phase 4: Advanced Features (Estimated 15-20 hours)

### 4.1 Tree View Mode
**Problem:** Flat list doesn't show hierarchy clearly  
**Solution:** Alternative view showing nested structure

**UI Mockup:**
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
- Drag-and-drop to change hierarchy
- Visual parent-child relationships

**Estimated Time:** 8-10 hours

---

### 4.2 Hierarchical Block Creation
**Problem:** All blocks created at top level (flat)  
**Solution:** Use line.parent references to create nested blocks

**Implementation:**
```javascript
function createNestedBlocks(lines) {
  const blockMap = new Map();
  
  for (const line of lines) {
    const parentUuid = line.parent !== null 
      ? blockMap.get(line.parent)
      : transcriptSectionUuid;
    
    const block = await createBlock(parentUuid, line, {sibling: false});
    blockMap.set(line.index, block.uuid);
  }
}
```

**Estimated Time:** 4-5 hours

---

### 4.3 Multi-Page Editing
**Problem:** Can't apply same edits to multiple pages  
**Solution:** Batch editor for multiple pages

**Features:**
- Select multiple pages in LogSeq DB tab
- "Edit All" button opens modal with tabbed interface
- Apply same merge pattern to all
- Bulk save

**Estimated Time:** 6-8 hours

---

## Phase 5: Stroke-Level Precision (Estimated 12-16 hours)

### 5.1 Stroke IDs Property
**Problem:** Y-bounds approximation can fail with tight handwriting  
**Solution:** Store actual stroke IDs for perfect mapping

**Property Format:**
```markdown
stroke-y-bounds:: 1234.0-1345.0
stroke-ids:: s_1234567890_0,s_1234567891_0,s_1234567892_0
merged-lines:: 2
```

**Implementation:**
- Track stroke IDs during MyScript parsing
- Store as comma-separated list
- Use for exact stroke-to-line mapping

**Benefits:**
- Perfect identity tracking
- Handles overlapping Y-ranges
- Can update individual strokes

**Estimated Time:** 6-8 hours

---

### 5.2 Visual Stroke Highlighting
**Problem:** Hard to see which strokes belong to which line  
**Solution:** Highlight strokes on canvas when hovering line in editor

**Implementation:**
- Add canvas reference to modal
- On line hover, highlight corresponding strokes
- Color-code by line

**Estimated Time:** 4-5 hours

---

### 5.3 Stroke-Based Split
**Problem:** Split divides Y-bounds proportionally (imprecise)  
**Solution:** Use actual stroke boundaries for split

**Implementation:**
```javascript
function splitLineByStrokes(line, splitIndex) {
  const strokeIds = line.strokeIds; // ['s1', 's2', 's3', 's4']
  
  const strokes1 = strokeIds.slice(0, splitIndex);
  const strokes2 = strokeIds.slice(splitIndex);
  
  const bounds1 = calculateBoundsFromStrokes(strokes1);
  const bounds2 = calculateBoundsFromStrokes(strokes2);
  
  return [
    { text: text1, yBounds: bounds1, strokeIds: strokes1 },
    { text: text2, yBounds: bounds2, strokeIds: strokes2 }
  ];
}
```

**Estimated Time:** 3-4 hours

---

## Phase 6: Integration & Workflow (Estimated 8-12 hours)

### 6.1 Transcription Tab Integration
**Problem:** Editor only accessible from LogSeq DB tab  
**Solution:** Add "Edit Structure" button to transcription tab too

**Estimated Time:** 2-3 hours

---

### 6.2 Auto-Merge on Transcription
**Problem:** User has to manually open editor to merge  
**Solution:** Option to auto-apply smart merge suggestions

**Settings:**
```javascript
{
  autoMergeOnTranscribe: false,
  autoMergeConfidence: 0.8, // Only apply if confidence > 80%
  promptBeforeAutoMerge: true
}
```

**Estimated Time:** 3-4 hours

---

### 6.3 Merge History / Audit Log
**Problem:** Hard to track what was merged when  
**Solution:** Store merge history as block property

**Property Format:**
```markdown
merge-history:: [
  {timestamp: 1234567890, action: "merged", fromLines: [1,2], confidence: 0.9},
  {timestamp: 1234567900, action: "split", toLines: [1,2]}
]
```

**UI:** Show history in modal footer

**Estimated Time:** 4-6 hours

---

## Priority Ranking

### High Priority (Do Soon)
1. **Unmerge Action** - Common user request
2. **Better Conflict Resolution** - Prevents data loss
3. **Batch Property Updates** - Performance improvement

### Medium Priority (Nice to Have)
4. **Tree View Mode** - Better UX for hierarchical notes
5. **Hierarchical Block Creation** - Complete the structure
6. **Stroke IDs Property** - Improves accuracy

### Low Priority (Future Nice-to-Have)
7. **Merge Templates** - Power user feature
8. **Multi-Page Editing** - Advanced workflow
9. **Virtual Scrolling** - Only needed for huge pages
10. **Auto-Merge on Transcription** - Risky automation

---

## Technical Debt / Refactoring

### Code Quality Improvements
- [ ] Extract modal state management to composable
- [ ] Add TypeScript types for line objects
- [ ] Write unit tests for merge logic
- [ ] Add integration tests for re-transcription flow

### Documentation
- [ ] Add JSDoc comments to all functions
- [ ] Create architecture diagram (mermaid)
- [ ] Record video walkthrough
- [ ] Write user guide (non-technical)

---

## Breaking Changes to Consider

### Migration to Stroke IDs
**When:** Phase 5 implementation  
**Impact:** Need to recalculate stroke IDs for existing merged blocks  
**Migration Path:**
1. Read stroke data from LogSeq
2. Match Y-bounds to strokes
3. Update properties with stroke IDs
4. Keep Y-bounds as fallback

**Estimated Migration Time:** 2-3 hours (one-time script)

---

## Resource Requirements

### Development Time by Phase
- Phase 2: 12-16 hours (enhanced usability)
- Phase 3: 10-12 hours (performance)
- Phase 4: 15-20 hours (advanced features)
- Phase 5: 12-16 hours (stroke precision)
- Phase 6: 8-12 hours (integration)

**Total:** ~57-76 hours for all phases

### Recommended Order
1. Implement Phase 2.1 (Unmerge) - quick win
2. Gather user feedback
3. Implement Phase 3 (Performance) if needed
4. Implement Phase 2.2 (Conflict Resolution)
5. Assess demand for Phase 4/5 features
6. Implement based on user requests

---

## Success Metrics

### Phase 2 Success
- [ ] 90% of merges don't need unmerge
- [ ] <5% conflict resolution cases
- [ ] Users adopt template feature

### Phase 3 Success
- [ ] Large pages (100+ lines) load in <3s
- [ ] Save operations <5s regardless of size
- [ ] No UI lag during editing

### Phase 4 Success
- [ ] 50% of users prefer tree view
- [ ] Hierarchical blocks correctly created
- [ ] Multi-page editing saves 10+ minutes/week

### Phase 5 Success
- [ ] Zero Y-bounds overlap conflicts
- [ ] Stroke highlighting improves debugging
- [ ] Users trust stroke-based split

---

## Decision Points

### Should We Build Phase 4?
**Ask:**
- Do users frequently work with deeply nested notes?
- Is the flat list view causing confusion?
- Would tree view improve comprehension?

**If Yes:** Build Phase 4.1 first  
**If No:** Skip to Phase 5 or 6

### Should We Build Phase 5?
**Ask:**
- Are Y-bounds conflicts common in practice?
- Do users have very tight handwriting?
- Is the extra complexity worth it?

**If Yes:** Build Phase 5.1 first  
**If No:** Current Y-bounds approach is sufficient

---

## Conclusion

The **current v1.0 implementation is production-ready** and solves the core problem. Future phases add polish, performance, and power-user features but are **not required for basic functionality**.

**Recommendation:** Use v1.0 in production, gather user feedback, then prioritize phases based on actual user needs rather than assumed requirements.

**Key Insight:** The hardest part (merge persistence) is done. Everything else is incremental improvement.

---

**Document Version:** 1.0  
**Last Updated:** January 22, 2026  
**Next Review:** After 1 month of production use
