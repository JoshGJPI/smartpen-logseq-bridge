# LogSeq Database Explorer Specification

**Date:** December 2024  
**Status:** Draft  
**Purpose:** Replace Analysis tab with a LogSeq data browser for discovering, viewing, and importing stored smartpen pages

---

## Overview

Add a new "LogSeq DB" tab that provides visibility into all smartpen data stored in LogSeq. Users can browse stored pages, view transcriptions, and import stroke data back into the app for re-transcription or continued editing.

This feature complements the Lazy Import Transcription system by providing the manual discovery and import mechanism.

---

## Goals

1. **Visibility** - Show users what smartpen data exists in LogSeq
2. **Discovery** - Browse old pages, find forgotten notes
3. **Import** - Load stored strokes into canvas for viewing or re-transcription
4. **Status awareness** - Indicate which pages have unsaved local changes
5. **Simplification** - Replace unused Analysis tab with useful functionality

---

## UI Design

### Tab Replacement

**Before:**
```
[ Strokes ] [ Transcription ] [ Analysis ] [ Raw JSON ]
```

**After:**
```
[ Strokes ] [ Transcription ] [ LogSeq DB ] [ Raw JSON ]
```

### LogSeq DB Tab Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  LogSeq Database                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [🔄 Refresh]  Connected to localhost:12315                  ││
│  │               Last scanned: 2:34 PM                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 📚 Book 3017                                          [▼]   ││
│  │ ├─────────────────────────────────────────────────────────┐ ││
│  │ │ 📄 Page 42                                              │ ││
│  │ │ Strokes: 234  │  Last Updated: Dec 18, 2:30 PM          │ ││
│  │ │ ● Unsaved local changes                                 │ ││
│  │ │                                                         │ ││
│  │ │ Transcription:                                          │ ││
│  │ │ ┌─────────────────────────────────────────────────────┐ │ ││
│  │ │ │ Meeting Notes                                       │ │ ││
│  │ │ │   Discussed Q1 roadmap                              │ │ ││
│  │ │ │   Action items                                      │ │ ││
│  │ │ │     Review budget proposal                          │ │ ││
│  │ │ │     Schedule follow-up                              │ │ ││
│  │ │ └─────────────────────────────────────────────────────┘ │ ││
│  │ │                                                         │ ││
│  │ │ [Import Strokes]                                        │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  │ ├─────────────────────────────────────────────────────────┐ ││
│  │ │ 📄 Page 43                                              │ ││
│  │ │ Strokes: 89  │  Last Updated: Dec 17, 10:15 AM          │ ││
│  │ │                                                         │ ││
│  │ │ Transcription:                                          │ ││
│  │ │ ┌─────────────────────────────────────────────────────┐ │ ││
│  │ │ │ Project sketch ideas                                │ │ ││
│  │ │ │   Option A - curved roof                            │ │ ││
│  │ │ │   Option B - flat with parapet                      │ │ ││
│  │ │ └─────────────────────────────────────────────────────┘ │ ││
│  │ │                                                         │ ││
│  │ │ [Import Strokes]                                        │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 📚 Book 1234                                          [▶]   ││
│  │ (collapsed - click to expand)                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### Header Section
- **Refresh button** - Re-scan LogSeq for smartpen pages
- **Connection status** - Show LogSeq host or "Not connected"
- **Last scanned timestamp** - When page list was last fetched

#### Book Accordion
- **Collapsible** - Click to expand/collapse
- **Book ID** - Displayed as "Book {number}"
- **Page count badge** - Show number of pages in book (optional)

#### Page Card
- **Page number** - "Page {number}"
- **Stroke count** - Total strokes stored
- **Last updated** - Human-readable timestamp from metadata
- **Sync status indicator** - Shows if local changes exist (see below)
- **Transcription preview** - Full transcription with indentation preserved
- **Import button** - Load strokes into canvas

### Sync Status Indicators

| Status | Indicator | Meaning |
|--------|-----------|---------|
| Clean | (none) | LogSeq data matches or no local data |
| Unsaved changes | 🟡 "Unsaved local changes" | Local cache has strokes not in LogSeq |
| Imported | 🔵 "In canvas" | Page strokes currently loaded in app |

