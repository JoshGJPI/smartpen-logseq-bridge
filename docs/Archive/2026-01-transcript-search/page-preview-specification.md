# Page Preview Specification
## SmartPen-LogSeq Bridge - Page & Book Visualization

**Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Design Specification  
**Related Docs:** `temporal-data-specification.md`, `app-specification.md`

---

## Table of Contents

1. [Overview](#overview)
2. [Motivation & Goals](#motivation--goals)
3. [User Interface Design](#user-interface-design)
4. [Data Architecture](#data-architecture)
5. [Search & Filter System](#search--filter-system)
6. [View Modes](#view-modes)
7. [Page Comparison & Side-by-Side](#page-comparison--side-by-side)
8. [Temporal Integration](#temporal-integration)
9. [Implementation Phases](#implementation-phases)
10. [Technical Considerations](#technical-considerations)

---

## Overview

The **Page Preview** feature transforms the SmartPen-LogSeq Bridge from a stroke-centric tool into a comprehensive page and book management system. While the current Stroke Preview excels at visualizing and selecting individual strokes, Page Preview provides a higher-level view organized around pages and books, with powerful search, sorting, and comparison capabilities.

### Key Capabilities

- **Page-centric navigation**: Browse all pages across books with thumbnails and metadata
- **Smart search**: Bag-of-words text search across transcribed content
- **Flexible sorting**: Book/Page, Chronological, or Alphabetical (by transcribed text)
- **Multi-page comparison**: View 2-4 pages side-by-side with synchronized zooming
- **Temporal visualization**: Timeline view showing writing chronology across pages
- **Seamless integration**: Leverages existing canvas drag-and-drop and page positioning

---

## Motivation & Goals

### Current State

The application provides excellent tools for:
- ✅ Capturing and visualizing strokes
- ✅ Transcribing handwriting to text
- ✅ Managing pages individually in LogSeq
- ✅ Basic page filtering in stroke canvas

### Gaps & Pain Points

Users currently struggle to:
- ❌ Find specific content across multiple pages and books
- ❌ Compare pages or see them side-by-side
- ❌ Understand the temporal flow of writing across pages
- ❌ Get a quick overview of what's in each page without loading strokes
- ❌ Navigate large notebooks efficiently

### Design Goals

1. **Discoverability**: Make it easy to find pages with specific content
2. **Context**: Show page metadata (book, page number, date, stroke count, text preview)
3. **Navigation**: Quick switching between pages without reloading stroke data
4. **Comparison**: Enable side-by-side viewing for reference and analysis
5. **Temporal Awareness**: Visualize writing chronology across pages
6. **Performance**: Handle 100+ pages without lag
7. **Integration**: Work seamlessly with existing Stroke Preview and canvas

---

## User Interface Design

### Layout Architecture

Page Preview operates as an **alternative canvas view mode** with a dedicated toggle:

```
┌─────────────────────────────────────────────────────────────┐
│  Header: [Stroke Preview] [Page Preview ●] [Text View]     │
└─────────────────────────────────────────────────────────────┘
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  Sidebar (Left Panel)                                 │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  📚 Book Navigation                             │  │ │
│  │  │  • Book 161 "Meeting Notes" (12 pages)          │  │ │
│  │  │  • Book 162 "Personal Journal" (8 pages)        │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  🔍 Search & Filter                             │  │ │
│  │  │  [Search: "roadmap"]                            │  │ │
│  │  │  Sort: [Book/Page ▾] [Chronological] [A-Z]     │  │ │
│  │  │  Date: [Jan 1-31, 2026        ]                │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  📄 Page List (filtered results)                │  │ │
│  │  │  ┌─────────────────────────────────────────┐    │  │ │
│  │  │  │ Book 161 - Page 3                       │    │  │ │
│  │  │  │ Jan 6, 2026 10:34 AM • 47 strokes       │    │  │ │
│  │  │  │ "Discussed Q1 roadmap with team..."     │ ← Preview │
│  │  │  │ [View] [Compare] [Select]               │    │  │ │
│  │  │  └─────────────────────────────────────────┘    │  │ │
│  │  │  ... more pages ...                             │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  Main Canvas Area                                     │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  Grid/Gallery View Mode                         │  │ │
│  │  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐        │  │ │
│  │  │  │ B161 │  │ B161 │  │ B161 │  │ B162 │        │  │ │
│  │  │  │ P1   │  │ P2   │  │ P3   │  │ P1   │        │  │ │
│  │  │  │ [📷] │  │ [📷] │  │ [📷] │  │ [📷] │        │  │ │
│  │  │  │ 23   │  │ 47   │  │ 18   │  │ 65   │        │  │ │
│  │  │  │stroke│  │stroke│  │stroke│  │stroke│        │  │ │
│  │  │  └──────┘  └──────┘  └──────┘  └──────┘        │  │ │
│  │  │  ... more thumbnails ...                        │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  OR                                                    │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  Side-by-Side Comparison Mode                   │  │ │
│  │  │  ┌──────────────────┐  ┌──────────────────┐    │  │ │
│  │  │  │ Book 161, Page 3 │  │ Book 161, Page 7 │    │  │ │
│  │  │  │ [Stroke canvas]  │  │ [Stroke canvas]  │    │  │ │
│  │  │  │ or [Text view]   │  │ or [Text view]   │    │  │ │
│  │  │  └──────────────────┘  └──────────────────┘    │  │ │
│  │  │  [⊕] Add page (up to 4 total)                  │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  OR                                                    │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  Timeline View (Temporal Mode)                  │  │ │
│  │  │  ┌──────────────────────────────────────────┐   │  │ │
│  │  │  │ Jan 6, 9AM    10AM         11AM    12PM  │   │  │ │
│  │  │  │ ├─────┬────────┬────────┬───────────┤   │   │  │ │
│  │  │  │ B161  B161     B162      B161        │   │  │ │
│  │  │  │ P1    P2       P1        P3          │   │  │ │
│  │  │  │ [▸]   [▸]      [▸]       [▸]         │   │  │ │
│  │  │  └──────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### View Mode Toggle

The canvas area supports three distinct modes via header toggle buttons:

1. **Stroke Preview** (existing): Render all strokes from selected pages
2. **Page Preview** (new): Show page grid/gallery with thumbnails
3. **Text View** (existing): Display transcribed text inside page boundaries

### Component Structure

```
Page Preview Components:
├── PagePreviewCanvas.svelte         # Main container, mode orchestration
├── PageGrid.svelte                  # Grid/gallery layout for page thumbnails
├── PageThumbnail.svelte             # Individual page card with thumbnail
├── PageSidebar.svelte               # Left panel navigation and filters
│   ├── BookNavigator.svelte         # Collapsible book list
│   ├── SearchFilters.svelte         # Search and sort controls
│   └── PageList.svelte              # Filtered page results list
├── PageComparison.svelte            # Side-by-side page viewer
│   ├── ComparisonPane.svelte        # Single page in comparison view
│   └── ComparisonControls.svelte    # Sync zoom, layout controls
└── TimelineView.svelte              # Chronological page timeline
```

---

## Data Architecture

### Page Metadata Structure

Each page in the system has rich metadata for search, sorting, and display:

```javascript
{
  // Identity
  pageKey: "S3/O1012/B161/P3",      // Ncode identifier
  book: 161,                         // Book ID
  page: 3,                           // Page number
  section: 3,                        // Ncode section
  owner: 1012,                       // Ncode owner
  
  // Content
  strokeCount: 47,                   // Number of strokes
  strokes: [...],                    // Optional: Full stroke data (lazy-loaded)
  transcriptionText: "Discussed...", // Full transcribed text
  textPreview: "Discussed Q1 road...", // First 100 chars for list view
  
  // Temporal (from first/last stroke timestamps)
  firstStrokeTime: 1765403005055,   // Unix timestamp (ms)
  lastStrokeTime: 1765403245892,    // Unix timestamp (ms)
  writingDuration: 240837,          // ms (lastStroke - firstStroke)
  
  // Metadata
  hasTranscription: true,           // Whether text is available
  source: 'myscript' | 'logseq',   // Where data came from
  syncStatus: 'clean' | 'unsaved' | 'in-canvas', // LogSeq sync state
  
  // Search indexing
  searchTokens: Set(['discussed', 'q1', 'roadmap', ...]), // For bag-of-words
  
  // Display
  thumbnailUrl: 'data:image/png;base64,...', // Optional pre-rendered thumbnail
  selected: false,                   // UI selection state
  comparisonSlot: null              // Which comparison pane (1-4) or null
}
```

### Store Architecture

New stores for Page Preview:

```javascript
// src/stores/page-preview.js

// All pages with metadata (derived from strokes + transcriptions + logseqPages)
export const allPages = derived(
  [strokes, pageTranscriptions, logseqPages, bookAliases],
  ([$strokes, $transcriptions, $lsPages, $aliases]) => {
    // Merge stroke data, transcriptions, and LogSeq imports
    // Generate metadata for each unique page
    return pageMetadataArray;
  }
);

// Current search/filter state
export const searchQuery = writable('');
export const sortMode = writable('book-page'); // 'book-page' | 'chronological' | 'alphabetical'
export const dateRange = writable({ start: null, end: null });
export const selectedBooks = writable(new Set()); // Empty = all books

// Filtered and sorted pages
export const visiblePages = derived(
  [allPages, searchQuery, sortMode, dateRange, selectedBooks],
  ([$pages, $search, $sort, $dateRange, $books]) => {
    // Apply search filter (bag of words)
    // Apply date range filter
    // Apply book filter
    // Apply sort
    return filteredSortedPages;
  }
);

// Page comparison state
export const comparisonPages = writable([null, null, null, null]); // Up to 4 pages
export const comparisonLayout = writable('2-column'); // '2-column' | '2-row' | '3-grid' | '4-grid'
export const syncZoom = writable(true); // Synchronized zoom across comparison panes
```

### Data Loading Strategy

**Progressive Loading** to handle large notebooks:

1. **Phase 1 - Metadata Only**: Load page list with minimal data
   - Page identifiers (book, page, pageKey)
   - Stroke counts
   - Timestamps (from first/last stroke)
   - Text preview (first 100 chars)
   
2. **Phase 2 - On-Demand**: Load full data when needed
   - Full stroke arrays (when viewing/comparing page)
   - Full transcription text (when searching/displaying)
   - Thumbnail images (when scrolling into view)

3. **Phase 3 - Caching**: Keep recently viewed pages in memory
   - LRU cache of last 10 pages' full data
   - Persist to IndexedDB for offline access

---

## Search & Filter System

### Bag-of-Words Search

**Why Bag-of-Words?**
- Simple and fast for handwriting recognition text
- Handles OCR errors gracefully (partial matches work)
- No need for complex phrase parsing
- Works well with imperfect transcription

**Implementation:**

```javascript
// Tokenization
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)              // Split on whitespace
    .filter(word => word.length > 2); // Ignore 1-2 char words
}

// Build search index for each page
function buildSearchIndex(page) {
  const tokens = tokenize(page.transcriptionText || '');
  page.searchTokens = new Set(tokens);
  return page;
}

// Search function
function searchPages(pages, query) {
  if (!query) return pages;
  
  const queryTokens = tokenize(query);
  
  return pages.filter(page => {
    if (!page.searchTokens) return false;
    
    // Match if ANY query token is in page tokens (OR search)
    return queryTokens.some(token => 
      Array.from(page.searchTokens).some(pageToken => 
        pageToken.includes(token) || token.includes(pageToken)
      )
    );
  }).map(page => ({
    ...page,
    // Calculate match score for ranking
    matchScore: queryTokens.filter(token =>
      Array.from(page.searchTokens).some(pageToken =>
        pageToken.includes(token) || token.includes(pageToken)
      )
    ).length
  })).sort((a, b) => b.matchScore - a.matchScore); // Rank by relevance
}
```

**Search Features:**
- Case-insensitive
- Partial word matching ("road" matches "roadmap")
- Multiple terms = OR search (any term matches)
- Results ranked by number of matching terms
- Instant search (no submit button)
- Highlight matching terms in results

### Sort Modes

#### 1. Book/Page (Default)
```javascript
// Sort by book ID, then page number
pages.sort((a, b) => {
  if (a.book !== b.book) return a.book - b.book;
  return a.page - b.page;
});
```

**Use Case:** Logical notebook order, following physical page sequence

#### 2. Chronological
```javascript
// Sort by first stroke timestamp (when page was started)
pages.sort((a, b) => a.firstStrokeTime - b.firstStrokeTime);
```

**Use Case:** See writing in the order it actually happened, identify what was written when

**Enhanced Feature:** Timeline visualization (see [Timeline View](#timeline-view))

#### 3. Alphabetical
```javascript
// Sort by transcribed text content (first line or full text)
pages.sort((a, b) => {
  const textA = (a.transcriptionText || '').toLowerCase();
  const textB = (b.transcriptionText || '').toLowerCase();
  return textA.localeCompare(textB);
});
```

**Use Case:** Find pages by content when you know the beginning text

### Date Range Filter

```javascript
// Filter by stroke timestamp range
function filterByDateRange(pages, startDate, endDate) {
  return pages.filter(page => {
    if (!page.firstStrokeTime) return false;
    
    const pageDate = new Date(page.firstStrokeTime);
    const inRange = (!startDate || pageDate >= startDate) &&
                   (!endDate || pageDate <= endDate);
    return inRange;
  });
}
```

**UI Component:**
- Date range picker (start/end)
- Quick presets: "Today", "This Week", "This Month", "All Time"
- Clear button to remove filter

### Book Filter

```javascript
// Filter to selected books only
function filterByBooks(pages, selectedBooks) {
  if (selectedBooks.size === 0) return pages; // Empty = all books
  return pages.filter(page => selectedBooks.has(page.book));
}
```

**UI Component:**
- Checkbox list of all books
- Book aliases displayed (user-friendly names)
- "Select All" / "Select None" buttons
- Show page count per book

---

## View Modes

### 1. Grid/Gallery View (Primary)

**Layout:** Responsive grid of page thumbnails

```
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ B161 │ │ B161 │ │ B161 │ │ B162 │
│ P1   │ │ P2   │ │ P3   │ │ P1   │
│ [📷] │ │ [📷] │ │ [📷] │ │ [📷] │
│ 23   │ │ 47   │ │ 18   │ │ 65   │
│stroke│ │stroke│ │stroke│ │stroke│
└──────┘ └──────┘ └──────┘ └──────┘
```

**Thumbnail Card:**
- **Header:** Book ID + Page number (with alias: "Meeting Notes - Page 3")
- **Image:** Canvas thumbnail (rendered at small scale, ~200x300px)
  - Option 1: Pre-render when page is loaded (cached)
  - Option 2: Render on-demand using virtual scrolling
- **Footer Metadata:**
  - Stroke count
  - Date/time (formatted: "Jan 6, 10:34 AM")
  - Text preview (first 50 chars, ellipsis)
- **Actions:**
  - Click: View full page in canvas
  - Hover: Quick preview tooltip with full text snippet
  - Checkbox: Add to comparison mode
  - ⋮ Menu: Delete, Export, Send to LogSeq

**Responsive Grid:**
- Desktop (>1400px): 4 columns
- Laptop (1000-1400px): 3 columns
- Tablet (600-1000px): 2 columns
- Mobile (<600px): 1 column

**Performance:**
- Virtual scrolling for 100+ pages
- Lazy-load thumbnails (render when in viewport)
- Cache rendered thumbnails in memory

### 2. List View (Compact Alternative)

**Layout:** Dense list with text emphasis

```
┌─────────────────────────────────────────────────────┐
│ 📄 Book 161 - Page 3      Jan 6, 10:34 AM  47 str  │
│    "Discussed Q1 roadmap with team, action items..." │
│    [View] [Compare] [Delete]                         │
├─────────────────────────────────────────────────────┤
│ 📄 Book 161 - Page 7      Jan 6, 11:15 AM  23 str  │
│    "Follow-up meeting notes, budget constraints..." │
│    [View] [Compare] [Delete]                         │
└─────────────────────────────────────────────────────┘
```

**Benefits:**
- Faster scanning of page list
- More text visible per page
- Better for search result browsing
- No thumbnail rendering overhead

**Toggle:** Button in header to switch Grid ↔ List

---

## Page Comparison & Side-by-Side

### Comparison Workflow

1. **Selection Phase:**
   - User checks pages in grid/list view
   - "Compare Selected" button appears when 2-4 pages selected
   - Click button → Enter comparison mode

2. **Comparison Mode:**
   - Canvas splits into 2-4 panes (based on selection count)
   - Each pane shows a full-featured canvas for that page
   - Can toggle between stroke view and text view per pane
   - Independent pan/zoom OR synchronized (toggle)

3. **Exit:**
   - "Back to Grid" button
   - "Clear Comparison" to remove all panes

### Layout Options

#### 2-Page Comparison
```
┌─────────────────┬─────────────────┐
│ Book 161, P3    │ Book 161, P7    │
│ [Canvas]        │ [Canvas]        │
│ 47 strokes      │ 23 strokes      │
│ [Stroke] [Text] │ [Stroke] [Text] │
└─────────────────┴─────────────────┘
```

**Use Cases:**
- Compare two pages from same meeting
- Before/after comparison
- Reference and working page

#### 3-Page Comparison
```
┌─────────────┬─────────────┐
│ Book 161,P3 │ Book 161,P7 │
│ [Canvas]    │ [Canvas]    │
├─────────────┴─────────────┤
│ Book 162, P1              │
│ [Canvas - Full Width]     │
└───────────────────────────┘
```

**Use Cases:**
- Compare multiple meeting notes
- Project overview with details

#### 4-Page Comparison
```
┌─────────┬─────────┐
│ B161,P3 │ B161,P7 │
│ [Canvas]│ [Canvas]│
├─────────┼─────────┤
│ B162,P1 │ B162,P2 │
│ [Canvas]│ [Canvas]│
└─────────┴─────────┘
```

**Use Cases:**
- Comprehensive project review
- Multi-session meeting comparison

### Synchronized Features

**Zoom Sync (Toggle):**
When enabled, zooming in one pane zooms all panes equally
```javascript
function handleZoomInPane(paneIndex, newZoom) {
  if (syncZoom) {
    // Apply to all panes
    comparisonPanes.forEach((pane, idx) => {
      pane.renderer.setZoom(newZoom);
    });
  } else {
    // Apply to single pane only
    comparisonPanes[paneIndex].renderer.setZoom(newZoom);
  }
}
```

**Pan Sync (Toggle):**
When enabled, panning one canvas pans all canvases proportionally

**View Mode Sync (Toggle):**
When enabled, switching Stroke ↔ Text in one pane switches all panes

### Comparison Actions

**Per-Pane Actions:**
- Replace page (dropdown to select different page)
- Toggle stroke/text view
- Zoom controls
- Export this page

**Global Actions:**
- Sync zoom on/off
- Sync pan on/off
- Layout mode (2-col, 2-row, 3-grid, 4-grid)
- Export all pages as PDF
- Back to grid view

---

## Temporal Integration

### Timeline View

**Purpose:** Visualize writing chronology across pages, leveraging temporal data from `temporal-data-specification.md`

**Layout:** Horizontal timeline with page markers

```
┌───────────────────────────────────────────────────────────┐
│ Timeline View - January 6, 2026                           │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  9:00 AM         10:00 AM        11:00 AM        12:00 PM│
│  ├────────────────┼────────────────┼────────────────┤    │
│  │                │                │                │    │
│  ▼                ▼                ▼                ▼    │
│  ┌─────┐          ┌─────┐         ┌─────┐        ┌─────┐│
│  │B161 │          │B161 │         │B162 │        │B161 ││
│  │ P1  │          │ P2  │         │ P1  │        │ P3  ││
│  │9:15 │          │10:22│         │11:04│        │11:47││
│  │ 23  │          │ 47  │         │ 18  │        │ 65  ││
│  │str  │          │str  │         │str  │        │str  ││
│  └─────┘          └─────┘         └─────┘        └─────┘│
│                                                           │
│  [▸ Playback]  Speed: [1x ▾]  Zoom: [1 hour ▾]         │
└───────────────────────────────────────────────────────────┘
```

**Features:**

1. **Chronological Positioning:**
   - Pages positioned based on `firstStrokeTime`
   - Horizontal axis = time
   - Vertical stacking if pages overlap temporally

2. **Zoom Levels:**
   - Hour view (1 hour range)
   - Day view (24 hours)
   - Week view (7 days)
   - Month view (30 days)

3. **Page Markers:**
   - Mini thumbnail or icon
   - Book/Page label
   - Timestamp
   - Stroke count
   - Click to view full page

4. **Playback Mode:**
   - Animate through pages in chronological order
   - Speed controls (0.5x, 1x, 2x, 5x, 10x)
   - Auto-advance to next page based on writing duration
   - Useful for reviewing thought progression

5. **Session Detection:**
   - Visual grouping of pages written in same session
   - Detect gaps >2 minutes as session breaks
   - Different colors for different sessions

### Temporal Sort Enhancements

When **Chronological** sort is active:

- Option to group by session (pages within 2-min gaps grouped)
- Show time gaps between pages ("5 min later", "2 hours later")
- Highlight pages written on same day with visual marker

### Temporal Filters

**Date Range Picker:**
- Calendar widget with date range selection
- Quick presets:
  - Today
  - Yesterday
  - This Week
  - Last 7 Days
  - This Month
  - Custom Range

**Time of Day Filter:**
- Slider to select time range (e.g., 9 AM - 5 PM)
- Use case: "Show me all pages written during work hours"

---

## Implementation Phases

### Phase 1: Core Page Grid (MVP)
**Effort:** 12-16 hours  
**Priority:** High

**Deliverables:**
- [ ] `PagePreviewCanvas.svelte` - Main container component
- [ ] `PageGrid.svelte` - Thumbnail grid layout
- [ ] `PageThumbnail.svelte` - Individual page card
- [ ] `allPages` derived store - Merge strokes, transcriptions, LogSeq data
- [ ] Basic thumbnail rendering (small-scale stroke canvas)
- [ ] Click to view full page in stroke canvas
- [ ] Book/Page sort (default)

**Acceptance Criteria:**
- Can see all pages as thumbnails
- Thumbnails show book/page/date/stroke count
- Click thumbnail → load full page in canvas
- Grid is responsive (4/3/2/1 columns)

---

### Phase 2: Search & Filters
**Effort:** 8-10 hours  
**Priority:** High

**Deliverables:**
- [ ] `SearchFilters.svelte` - Search input and filter controls
- [ ] Bag-of-words search implementation
- [ ] Date range filter
- [ ] Book filter (checkbox list)
- [ ] Sort mode toggle (Book/Page, Chronological, Alphabetical)
- [ ] Search result highlighting
- [ ] "No results" empty state

**Acceptance Criteria:**
- Can search for words in transcribed text
- Search is instant (debounced, <100ms)
- Can filter by date range
- Can filter by book selection
- Search highlights matching pages in grid
- Sort modes work correctly

---

### Phase 3: Page Comparison
**Effort:** 10-12 hours  
**Priority:** Medium

**Deliverables:**
- [ ] `PageComparison.svelte` - Side-by-side container
- [ ] `ComparisonPane.svelte` - Individual comparison canvas
- [ ] `ComparisonControls.svelte` - Layout and sync controls
- [ ] `comparisonPages` store - Track 2-4 selected pages
- [ ] Multi-select UI in grid (checkboxes)
- [ ] Layout switcher (2-col, 2-row, 3-grid, 4-grid)
- [ ] Synchronized zoom toggle
- [ ] Per-pane stroke/text view toggle

**Acceptance Criteria:**
- Can select 2-4 pages from grid
- "Compare Selected" button appears
- Comparison view shows selected pages side-by-side
- Can toggle sync zoom on/off
- Can switch layout modes
- Can exit comparison back to grid

---

### Phase 4: Timeline View
**Effort:** 12-16 hours  
**Priority:** Medium-Low

**Deliverables:**
- [ ] `TimelineView.svelte` - Horizontal timeline component
- [ ] Chronological positioning of page markers
- [ ] Zoom levels (hour, day, week, month)
- [ ] Session detection and grouping
- [ ] Page marker click → view full page
- [ ] Time gap labels between pages
- [ ] Playback mode (optional)

**Acceptance Criteria:**
- Can switch to timeline view from header
- Pages positioned chronologically
- Can zoom in/out on timeline
- Can see time gaps between pages
- Session detection groups related pages
- Click page marker → load in canvas

---

### Phase 5: Performance & Polish
**Effort:** 8-12 hours  
**Priority:** Low

**Deliverables:**
- [ ] Virtual scrolling for grid (100+ pages)
- [ ] Lazy-load thumbnails (render when in viewport)
- [ ] Thumbnail caching (IndexedDB)
- [ ] LRU cache for page data
- [ ] Progressive loading indicators
- [ ] Empty states and error handling
- [ ] Keyboard shortcuts (arrow keys for navigation)
- [ ] Export comparison as PDF

**Acceptance Criteria:**
- Grid scrolls smoothly with 100+ pages
- No lag when switching between pages
- Thumbnails render only when visible
- Memory usage stays reasonable (<200MB)
- Keyboard navigation works

---

## Technical Considerations

### Canvas Reuse vs. Multiple Instances

**Option 1: Single Shared Canvas**
- Pro: Memory efficient, existing canvas instance
- Pro: Leverages existing renderer optimizations
- Con: More complex state management
- Con: Need to reload strokes when switching pages

**Option 2: Multiple Canvas Instances (Comparison)**
- Pro: Simpler state isolation per pane
- Pro: Can view multiple pages simultaneously
- Con: Higher memory usage
- Con: Need to manage multiple renderers

**Recommendation:** Hybrid approach
- Single canvas for grid view (reused for thumbnails)
- Multiple canvas instances for comparison mode (2-4)
- Lazy-create comparison canvases only when needed

### Thumbnail Rendering Strategy

**Challenge:** Rendering 50-100 small canvases is expensive

**Solution: Virtual Scrolling + Lazy Rendering**

```javascript
// Only render thumbnails in viewport + buffer
function getThumbnailsInViewport(scrollTop, viewportHeight) {
  const buffer = 200; // pixels above/below viewport
  const startY = scrollTop - buffer;
  const endY = scrollTop + viewportHeight + buffer;
  
  return visiblePages.filter(page => {
    const pageY = page.gridPosition.y;
    const pageHeight = page.gridPosition.height;
    return pageY + pageHeight >= startY && pageY <= endY;
  });
}

// Render thumbnails on-demand
function renderThumbnail(page) {
  if (page.thumbnailUrl) return; // Already cached
  
  // Create temporary small canvas
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 200;
  thumbCanvas.height = 300;
  
  // Render strokes at small scale
  const tempRenderer = new CanvasRenderer(thumbCanvas);
  tempRenderer.calculateBounds(page.strokes);
  page.strokes.forEach(stroke => {
    tempRenderer.drawStroke(stroke, false, false, false);
  });
  
  // Cache as data URL
  page.thumbnailUrl = thumbCanvas.toDataURL('image/png');
  
  // Clean up
  tempRenderer = null;
  thumbCanvas = null;
}
```

### Search Performance

**Challenge:** Searching 100+ pages' text in real-time

**Solution: Pre-indexed Tokens**

```javascript
// Build index once when page is loaded/transcribed
function buildSearchIndex(pages) {
  return pages.map(page => ({
    ...page,
    searchTokens: tokenize(page.transcriptionText)
  }));
}

// Search is O(n) but with Set lookups (O(1))
function searchIndexedPages(pages, query) {
  const queryTokens = tokenize(query);
  return pages.filter(page => 
    queryTokens.some(token => page.searchTokens.has(token))
  );
}
```

**Performance Target:** <50ms for 100 pages

### State Management Complexity

**Challenge:** Multiple views (grid, comparison, timeline) with shared state

**Solution: Centralized Store with View-Specific Subscriptions**

```javascript
// Each view subscribes only to what it needs
// Grid View
$: visiblePages = derived([allPages, searchQuery, sortMode], ...);

// Comparison View
$: comparisonCanvases = derived([comparisonPages], ...);

// Timeline View
$: timelinePages = derived([allPages, sortMode], 
  ([$pages, $sort]) => $sort === 'chronological' ? $pages : []
);
```

### Canvas Integration

**Existing Drag-and-Drop:**
The current stroke canvas has page drag-and-drop with custom positioning. Page Preview should:
1. Respect existing `pagePositions` store
2. Allow drag-and-drop in grid view → update positions
3. Sync positions between Stroke Preview and Page Preview
4. Use `useCustomPositions` toggle for layout mode

**Integration Point:**
```javascript
// When dragging thumbnail in Page Preview
function handleThumbnailDrag(pageKey, newX, newY) {
  setPagePosition(pageKey, newX, newY);
  // This updates pagePositions store, which is already used by StrokeCanvas
}
```

### Memory Management

**Target:** Support 100 pages with <200MB memory usage

**Strategy:**
1. **Lazy Load Full Data:**
   - Keep only metadata (2-5KB per page) in memory
   - Load full strokes (100KB-1MB per page) on-demand
   
2. **LRU Cache:**
   - Keep last 10 viewed pages in full-data cache
   - Evict least recently used when exceeding limit

3. **Thumbnail Cache:**
   - Cache rendered thumbnails as data URLs
   - Store in IndexedDB for persistence
   - ~50-100KB per thumbnail

4. **Comparison Mode Limit:**
   - Max 4 pages simultaneously
   - Load comparison pages into memory when entering mode
   - Unload when exiting

### Responsive Design

**Mobile Considerations:**
- Grid: Single column on mobile
- Comparison: Not recommended for mobile (<600px)
  - Show warning: "Comparison mode works best on larger screens"
  - Allow but in stacked layout (vertical)
- Timeline: Horizontal scroll on mobile
- Search: Collapsible filters to save space

---

## User Stories & Use Cases

### Story 1: Finding Meeting Notes
**As a user**, I want to find notes from a specific meeting so I can review what was discussed.

**Flow:**
1. Click "Page Preview" in header
2. Enter search term: "Q1 roadmap"
3. See filtered list of pages with matching text
4. Click thumbnail to view full page
5. Optionally compare with related pages

---

### Story 2: Reviewing Daily Writing
**As a user**, I want to see all pages I wrote today in chronological order.

**Flow:**
1. Click "Page Preview"
2. Select "Today" in date range filter
3. Click "Chronological" sort
4. See pages in order written
5. Use timeline view for visual representation

---

### Story 3: Comparing Project Pages
**As a user**, I want to compare pages from different project planning sessions.

**Flow:**
1. Search for "project plan"
2. Check 3 relevant pages from results
3. Click "Compare Selected"
4. View all 3 pages side-by-side
5. Toggle between stroke and text view
6. Export comparison as PDF

---

### Story 4: Finding Specific Book
**As a user**, I want to see all pages from my "Meeting Notes" book.

**Flow:**
1. Open Page Preview
2. In book filter, select only "Book 161 (Meeting Notes)"
3. See filtered grid of just those pages
4. Sort by page number for logical order

---

## Future Enhancements

### Phase 6+ (Optional)

1. **Annotations:**
   - Add digital annotations to handwritten pages
   - Highlight sections
   - Add sticky notes

2. **Tags & Categories:**
   - User-defined tags per page
   - Filter by tag
   - Tag cloud view

3. **Export Options:**
   - Export comparison as multi-page PDF
   - Export selected pages as ZIP
   - Share link (if cloud storage added)

4. **Advanced Search:**
   - Phrase matching (not just bag-of-words)
   - Regular expression search
   - Search within date range only

5. **Page Analytics:**
   - Most frequently referenced pages
   - Writing time heatmap by day/hour
   - Productivity dashboard

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial specification - Page Preview feature design |
