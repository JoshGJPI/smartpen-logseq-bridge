# Claude Development Guide

This document provides context for AI assistants (like Claude) working on this project.

## Project Overview

**smartpen-bridge** (v2.0+, formerly `smartpen-logseq-bridge`) is a desktop Electron app that captures NeoSmartpen (Lamy Safari) strokes, runs handwriting recognition on them, and saves the result as plain JSON files in a user-chosen local folder.

In v1 (≤ 1.3.4) the storage layer was LogSeq's HTTP API. The v2.0 pivot replaced LogSeq with a folder of `<dataRoot>/pages/B###/P##.json` PageDoc files. See `docs/LOCAL-STORAGE-PIVOT-SPEC.md` for the full design and `scripts/migrate-from-logseq.cjs` for the one-shot v1 → v2 importer.

**Tech Stack:**
- **Frontend**: Svelte 4 (reactive components)
- **Build Tool**: Vite
- **Shell**: Electron (Chromium renderer + Node main, for Web Bluetooth + filesystem access)
- **Pen Integration**: web_pen_sdk (NeoSmartpen Web SDK)
- **Handwriting Recognition**: MyScript Cloud API (proxied through Electron main to preserve HTTP header casing)
- **Storage**: Local JSON files (atomic write via `<file>.tmp` + rename, in `electron/main.cjs`)
- **Browser APIs**: Web Bluetooth API, Canvas API

## Architecture

### Component Hierarchy
```
App.svelte (Root)
├── Header
│   ├── PenControls (Connect, Fetch, Transcribe)
│   ├── ActionBar (Save to Folder, Clear, unsaved-changes dot)
│   └── SettingsDropdown (MyScript, Data Folder, Book Aliases)
├── LeftPanel
│   ├── Data Explorer (Tabbed Interface)
│   │   ├── StrokeList (Browse by book/page)
│   │   ├── TranscriptionView (View transcribed text)
│   │   ├── Saved Pages (folder-backed page list — `components/logseq-db/` dir, soon to be renamed)
│   │   └── RawJsonViewer (Technical inspection)
│   └── ActivityLog (Real-time feedback)
└── Canvas Section (Editor ⇄ Book View toggle, in App.svelte)
    ├── StrokeCanvas (Editor — live capture/edit)
    │   ├── Canvas Renderer (Drawing engine)
    │   ├── CanvasControls (Zoom, fit, reset)
    │   ├── PageSelector (Multi-page filtering)
    │   └── FilteredStrokesPanel (Decorative strokes)
    └── BookViewer (Book View — read/edit saved pages as a book)
        ├── Home grid (recent + collapsible by-book page thumbnails)
        └── PageSpreadView ×1–2 (side-by-side spread, page-turn nav)
            ├── SVG stroke render (per-page zoom/pan/fit)
            └── TranscriptPane (view/inline-edit lines, copy LogSeq markdown)
```

The right-hand pane toggles between the **Editor** (`StrokeCanvas`) and **Book View**
(`BookViewer`) via a segmented control in the top bar (`App.svelte`). Book View's
global controls (Home · Strokes/Transcript · Single/Spread) live in that same top bar
and drive the bound `BookViewer` instance; each page's toolbar has a **Load into
Editor** action that imports that page's strokes into the Editor canvas and switches
to it.

### State Management (Svelte Stores)

All state is managed through Svelte stores located in `src/stores/`:

**Core Data:**
- `strokes.js` - All captured strokes from pen
- `selection.js` - Selected stroke indices and selection state
- `clipboard.js` - Copied strokes for duplication
- `pasted-strokes.js` - Duplicated/pasted strokes management

**Transcription:**
- `transcription.js` - MyScript transcription results and cache
- Page-level transcription data with hierarchy

**Saved-Pages Index:**
- `logseqPages.js` — historical name; holds the scanned list of `pages/B###/P##.json` records the Data Explorer renders. Variable still called `logseqPages` for inertia; nothing LogSeq-specific remains.
- `storage.js` — save status, unsaved-changes flag (`unsavedChanges` writable, `markUnsavedChanges()`, cleared on successful save)
- `book-aliases.js` — custom book name mappings (persisted to `<dataRoot>/pages/_aliases.json`)