---

## Data Flow

### Page Discovery

```
User opens LogSeq DB tab (or clicks Refresh)
    │
    ▼
Check LogSeq connection status
    │
    ├── Not connected → Show "Connect to LogSeq to browse stored data"
    │
    └── Connected
            │
            ▼
        Query LogSeq for all pages in "Smartpen Data/" namespace
            │
            ▼
        For each page:
            ├── Parse page name → Extract book/page numbers
            ├── Get page properties (stroke count, last updated)
            ├── Get transcription block content
            └── Get stroke JSON block (for import, lazy-loaded)
            │
            ▼
        Group pages by book
            │
            ▼
        Update logseqPages store
            │
            ▼
        Render accordion UI
```

### Stroke Import

```
User clicks "Import Strokes" on a page card
    │
    ▼
Fetch stroke JSON from LogSeq page (if not already cached)
    │
    ▼
Parse stroke array from JSON
    │
    ▼
Get current strokes from app store
    │
    ▼
Deduplicate:
    ├── Build Set of existing stroke IDs
    ├── Filter LogSeq strokes to only those with new IDs
    └── Count: imported, skipped (duplicates)
    │
    ▼
Append new strokes to store
    │
    ▼
Update canvas rendering
    │
    ▼
Show activity log: "Imported 234 strokes from B3017/P42 (12 duplicates skipped)"
    │
    ▼
Mark page as "In canvas" in UI
```

### Sync Status Detection

```
For each LogSeq page:
    │
    ├── Get LogSeq stroke IDs (from stored JSON)
    │
    ├── Get local cache stroke IDs for same book/page
    │
    └── Compare:
            │
            ├── Local has strokes not in LogSeq → "Unsaved local changes"
            │
            ├── LogSeq has strokes not in local → (normal, no indicator)
            │
            └── Sets match → Clean (no indicator)
```

---

## LogSeq Query Strategy

### Finding Smartpen Pages

Use LogSeq's page search to find all pages in the smartpen namespace:

```javascript
// Option 1: Search by page name prefix
const pages = await logseqApi.request('logseq.DB.datascriptQuery', [`
  [:find (pull ?p [:block/name :block/properties])
   :where
   [?p :block/name ?name]
   [(clojure.string/starts-with? ?name "smartpen data/")]]
`]);

// Option 2: Query by property (if we add type:: smartpen-page)
const pages = await logseqApi.request('logseq.DB.datascriptQuery', [`
  [:find (pull ?p [:block/name :block/properties])
   :where
   [?p :block/properties ?props]
   [(get ?props :type) ?type]
   [(= ?type "smartpen-page")]]
`]);
```

### Fetching Page Details

For each discovered page, fetch:

1. **Properties** - Book, Page, Stroke-Count, Last-Updated, Transcribed
2. **Transcription text** - Content under "## Transcribed Text" heading
3. **Stroke JSON** - Content under "## Raw Stroke Data" heading (lazy-load on import)

```javascript
async function getPageDetails(pageName) {
  // Get page blocks
  const blocks = await logseqApi.request('logseq.Editor.getPageBlocksTree', [pageName]);
  
  // Find relevant sections
  const strokeBlock = findBlockByHeading(blocks, 'Raw Stroke Data');
  const transcriptionBlock = findBlockByHeading(blocks, 'Transcribed Text');
  
  return {
    pageName,
    book: extractBookFromName(pageName),
    page: extractPageFromName(pageName),
    strokeJson: strokeBlock ? parseJsonFromBlock(strokeBlock) : null,
    transcription: transcriptionBlock ? extractTextContent(transcriptionBlock) : null,
    properties: await logseqApi.request('logseq.Editor.getPageProperties', [pageName])
  };
}
```

---

## Store Design

### New Store: `logseqPages.js`

