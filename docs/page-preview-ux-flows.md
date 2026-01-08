# Page Preview - UI/UX Flows & Implementation Guide

**Quick Reference for Building Page Preview Feature**

---

## UI/UX Flow Summary

### Primary User Flows

#### Flow 1: Quick Page Discovery
```
[Open App] → [Page Preview Tab] → [See Grid of All Pages]
           ↓
    [Search "meeting"] → [Filtered Results] → [Click Page]
           ↓
    [View Full Page in Canvas]
```

**Key UX Principles:**
- Zero friction to browse all pages
- Instant search feedback (<100ms)
- One-click to full page view

---

#### Flow 2: Temporal Exploration
```
[Page Preview] → [Sort: Chronological] → [Timeline View Button]
                ↓
         [See Timeline] → [Zoom to Today] → [Identify Writing Sessions]
                ↓
         [Click Page Marker] → [View Full Page]
```

**Key UX Principles:**
- Understand writing flow across time
- Visualize work sessions
- Easy navigation through history

---

#### Flow 3: Side-by-Side Comparison
```
[Page Preview Grid] → [Select 2-3 Pages] → [Compare Button]
                ↓
         [Split View] → [Toggle Stroke/Text per Pane]
                ↓
         [Sync Zoom ON] → [Pan One Canvas] → [All Pans Together]
                ↓
         [Export Comparison as PDF]
```

**Key UX Principles:**
- Visual comparison made easy
- Independent or synchronized controls
- Export for sharing/archival

---

#### Flow 4: Book-Focused Review
```
[Page Preview] → [Book Filter] → [Select "Meeting Notes" Only]
                ↓
         [See Filtered Grid] → [Sort by Page Number]
                ↓
         [Sequential Review] → [Arrow Keys to Navigate]
```

**Key UX Principles:**
- Focus on specific notebooks
- Logical progression through content
- Keyboard-friendly navigation

---

## Component Architecture & Relationships

### Component Hierarchy
```
App.svelte
└── Header.svelte
    ├── [Stroke Preview] button
    ├── [Page Preview] button ← NEW
    └── [Text View] button
    
Main Canvas Area (conditional rendering based on mode)
├── StrokeCanvas.svelte (existing - mode: "stroke")
├── PagePreviewCanvas.svelte (new - mode: "page")
│   ├── PageGrid.svelte
│   │   └── PageThumbnail.svelte (n instances)
│   │       ├── Mini Canvas (thumbnail render)
│   │       ├── Metadata Display
│   │       └── Action Buttons
│   │
│   ├── PageComparison.svelte
│   │   ├── ComparisonPane.svelte (2-4 instances)
│   │   │   └── Mini StrokeCanvas (reused component)
│   │   └── ComparisonControls.svelte
│   │
│   └── TimelineView.svelte
│       ├── Timeline SVG (horizontal axis)
│       ├── Page Markers (positioned by timestamp)
│       └── Playback Controls
│
└── LeftPanel.svelte (updated)
    ├── Data Explorer (existing tabs)
    └── PageSidebar.svelte (new - when in Page Preview mode)
        ├── BookNavigator.svelte
        ├── SearchFilters.svelte
        └── PageList.svelte (filtered results)
```

---

## Store Design

### New Stores (src/stores/page-preview.js)