**Book View (v2.1):**
- `viewer.js` — Book View pane state:
  - `viewerMode` (`'editor' | 'book'`) — which view the right pane shows; `setViewerMode()`, `toggleViewerMode()`
  - `viewerDirty` (derived) + `markViewerDirtyPage()`/`clearViewerDirtyPage()` — per-page unsaved-transcript-edit tracking, kept **separate** from the canvas `unsavedChanges` so saving a transcript never masks unsaved stroke changes (App's `beforeunload` checks both)
  - `viewerSelection` — last-open `{book, pageId}`, persisted to localStorage so Book View reopens the same spread across toggles/reload; `setViewerSelection()`/`clearViewerSelection()`
  - `recentViews` + `recordRecentView()` — recently-opened pages for the home grid

**UI State:**
- `ui.js` - Active tab, canvas zoom, UI preferences
- `page-order.js` - Custom page positioning/layout
- `page-scale.js` - Per-page scaling factors
- `pen.js` - Pen connection state and battery info

**Advanced:**
- `filtered-strokes.js` - Decorative element detection
- `pending-changes.js` - Tracks local changes before save (deletions, additions per page)
  - `deletedIndices` — set of stroke indices marked for deletion
  - `pendingChanges` — derived store computing additions/deletions per page (pure core `computePendingChangesMap()`, tested)
  - `getDeletedStrokeIdsForPage()` — converts indices to stroke IDs for the save call
  - `onDiskStrokeIds` + `noteOnDiskStrokeIds()` — perf #3: since `logseqPages` records no longer carry strokes, the additions diff uses a small `pageKey → Set<strokeId>` map populated ONLY for pages currently on the canvas (primed by `load-page.js` import + `save-page.js` save; lazily backfilled and evicted by a `canvasPageKeys` subscription). Never reads strokes off `logseqPages`.
- `settings.js` — persisted user settings (MyScript keys, `dataRoot`, `dataFolderReady`, `dataFolderStatusText`; **Publish to graph:** `graphRoot`, `publishToGraph`, `graphFolderReady`, `graphFolderStatusText`)

### Key Libraries

**Core Logic (`src/lib/`):**
- `pen-sdk.js` - NeoSmartpen SDK wrapper and BLE communication
- `canvas-renderer.js` - Canvas drawing engine for stroke visualization
- `myscript-api.js` - MyScript API client for handwriting recognition (proxied via IPC in Electron)
- `stroke-analyzer.js` - Shape detection and analysis
- `stroke-filter.js` - Decorative element detection (boxes, underlines)
- `stroke-storage.js` - Stroke ID generation, format conversion, bounds, dedupe, user JSON/MD exports
- `transcript-search.js` - Full-text search across transcriptions

**Storage Layer (`src/lib/storage/`)** — v2.0:
- `page-doc.js` — PageDoc schema types, `emptyPageDoc()`, `computeBounds()`, `validatePageDoc()`
- `page-doc-format.js` — hybrid pretty/compact serializer (document shell pretty-printed; each stroke on one line)
- `local-store.js` — renderer-side facade over `window.storageAPI` IPC: `listPages`, `getPage`, `savePage`, `deletePage`, alias CRUD, `pickFolder`, `isAvailable`, `openInExplorer`. **`savePage()` is the single choke point all PageDoc writes funnel through** — it also fires the optional "Publish to graph" mirror after a successful save (see `publish-graph.js`)
- `save-page.js` — `savePageToFolder()` — append-only stroke merge with explicit deletions, Y-bounds-based transcript merge with checkbox preservation
- `graph-index.js` — pure helpers for **Publish to graph**: `smartpenAssetName()`/`smartpenAssetRelPath()` (the `smartpen-B{book}-P{pageId}.json` asset convention), `buildSmartpenIndexEntry()`, `upsertSmartpenIndex()`, `emptySmartpenIndex()`. Mirrors the JPI Tools plugin's `tools/migrate-smartpen-assets.mjs` index logic (plugin spec §4.6/§6.1). Identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
- `publish-graph.js` — `publishPageToGraph(book, pageId, doc)` — renderer facade that mirrors a saved PageDoc into a LogSeq graph folder when enabled: reads `smartpen-index.json`, upserts this page's entry (+ book alias), then writes the asset (`serializePageDoc`, verbatim) + index via IPC. **Best-effort: never throws** — a graph-write failure logs a warning but never fails the authoritative bridge save. No LogSeq runtime dependency (pure filesystem)
- `load-page.js` — `importStrokesFromFolder()`, `importStrokesForLoadedPagesFromFolder()` — converts StoredStroke → canvas dotArray format
- `scan.js` — `scanLocalPages()` + `metaToRecord()` (pure, tested) — populates the `logseqPages` store from disk. **Metadata-only (perf #3):** records carry summary fields ONLY (`strokeCount`, `lastUpdated`, `transcriptionText`, `transcribed`, `transcriptLineCount`, `pageId`/`suffix`) — never `strokes`/`pageDoc`/`strokeData`, so the corpus never stays resident; each page's strokes load lazily on view. Records load by `pageId`, so letter-suffixed variants (`P127.json` + `P127b.json`) don't collapse onto the integer page. (`main.cjs listAllPages` → `extractPageMeta` parses just the doc shell, skipping the strokes array, so the scan is fast; the tiny `transcriptionText` rides along to power search/preview without loading strokes.)
- `page-changes.js` — `computePageChangesFolder()` — preview diff for the SaveConfirmDialog

**Book View Layer (`src/lib/viewer/`)** — v2.1:
- `page-svg.js` — `computeStrokeBounds()`, `strokeToPathD()`, `generateThumbnailSVG()` — SVG render for the spread pages + home-grid thumbnails (`NCODE_SCALE = 2.371`)
- `page-cache.js` — small LRU (`getCachedPage`/`invalidatePage`/`clearPageCache`, MAX 6) over full PageDocs. Book View loads strokes lazily through this (records no longer embed them, perf #3) so turning a spread doesn't re-read disk; older docs are evicted. Keyed by `B{book}/P{pageId}` (suffix-safe)
- `transcript-markdown.js` — `linesToLogseqMarkdown()` — tab-indented `- ` bullets with `- TODO`/`- DONE` markers; `key:: value` property lines stripped (LogSeq-pasteable copy)
- `save-transcript.js` — `saveTranscriptLines(book, pageId, lines)` — writes inline transcript edits back to the PageDoc verbatim (getPage → replace `transcript.lines` → scrub deleted `lineId`s on strokes → `savePage`); `recomputeParentIds()` keeps the hierarchy consistent after indent edits

## Data Structures

### Stroke Format
```javascript
{
  pageInfo: {
    section: number,      // Ncode section
    owner: number,        // Ncode owner
    book: number,         // Notebook ID
    page: number          // Page number
  },
  startTime: number,      // Unix timestamp (ms)
  endTime: number,        // Unix timestamp (ms)
  dotArray: [
    {
      x: number,          // Ncode X coordinate
      y: number,          // Ncode Y coordinate
      f: number,          // Pressure (force)
      timestamp: number   // Dot timestamp (ms)
    }
  ]
}
```

### Transcription Result
```javascript
{
  text: "Full transcribed text with\nline breaks",
  strokeCount: number,
  pageInfo: { section, owner, book, page },
  lines: [
    {
      text: "Line content",
      indentLevel: 0,        // 0, 1, 2, etc.
      parent: null,          // Index of parent line
      children: [1, 2],      // Indices of child lines
      x: 10.5,               // Leftmost position
      baseline: 25.3,        // Y position
      words: [...]           // Word-level data
    }
  ],
  commands: [
    {
      command: "page",
      value: "Meeting Notes",
      lineIndex: 0
    }
  ]
}
```

### v2.0 PageDoc Storage Format

One JSON file per pen page at `<dataRoot>/pages/B{book}/P{page}.json`. Hybrid pretty serializer keeps the document shell pretty-printed but inlines each stroke onto one line (file is ~40% the size of full pretty-print while staying diff-friendly).

```jsonc
{
  "version": "2.0",
  "pageInfo": { "section": 3, "owner": 1012, "book": 3017, "page": 42 },
  "metadata": {
    "lastUpdated": "2026-05-28T14:22:01.000Z",
    "totalStrokes": 385,
    "bounds": { "minX": 5.43, "maxX": 60.24, "minY": 36.39, "maxY": 64.74 }
  },
  "transcript": {
    "lastTranscribed": "2026-05-28T14:25:00.000Z",
    "lines": [
      {
        "id": "955e79bf-…",            // stable line ID (was blockUuid in v1)
        "text": "Meeting notes",
        "indentLevel": 0,
        "parentId": null,
        "checked": null,                // null | true (DONE) | false (TODO)
        "yBounds": { "minY": 1.6, "maxY": 8.6 }
      }
    ]
  },
  "strokes": [
    {"id":"s1765313505107","startTime":1765313505107,"endTime":1765313505396,"lineId":"955e79bf-…","points":[[6.56,37.25,1765313505107], …]}
  ]
}
```

Letter-suffixed pages (e.g. `P151b.json`) are supported — they came from manual v1 workflows where the user created variants of the same NCode page. The integer `pageInfo.page` matches the NCode page number; the filename suffix is the user's identifier and is preserved.

Aliases live alongside in `<dataRoot>/pages/_aliases.json`:
```json
{ "3017": "Field Notes", "390": "Calc Pad" }
```

## Development Guidelines

### Code Style
1. **Svelte Components**: Follow Svelte 4 best practices
   - Use `$:` for reactive statements
   - Prefer stores over prop drilling
   - Keep components focused and single-purpose

2. **State Management**: Always use stores for shared state
   - Never pass stores as props (import them directly)
   - Use derived stores for computed values
   - Persist important state to localStorage via settings.js

3. **Async Operations**: Handle errors gracefully
   - Show user feedback in ActivityLog
   - Use try/catch blocks
   - Display progress for long operations

4. **Canvas Operations**: Performance is critical
   - Optimize rendering for >1000 strokes
   - Use requestAnimationFrame for animations
   - Debounce expensive operations

### File Organization

**Components** (`src/components/`):
- Group by feature area (canvas, dialog, header, etc.)
- Keep components under 300 lines when possible
- Extract reusable UI into shared components

**Stores** (`src/stores/`):
- One store per concern
- Export both store and helper functions
- Document store shape in comments

**Libraries** (`src/lib/`):
- Pure business logic, no UI
- Fully testable without DOM
- Clear API boundaries

### Common Patterns

**Adding a new feature:**
1. Create/update relevant stores in `src/stores/`
2. Add business logic to `src/lib/`
3. Create UI components in `src/components/`
4. Wire up in App.svelte or parent component
5. Update ActivityLog for user feedback
6. Consider persistence needs (settings.js)

**Working with strokes:**
```javascript
import { strokes } from './stores/strokes.js';
import { selection } from './stores/selection.js';

// Get selected strokes
const selectedStrokes = $strokes.filter((_, i) => $selection.has(i));

// Manipulate and update
strokes.update(s => [...s, newStroke]);
```

**Saving a page (v2.0):**
```javascript
import { savePageToFolder } from '$lib/storage/save-page.js';
import { log } from '$stores';

const result = await savePageToFolder({
  book, page,
  activeStrokes,                    // canvas-format strokes (with dotArray)
  deletedStrokeIds,                 // Set<string> — explicit deletions only
  pageTranscription                 // MyScript result for untranscribed strokes, or null
});
if (result.success) {
  log(`Saved B${book}/P${page}: +${result.added} new, -${result.deleted} deleted, ${result.total} total`, 'success');
} else {
  log(`Save failed: ${result.error}`, 'error');
}
```

The save module:
- Reads the existing PageDoc as the base
- Applies explicit deletions (never inferred)
- Appends new strokes deduplicated by id
- Merges fresh transcript lines via Y-bounds overlap matching, preserves `checked` state on lines whose text matches existing entries
- Scrubs dangling `lineId` references
- Writes atomically (`.tmp` + rename + fsync) via IPC to the Electron main process

**Reading a page:**
```javascript
import { getPage } from '$lib/storage/local-store.js';
const doc = await getPage(book, page);   // returns PageDoc or null
```

## Important Implementation Notes

### Web Bluetooth Constraints
- **Only works in Chrome/Edge** (not Firefox/Safari)
- **Requires HTTPS** (or localhost for development)
- User must explicitly pair via browser dialog
- Connection can drop; implement reconnection logic

### Canvas Coordinate System
- Ncode coordinates are in pen's coordinate space (mm, typically 0–160 range for Lamy paper)
- `canvas-renderer.js` converts via: `screenX = (dot.x - bounds.minX + offsetX) * scale * zoom + panX`
- `scale = 2.371` converts Ncode mm → screen pixels at zoom=1
- `calculateBounds()` normalises page content to start at (0,0) in world space
  - `offsetY` formula: `offset.bounds.minY - globalMinY` (NOT `-globalMinY` — would double-subtract)
- `clear(resetBounds=true)` resets stroke bounds but **does NOT reset zoom/pan** (view state is managed separately)
- Page positioning is customizable (stored in pagePositions store)
- Page scaling is per-page (stored in pageScales store)

### Live Writing vs. Offline Import (Canvas View)
- **Live writing** (`$penConnected === true`): `setLiveWritingView()` is called once on the first stroke of a session (zoom=3, top-left anchor). The view stays stable for the entire session. Resets when pen disconnects.
- **Offline import** (`batchMode`): `fitContent()` is called once when the first batch of strokes appears (`previousStrokeCount === 0`). Not called again on subsequent stroke count changes.
- The `liveWritingViewSet` flag in `StrokeCanvas.svelte` prevents repeated viewport jumps during live writing.

### NeoSmartpen SDK — Invalid Pen-Down Dot
- The SDK emits `{x: -1, y: -1, f: 0, dotType: 0}` as the first dot of every stroke **before** it has resolved position
- The `pageInfo` on this placeholder dot is stale from the prior connection session
- `processDot()` in `pen-sdk.js` detects this via `isInvalidDot = (dot.x === -1 && dot.y === -1)` and:
  - Leaves `pageInfo: null` and `dotArray: []` until the first real pen-move dot arrives
  - Latches correct `pageInfo` from the first real dot
  - Skips invalid dots from canvas renderer and `currentPageInfo` store
  - Only finalises a stroke if `pageInfo` is confirmed and `dotArray` is non-empty

### MyScript API Limitations
- **2,000 requests/month** on free tier
- Rate limiting applies
- Requires HMAC authentication
- Process strokes page-by-page to avoid overwhelming API

### Storage Layer (v2.0 — Local Folder)
- One JSON file per pen page at `<dataRoot>/pages/B###/P##.json`
- All writes are atomic (`.tmp` + rename via `fs.rename`) — no half-written files
- Hybrid serializer (`src/lib/storage/page-doc-format.js`) prints the document shell pretty but inlines each stroke onto one line — ~40% smaller than full pretty-print, still diff-friendly
- The renderer talks to disk via IPC handlers in `electron/main.cjs` exposed as `window.storageAPI` by `electron/preload.cjs`
- Letter-suffixed pages supported (`P151b.json`) — preserved from manual v1 workflows

### Stroke Persistence Strategy (v2.0 Append-Only)
- **Append-Only**: `savePageToFolder()` starts from the existing PageDoc on disk, never replaces wholesale
- **Explicit Deletions Only**: tracked in `pending-changes.js` (`deletedIndices`), converted to stroke-id sets via `getDeletedStrokeIdsForPage()`
- **No Phantom Deletions**: missing from canvas ≠ deleted on disk
- **Stroke IDs**: `s{startTime}` for deduplication (see `src/lib/stroke-storage.js`)
- **lineId tracking**: each stroke carries an opaque `lineId` linking it to a transcript line (the v1 `blockUuid` field is renamed but semantically identical)
- **Deletion timeout**: 15-minute undo window for marked-but-not-yet-saved deletions

## Known Issues and Gotchas

1. **Stroke Deduplication**: Uses timestamp-based IDs (`s{startTime}`). See `stroke-storage.js`.

2. **Append-Only Saves**: Save operations NEVER replace the entire PageDoc — only explicit additions and deletions apply.

3. **Deletion Tracking**: `pending-changes.js` (`deletedIndices`); `getDeletedStrokeIdsForPage()` converts to ID sets.

4. **Memory Management**: Large stroke datasets (>2000 strokes per page) can impact canvas performance. Use the page selector to limit visible strokes.

5. **LocalStorage Limits**: Settings, page positions, and scales persist to localStorage (~5MB browser limit). The pen-stroke data itself lives in JSON files, not localStorage.

6. **Deletion Undo Timeout**: 15-minute window; after that the deletion is permanent at next save.

7. **Unsaved Changes**: Tracked via the `unsavedChanges` store, set by `addStroke()`, `addOfflineStrokes()`, `removeStrokesByIndices()`, `markStrokesDeleted()`. Cleared by `recordSuccessfulSave()`. Header shows an amber dot on the Save button when dirty; window-close hook prompts confirmation.

## Testing Considerations

### Automated Unit Tests

Run with `npm test` (single pass) or `npm run test:watch` (watch mode).
Framework: **Vitest 4.1.1**, environment: **happy-dom**.

Existing test files (all in `src/lib/__tests__/`):

| File | What it tests |
|------|---------------|
| `stroke-storage.test.js` | ID generation, `convertToStorageFormat` (lineId/blockUuid), `convertFromStorageFormat` round-trip, bounds, deduplication, JSON/MD export builders, `formatTranscribedText` / `formatPageName` / `getPageProperties` |
| `myscript-api.test.js` | `parseMyScriptResponse` — line parsing, Y-bounds from word bboxes, fallback interpolation, indentation, checkbox normalisation |
| `transcript-search.test.js` | `tokenize` (hyphen preservation, property filtering), `searchPages` (partial matching, ranking), `highlightMatches` (HTML escaping) |
| `stroke-filter.test.js` | `filterDecorativeStrokes` / `detectDecorativeIndices` — underline, circle, single-stroke box detection, threshold behaviour |
| `page-svg.test.js` | `computeStrokeBounds`, `strokeToPathD` (scaling, normalisation, <2-point skip), `generateThumbnailSVG` (empty placeholder, dimensions) |
| `transcript-markdown.test.js` | `linesToLogseqMarkdown` — tab indentation, TODO/DONE markers, `::` property stripping, blank-line drop, `isPropertyLine` |
| `save-transcript.test.js` | `recomputeParentIds` (hierarchy by indent), `saveTranscriptLines` (verbatim write, lineId scrub on deleted lines, timestamp bump, missing-page guard; mocks `getPage`/`savePage`) |

When writing new tests follow the patterns in the existing files:
- Mock Svelte stores (`vi.mock()`) before imports if needed
- Use small, focused helper factories (`makeStroke`, `line`)
- Test boundary conditions explicitly (empty input, zero bounds, null values)

### Manual Testing Scenarios

When making changes, also verify manually:
- Pen connection/disconnection flows
- Offline sync from pen memory
- Real-time stroke capture
- Selection (box, individual, keyboard shortcuts)
- Duplication and dragging strokes
- Page creation from duplicates
- Transcription with MyScript
- Save to data folder (Saved Pages tab refreshes, file timestamps update)
- Re-import a saved page from the Saved Pages tab
- Edit transcript via the page-card editor; reload to confirm persistence
- Canvas pan/zoom/navigation
- Page positioning and scaling
- Unsaved-changes indicator + window-close prompt
- Browser compatibility (Electron Chromium only — pure web build is out of scope in v2.0)

## Useful Commands

```bash
# Development server (localhost:3000)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Resources

### Primary Documentation
- [README.md](README.md) — User-facing documentation
- [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) — **START HERE** for v2.0 — full design of the local-folder storage layer
- [scripts/migrate-from-logseq.cjs](scripts/migrate-from-logseq.cjs) — one-shot importer for v1 LogSeq exports → v2 PageDoc files
- [docs/QUICK-ARCHITECTURE-REFERENCE.md](docs/QUICK-ARCHITECTURE-REFERENCE.md) — quick architecture lookups (v1 era, mostly still applies for canvas/pen/MyScript)
- [docs/app-specification.md](docs/app-specification.md) — original technical specification (LogSeq-era; superseded by the pivot spec for storage details)

### Implementation Details (historical, mostly v1)
- [docs/Archive/2026-03-live-capture-canvas-fixes/LIVE-CAPTURE-CANVAS-FIXES.md](docs/Archive/2026-03-live-capture-canvas-fixes/LIVE-CAPTURE-CANVAS-FIXES.md) — Live capture & canvas fixes (Mar 2026)
- [docs/Archive/2026-02-data-loss-fixes/DATA-LOSS-FIXES-SUMMARY.md](docs/Archive/2026-02-data-loss-fixes/DATA-LOSS-FIXES-SUMMARY.md) — Data loss fixes (Feb 2026, v1)
- [docs/bridge-uuid-system.md](docs/bridge-uuid-system.md) — Custom UUID system
- [docs/Archive/ARCHIVE-INDEX.md](docs/Archive/ARCHIVE-INDEX.md) — Archived implementation docs index

### External APIs
- [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0) — SDK documentation
- [MyScript API Docs](https://developer.myscript.com/) — Handwriting recognition API
- [Svelte 4 Docs](https://svelte.dev/docs/svelte/overview) — Framework reference

## Recent Changes (Git History Context)

### Publish to graph — close the loop with the JPI Tools plugin (June 2026)

**Optionally mirror each saved page into a LogSeq graph as plugin assets.** The
JPI Tools LogSeq plugin (v1.9.66+) went "page-less": it reads smartpen strokes
from graph **assets** and discovers pages from an index manifest, not from
in-page chunked JSON. This feature lets the bridge publish directly into the
graph on every save, so newly-captured pages are renderable in LogSeq without the
one-shot `migrate-smartpen-assets.mjs` step.

**What landed:**
- **Settings:** `graphRoot` (folder picker, mirrors `dataRoot`) + `publishToGraph`
  toggle ("Publish to LogSeq graph on save"), persisted to localStorage. New
  `GraphFolderSettings.svelte` section in the Settings dropdown; boot-time folder
  verification in `App.svelte` (`checkGraphFolder`).
- **On save (when enabled)** the bridge also writes two files into the graph
  (pure filesystem, atomic `.tmp`+rename, no LogSeq runtime):
  1. `<graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-B{book}-P{pageId}.json`
     — the PageDoc **verbatim** (same `serializePageDoc` hybrid serializer).
  2. `<graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-index.json`
     — the discovery manifest, with this page's entry added/replaced and the book
     alias merged (plugin spec §4.6). **No transcript outliner / thin `.md` page**
     — transcript stays inside the asset.
- **Single choke point:** publish is fired from `local-store.js` `savePage()`, so
  every save path (capture save, Book View transcript edits, page-card rewrites)
  mirrors automatically. **Best-effort** — `publishPageToGraph` never throws; a
  graph-write failure logs a warning but never fails the bridge save.
- **Letter-suffixed pages** (`P151b`) preserved on the asset name + index entry;
  identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
  (mirrors `migrate-from-logseq.cjs`/`parseFilename`).
- **New files:** `src/lib/storage/graph-index.js` (pure, tested in
  `graph-index.test.js`), `src/lib/storage/publish-graph.js`,
  `src/components/settings/GraphFolderSettings.svelte`. **Edited:** `electron/main.cjs`
  (`storage:readGraphIndex` + `storage:publishToGraph` IPC), `electron/preload.cjs`,
  `settings.js`, `stores/index.js`, `local-store.js`, `SettingsDropdown.svelte`,
  `App.svelte`.

**Design source:** the plugin repo's `spec/smartpen-stroke-asset-externalization.md`
(§4 storage model, §6.1 bridge publish) and `tools/migrate-smartpen-assets.mjs`
(`--from-clean` does this same write batch-wise; `--from-clean`/`--write-index`
remain the way to back-fill already-saved pages that predate this feature).

### v2.1 / v2.0.2 — Book View + Editor handoff (June 2026)

**A read-and-edit "Book View" for saved pages.** The right-hand pane now toggles
between the **Editor** (the existing `StrokeCanvas` capture/edit surface) and **Book
View** (`BookViewer`), letting the user read their notebooks as side-by-side spreads
and view/edit/copy transcripts now that LogSeq is gone.

**What landed:**
- New `src/components/viewer/` — `BookViewer` (home grid + spread layout + page-turn
  nav), `PageSpreadView` (per-page SVG stroke render with zoom/pan/fit, or transcript),
  `TranscriptPane` (inline structured editor + copy)
- New `src/lib/viewer/` — `page-svg.js`, `transcript-markdown.js`, `save-transcript.js`
  (+ unit tests `page-svg.test.js`, `transcript-markdown.test.js`, `save-transcript.test.js`)
- New `src/stores/viewer.js` — pane mode, per-page dirty tracking, persisted selection,
  recents (see Stores section)
- **Strokes ⇄ Transcript toggle** (viewer-wide); transcript shows hierarchy + TODO/DONE
- **Inline transcript editing** — edit text, Tab/Shift+Tab indent, cycle TODO/DONE,
  add/delete lines; saves back to the PageDoc verbatim (separate dirty flag from the
  canvas so a transcript save never masks unsaved strokes)
- **Copy** transcript as LogSeq-pasteable markdown (tab indents, `- TODO`/`- DONE`,
  `::` properties stripped)
- **Single/Spread** with page-turn nav; home grid with recent + collapsible by-book
  thumbnails (collapsed by default so large books don't bury navigation)
- **Load into Editor** (per page) — imports that page's strokes into the live canvas
  and switches to the Editor for editing
- **State persistence** — Book View reopens the last spread across Editor/Book toggles
  and app reloads (`viewerSelection` in localStorage)

**Fixes made along the way:**
- `scan.js` now carries `pageId`/`suffix` and loads by `pageId`, so letter-suffixed
  pages (`P127.json` + `P127b.json`) no longer collide into one duplicate record — this
  also fixed the Saved Pages tab crashing on such books (`BookAccordion` keys by
  `pageName`). `pagesByBook` breaks page-number ties by suffix.
- `StrokeCanvas` `onMount` now seeds the page filter from already-loaded pages and does
  a full render + fit, so "Load into Editor" shows the page immediately. Previously
  `visibleStrokes` (filtered by an initially-empty `selectedPages`) raced the
  `PageSelector` auto-select on a fresh mount, leaving the canvas blank until a filter
  was toggled.

### v2.0.0 — LogSeq → Local Folder Pivot (May 2026)

**The big one.** Replaced LogSeq as the storage backend with plain JSON files in a user-chosen local folder.

**Why:** LogSeq's graph DB performance degraded with dense, frequently-rewritten stroke chunks. The chunking, block CRUD, and inter-chunk-delay machinery was bookkeeping for LogSeq's sake, not user value.

**What landed:**
- New storage layer in `src/lib/storage/` (PageDoc schema, hybrid serializer, IPC-backed local-store, append-only save, Y-bounds transcript merge, folder scanner, page-changes preview)
- IPC handlers in `electron/main.cjs` (`storage:listPages`, `getPage`, `savePage`, etc.) with atomic writes
- Settings: dropped `logseqHost`/`logseqToken`/`logseqConnected`; added `dataRoot`/`dataFolderReady`/`dataFolderStatusText`
- Unsaved-changes indicator: amber dot on the Save button, `beforeunload` confirmation
- Migration importer at `scripts/migrate-from-logseq.cjs` — parses LogSeq's outliner `.md` files (supports letter-suffixed pages like `P151b.md`) and emits v2 PageDocs. Idempotent + non-destructive
- Compact-pretty hybrid serializer: doc shell pretty-printed, each stroke on one line (~40% the size of full pretty-print, still diff-friendly)
- Deleted modules: `logseq-api.js`, `logseq-scanner.js`, `logseq-import.js`, `transcript-updater.js`, `LogseqSettings.svelte`, `LogseqPreview.svelte`, and matching tests
- Trimmed `stroke-storage.js` of chunked-storage helpers
- UI rebrand: "Save to LogSeq (Strokes)" → "Save (Strokes)" / "Save Changes" / "Save (Strokes + Text)"; status pill shows the data folder; "LogSeq DB" tab → "Saved Pages"

**See:** [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) for the full design and phasing.

### Major Fixes (March 2026)

**LogSeq DB Tab — PageCard UX Overhaul (2026-03-24):**
- Redesigned `PageCard.svelte` for scalability with growing page lists
- Compact single-row header: sync badge · icon · title · ▶ expand · Import Strokes (inline)
- Transcript section is collapsed by default; expand arrow only appears when transcript data exists — solves the scroll-hijacking problem caused by tall preview boxes
- Transcript section header: `TRANSCRIPTION:` + `[Edit]` + `[↺ Reset]` inline action buttons
- **Reset Transcript**: clears `blockUuid` from session-loaded strokes and in-memory transcription entry so a page can be re-transcribed after a truncated run; logs result to ActivityLog; LogSeq blocks are not deleted
- Removed stale stroke-count/last-updated metadata row (returned 0/Unknown)
- Removed floating inline edit-pencil from `TranscriptionPreview.svelte` (editing via modal only)

**Decorative Stroke Filter — Single-stroke Only (2026-03-24):**
- Rewrote `stroke-filter.js`: removed 2-stroke H+V box detection and vertical-line detection
- Replaced `StrokeAnalyzer` corner-detection with perimeter-fraction + path-ratio heuristic
- All three detectors (underlines, boxes, circles) now operate on individual strokes only
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Decorative Stroke Filter

**Offline Import — Multi-book Reliability & Progress UI (2026-04-10):**
- Fixed critical bug where earlier books in a multi-book import were skipped after their first data chunk; only the last book was fully imported
- **Three root causes fixed in `src/lib/pen-sdk.js`:**
  1. `offlineTransferResolver` not cleared after use — stale BLE retransmissions resolved the next book's promise immediately; fix: null the global before calling resolver
  2. Book ID mismatch — pen sends data for old book during new book request; `handleOfflineDataReceived()` now returns `false` on mismatch, gating the resolver call on return value
  3. Multiple chunks per book — SDK fires `OFFLINE_DATA_SEND_SUCCESS` once per page, not once per book; code was resolving after first chunk; fix: hold promise open until received ≥ expected
- **Expected stroke count:** `OFFLINE_DATA_RESPONSE` (type 49) is consumed internally by the SDK and never forwarded to the app's `messageCallback`; count estimated from `OFFLINE_DATA_SEND_STATUS` percentage: `total = received / (percent / 100)`
- **Transfer progress UI:** real-time per-book stroke count and percentage in both builds:
  - Web build: `src/components/pen/TransferProgress.svelte`
  - Desktop/Electron build: `src/components/header/ActionBar.svelte` inline popup (class `transfer-popup`) — this is the component the Electron app actually renders
  - Format: `Book X/Y · N/M strokes (P%)` with determinate bar when expected count is known
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Offline Import — Multi-book Reliability & Progress UI

**Offline Import Performance (2026-03-19):**
- Resolved per-book transfer promise immediately on `OFFLINE_DATA_SEND_SUCCESS` instead of waiting 10s idle timeout — the SDK's own "success" signal is reliable; idle timeout kept as fallback only
- Reduced `INTER_BOOK_DELAY_MS` from 1000ms → 500ms (BLE stabilisation delay between books)
- Result: ~75% reduction in import time for multi-book syncs (e.g. 5 books: ~55s → ~13s)
- Config: `TRANSFER_CONFIG` object in `src/lib/pen-sdk.js:511`
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Offline Import Performance

**Live Capture & Canvas View Stability (2026-03-11):**
- Fixed invalid SDK pen-down dot `{x:-1, y:-1}` — was causing origin-line artifact and stale book/page on first stroke
- Fixed `calculateBounds` `offsetY` double-subtraction bug — was pushing content off-screen above the canvas
- Removed zoom/pan reset from `clear(resetBounds=true)` — was snapping view back to zoom=1 after every stroke
- Added `setLiveWritingView()` to `canvas-renderer.js` — sets stable 3× zoom anchored to top-left for writing
- Rewrote auto-fit logic in `StrokeCanvas.svelte` — live writing gets `setLiveWritingView()` once; offline import gets `fitContent()` once; no more "every 10 strokes" jump
- See `docs/Archive/2026-03-live-capture-canvas-fixes/LIVE-CAPTURE-CANVAS-FIXES.md`

### Major Fixes (February 2026)

**Data Loss Prevention (commit 0a836ac):**
- Fixed stroke deletion to be explicit only (no phantom deletions from partial imports)
- Updated `updatePageStrokesSingle()` to use append-only strategy
- Changed deletion counting from arithmetic (`existing - current`) to explicit tracking via `deletedStrokeIds`
- Stroke saves now preserve all LogSeq data unless explicitly marked for deletion in `pending-changes.js`

**Edit Structure UI Overhaul (commit 0a836ac):**
- Converted TranscriptionEditorModal to single-column layout
- Improved visual hierarchy and editing experience
- Fixed deletion counts in SaveConfirmDialog to use explicit deletion tracking

**Y-Bounds Preservation (commit 8c129a8):**
- Fixed transcript updates to preserve Y-bounds properties
- Ensures stroke-to-block matching data survives LogSeq round-trips

### Earlier Work
- Electron desktop app conversion (electron/ directory, vite.config.js updates)
- Hierarchical block creation order fix (parent blocks before children)
- Transcript data loss fixes (Y-bounds, blockUuid preservation, merge logic)
- BlockUUID over-assignment bug fix (scoping transcription to correct strokes)
- Persistent UUID implementation to avoid duplicate strokes
- Custom UUID system to avoid conflicts with pen SDK
- Transcript storage v3.0 architecture (see `docs/TRANSCRIPT-STORAGE-SPEC.md`)

When working with stroke management or transcription storage, be aware of these architectural changes.

## Questions to Ask Before Major Changes

1. **State**: Which stores need to be updated? Should state persist (localStorage for UI, JSON file for stroke/transcript data)?
2. **Performance**: Will this impact canvas rendering with 1000+ strokes?
3. **User Feedback**: Should this operation show progress or log messages? Trigger the unsaved-changes flag?
4. **Error Handling**: What happens if MyScript API fails or the data folder is missing?
5. **Persistence**: Settings → localStorage. Stroke/transcript data → PageDoc files. UI ephemera → not persisted.
6. **Platform**: Anything filesystem-related must run via IPC; never reach for `fs` from the renderer.

## Tips for Working with This Codebase

- **Start with stores**: Understanding the data model is key to understanding the app
- **Follow the data flow**: Pen → strokes store → canvas / MyScript → `savePageToFolder` → PageDoc on disk
- **Check ActivityLog**: Most operations log their progress for debugging
- **Use browser DevTools**: Stores are debuggable in Svelte DevTools extension
- **Test with real pen**: Some behaviors only manifest with actual hardware
- **Inspect the PageDoc**: Saved data is plain JSON — open the file in any editor to verify what was written. Compact-pretty format keeps each stroke on one line so diffs are readable.
- **Reference docs**: `docs/LOCAL-STORAGE-PIVOT-SPEC.md` for storage; `docs/QUICK-ARCHITECTURE-REFERENCE.md` for canvas/pen.