```javascript
import { writable, derived } from 'svelte/store';

// Raw page data from LogSeq
export const logseqPages = writable([]);

// Loading state
export const isScanning = writable(false);

// Last scan timestamp
export const lastScanTime = writable(null);

// Pages grouped by book
export const pagesByBook = derived(logseqPages, ($pages) => {
  const grouped = {};
  for (const page of $pages) {
    const book = page.book;
    if (!grouped[book]) {
      grouped[book] = [];
    }
    grouped[book].push(page);
  }
  // Sort pages within each book
  for (const book of Object.keys(grouped)) {
    grouped[book].sort((a, b) => a.page - b.page);
  }
  return grouped;
});

// Book IDs sorted
export const bookIds = derived(pagesByBook, ($grouped) => {
  return Object.keys($grouped).map(Number).sort((a, b) => a - b);
});

// Actions
export function setLogseqPages(pages) {
  logseqPages.set(pages);
  lastScanTime.set(Date.now());
}

export function setScanning(scanning) {
  isScanning.set(scanning);
}

export function clearLogseqPages() {
  logseqPages.set([]);
  lastScanTime.set(null);
}
```

### Page Data Structure

```typescript
interface LogSeqPageData {
  // Identification
  pageName: string;           // "Smartpen Data/B3017/P42"
  book: number;               // 3017
  page: number;               // 42
  
  // Metadata (from properties)
  strokeCount: number;        // 234
  lastUpdated: number;        // Unix timestamp
  transcribed: boolean;       // true/false
  
  // Content
  transcriptionText: string | null;  // Full transcribed text with indentation
  
  // Lazy-loaded (null until import requested)
  strokeData: SimplifiedStroke[] | null;
  
  // UI state
  syncStatus: 'clean' | 'unsaved' | 'in-canvas';
}
```

---

## LogSeq Storage Format and Parsing

### Storage Structure in LogSeq

Smartpen data is stored in LogSeq pages with this structure:

```
Smartpen Data/B3017/P42
├── Page Properties (Book::, Page::, Stroke-Count::, Last-Updated::, Transcribed::)
├── ## Raw Stroke Data
│   └── ```json block with stroke data
├── ## Transcription Data  
│   └── ```json block with transcription result
└── ## Transcribed Text
    └── Human-readable indented text
```

### Stored Stroke JSON Schema

Strokes are stored in a **simplified format** to reduce storage size (~60% smaller than raw pen data):

```json
{
  "version": "1.0",
  "pageInfo": {
    "section": 3,
    "owner": 1012,
    "book": 3017,
    "page": 42
  },
  "strokes": [
    {
      "id": "s1765313505107",
      "startTime": 1765313505107,
      "endTime": 1765313505396,
      "points": [
        [6.56, 37.25, 1765313505107],
        [6.58, 37.30, 1765313505153],
        [6.60, 37.46, 1765313505177]
      ]
    }
  ],
  "metadata": {
    "lastUpdated": 1765368883377,
    "strokeCount": 145,
    "bounds": {
      "minX": 6.56,
      "maxX": 42.91,
      "minY": 37.25,
      "maxY": 54.28
    }
  }
}
```

**Stored fields per stroke:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID: `s{startTime}` |
| `startTime` | number | Unix timestamp (ms) when stroke began |
| `endTime` | number | Unix timestamp (ms) when stroke ended |
| `points` | array | Array of `[x, y, timestamp]` tuples |

**Stripped fields (not stored):**
- `f` (pressure/force) - Not needed for transcription or display
- `dotType` - Can be inferred (first=down, middle=move, last=up)
- `angle` (tilt data) - Not needed
- `color` - Always black for notes
- Per-dot `pageInfo` - Redundant, stored at document level

### Raw Pen Format (Canvas Expectation)

The canvas renderer and strokes store expect the **raw pen format**:

```typescript
interface Stroke {
  pageInfo: {
    section: number;
    owner: number;
    book: number;
    page: number;
  };
  startTime: number;
  endTime: number;
  dotArray: Dot[];
}

interface Dot {
  x: number;
  y: number;
  f: number;              // Force/pressure (0-1000)
  dotType: 0 | 1 | 2 | 3; // 0=Down, 1=Move, 2=Up, 3=Hover
  timestamp: number;
  pageInfo: { section, owner, book, page };
}
```