```javascript
// Derived: All page metadata
export const allPages = derived(
  [strokes, pageTranscriptions, logseqPages, bookAliases],
  ([$strokes, $trans, $logseq, $aliases]) => {
    // Merge all data sources into unified page list
    const pageMap = new Map();
    
    // From strokes: identify pages, get stroke counts, timestamps
    $strokes.forEach(stroke => {
      const pageKey = buildPageKey(stroke.pageInfo);
      if (!pageMap.has(pageKey)) {
        pageMap.set(pageKey, {
          pageKey,
          ...stroke.pageInfo,
          strokes: [],
          firstStrokeTime: stroke.startTime,
          lastStrokeTime: stroke.endTime,
          strokeCount: 0
        });
      }
      const page = pageMap.get(pageKey);
      page.strokes.push(stroke);
      page.strokeCount++;
      page.firstStrokeTime = Math.min(page.firstStrokeTime, stroke.startTime);
      page.lastStrokeTime = Math.max(page.lastStrokeTime, stroke.endTime);
    });
    
    // From transcriptions: add text data
    $trans.forEach((transcription, pageKey) => {
      if (pageMap.has(pageKey)) {
        const page = pageMap.get(pageKey);
        page.transcriptionText = transcription.text;
        page.textPreview = transcription.text.slice(0, 100) + '...';
        page.hasTranscription = true;
        page.source = 'myscript';
      }
    });
    
    // From LogSeq: add imported pages
    $logseq.forEach(lsPage => {
      const pageKey = buildPageKey(lsPage);
      if (!pageMap.has(pageKey)) {
        // Page exists in LogSeq but not in current strokes
        pageMap.set(pageKey, {
          pageKey,
          book: lsPage.book,
          page: lsPage.page,
          section: lsPage.section || 0,
          owner: lsPage.owner || 0,
          transcriptionText: lsPage.transcriptionText,
          textPreview: lsPage.transcriptionText?.slice(0, 100) + '...',
          hasTranscription: !!lsPage.transcriptionText,
          strokeCount: lsPage.strokeCount || 0,
          source: 'logseq',
          syncStatus: lsPage.syncStatus
        });
      }
    });
    
    // Build search index
    const pages = Array.from(pageMap.values()).map(page => ({
      ...page,
      searchTokens: buildSearchTokens(page.transcriptionText || ''),
      bookAlias: $aliases[page.book] || `Book ${page.book}`
    }));
    
    return pages;
  }
);

// Search & Filter State
export const pagePreviewMode = writable('grid'); // 'grid' | 'list' | 'comparison' | 'timeline'
export const searchQuery = writable('');
export const sortMode = writable('book-page'); // 'book-page' | 'chronological' | 'alphabetical'
export const dateRange = writable({ start: null, end: null });
export const selectedBooks = writable(new Set());

// Filtered Pages
export const visiblePages = derived(
  [allPages, searchQuery, sortMode, dateRange, selectedBooks],
  ([$pages, $query, $sort, $range, $books]) => {
    let filtered = $pages;
    
    // Apply search filter
    if ($query) {
      filtered = searchPages(filtered, $query);
    }
    
    // Apply date range filter
    if ($range.start || $range.end) {
      filtered = filterByDateRange(filtered, $range.start, $range.end);
    }
    
    // Apply book filter
    if ($books.size > 0) {
      filtered = filtered.filter(p => $books.has(p.book));
    }
    
    // Apply sort
    filtered = sortPages(filtered, $sort);
    
    return filtered;
  }
);

// Comparison Mode State
export const comparisonPages = writable([null, null, null, null]); // Up to 4
export const comparisonLayout = writable('2-column');
export const syncZoom = writable(true);
export const syncPan = writable(false);

// Helper: Add page to comparison
export function addToComparison(page) {
  comparisonPages.update(pages => {
    const emptySlot = pages.findIndex(p => p === null);
    if (emptySlot !== -1) {
      const newPages = [...pages];
      newPages[emptySlot] = page;
      return newPages;
    }
    return pages;
  });
}

// Helper: Remove from comparison
export function removeFromComparison(slotIndex) {
  comparisonPages.update(pages => {
    const newPages = [...pages];
    newPages[slotIndex] = null;
    return newPages;
  });
}

// Helper: Clear all comparison
export function clearComparison() {
  comparisonPages.set([null, null, null, null]);
}
```

---

## Implementation Checklist

### Phase 1: Foundation (Week 1)

**Day 1-2: Store Setup**
- [ ] Create `src/stores/page-preview.js`
- [ ] Implement `allPages` derived store
- [ ] Implement `visiblePages` with search/filter/sort
- [ ] Add search token indexing
- [ ] Test store with existing data

**Day 3-4: Basic Grid View**
- [ ] Create `PagePreviewCanvas.svelte` (main container)
- [ ] Create `PageGrid.svelte` (grid layout)
- [ ] Create `PageThumbnail.svelte` (thumbnail card)
- [ ] Implement thumbnail rendering (mini canvas)
- [ ] Add click handler → navigate to stroke canvas
- [ ] Style grid responsively (4/3/2/1 columns)

**Day 5: Header Integration**
- [ ] Add "Page Preview" toggle to Header.svelte
- [ ] Implement mode switching (stroke ↔ page)
- [ ] Test navigation between modes
- [ ] Ensure state persists when switching

---

### Phase 2: Search & Filters (Week 2)

**Day 1-2: Search Implementation**
- [ ] Create `SearchFilters.svelte`
- [ ] Implement search input with debouncing
- [ ] Connect to `searchQuery` store
- [ ] Test bag-of-words search
- [ ] Add "No results" empty state

**Day 3: Filter Controls**
- [ ] Add date range picker (start/end)
- [ ] Add date presets (Today, Week, Month)
- [ ] Implement book filter checkboxes
- [ ] Test combined filters (search + date + books)

**Day 4: Sort Modes**
- [ ] Add sort mode toggle buttons
- [ ] Implement Book/Page sort
- [ ] Implement Chronological sort
- [ ] Implement Alphabetical sort
- [ ] Test sort stability

**Day 5: Polish & Testing**
- [ ] Add loading states for filters
- [ ] Add result count display
- [ ] Test with large datasets (50+ pages)
- [ ] Optimize performance (<100ms filter update)