### Transformation: Stored → Canvas Format

When importing strokes from LogSeq, transform the simplified format back to canvas-compatible format:

```javascript
/**
 * Transform stored stroke format to canvas-renderable format
 * @param {Object} storedData - Full JSON object from LogSeq
 * @returns {Array} Array of strokes in raw pen format
 */
function transformStoredToCanvasFormat(storedData) {
  const { pageInfo, strokes } = storedData;
  
  return strokes.map(stroke => {
    const points = stroke.points;
    
    return {
      pageInfo: { ...pageInfo },  // Copy from document level
      startTime: stroke.startTime,
      endTime: stroke.endTime,
      dotArray: points.map((point, index) => {
        const [x, y, timestamp] = point;
        
        // Determine dotType from position in array
        let dotType;
        if (index === 0) {
          dotType = 0;  // Pen Down
        } else if (index === points.length - 1) {
          dotType = 2;  // Pen Up
        } else {
          dotType = 1;  // Pen Move
        }
        
        return {
          x,
          y,
          f: 500,           // Default pressure (middle value)
          dotType,
          timestamp,
          pageInfo: { ...pageInfo }
        };
      })
    };
  });
}
```

### Data Loss Considerations

| Lost Data | Impact | Mitigation |
|-----------|--------|------------|
| Pressure (`f`) | Strokes render with uniform thickness | Use default value (500). Could store if needed for artistic rendering. |
| Tilt angles | None for text | Not needed for note-taking use case |
| Per-dot pageInfo | None | Redundant - reconstructed from document-level pageInfo |

**Note:** The simplified format is intentionally lossy to reduce storage. For this note-taking application, the lost data (pressure, tilt) doesn't affect transcription or basic stroke visualization. If pressure-sensitive rendering becomes important, the storage format could be extended.

### Parsing LogSeq Blocks

To extract stroke JSON from a LogSeq page:

```javascript
/**
 * Find and parse stroke data from LogSeq page blocks
 * @param {Array} blocks - Block tree from logseq.Editor.getPageBlocksTree
 * @returns {Object|null} Parsed stroke data or null
 */
function extractStrokeData(blocks) {
  // Find "Raw Stroke Data" heading block
  const strokeHeading = findBlockByContent(blocks, (content) => 
    content.includes('## Raw Stroke Data')
  );
  
  if (!strokeHeading || !strokeHeading.children?.length) {
    return null;
  }
  
  // Get first child (the JSON code block)
  const jsonBlock = strokeHeading.children[0];
  const content = jsonBlock.content;
  
  // Extract JSON from code fence
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    // Try without language specifier
    const plainMatch = content.match(/```\n([\s\S]*?)\n```/);
    if (!plainMatch) return null;
    return JSON.parse(plainMatch[1]);
  }
  
  return JSON.parse(jsonMatch[1]);
}

/**
 * Recursively search block tree for matching content
 */
function findBlockByContent(blocks, predicate) {
  for (const block of blocks) {
    if (predicate(block.content || '')) {
      return block;
    }
    if (block.children?.length) {
      const found = findBlockByContent(block.children, predicate);
      if (found) return found;
    }
  }
  return null;
}
```

### Full Import Flow with Transformation

```javascript
async function importStrokesFromLogSeq(pageData) {
  // 1. Fetch stroke JSON from LogSeq (if not cached)
  const blocks = await logseqApi.request(
    'logseq.Editor.getPageBlocksTree', 
    [pageData.pageName]
  );
  
  // 2. Extract and parse JSON
  const storedData = extractStrokeData(blocks);
  if (!storedData) {
    throw new Error('No stroke data found in page');
  }
  
  // 3. Transform to canvas format
  const canvasStrokes = transformStoredToCanvasFormat(storedData);
  
  // 4. Get current strokes and merge with deduplication
  const currentStrokes = get(strokes);
  const result = mergeStrokes(currentStrokes, canvasStrokes);
  
  // 5. Update store
  strokes.set(result.strokes);
  
  return result;
}
```

---

## Deduplication Logic

### Stroke Identification

Each stroke has a unique ID based on `startTime`:

```javascript
function getStrokeId(stroke) {
  // Stored format uses 'id' field
  if (stroke.id) return stroke.id;
  // Raw format uses startTime
  return `s${stroke.startTime}`;
}
```

### Merge Algorithm

```javascript
function mergeStrokes(existingStrokes, newStrokes) {
  // Build set of existing IDs
  const existingIds = new Set(existingStrokes.map(getStrokeId));
  
  // Filter new strokes
  const uniqueNew = [];
  const duplicates = [];
  
  for (const stroke of newStrokes) {
    const id = getStrokeId(stroke);
    if (existingIds.has(id)) {
      duplicates.push(stroke);
    } else {
      uniqueNew.push(stroke);
      existingIds.add(id); // Prevent duplicates within newStrokes
    }
  }
  
  // Merge and sort by time
  const merged = [...existingStrokes, ...uniqueNew]
    .sort((a, b) => (a.startTime || parseInt(a.id.slice(1))) - 
                    (b.startTime || parseInt(b.id.slice(1))));
  
  return {
    strokes: merged,
    imported: uniqueNew.length,
    duplicatesSkipped: duplicates.length
  };
}
```

### Integration with Existing Store

The import action merges into the existing `strokes` store:

```javascript
// In lib/logseq-import.js or similar
import { strokes, addStrokes } from '../stores/strokes';
import { get } from 'svelte/store';

export async function importStrokesFromLogSeq(pageData) {
  // Fetch stroke JSON if not already loaded
  if (!pageData.strokeData) {
    pageData.strokeData = await fetchStrokeJson(pageData.pageName);
  }
  
  // Get current strokes
  const currentStrokes = get(strokes);
  
  // Merge with deduplication
  const result = mergeStrokes(currentStrokes, pageData.strokeData);
  
  // Update store (replace with merged set)
  strokes.set(result.strokes);
  
  return {
    imported: result.imported,
    duplicatesSkipped: result.duplicatesSkipped,
    total: result.strokes.length
  };
}
```

---

## Component Structure

### New Components

```
src/components/logseq-db/
├── LogSeqDbTab.svelte        # Main tab container
├── DbHeader.svelte           # Connection status, refresh button
├── BookAccordion.svelte      # Collapsible book section
├── PageCard.svelte           # Individual page display
├── TranscriptionPreview.svelte  # Indented text display (reuse from transcription tab)
└── SyncStatusBadge.svelte    # Status indicator component
```

### LogSeqDbTab.svelte (Main Component)

```svelte
<script>
  import { onMount } from 'svelte';
  import { logseqPages, pagesByBook, bookIds, isScanning, lastScanTime } from '../../stores/logseqPages';
  import { logseqConnected } from '../../stores/settings';
  import { scanLogSeqPages } from '../../lib/logseq-scanner';
  import DbHeader from './DbHeader.svelte';
  import BookAccordion from './BookAccordion.svelte';
  
  // Auto-scan on mount if connected
  onMount(() => {
    if ($logseqConnected && $logseqPages.length === 0) {
      handleRefresh();
    }
  });
  
  async function handleRefresh() {
    await scanLogSeqPages();
  }
</script>

<div class="logseq-db-tab">
  <DbHeader 
    connected={$logseqConnected}
    scanning={$isScanning}
    lastScan={$lastScanTime}
    on:refresh={handleRefresh}
  />
  
  {#if !$logseqConnected}
    <div class="empty-state">
      <p>Connect to LogSeq to browse stored smartpen data.</p>
      <p class="hint">Configure connection in Settings panel.</p>
    </div>
  {:else if $isScanning}
    <div class="scanning">
      <span class="spinner"></span>
      Scanning LogSeq database...
    </div>
  {:else if $bookIds.length === 0}
    <div class="empty-state">
      <p>No smartpen data found in LogSeq.</p>
      <p class="hint">Save strokes to LogSeq to see them here.</p>
    </div>
  {:else}
    <div class="book-list">
      {#each $bookIds as bookId}
        <BookAccordion 
          {bookId} 
          pages={$pagesByBook[bookId]} 
        />
      {/each}
    </div>
  {/if}
</div>
```