---

### Phase 3: Comparison View (Week 3)

**Day 1-2: Multi-Select UI**
- [ ] Add checkboxes to PageThumbnail
- [ ] Implement multi-select state in store
- [ ] Add "Compare Selected" button (appears when 2-4 selected)
- [ ] Test selection/deselection

**Day 3-4: Comparison Layout**
- [ ] Create `PageComparison.svelte`
- [ ] Create `ComparisonPane.svelte`
- [ ] Implement 2-column layout first
- [ ] Add canvas instances per pane
- [ ] Test side-by-side rendering

**Day 5: Sync Controls**
- [ ] Create `ComparisonControls.svelte`
- [ ] Implement zoom sync toggle
- [ ] Implement pan sync toggle
- [ ] Add layout switcher (2-col, 2-row, 3-grid, 4-grid)
- [ ] Test synchronized interactions

---

### Phase 4: Timeline View (Week 4)

**Day 1-2: Timeline Layout**
- [ ] Create `TimelineView.svelte`
- [ ] Implement SVG horizontal timeline
- [ ] Position pages by `firstStrokeTime`
- [ ] Add time axis labels (hours/days)

**Day 3: Zoom & Interaction**
- [ ] Add zoom controls (hour/day/week/month)
- [ ] Implement timeline pan/zoom
- [ ] Add page markers with metadata tooltip
- [ ] Test click marker → load page

**Day 4: Session Detection**
- [ ] Implement session detection (2-min gaps)
- [ ] Visual grouping of session pages
- [ ] Color-code sessions
- [ ] Test with multi-session data

**Day 5: Polish**
- [ ] Add playback controls (optional)
- [ ] Add time gap labels
- [ ] Optimize for mobile (horizontal scroll)
- [ ] Final testing

---

## Key UX Decisions & Rationale

### 1. Grid vs. List Default

**Decision:** Grid view by default

**Rationale:**
- Visual thumbnails aid recognition ("I remember that page")
- More engaging than text-only list
- Better showcases handwriting
- Can toggle to list for text-focused search

---

### 2. Search: Bag-of-Words vs. Phrase Match

**Decision:** Bag-of-words (OR search)

**Rationale:**
- Handwriting OCR is imperfect → partial matching more forgiving
- Faster to implement and query
- Simpler mental model for users
- Can add phrase search in Phase 6 if needed

---

### 3. Comparison Limit: 4 Pages

**Decision:** Max 4 pages in comparison

**Rationale:**
- More than 4 = too small to be useful
- Memory management (each canvas = 50-100MB)
- 4 pages = 2x2 grid = logical layout
- Most use cases need 2-3 pages max

---

### 4. Canvas Reuse vs. Multiple Instances

**Decision:** Hybrid - Single for grid, Multiple for comparison

**Rationale:**
- Grid: Thumbnails don't need full canvas power → use lightweight rendering
- Comparison: Need interactive canvases → create dedicated instances
- Memory tradeoff acceptable for comparison (user explicitly requested it)

---

### 5. Timeline as Separate View (not integrated in grid)

**Decision:** Timeline is distinct mode, not a sorting option

**Rationale:**
- Timeline requires different visual representation (horizontal vs. grid)
- Would clutter grid view if always visible
- User explicitly opts into temporal view when relevant
- Can still chronologically sort grid separately

---

## Performance Targets

| Metric | Target | How to Achieve |
|--------|--------|----------------|
| Grid load time | <500ms for 50 pages | Virtual scrolling, lazy render |
| Search response | <100ms | Pre-indexed tokens, debounced input |
| Thumbnail render | <50ms per thumbnail | Small canvas (200x300px), cached |
| Comparison load | <1s for 4 pages | Pre-load strokes, reuse renderer |
| Memory usage | <200MB for 100 pages | Lazy load full data, LRU cache |
| Timeline render | <300ms | SVG-based, simple markers |

---

## Visual Design Tokens

### Page Thumbnail Card
```css
.page-thumbnail {
  width: 200px;
  height: 320px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.page-thumbnail:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(233, 69, 96, 0.3);
}

.thumbnail-header {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  font-weight: 600;
}

.thumbnail-canvas {
  width: 100%;
  height: 200px;
  background: white;
}

.thumbnail-footer {
  padding: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.thumbnail-actions {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--border);
}
```

### Comparison Layout
```css
.comparison-container {
  display: grid;
  gap: 16px;
  height: 100%;
}

/* 2-column layout */
.comparison-2col {
  grid-template-columns: 1fr 1fr;
}

/* 2-row layout */
.comparison-2row {
  grid-template-rows: 1fr 1fr;
}

/* 3-grid (2 top, 1 bottom) */
.comparison-3grid {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

/* 4-grid */
.comparison-4grid {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.comparison-pane {
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}

.pane-header {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pane-canvas {
  flex: 1;
  min-height: 0;
}
```