### PageCard.svelte

```svelte
<script>
  import { createEventDispatcher } from 'svelte';
  import { importStrokesFromLogSeq } from '../../lib/logseq-import';
  import { addLogMessage } from '../../stores/ui';
  import TranscriptionPreview from './TranscriptionPreview.svelte';
  import SyncStatusBadge from './SyncStatusBadge.svelte';
  
  export let page;  // LogSeqPageData
  
  let importing = false;
  
  async function handleImport() {
    importing = true;
    try {
      const result = await importStrokesFromLogSeq(page);
      addLogMessage(
        `Imported ${result.imported} strokes from B${page.book}/P${page.page}` +
        (result.duplicatesSkipped > 0 ? ` (${result.duplicatesSkipped} duplicates skipped)` : ''),
        'success'
      );
      page.syncStatus = 'in-canvas';
    } catch (error) {
      addLogMessage(`Import failed: ${error.message}`, 'error');
    } finally {
      importing = false;
    }
  }
  
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
</script>

<div class="page-card">
  <div class="page-header">
    <span class="page-icon">📄</span>
    <span class="page-title">Page {page.page}</span>
    <SyncStatusBadge status={page.syncStatus} />
  </div>
  
  <div class="page-meta">
    <span>Strokes: {page.strokeCount}</span>
    <span class="separator">│</span>
    <span>Last Updated: {formatDate(page.lastUpdated)}</span>
  </div>
  
  {#if page.transcriptionText}
    <div class="transcription-section">
      <div class="section-label">Transcription:</div>
      <TranscriptionPreview text={page.transcriptionText} />
    </div>
  {:else}
    <div class="no-transcription">
      <em>No transcription data</em>
    </div>
  {/if}
  
  <div class="page-actions">
    <button 
      class="import-btn"
      on:click={handleImport}
      disabled={importing}
    >
      {#if importing}
        Importing...
      {:else}
        Import Strokes
      {/if}
    </button>
  </div>
</div>
```

---

## Error Handling

### Connection Errors

| Error | UI Behavior |
|-------|-------------|
| LogSeq not running | Show "Not connected" in header, disable refresh |
| Connection timeout | Show error toast, keep stale data visible |
| Auth failure | Show "Authentication failed" message |

### Data Errors

| Error | UI Behavior |
|-------|-------------|
| Invalid JSON in stroke block | Show page with "⚠️ Corrupted data" badge, disable import |
| Missing stroke block | Show page with stroke count as 0, disable import |
| Missing transcription | Show page without transcription section |

### Import Errors

| Error | UI Behavior |
|-------|-------------|
| Parse failure | Show error in activity log, don't modify store |
| Partial data | Import what's valid, log warning about skipped strokes |

---

## Performance Considerations

### Lazy Loading Strategy

1. **Initial scan** - Fetch only page names and properties (fast)
2. **Expand book** - Fetch transcription text for visible pages
3. **Import click** - Fetch full stroke JSON (potentially large)

```javascript
// Lazy load transcription when book expanded
async function onBookExpand(bookId, pages) {
  for (const page of pages) {
    if (page.transcriptionText === undefined) {
      page.transcriptionText = await fetchTranscription(page.pageName);
    }
  }
}

// Lazy load stroke JSON on import
async function fetchStrokeJson(pageName) {
  const blocks = await logseqApi.getPageBlocks(pageName);
  const strokeBlock = findStrokeDataBlock(blocks);
  return parseJsonFromBlock(strokeBlock);
}
```

### Caching

- Cache page list for duration of session
- Clear cache on explicit refresh
- Don't cache stroke JSON (could be large, fetch on demand)

### Large Datasets

For users with many stored pages (50+):
- Virtual scrolling for book list (if needed)
- Collapse all books by default
- Show "Loading..." placeholder while fetching details

---

## Integration with Lazy Import Spec

This spec and the Lazy Import Transcription spec work together:

| Feature | LogSeq DB Tab | Lazy Import |
|---------|---------------|-------------|
| **Purpose** | Discovery and manual import | Re-transcription workflow |
| **Trigger** | User browses and clicks import | User clicks "Refresh Full Page" |
| **Data source** | LogSeq only | LogSeq + local cache + current strokes |
| **Result** | Strokes added to canvas | New transcription saved to LogSeq |

### Workflow Example

1. User opens **LogSeq DB** tab
2. Browses to Book 3017, Page 42
3. Clicks **Import Strokes** → 234 strokes loaded to canvas
4. Writes additional notes with pen → 45 new strokes
5. Goes to **Transcription** tab
6. Clicks **Refresh Full Page** → All 279 strokes transcribed together
7. Complete transcription saved back to LogSeq

---

## Implementation Phases

### Phase 1: Basic Discovery (2-3 hours)

1. Create LogSeq page scanning function
2. Create `logseqPages` store
3. Create `LogSeqDbTab.svelte` with basic UI
4. Replace Analysis tab in `TabContainer.svelte`
5. Display page list grouped by book

**Files:**
- New: `src/stores/logseqPages.js`
- New: `src/lib/logseq-scanner.js`
- New: `src/components/logseq-db/LogSeqDbTab.svelte`
- New: `src/components/logseq-db/DbHeader.svelte`
- New: `src/components/logseq-db/BookAccordion.svelte`
- New: `src/components/logseq-db/PageCard.svelte`
- Modify: `src/components/layout/TabContainer.svelte`

### Phase 2: Import Functionality (2-3 hours)

1. Create stroke import function with deduplication
2. Add Import button to PageCard
3. Wire up to strokes store
4. Add activity log messages
5. Update canvas after import

**Files:**
- New: `src/lib/logseq-import.js`
- Modify: `src/components/logseq-db/PageCard.svelte`
- Modify: `src/stores/strokes.js` (if merge helper needed)

### Phase 3: Sync Status (1-2 hours)

1. Implement sync status detection logic
2. Create `SyncStatusBadge.svelte`
3. Compare local cache with LogSeq data
4. Update status on import/save operations

**Files:**
- New: `src/components/logseq-db/SyncStatusBadge.svelte`
- New: `src/lib/sync-status.js`
- Modify: `src/components/logseq-db/PageCard.svelte`

### Phase 4: Polish (1-2 hours)

1. Add transcription preview component
2. Handle error states gracefully
3. Add loading states and spinners
4. Style refinements
5. Test with real data

**Files:**
- New: `src/components/logseq-db/TranscriptionPreview.svelte`
- Modify: Various components for styling

---

## Testing Checklist

### Discovery Tests

- [ ] Scan finds all Smartpen Data pages
- [ ] Pages grouped correctly by book
- [ ] Book accordion expands/collapses
- [ ] Refresh button re-scans
- [ ] Empty state shown when no data
- [ ] Disconnected state shown when LogSeq offline

### Import Tests

- [ ] Import strokes from clean page
- [ ] Import with duplicates (some skipped)
- [ ] Import into empty canvas
- [ ] Import into canvas with existing strokes
- [ ] Import multiple pages sequentially
- [ ] Activity log shows correct counts
- [ ] Canvas updates after import

### Sync Status Tests

- [ ] Clean status when no local changes
- [ ] Unsaved status when local cache has more strokes
- [ ] In-canvas status after import
- [ ] Status updates after save to LogSeq

### Error Tests

- [ ] Handle LogSeq connection failure
- [ ] Handle corrupted stroke JSON
- [ ] Handle missing transcription block
- [ ] Handle network timeout during import

---

## Future Enhancements

### Potential Additions

1. **Search/filter** - Find pages by text content or date range
2. **Bulk import** - Import all pages from a book at once
3. **Preview strokes** - Show thumbnail of strokes without full import
4. **Sort options** - Sort by date, stroke count, or page number
5. **Export** - Download page data as JSON file

### Not In Scope

- Delete pages from LogSeq
- Edit transcription from this tab
- Real-time sync with LogSeq changes
- Multi-select for batch operations

---

**End of Specification**