### Timeline View
```css
.timeline-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.timeline-controls {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  align-items: center;
}

.timeline-svg {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
}

.page-marker {
  cursor: pointer;
  transition: transform 0.2s;
}

.page-marker:hover {
  transform: scale(1.1);
}

.session-group {
  fill: var(--accent);
  opacity: 0.1;
  stroke: var(--accent);
  stroke-width: 2;
}
```

---

## Testing Strategy

### Unit Tests
- [ ] Store: `allPages` correctly merges sources
- [ ] Store: Search filters pages correctly
- [ ] Store: Sort modes work as expected
- [ ] Util: `tokenize()` produces correct tokens
- [ ] Util: `searchPages()` matches correctly

### Integration Tests
- [ ] Grid renders with real stroke data
- [ ] Thumbnails load on scroll (virtual scrolling)
- [ ] Click thumbnail navigates to stroke canvas
- [ ] Search updates visible pages reactively
- [ ] Comparison mode loads multiple pages
- [ ] Timeline positions pages chronologically

### Manual Test Cases
1. **Empty State:** No strokes → show empty message
2. **Single Page:** One page → grid shows single thumbnail
3. **Large Dataset:** 100+ pages → virtual scrolling works, no lag
4. **Search:** Search "meeting" → only matching pages shown
5. **Date Filter:** Today only → correct pages shown
6. **Book Filter:** Select Book 161 → only those pages shown
7. **Comparison:** Select 3 pages → comparison view shows all 3
8. **Sync Zoom:** Enable sync → zoom one pane → all panes zoom
9. **Timeline:** Switch to timeline → pages chronologically positioned
10. **Mobile:** Resize to mobile → single column grid, filters collapse

---

## Development Tips

### Leverage Existing Code
- **Canvas Renderer:** Reuse `CanvasRenderer` class for thumbnails (just smaller scale)
- **Page Filtering:** Adapt `PageSelector.svelte` logic for page selection
- **Store Patterns:** Follow existing store structure (writable + derived)
- **Styling:** Use existing CSS variables and component patterns

### Quick Wins
1. Start with Book/Page sort only (simplest)
2. Use placeholder thumbnails first (gray boxes), add rendering later
3. Test with 5-10 pages before scaling to 100+
4. Implement Grid view fully before Comparison/Timeline

### Performance Traps to Avoid
- ❌ Don't render all thumbnails on mount → Use virtual scrolling
- ❌ Don't recalculate search index on every keystroke → Pre-build index
- ❌ Don't keep all stroke data in memory → Lazy load per page
- ❌ Don't create 100 canvas instances → Reuse for thumbnails

### Debugging Helpers
```javascript
// Log visible pages
$: console.log('Visible pages:', $visiblePages.length);

// Log search performance
console.time('search');
const results = searchPages($allPages, query);
console.timeEnd('search'); // Should be <50ms

// Log memory usage
console.log('Memory:', performance.memory.usedJSHeapSize / 1024 / 1024, 'MB');
```

---

## Next Steps

1. **Review this spec with team/users** - Get feedback on UX flows
2. **Create component stubs** - Empty Svelte components with proper structure
3. **Set up stores** - Implement `page-preview.js` first (foundation)
4. **Build Phase 1** - Get basic grid working end-to-end
5. **Iterate** - User testing after each phase, adjust UX as needed

---

## Questions to Resolve

- [ ] Should thumbnails show strokes or transcribed text by default?
- [ ] Should search highlight matching terms in thumbnail text?
- [ ] Should comparison mode support stroke vs. text per pane independently?
- [ ] Should timeline playback auto-advance or manual control only?
- [ ] Should there be a "Recent Pages" quick access list?
- [ ] Should pages have user-editable titles/notes?

---

## Success Metrics

**Phase 1 (Grid View):**
- ✅ User can browse all pages as thumbnails
- ✅ Click thumbnail → view full page in <1s
- ✅ Grid supports 50+ pages without lag

**Phase 2 (Search):**
- ✅ User can find pages by content in <100ms
- ✅ Search works with imperfect OCR (partial matches)
- ✅ Filters (date, book) work in combination with search

**Phase 3 (Comparison):**
- ✅ User can compare 2-4 pages side-by-side
- ✅ Sync zoom/pan toggles work correctly
- ✅ Comparison is useful (user feedback: "This helps me work")

**Phase 4 (Timeline):**
- ✅ User can visualize writing chronology
- ✅ Session detection groups related pages
- ✅ Timeline helps answer "when did I write this?"

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial UI/UX flow and implementation guide |
