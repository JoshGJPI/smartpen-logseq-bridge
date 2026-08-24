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
│   └── SettingsDropdown (MyScript, Data Folder, Graph Folder, Pen Memory,
│       └── ActivityLogDialog (Troubleshooting → 🩺, filter by level + copy)
├── LeftPanel (one row of tabs — see "Left panel tabs" below)
│   ├── StrokeList ("Strokes" — browse by book/page)
│   ├── TranscriptsPanel ("Transcripts")
│   │   ├── TranscriptionView (Review — incoming MyScript results)
│   │   └── TranscriptSearch (Search — full-text over saved pages on disk)
│   │       └── SearchResultCard (per-result import / open in Book View)
│   ├── SavedPagesTab ("Pages" — folder-backed page list)
│   └── BooksTab ("Books" — per-notebook aliases + volume routing)
└── Canvas Section (Editor ⇄ Book View toggle, in App.svelte)
    ├── StrokeCanvas (Editor — live capture/edit)
    │   ├── panel header: Select All · Deselect · CanvasSearch · stroke count
    │   ├── top toolbar: Decorative · Duplicate · Edit Points · Volume ▾ ·
    │   │                Text · Copy · Page Resets ▾
    │   ├── bottom bar: zoom · Fit · Reset View · Sketch · Unmark ·
    │   │               SketchStylePopover · PageSelector · Export ▾
    │   ├── Canvas Renderer (Drawing engine)
    │   ├── PointEditPanel (Edit Points mode — stray-point list + delete)
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

**Left panel tabs.** Tab *ids* are unchanged from the pre-v2.7 nested version
(`'strokes'`, `'transcription'`, `'saved-pages'`, plus new `'books'`) even though
two labels differ — `ActionBar` calls `setActiveTab('transcription')` after a
transcription run.

**Two searches, deliberately separate.** `CanvasSearch` (panel header) searches
only pages already loaded and *pans* to one — <kbd>Ctrl+F</kbd>. `TranscriptSearch`
(left panel) searches every saved page on disk to decide what to *load* —
<kbd>Ctrl+Shift+F</kbd>, or `openTranscriptSearch()`.

**Three resets, deliberately distinct.** `Reset View` (bottom bar) is zoom/pan.
`Page Resets ▾` holds `Reset Layout` (dragged page positions) and `Reset Sizes`
(page scaling). The bottom-bar button was labelled just "Reset", which read as if
it covered all three.

### State Management (Svelte Stores)

All state is managed through Svelte stores located in `src/stores/`:

**Core Data:**
- `strokes.js` - All captured strokes from pen; `pages` (derived, `S/O/B/P` → strokes) and `canvasPageKeys` (derived, `Set<"B{book}/P{page}">`) expose what's currently loaded — the Saved Pages list reads `canvasPageKeys` to disable Import Strokes for pages already on the canvas
- `selection.js` - Selected stroke indices and selection state
- `clipboard.js` - Copied strokes for duplication
- `pasted-strokes.js` - Duplicated/pasted strokes management

**Transcription:**
- `transcription.js` - MyScript transcription results and cache
- Page-level transcription data with hierarchy

**Saved-Pages Index:**
- `saved-pages.js` — holds the scanned list of `pages/B###/P##.json` records the Data Explorer renders. Store is `savedPages` (renamed from `logseqPages` in v2.3; nothing LogSeq-specific remains).
- `storage.js` — save status, unsaved-changes flag (`unsavedChanges` writable, `markUnsavedChanges()`, cleared on successful save)
- `book-aliases.js` — custom book name mappings (persisted to `<dataRoot>/pages/_aliases.json`)

**Book View (v2.1):**
- `viewer.js` — Book View pane state:
  - `viewerMode` (`'editor' | 'book'`) — which view the right pane shows; `setViewerMode()`, `toggleViewerMode()`
  - `viewerDirty` (derived) + `markViewerDirtyPage()`/`clearViewerDirtyPage()` — per-page unsaved-transcript-edit tracking, kept **separate** from the canvas `unsavedChanges` so saving a transcript never masks unsaved stroke changes (App's `beforeunload` checks both)
  - `viewerSelection` — last-open `{book, pageId}`, persisted to localStorage so Book View reopens the same spread across toggles/reload; `setViewerSelection()`/`clearViewerSelection()`
  - `recentViews` + `recordRecentView()` — recently-opened pages for the home grid

**Sketch Strokes (v2.4):**
- `sketch.js` — the pressure → thickness render profile (`sketchProfile`, `sketchPresetName`, `sketchPresets`, `sketchProfileSummary`, `applySketchPreset()`, `updateSketchProfile()`, `resetSketchProfile()`). Persisted to localStorage: it's a *display* preference, so it restyles every sketch at once and never touches disk. Any manual edit clears the preset name (showing "Brush" as active after its numbers changed would lie).
- `strokes.js` also owns the flag itself — `sketchStrokeCount` (derived), `setStrokesSketch()` / `markStrokesAsSketch()` / `unmarkStrokesAsSketch()`. Flagging marks the session dirty (the flag lives in the PageDoc) and drops the renderer's cached `_sw` width array.

**Volumes (v2.6):**
- `volumes.js` — capture routing for physical notebooks that share an NCode book id. `volumeRegistry` (`{version, active: {ncodeBook: volume}}`, persisted to `<dataRoot>/pages/_volumes.json`), `activeVolumeFor()`, `applyActiveVolume()` (the single pen→app boundary; **idempotent** — a pageInfo that already carries `volume` is returned untouched, so re-adding an imported stroke can't demote it), `loadVolumes()`, `setActiveVolume()`, `volumesForBook()`
- `strokes.js` also owns reassignment — `reassignVolume(indices, volume)` rewrites `pageInfo.book` to the target book key, clears `blockUuid` (the transcript line belongs to the *source* page) and stamps the in-memory `movedFrom` marker; `clearMovedFromMarkers(book, page)` drops it after the source page saves
- `pending-changes.js` — `getMovedAwayStrokeIdsForPage()` and the `moves` category (see below)

**Point Editing (v2.5):**
- `point-edit.js` — the canvas "Edit Points" mode: `pointEditMode`, `selectedPoints` (keys `"{strokeIndex}:{pointIndex}"`), `pointEditStrokes` (derived from the stroke selection, capped at `MAX_POINT_EDIT_STROKES`), `strayPoints`/`strayPointKeys` (advisory detection), `selectPoint()`/`selectPoints()`, `deleteSelectedPoints()`, `deleteStrayPoints()`, `enterPointEditMode()`/`exitPointEditMode()`. A `selectedIndices` subscription prunes point keys whose stroke leaves the selection and exits the mode when the selection empties
- `strokes.js` owns the mutation — `removeStrokePoints(Map<strokeIndex, Set<pointIndex>>)` and `clearPointEditMarkers(book, page)`. **This is the only code in the app that mutates captured geometry.** It preserves `startTime`/`endTime` (and so the `s{startTime}` id), every surviving point's force, and the sketch flag; it refuses to reduce a stroke below 2 points and reports those in `refused`; it stamps the edited stroke with the in-memory `pointsEdited` marker that gates the save-time rewrite

**UI State:**
- `ui.js` - Active tab, canvas zoom, UI preferences. Also `showActivityLogDialog`,
  `transcriptsMode` (`'review' | 'search'`) and `transcriptSearchFocus` (a counter,
  not a boolean, so a repeat request re-focuses an already-open search)

**Canvas session (v2.7):**
- `canvas.js` — operations on what is *loaded* rather than what is stored.
  `unloadPageFromCanvas(book, page)` takes one page off the canvas;
  `describePageUnload()` reports what unsaved work that would discard (read from
  `pendingChanges`, so the warning can't disagree with the save dialog).
  Lives here, not in `strokes.js`, because it touches the stores that import
  `strokes.js` — putting it there is an import cycle.
  **Unloading is not an edit** and deliberately does not call
  `markUnsavedChanges()`: under append-only, off the canvas never means deleted
  on disk, so an unloaded page is untouched in its PageDoc.
  Its real job is keeping the **index-keyed** stores honest — `strokes` is an
  array, so removing from the middle shifts every later position:
  `deletedIndices` is shifted (a stale mark would delete the *wrong* stroke at
  next save), `selectedIndices` is shifted, point-edit mode exits (its keys are
  `"strokeIndex:pointIndex"`), and `filteredStrokes` is cleared. `pagePositions`
  / `pageScales` are page-keyed and kept, so re-importing restores placement.
- `page-order.js` - Custom page positioning/layout
- `page-scale.js` - Per-page scaling factors
- `pen.js` - Pen connection state and battery info

**Advanced:**
- `filtered-strokes.js` - Decorative element detection
- `pending-changes.js` - Tracks local changes before save (additions, edits, modifications, deletions per page)
  - `deletedIndices` — set of stroke indices marked for deletion
  - `pendingChanges` — derived store computing additions/**edits**/**modifications**/deletions per page (pure core `computePendingChangesMap()`, tested). `edits` are strokes already on disk whose *geometry* shrank (points deleted); `modifications` are strokes already on disk whose *sketch flag* was toggled. Both move no stroke count. **Every stroke lands in exactly one bucket:** new-and-anything is an addition (the save writes the whole stroke), and edited-and-reflagged is an edit (the stronger claim; one save carries both)
  - `getDeletedStrokeIdsForPage()` — converts indices to stroke IDs for the save call
  - `adjustDeletionsAfterRemoval(removedIndices)` — re-points the marks when strokes
    leave the store (page unload). Marks on removed strokes are dropped; the undo
    history is cleared rather than shifted. Tested — an unshifted mark silently
    deletes a different stroke from disk, which is the worst failure this store has
  - `onDiskStrokeIds` + `noteOnDiskStrokeIds()` — perf #3: since `savedPages` records no longer carry strokes, the diff uses a small `pageKey → Map<strokeId, {sketch, points}>` map populated ONLY for pages currently on the canvas (primed by `load-page.js` import + `save-page.js` save; lazily backfilled and evicted by a `canvasPageKeys` subscription). Never reads strokes off `savedPages`. Entries are scalar-sized records, never strokes — `points` here is a *count*, not the array; keep any future field just as small. The count is what makes the edit diff **self-clearing**: the post-save refresh brings it in line and the page stops reporting an edit with no flag to reset
- `settings.js` — persisted user settings (MyScript keys, `dataRoot`, `dataFolderReady`, `dataFolderStatusText`; **Export to LogSeq:** `graphRoot`, `graphFolderReady`, `graphFolderStatusText` — no publish-on-save flag, removed in v2.3)

### Key Libraries

**Core Logic (`src/lib/`):**
- `volumes.js` - **Book keys** (pure). `pageInfo.book` is a *string* everywhere in memory: `"388"` = volume 1, `"388v2"` = volume 2 of the same physical NCode book. `makeBookKey`/`parseBookKey` (rejects non-canonical spellings — `"388v1"`, `"0388"` — via a round-trip check, so one spelling per notebook), `compareBookKeys` (NCode book then volume; **required** — naive string sort puts `"388v2"` after `"3880"`), `bookDirName`/`parseBookDirName`, `pageInfoForDisk`/`pageInfoWithBookKey` (the disk↔memory boundary), `BOOK_KEY_FRAGMENT` (**use this to build any regex matching a page key — never hand-write `\d+` for the book**), `volumeSuffix`/`volumeBadge`
- `pen-sdk.js` - NeoSmartpen SDK wrapper and BLE communication
- `canvas-renderer.js` - Canvas drawing engine for stroke visualization
- `myscript-api.js` - MyScript API client for handwriting recognition (proxied via IPC in Electron)
- `stroke-analyzer.js` - Shape detection and analysis
- `stroke-filter.js` - Decorative element detection (boxes, underlines)
- `stroke-storage.js` - Stroke ID generation, format conversion, bounds, dedupe, user JSON/MD exports
- `point-edit.js` - Point-level stroke editing (pure): `detectStrayPoints()` (`origin` — at/near Ncode (0,0) or non-finite; `jump` — far from both neighbours, relative to the stroke's median spacing **and** past `MIN_JUMP_DISTANCE`, an absolute floor that keeps short flick strokes out of the results), `detectStrayPointsForStrokes()`, `removePointsFromStroke()` (identity- and force-preserving, re-tags `dotType`, drops the `_nb`/`_sw` caches, refuses to go below `MIN_STROKE_POINTS`), `pointKey`/`parsePointKey`/`groupPointKeys`, `formatPointCoords`
- `sketch-width.js` - Pressure → line thickness mapping for sketch strokes (pure): profile normalisation/presets, `pressureToUnit`, `smoothSeries` (symmetric, spike attenuation), `limitSlew`, `widthsForPressures`, `widthsForStrokeSeries` (the single "no pressure data → flatWidth" rule), `profileKey` for width-cache tagging
- `transcript-search.js` - Full-text search across transcriptions

**Storage Layer (`src/lib/storage/`)** — v2.0:
- `page-doc.js` — PageDoc schema types, `emptyPageDoc()`, `computeBounds()`, `validatePageDoc()`
- `page-doc-format.js` — hybrid pretty/compact serializer (document shell pretty-printed; each stroke on one line)
- `local-store.js` — renderer-side facade over `window.storageAPI` IPC: `listPages`, `getPage`, `savePage`, `deletePage`, alias CRUD, `pickFolder`, `isAvailable`, `openInExplorer`. **`savePage()` is the single choke point all PageDoc writes funnel through.** It does NOT publish to the LogSeq graph — that was removed in v2.3 (see `graph-export.js`)
- `save-page.js` — `savePageToFolder()` — append-only stroke merge with explicit deletions, Y-bounds-based transcript merge with checkbox preservation
- `graph-index.js` — pure helpers for **Export to LogSeq**: `smartpenAssetName()`/`smartpenAssetRelPath()` (the `smartpen-B{book}-P{pageId}.json` asset convention), `buildSmartpenIndexEntry()`, `upsertSmartpenIndex()`, `emptySmartpenIndex()`. Mirrors the JPI Tools plugin's `tools/migrate-smartpen-assets.mjs` index logic (plugin spec §4.6/§6.1). Identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
- `publish-graph.js` — graph **transport only**: `readGraphPage(book, pageId)` (the published asset, or null) and `writeGraphPage(book, pageId, doc)` (asset via `serializePageDoc` + `smartpen-index.json` upsert, both atomic via IPC). **Throws on failure** — export is a deliberate user action, so errors surface. No LogSeq runtime dependency (pure filesystem). Does *not* decide what to publish
- `graph-export.js` — **what** to publish. Pure core (`stripTranscriptRefs`, `mergeGraphStrokes`, `resolveGraphPageInfo`, `buildGraphPageDoc`, `groupCanvasStrokesByPage`) + facades `exportSelectionToGraph(canvasStrokes)` (fans out one merge+write per page in the selection) and `exportPageDocToGraph(book, pageId, doc)` (whole-page backfill). Two invariants: **additive** (merge into what's already published, dedupe by stroke id — re-exporting is a safe no-op) and **transcript-free** (`transcript.lines` emptied, every `lineId` cleared). Tested in `graph-export.test.js`
- `load-page.js` — `importStrokesFromFolder()`, `importStrokesForLoadedPagesFromFolder()` — converts StoredStroke → canvas dotArray format
- `scan.js` — `scanLocalPages()` + `metaToRecord()` (pure, tested) — populates the `savedPages` store from disk. **Metadata-only (perf #3):** records carry summary fields ONLY (`strokeCount`, `lastUpdated`, `transcriptionText`, `transcribed`, `transcriptLineCount`, `pageId`/`suffix`) — never `strokes`/`pageDoc`/`strokeData`, so the corpus never stays resident; each page's strokes load lazily on view. Records load by `pageId`, so letter-suffixed variants (`P127.json` + `P127b.json`) don't collapse onto the integer page. (`main.cjs listAllPages` → `extractPageMeta` parses just the doc shell, skipping the strokes array, so the scan is fast; the tiny `transcriptionText` rides along to power search/preview without loading strokes.)
- `page-changes.js` — `computePageChangesFolder()` — preview diff for the SaveConfirmDialog. Reads the PageDoc off disk rather than the `onDiskStrokeIds` index, so it is a **second implementation** of the `pendingChanges` question and has to stay in step with it — it returns `strokeAdditions`/`strokeModifications`/`strokeDeletions` on the same rules

**Book View Layer (`src/lib/viewer/`)** — v2.1:
- `page-svg.js` — `computeStrokeBounds()`, `strokeToPathD()`, `generateThumbnailSVG()` — SVG render for the spread pages + home-grid thumbnails (`NCODE_SCALE = 2.371`). Also `strokePointPressures()` + `strokeToWidthRuns()` for sketch strokes: SVG applies one `stroke-width` per `<path>`, so a pressure-varying line is emitted as consecutive constant-width runs (thumbnails stay flat — too small to matter)
- `page-cache.js` — small LRU (`getCachedPage`/`invalidatePage`/`clearPageCache`, MAX 6) over full PageDocs. Book View loads strokes lazily through this (records no longer embed them, perf #3) so turning a spread doesn't re-read disk; older docs are evicted. Keyed by `B{book}/P{pageId}` (suffix-safe)
- `transcript-markdown.js` — `linesToLogseqMarkdown()` — tab-indented `- ` bullets with `- TODO`/`- DONE` markers; `key:: value` property lines stripped (LogSeq-pasteable copy). Also `indentMarkdownBlock()`, `textToTranscriptLines()` (flat-text fallback) and `pagesToLogseqMarkdown()` (multi-page payload: one page copies bare, several nest under `- {label}` bullets) — used by the canvas text-view copy
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
    {"id":"s1765313505107","startTime":1765313505107,"endTime":1765313505396,"lineId":"955e79bf-…","points":[[6.56,37.25,1765313505107,412], …]},
    {"id":"s1765313509880","startTime":1765313509880,"endTime":1765313510402,"lineId":null,"sketch":true,"points":[[12.10,41.03,1765313509880,655], …]}
  ]
}
```

**Point tuples are variable length:** `[x, y]`, `[x, y, ts]`, or
`[x, y, ts|null, force]`. The 4th element is the raw pen force driving sketch
rendering; it is written for every stroke (not just flagged ones) because flagging
happens long after capture — conditional pressure would make marking a stroke later
silently produce a flat line. When force is present but no timestamp was recorded,
position 2 is an explicit `null` so force keeps a fixed index. Files written before
pressure was persisted have shorter tuples and read back fine; they render at a
constant `flatWidth`.

`sketch: true` is omitted entirely when false, so handwriting pages serialize
exactly as they did before sketch strokes existed.

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
- **The one geometry exception (v2.5)**: `savePageToFolder()` rewrites a stored stroke's `points` when — and only when — the canvas copy carries the in-memory `pointsEdited` marker, which `removeStrokePoints()` alone sets. Gated on explicit intent rather than "the canvas has fewer points than disk" precisely so a dotArray filtered by some future code path can never destroy stored geometry. `strokeToStored()` builds stored strokes from a fixed key list, so the marker cannot reach disk

## Known Issues and Gotchas

1. **Stroke Deduplication**: Uses timestamp-based IDs (`s{startTime}`). See `stroke-storage.js`.

2. **Append-Only Saves**: Save operations NEVER replace the entire PageDoc — only explicit additions, deletions, and (v2.5) point edits carrying the `pointsEdited` marker apply.

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
| `page-svg.test.js` | `computeStrokeBounds`, `strokeToPathD` (scaling, normalisation, <2-point skip), `generateThumbnailSVG` (empty placeholder, dimensions); `strokePointPressures` (4th tuple element, NaN for legacy), `strokeToWidthRuns` (run splitting, monotonic ramp, full segment coverage, constant-pressure collapse, flatWidth fallback, scale/profile response) |
| `sketch-width.test.js` | `normalizeProfile` (defaults, swapped/degenerate sanitising, null-vs-zero), presets, `profileKey`, `pressureToUnit` (band/clamp/NaN), `widthForPressure` (endpoints, gamma character), `smoothSeries` (symmetry, spike attenuation, edge windows), `limitSlew` (bidirectional), `widthsForPressures` (full pipeline, gap filling, all-missing → flatWidth), `strokePressures`/`hasPressureData` |
| `sketch-store.test.js` | `stores/sketch.js` (sanitised load, persistence, corrupt JSON, presets, edit-clears-preset, reset, summary) and the `stores/strokes.js` flag helpers (mark/unmark, Set or array, no-op detection, unsaved-changes signalling, `_sw` cache invalidation, `sketchStrokeCount`) |
| `canvas-renderer-sketch.test.js` | Renderer sketch path against a recording 2D-context stub: uniform handwriting (and that width no longer depends on the final dot), multi-width sketch runs, monotonic ramp, full segment coverage, run batching/quantisation, dashed fallback for deleted/decorative, width caching + profile invalidation, pasted-sketch taper |
| `save-page.test.js` | `strokeToStored` (force as 4th element, integer rounding, null-timestamp placeholder, 3-element fallback for missing force, `sketch` omitted when false, key order); `savePageToFolder` sketch-flag sync onto strokes already on disk (mark, unmark removes the key, untouched when absent from canvas, points never rewritten *without the marker*, lineId sync preserved); **point edits** (rewrite gated on `pointsEdited`, refused without it, id/startTime/endTime survive losing the first point, force + sketch flag survive, marker never written to disk, other strokes untouched, bounds recomputed, key order stable, new-stroke case reports `edited: 0`) |
| `point-edit.test.js` | `detectStrayPoints` (origin exact/near/leading, non-finite, interior jump, fast-movement and short-flick non-detections, absolute-floor boundary, short strokes, single reason per point); `detectStrayPointsForStrokes`; `removePointsFromStroke` (order, identity preserved both ends, force + sketch preserved, `dotType` re-tag, cache drop, no mutation, min-points refusal, no-ops, Set input); key helpers; `removeStrokePoints`/`clearPointEditMarkers` store behaviour (marker stamping, dirty signalling, partial refusal, per-page clearing); `stores/point-edit.js` mode + selection (entry refusals, derived strokes/point count/strays, key pruning when a stroke leaves the selection, exit when the selection empties, toggle, select/delete strays, selection cleared after a delete) |
| `volumes.test.js` | `src/lib/volumes.js` — `makeBookKey`/`parseBookKey` round-trip, canonical-form rejection (`"388v1"`, `"388v0"`, `"0388"`, `"388v02"`), `compareBookKeys` ordering (`"388"` < `"388v2"` < `"3880"` — the case naive string sort gets wrong), `withVolume`, `bookDirName`/`parseBookDirName`, the disk↔memory `pageInfo` boundary (volume 1 omitted), display helpers, `BOOK_KEY_FRAGMENT` matching |
| `volumes-store.test.js` | `stores/volumes.js` (`activeVolumeFor`, `applyActiveVolume` including its idempotency, `volumesForBook`) and reassignment in `stores/strokes.js` — identity/geometry/sketch preserved, `blockUuid` cleared, first origin kept across a double move, `getMovedAwayStrokeIdsForPage` (the copy→move fix), `clearMovedFromMarkers` no-op pre-check |
| `pending-changes.test.js` | `computePendingChangesMap` — additions vs. the on-disk stroke-state index, explicit deletions, page separation/`isSaved`, missing `pageInfo`; sketch-flag **modifications** (flag on, flag off, absent-vs-false, matching flag, new-and-flagged counted once as an addition, unknown page, deleted stroke excluded, mixed page, modification-only page enters the map); geometry **edits** (fewer points than stored, self-clearing when counts agree, silent on unknown stored count, edited-and-reflagged counted once as an edit, new stroke stays an addition, deleted stroke excluded, edit-only page enters the map, all four categories side by side); `adjustDeletionsAfterRemoval` (shift, marks before the hole untouched, marks on removed strokes dropped, interleaved removals, Set input, empty/null no-op, no renumber collision, undo history cleared) |
| `page-changes.test.js` | `computePageChangesFolder` — the SaveConfirmDialog's own diff against the PageDoc on disk: additions, `strokeModifications` (both directions, absent-vs-false, new-and-flagged once), `strokeEdits` (point-count difference, self-clearing, `strokeTotal` unmoved, edited-and-reflagged once, new stroke stays an addition, error fallback, all four categories side by side), deletions + `strokeTotal` arithmetic, error fallback, transcription new/changed (mocks `getPage`) |
| `transcript-markdown.test.js` | `linesToLogseqMarkdown` — tab indentation, TODO/DONE markers, `::` property stripping, blank-line drop, `isPropertyLine`; `indentMarkdownBlock`, `textToTranscriptLines` (tab/2-space indent inference, blank drop), `pagesToLogseqMarkdown` (bare single page vs. labelled multi-page nesting, empty-page skip) |
| `save-transcript.test.js` | `recomputeParentIds` (hierarchy by indent), `saveTranscriptLines` (verbatim write, lineId scrub on deleted lines, timestamp bump, missing-page guard; mocks `getPage`/`savePage`) |
| `graph-index.test.js` | `smartpenAssetName`/`smartpenAssetRelPath`, `buildSmartpenIndexEntry`, `upsertSmartpenIndex` (replace-in-place, alias merge, sorting, corrupt-input normalisation) |
| `graph-export.test.js` | `stripTranscriptRefs`, `mergeGraphStrokes` (dedupe by id, existing wins, re-export is a no-op), `resolveGraphPageInfo`, `buildGraphPageDoc` (**transcript never published**, bounds/totalStrokes recomputed), `groupCanvasStrokesByPage` (multi-page fan-out, orphan counting), `exportSelectionToGraph`/`exportPageDocToGraph` (merge into published page, per-page failure isolation, letter-suffix identity; mocks `publish-graph.js`) |

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
- Re-import a saved page from the Saved Pages tab (Import Strokes greys out while
  that page is loaded, re-enables after Clear)
- Clear the canvas, then import a page with **fewer** strokes than were cleared —
  pages must lay out side by side without needing Reset Layout
- Edit transcript via the page-card editor; reload to confirm persistence
- Canvas text view: import a transcribed page → **📝 Show Text** → per-page **📋 Copy**
  button appears in the page's top-right corner and the header shows **📋 Copy
  Transcript**; paste into LogSeq and confirm hierarchy + TODO/DONE survive.
  With two pages shown, confirm each page's button copies just that page and the
  header button copies both under labelled parent bullets; pan/zoom and confirm
  the buttons track their pages
- Export to LogSeq: select strokes → ⇪ LogSeq → asset appears under
  `<graph>/assets/storages/logseq-plugin-jpi-tools/`; export a second, different
  selection on the same page and confirm both stroke sets are present (additive);
  re-export the same selection and confirm it adds nothing; confirm no transcript
  text in the asset
- Sketch strokes: draw something with varying pressure → select it → **✏️ Mark as
  Sketch** → confirm the line tapers with pressure and that a hard jab widens
  gradually rather than bulging. Save, Clear, re-import → taper survives the
  round-trip. **Unmark Sketch** returns it to a uniform line. Settings → **Sketch
  Style**: presets and each slider update the live preview *and* the canvas
  immediately; check a page saved before this feature renders at one flat width
  rather than a hairline. Confirm the same taper appears in Book View and in an
  SVG export, and that a duplicated (pasted) sketch stroke keeps it
- Sketch flag reported as a change: save a page, then mark one of its strokes as a
  sketch **without** drawing anything new — the page label gains its `*`, and Save
  lists the page with "✏️ 1 restyled" (not `+1 strokes`) and a "Restyling" total.
  Save, reopen the dialog → the page is gone from the list. Unmark and repeat.
  Marking a *freshly drawn* stroke must still read as `+1 strokes` only
- Point editing (the stray-origin-dot fix): find a stroke with a line shooting off
  to the page's top-left corner, select it → **📍 Edit Points** → point handles
  appear, the offending dot amber. The panel lists it with its coordinates
  (`0.00, 0.00`); click the row to centre the view on it, then **Delete selected**
  (or **Delete all** for every suspect point). The line to the corner disappears
  and the page border shrinks to the real content. Confirm the rest of the stroke
  is intact and, if it was a sketch, still tapers. Then: the page label gains its
  `*`; Save lists the page with "✎ 1 edited" and an amber **Editing** total plus
  the rewrite warning; save, Clear, re-import → the point is still gone and the
  stroke kept its transcript line. Reopen the save dialog → the page is gone from
  the list. Also check a box-drag selects several handles, Del deletes them, Esc
  clears the point selection and a second Esc leaves the mode, and that trying to
  delete all but one point of a stroke is refused with a message rather than
  leaving an invisible stroke
- Volumes — **live capture, definition and reassignment verified 2026-08-07;
  offline import still outstanding.** Settings → **Notebook Volumes** → *Start
  Volume 2* on the duplicated book. Write with the pen: the ink must stay in one
  page group through pen-up (two borders, or ink that jumps on pen-up, means the
  live-preview remap regressed), and the page saves to `pages/B388v2/`, leaving
  `pages/B388/` untouched. Switch back to Volume 1 and confirm new strokes go
  there. Then the move path: select strokes → **Volume ▾** → pick the other
  volume; the save dialog lists the *source* page marked **required** with its
  checkbox disabled, and a "Moving: →N strokes" tile. Save, Clear, re-import both
  volumes — the stroke must appear in **exactly one**. Select every stroke on a
  transcribed page and move it: the transcript follows and the emptied source
  file disappears from Saved Pages. **Still to test:** offline import from pen
  memory — a multi-book batch imports completely, strokes land in the active
  volume, and reassignment works on *imported* strokes (the case with a copy
  already on disk, so the `movedFrom` deletion has to fire). A batch spanning two
  physical volumes will mis-file half of it; that's expected, and reassignment is
  the remedy
- Canvas pan/zoom/navigation
- Page positioning and scaling
- **Books tab** (v2.7): on a book with two volumes, give each an unrelated name
  and confirm both survive a reload and appear throughout the app; confirm the
  destination folder next to the volume picker tracks the selection; set a book
  to a volume with no pages and confirm the row appears and can be named
- **Canvas search** (v2.7): load several pages → type in the header search →
  results rank name matches above text matches; picking one pans to it. Hide a
  page with the Filter control, then find it — it must be revealed *and* centred.
  Switch to 📝 Text and confirm matches are highlighted amber on the page itself
  and track as you type. <kbd>Ctrl+F</kbd> focuses this; <kbd>Ctrl+Shift+F</kbd>
  opens the left panel's disk-wide search
- **Unload one page** (v2.7): hover a page chip in the Filter control → ✕.
  The page leaves, the rest re-lay out without needing Reset Layout, and the file
  is untouched on disk (re-import it to confirm). Then the case that matters:
  mark strokes on page A for deletion, unload page B, and confirm the *same*
  strokes on A are still the ones marked — save and check the right ones went.
  Unload a page holding unsaved work and confirm the warning lists it
- **Activity Log** (v2.7): Settings → 🩺 opens over the app; Esc and the backdrop
  close it; level filters disable when a level is empty; Copy puts the filtered
  entries on the clipboard oldest-first
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
- [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) — **START HERE** for v2.0 — full design of the local-folder storage layer. §12 *Amendments Since v2.0* records what has changed on `strokes[]` since (variable-length point tuples carrying pen force, the `sketch` flag, and the one exception to immutable geometry); this file remains authoritative for current behaviour
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

### v2.7 — UI reorganisation: panels, not toolbars (August 2026)

**Every long-lived list got a panel; the canvas toolbar and settings dropdown
stopped being the dumping ground for them.** The toolbar carried twelve controls
across four unrelated concerns; the dropdown had seven sections, two of which
(`BookAliasManager`, `VolumeSettings`) were unbounded lists that grow with every
notebook — the wrong container for a list you scroll.

**Left panel flattened to one tab row.** The outer *Data Explorer / Activity Log*
level went when the log moved to Settings → Troubleshooting, leaving nothing to
switch between. Tabs are now Strokes · Transcripts · Pages · **Books**.

**Books tab** merges aliases and volume routing into one row per NCode book —
they answer the same question. Two things it fixed rather than moved:
- **Volumes are named independently.** Aliases were always keyed by book *key*,
  so `"388"` can be *Site Visits* while `"388v2"` is *Load Calcs*.
  `formatBookName()` falls back to the parent's name + volume suffix only while a
  volume has no name of its own.
- **A volume can be named before it is used.** The old manager listed only
  `knownBookIds` (books with pages on disk), so a notebook you had just made
  active had no row. Volume rows now come from `volumesForBook()`, which includes
  the active volume at zero pages.
- The **destination folder** (`pages/B388v2/`) sits beside the active volume: the
  failure volumes exist to prevent is writing into the wrong notebook.

**Transcripts panel** is Review (incoming MyScript results — the old
`TranscriptionView` unchanged) plus Search (the old modal, unwrapped). Mode lives
in a store so the canvas can route straight to Search and so leaving the tab and
returning keeps your half.

**Canvas split by what each bar acts on.** Top = identity and selection
(Volume ▾ stays there deliberately — it decides which physical notebook a stroke
belongs to and is worth keeping in view). Bottom = rendering, so sketch marking
sits beside the `SketchStylePopover` that tunes it; the popover means the live
preview and the strokes it restyles are finally on screen together, which the
settings dropdown could never manage. Exports folded into one `Export ▾`.

**Two searches, kept separate on purpose** — see "Left panel tabs" above.
`CanvasSearch` matches notebook name, page number and transcript text over loaded
pages only, entirely from memory (fresh MyScript results, else the
`transcriptionText` the metadata-only scan already carries), and **pans** to the
result. It reveals a page hidden by the page filter first, otherwise the view
centres on something not drawn. In text view the term is highlighted on the page
itself via `drawPageText(pageKey, text, highlight)` — word wrapping happens
first, so a phrase broken across a wrap boundary finds the page but marks nothing.

**Unloading one page from the canvas** (hover a page chip in the filter → ✕).
The button was the easy half; the work was index safety — see `stores/canvas.js`
in the Stores section. `adjustDeletionsAfterRemoval()` is the load-bearing part:
an unshifted deletion mark silently deletes a *different* stroke at next save.

**Reset labelling.** "Reset" on the bottom bar read as though it covered page
layout too. It is now **Reset View**, and `⋯` became **Page Resets ▾** with a
hint on each item naming what it acts on.

**Deleted (7):** `SearchTranscriptsDialog`, `TranscriptSearchResult`,
`BookAliasManager`, `VolumeSettings`, `ActivityLog` (the dialog filters entries,
so it renders them itself), and the pre-existing dead `Sidebar` +
`MyScriptSettings` — the latter a near-duplicate of the MyScript block inlined in
`SettingsDropdown`, so editing it appeared to do nothing.
**Known orphan:** `PenInfo.svelte` was only imported by `Sidebar` and is now
unreachable. Left in place pending a decision.

**New:** `stores/canvas.js`, `components/books/BooksTab.svelte`,
`components/transcription/{TranscriptsPanel,TranscriptSearch,SearchResultCard}.svelte`,
`components/canvas/{CanvasSearch,SketchStylePopover}.svelte`,
`components/dialog/ActivityLogDialog.svelte`.
**Edited:** `stores/{ui,index,strokes,pending-changes}.js`,
`lib/canvas-renderer.js` (`centerOnPage`, `drawTextHighlights`, highlight param),
`components/layout/LeftPanel.svelte`,
`components/canvas/{StrokeCanvas,CanvasControls,PageSelector}.svelte`,
`components/header/SettingsDropdown.svelte`, `pending-changes.test.js`.

### Volumes — telling apart notebooks that share an NCode book id (August 2026)

**NCode identifies a paper design, not an object.** Two identical Lamy notebooks
report the same `book` id and the same page numbers, so page 12 of the second
merged into `pages/B388/P12.json` alongside page 12 of the first. Nothing was
destroyed (append-only dedupes by `s{startTime}`, and timestamps never collide)
but the two notebooks' strokes were drawn on top of each other, permanently
interleaved, and re-transcribing produced nonsense.

**A volume is a suffix on the book key.** `pages/B388/` is volume 1;
`pages/B388v2/` is volume 2. In memory `pageInfo.book` carries the key as a
**string**; on disk it stays a *number* with an optional `volume` field, omitted
when 1. So `validatePageDoc`'s `typeof book === 'number'` check is unchanged,
`PAGE_DOC_VERSION` stays `"2.0"`, and **every existing file is byte-identical.
There is no migration** — an absent `_volumes.json` means every book is volume 1,
which is exactly how the app behaved before.

**Why the ~30 page-key sites didn't need touching.** They're template literals
(`` `B${pageInfo.book}/P${pageInfo.page}` ``), and a template literal interpolates
a string as happily as a number. What broke was the much smaller set that does
*arithmetic* on `book` or regex-parses a key with `\d+`. Both fail quietly:
- **No match** — `main.cjs`'s directory scan (volume dirs invisible),
  `pending-changes.js`'s lazy backfill (**every volume stroke reports as a new
  addition on every save, forever**), `canvas-renderer`'s page-layout comparator
  (`return 0` against everything → arbitrary left-to-right order).
- **Partial match** — unanchored `/B(\d+)/` matches `B388` *inside* `B388v2` and
  confidently returns 388. A plausible wrong value, which is worse.

`BOOK_KEY_FRAGMENT` in `volumes.js` exists so this can't come back. **Use it;
don't hand-write `\d+` for a book.** A grep sweep after the first round of edits
turned up five more sites than the original inventory — assume any such list is
incomplete.

**Book keys are strings *including* volume 1**, deliberately. A mixed
number/string type would have contained the blast radius, but only by delaying
discovery until volume 2 was actually used — i.e. on the one notebook with the
least redundancy. All-strings makes a missed coercion fail immediately, across
data that's easy to eyeball. (`pageId` was already a string throughout, so this
is an established pattern here, not a new one.)

**Reassignment is a move, not a copy — and that took work.** Selecting strokes
and picking a volume rewrites `pageInfo.book`, which makes them an *addition* to
the target. But under append-only, missing-from-canvas never means
deleted-on-disk, so the source page keeps its copy and the stroke ends up in
**both volumes**, silently — worse than the mis-filing being fixed. The fix is the
in-memory `movedFrom` marker (same shape as `pointsEdited`; `strokeToStored()`
builds from a fixed key list so it can't reach disk).
`getMovedAwayStrokeIdsForPage()` reads it and the caller unions the result into
`deletedStrokeIds` — the same operation, so the existing deletion machinery is
reused rather than extended. Consequences:
- A fourth pending-changes category, `moves`, attributed to the page a stroke
  *left*. It has to synthesise that page's entry: after a whole-page move the
  source has no canvas strokes, so the grouping pass produces nothing for it and
  it would vanish from the save dialog entirely.
- **Move sources are force-included in `SaveConfirmDialog`** (checkbox disabled,
  `required` tag). Saving only the target is exactly the two-volumes failure.
- `startTime`/`endTime` survive so the `s{startTime}` id is stable — the source
  deletion matches on it. `blockUuid` is cleared; it points at a transcript line
  on the source page.

**Whole-page moves work by selecting every stroke** (Josh's call — no separate
page-move tool). Two things strokes don't carry: the **transcript** lives in
`doc.transcript.lines`, and the emptied **file** lingers as a 0-stroke ghost.
`planPageMove()`/`finalizePageMoves()` handle both, running *after* every page
save so they can't race the writes. The transcript is carried only when the
source ends genuinely empty, exactly one target received its strokes, and the
target has no transcript of its own — splitting one by guesswork would be worse
than leaving it put.

**Live preview needed the same remap as capture.** `canvasRenderer.addDot()`
builds its own page-group key from the raw dot, so without it live ink lands in
`B388/P12` while the finalized stroke lands in `B388v2/P12` — two page borders,
ink that jumps on pen-up. Invisible in review, obvious in use. The remap stays
*out* of the transport path (`normalizeBookId`, transfer matching, pen-memory
keys), which must keep the raw NCode id.

**`book` became a path-injection surface.** It used to reach `pagePath()` via
`parseInt` and was inherently safe; as a string it isn't. `requireBookKey()` /
`requirePageId()` in `main.cjs` are what keep page reads and writes inside the
data root.

**Also fixed:** `getAliases()` normalised keys with `Number()` while `main.cjs`
wrote `String(book)` — `Number("388v2")` is `NaN`, so volume aliases would have
been destroyed on every scan. Keys now pass through unchanged (a latent
inconsistency already; `publish-graph.js` hedged around it).

**Known limitation — permanent:** if you write in physical volume 1 while the
active pointer says volume 2, nothing can detect it. The pen cannot tell the
notebooks apart; that's the premise. Reassignment is the remedy, not prevention.

**Verified on hardware (2026-08-07):** live capture with a volume active (ink
stays in one page group through pen-up — the trap where the renderer builds its
own page-group key from the raw dot), volume definition, and canvas reassignment.

**⚠️ Offline import is UNVERIFIED.** Nothing is known broken; it just hasn't been
run against the pen since volumes landed, and it's the riskiest untested path.
The remap was deliberately kept *out* of the transport layer (`normalizeBookId`,
transfer matching, pen-memory keys all still use the raw NCode id) because
multi-book offline import has a history of subtle bugs — see the April 2026
fixes. Check in order: a multi-book batch still imports completely; strokes land
in the active volume; and reassignment works on *imported* strokes (the path
where a copy already exists on disk, so the `movedFrom` deletion actually has to
fire). See docs/VOLUMES-SPEC.md §11.

**Not done:** volume 2+ **LogSeq export is refused** with a readable message
(`requireGraphBook`) — `smartpen-index.json` carries a numeric book and the JPI
Tools plugin needs a matching change. The plugin spec is deliberately deferred
until this has been used against real notebooks. Also deferred: timestamp routing
for offline import (a batch spanning two volumes currently needs manual
reassignment — promote this if it proves annoying), and the per-book selector in
`BookSelectionDialog`.

**New:** `src/lib/volumes.js`, `src/stores/volumes.js`,
`src/components/settings/VolumeSettings.svelte`, `volumes.test.js`,
`volumes-store.test.js`.
**Edited:** `electron/main.cjs`, `electron/preload.cjs`, `storage/local-store.js`,
`storage/scan.js`, `storage/load-page.js`, `storage/save-page.js`,
`storage/page-changes.js`, `storage/graph-export.js`, `stores/strokes.js`,
`stores/pending-changes.js`, `stores/saved-pages.js`, `stores/ui.js`,
`lib/canvas-renderer.js`, `lib/pen-sdk.js`, `utils/formatting.js`, `App.svelte`,
`StrokeCanvas.svelte`, `PageSelector.svelte`, `ActionBar.svelte`,
`SaveConfirmDialog.svelte`, `CreatePageDialog.svelte`, `BookViewer.svelte`,
`BookAliasManager.svelte`, `SettingsDropdown.svelte`, `scan.test.js`,
`pending-changes.test.js`, `page-changes.test.js`, `save-page.test.js`.

**See:** [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) — full design, plus the
rejected alternatives (arithmetic remap, decimal book ids, volume on the page
suffix) and why each fails.

### Point editing — delete a single stray point from a stroke (August 2026)

**The pen sometimes emits a dot at the Ncode origin partway through an otherwise
sound stroke.** The renderer joins consecutive dots, so one bad sample draws two
long lines out to the page's top-left corner and back, straight through the notes.
The only previous remedy was deleting the whole stroke, losing real handwriting.
The canvas now has an **Edit Points** mode: the selected strokes' individual points
become clickable handles, and single points can be deleted while the rest of the
stroke stays intact.

Note this is a *renderer* artifact of a bad sample, not the SDK's known invalid
pen-down dot — `processDot()` already filters `{x: -1, y: -1}` (see "NeoSmartpen
SDK — Invalid Pen-Down Dot"). These points arrive with plausible-looking data.

**In-canvas, not a modal.** A stray point is identified by *where it sits*
relative to the surrounding writing, and the canvas already has the zoom, pan and
box-select to do that. The numeric half of the job — a point at `0.00, 0.00` is off
in a page corner and easy to miss at fit-to-page zoom — is covered by
`PointEditPanel`, which lists each suspect point with its coordinates and centres
the view on it when clicked.

**Geometry became mutable, in exactly one place.** Everything else about the save
path is unchanged and still append-only:
- `removeStrokePoints()` in `stores/strokes.js` is the sole mutation. It stamps the
  stroke with an in-memory `pointsEdited` marker, and `savePageToFolder()` rewrites
  a stored stroke's `points` **only** for marked strokes. Deliberately *not* keyed
  on "the canvas copy has fewer points than disk": append-only exists so partial
  canvas state cannot destroy stored data, and a count comparison would hand that
  power to any future code path that filters a dotArray for its own purposes. The
  existing test asserting points are never rewritten still passes unchanged —
  which is the point.
- **Identity survives.** `startTime`/`endTime` are preserved even when the first or
  last point goes, so the `s{startTime}` id is stable. Re-deriving it would orphan
  the stroke from its transcript line and re-import it as a duplicate. (The stray
  is usually the pen-down sample, so this is the common case, not an edge one.)
- **Sketch data survives.** Each surviving point keeps its `f` (pen force), so
  `strokeToStored()` re-emits full `[x, y, ts|null, force]` tuples and a flagged
  stroke still tapers. The `_sw` width cache and `_nb` bounds cache are dropped so
  both recompute for the shorter series.
- A stroke can't be reduced below 2 points — there'd be no line to draw. Those
  removals are refused and reported rather than leaving an invisible stroke.

**Reported as its own status.** `additions`/`modifications`/`deletions` gained
`edits`: strokes already on disk whose geometry shrank. Separate from
`modifications` (a sketch-flag toggle) because saving an edit *overwrites captured
data*, so it earns its own amber **Editing** total, a per-page "✎ N edited" stat and
an explicit warning in the save dialog. Every stroke lands in exactly one bucket:
new-and-anything is an addition, edited-and-reflagged is an edit.

**The diff is self-clearing.** `onDiskStrokeIds` entries carry a point *count*
alongside the sketch flag, so an edit is detected by comparing counts and the
post-save index refresh ends the "edited" state on its own — no flag to reset.
`clearPointEditMarkers()` still runs after a successful save to keep the intent
marker honest, guarded by a cheap pre-check so it doesn't republish the strokes
array once per saved page for the common case of no edits.

**Detection is advisory.** `detectStrayPoints()` flags `origin` points (at/near
(0,0), or non-finite) and `jump` points (far from both neighbours). The jump test
needs an absolute floor as well as a relative one: a comma whose points are 0.2mm
apart and whose tail travels 3mm is a 15× jump by the relative measure, and
offering that for deletion would be worse than missing a candidate the user can
still click by hand.

**Known limitation:** a stroke already exported to the LogSeq graph keeps its
uncorrected geometry there. `mergeGraphStrokes()` dedupes by stroke id and lets the
existing published copy win, so a re-export is a no-op. Correcting a published
sketch would need a deliberate overwrite path in `graph-export.js`.

**New:** `src/lib/point-edit.js`, `src/stores/point-edit.js`,
`src/components/canvas/PointEditPanel.svelte`,
`src/lib/__tests__/point-edit.test.js`.
**Edited:** `stores/strokes.js`, `stores/pending-changes.js`, `stores/index.js`,
`lib/canvas-renderer.js` (point handles, `hitTestPointHandle`,
`findPointHandlesInRect`, `centerOnPoint`, the page-label asterisk),
`lib/storage/save-page.js`, `lib/storage/page-changes.js`,
`components/canvas/StrokeCanvas.svelte`,
`components/dialog/SaveConfirmDialog.svelte`, `components/header/ActionBar.svelte`,
`save-page.test.js`, `pending-changes.test.js`, `page-changes.test.js`.

### Pending-changes `modifications` — flag-only edits are reported (August 2026)

**The dirty-state diff grew a third category.** It classified each canvas stroke
as an *addition* or a *deletion*, which was the whole story until sketch strokes
introduced a per-stroke flag the user toggles **after** a stroke is already on
disk. That edit is neither: the stroke count doesn't move, but
`savePageToFolder()` does sync the flag onto the stored stroke, so it is genuinely
unsaved work. It was reported nowhere except the header's amber dot — no `*` on
the canvas page label, no row in the SaveConfirmDialog, undercounted in
`getPendingChangesSummary()`. Data was never at risk (`setStrokesSketch()` calls
`markUnsavedChanges()`, so the beforeunload prompt fired); it was purely a
reporting gap.

**What landed:**
- **`onDiskStrokeIds` now carries state, not just ids** — `pageKey →
  Map<strokeId, {sketch}>` (was `Set<strokeId>`). The perf #3 constraint is
  unchanged and still the reason this index exists: entries are flag-sized
  records, never strokes, so the corpus stays off the heap. `points` is what
  makes strokes expensive and geometry is immutable under append-only, so there
  is nothing to diff there — **keep any future field in this record similarly
  small.** Lazy populate on canvas entry / evict on canvas exit via the
  `canvasPageKeys` subscription is untouched. `noteOnDiskStrokeIds()` keeps its
  signature; both callers (`load-page.js` import, `save-page.js` post-save)
  already held the stored strokes.
- **`computePendingChangesMap()` emits `modifications: number[]`** — stroke
  indices whose id IS on disk but whose sketch flag differs from the stored
  value. **Counted once:** a stroke that is both new and flagged is an addition
  only, since saving writes the stroke and its flag together. A page unknown on
  disk reports no modifications (nothing to differ from), and a stroke marked for
  deletion is excluded from the flag diff. `sketch` is absent rather than `false`
  when off, on disk and on the canvas, so the comparison is boolean-normalised at
  both ends.
- **Threaded through every consumer** — `hasPendingChanges`,
  `getPendingChangesSummary()` (new `totalModifications`; a modification-only page
  now counts toward `pagesWithChanges`), and the `*` label in
  `drawPageBorders()`.
- **`page-changes.js` too** — SaveConfirmDialog does **not** read
  `pendingChanges`; it runs its own diff against the PageDoc on disk via
  `computePageChangesFolder()`. That is a second implementation of the same
  question and needed the same third category, so it returns
  `strokeModifications` (and the error fallback reports `0`). The dialog shows a
  "Restyling: ~N strokes" summary tile and a per-page "✏️ N restyled" stat, and
  its change filter includes modification-only pages so they are selectable and
  actually get saved. `strokeTotal` is unaffected — a flag toggle doesn't change
  how many strokes a page holds.

**Tests:** `pending-changes.test.js` extended (flag on, flag off, absent-vs-false,
matching flag, new-and-flagged counted once, unknown page, deleted stroke,
mixed page, modification-only page enters the map). New `page-changes.test.js`
covers the dialog's diff path, which had no tests at all.

**Edited:** `src/stores/pending-changes.js`, `src/lib/storage/page-changes.js`,
`src/lib/canvas-renderer.js`, `src/components/dialog/SaveConfirmDialog.svelte`,
`src/stores/strokes.js` (stale doc comment on `setStrokesSketch`).

### Sketch strokes — pressure-varying line thickness (August 2026)

**Strokes can be flagged as "sketch" and render with a thickness that follows the
pen force recorded at each point**, rather than one uniform width per stroke.
Handwriting is unaffected and keeps the cheap single-path render.

**The bug this uncovered.** `canvas-renderer.js` assigned `ctx.lineWidth` inside
its `moveTo`/`lineTo` loop. Canvas2D reads `lineWidth` once, at `stroke()` time,
and applies it to the whole path — so the assignment did nothing except leave the
last value in effect, and *every stroke rendered at the width implied by its final
dot's pressure*. The same pattern was in `drawPastedStroke` and
`drawStrokeInternal`. `addDot()` (live capture) stroked each segment separately so
it genuinely did vary, which is why live writing and re-render disagreed. All four
paths now go through explicit, deterministic width handling.

**Storage.** Pressure was previously discarded at the storage boundary
(`strokeToStored` wrote `[x, y, ts]`; load injected a constant). Point tuples are
now `[x, y, ts|null, force]` — variable length, so 2- and 3-element tuples from
existing files still read. Force is written for **every** stroke, not just flagged
ones: flagging happens long after capture, so conditional pressure would make
marking a stroke later silently produce a flat line. `PAGE_DOC_VERSION` stays
`"2.0"` — both additions are backward/forward compatible and bumping it would make
`validatePageDoc()` reject every file on disk. Pages saved before this render at a
constant `flatWidth`; `seriesHasVariation()` detects them (an unvarying force
series is not real data) and `widthsForStrokeSeries()` is the single definition of
that fallback, shared by the canvas and both SVG paths.

**The mapping** (`src/lib/sketch-width.js`, pure, 51 tests) is a pipeline:
normalise against a user-calibrated `pressureFloor`/`pressureCeil` band → smooth →
shape by `gamma` → scale into `minWidth`…`maxWidth` → slew-limit.
- `minWidth`/`maxWidth` are the brush-vs-pen control: a narrow band reads as a
  technical pen, a wide one as a brush.
- `gamma` is the response character: `<1` broadens readily (brush), `>1` stays thin
  until pressed hard (pencil). Exposed in the UI as a Brush↔Pencil slider.
- **Spike suppression** needed its own mechanism. Clamping `maxWidth` only caps how
  fat a jab gets, not how abrupt it is. `smoothSeries()` is a *symmetric* moving
  average (a trailing EMA would make the taper visibly lag the pen path) and
  `limitSlew()` bounds the per-point rate of change, running forward then backward
  so both flanks of a spike are bounded.
- Calibration is user-settable because the pen's real force range is not
  documented anywhere trustworthy — the SDK reads it as a 16-bit short and the
  historical code divided by 500 on what looks like a guess.

**Rendering.** Variable width means splitting the polyline: both Canvas2D and SVG
apply one width per path. `strokeVariableWidth()` (canvas) and
`strokeToWidthRuns()` (SVG) batch consecutive segments whose widths quantise to the
same value into one run; runs share boundary vertices and round caps join them
seamlessly. This collapses a 50-dot stroke from 49 draw calls to a handful. Widths
are cached per stroke, tagged with `profileKey()`, so dragging a slider restyles
the canvas live and anything else reuses. Deleted/decorative sketch strokes fall
back to the uniform path — dash patterns restart per sub-path, so a dashed
variable-width stroke would come out as uneven stipple, and the dash is the more
important signal there.

**Deliberately not done:** no live sketch preview. Strokes aren't flagged until
after they're drawn, so live capture has nothing to consult; it draws at the
uniform handwriting width and flagging changes appearance on the next render.

**Reported as a modification** (was a known gap; closed — see "Pending-changes
`modifications`" below). Toggling the flag on an already-saved stroke is a real
unsaved change that is neither an addition nor a deletion, so the diff grew a
third category rather than mislabelling it as one of the other two.

**Cross-repo:** exported LogSeq assets now carry pressure and the sketch flag
(asserted in `graph-export.test.js`), but the JPI Tools plugin's SVG generator
needs a matching change or graph renders stay flat.

**New:** `src/lib/sketch-width.js`, `src/stores/sketch.js`,
`src/components/settings/SketchStyleSettings.svelte`, and tests
`sketch-width.test.js`, `sketch-store.test.js`, `canvas-renderer-sketch.test.js`,
`save-page.test.js`.
**Edited:** `canvas-renderer.js`, `storage/page-doc.js`, `storage/save-page.js`,
`storage/load-page.js`, `stroke-storage.js`, `viewer/page-svg.js`,
`stores/strokes.js`, `stores/index.js`, `components/canvas/StrokeCanvas.svelte`,
`components/viewer/PageSpreadView.svelte`,
`components/header/SettingsDropdown.svelte`, `stroke-storage.test.js`,
`page-svg.test.js`, `graph-export.test.js`.

### Copy transcript from the canvas (July 2026)

Copying a transcript for LogSeq used to be possible only in Book View's
`TranscriptPane`, so a page loaded in the Editor had no copy path. The canvas
**text view** (`📝 Show Text`) now offers the same copy:

- **Per-page button** — `renderTranscribedText()` in `StrokeCanvas.svelte` now
  collects `renderer.getPageBoundsScreen(pageKey)` for every page whose text
  actually rendered into `textPageOverlays`, and the markup positions a faint
  `📋 Copy` button (`.page-copy-btn`) in each page's top-right corner. Positions
  are recomputed on every paint, so they follow pan/zoom/page layout; overlays
  are dropped when leaving text view.
- **Header button** — `📋 Copy Transcript` copies every page currently rendered
  in text view (`pagesToLogseqMarkdown`: a single page pastes bare, several nest
  under `- {book} · P{page}` parent bullets).
- **Line source** — MyScript results already carry structured `lines`; saved
  pages are metadata-only records, so `resolveTranscriptLines()` lazily reads the
  PageDoc via `getCachedPage(book, pageId)` (suffix-safe) to get indent levels
  and TODO/DONE state, falling back to `textToTranscriptLines()` on the rendered
  text if neither is available.

**Edited:** `src/lib/viewer/transcript-markdown.js` (new `indentMarkdownBlock`,
`textToTranscriptLines`, `pagesToLogseqMarkdown`),
`src/components/canvas/StrokeCanvas.svelte`,
`src/lib/__tests__/transcript-markdown.test.js`.

### Clear-canvas fixes (July 2026)

Two bugs that only showed up after using **Clear** and then importing again.

- **Stale "In canvas" state.** `importStrokesFromFolder()` stamped
  `syncStatus: 'in-canvas'` onto the `savedPages` record and nothing ever unset it,
  so the badge stayed lit after the canvas was cleared. Canvas membership is now
  derived (`canvasPageKeys` in `stores/strokes.js`) and surfaced by **greying out
  Import Strokes** instead of a badge — the badge pill squeezed the page title out
  of the card header. `SyncStatusBadge.svelte` deleted (no other users);
  `updatePageSyncStatus()` remains for a future `'unsaved'` state but is
  currently uncalled.
- **Pages piled at the origin.** Page layout (`calculateBounds()` → `pageOffsets`)
  is only recomputed by a full-reset render, whose sole trigger in
  `StrokeCanvas.svelte` was `visibleStrokes.length > previousStrokeCount`. Clear
  didn't reset `previousStrokeCount`, so importing a page with fewer strokes than
  were cleared never counted as "strokes added": the renderer kept the cleared
  pages' offsets, the new page had none, and `getScreenCoords()` fell back to
  global bounds — everything drawn on top of everything else until the user hit
  Reset Layout. The reactive block now detects the canvas emptying (via
  `$strokeCount`, so page-filter toggles keep their existing no-repack behaviour),
  full-resets to drop the stale layout, zeroes `previousStrokeCount` so the next
  import is treated as a first load (layout + auto-fit), and clears
  `liveWritingViewSet` so live writing re-anchors on a fresh canvas.

**Known gap:** `handleClearCanvas()` in `ActionBar.svelte` doesn't clear
`selectedIndices`, so a pre-clear selection still holds raw indices that point at
whatever is imported next.

### v2.3.0 — Export to LogSeq: manual, selective, additive (July 2026)

**Replaced auto-publish-on-save with an explicit stroke export.** The graph copy
is no longer a mirror of the notebook — it is a curated *book of sketches*
containing only what the user chose to publish. The bridge's `stroke-data/`
folder remains the complete digital twin.

**Why:** mirroring every save pushed private notes into the graph and offered no
way to publish just a sketch. The user wants to select strokes, send those, and
add more to the same page later.

**What landed:**
- **`graph-export.js` (new)** — the export policy. **Additive**: every export
  merges into the page's existing graph asset, deduplicated by stroke id, so
  sketches accumulate on a page and re-exporting an overlapping selection is a
  no-op. **Transcript-free**: `transcript.lines` is always emptied and every
  `lineId` cleared — recognised text is exactly the private content selective
  export exists to keep out of the graph (the plugin surfaces it via
  `copySmartpenTranscript`). Multi-page selections fan out to one merge+write
  per page; strokes lacking `pageInfo` are counted as orphans, not dropped.
- **`publish-graph.js` (rewritten)** — now transport only: `readGraphPage()` +
  `writeGraphPage()`. Throws on failure (was best-effort/never-throws) because
  export is now a deliberate action, not a background side-effect.
- **`storage:readGraphAsset` IPC (new)** — additive merge needs to *read* the
  published asset; only `readGraphIndex` existed. Book/pageId validation
  extracted into `requireGraphBook`/`requireGraphPageId` and shared with
  `publishToGraph`.
- **Decoupled from save** — the `publishPageToGraph()` call in `local-store.js`
  `savePage()` is gone, along with the `publishToGraph` setting and its toggle.
  `graphRoot` stays as the export target.
- **UI** — "⇪ LogSeq" button in the canvas export toolbar (uses the same
  `$hasSelection ? $selectedStrokes : visibleStrokes` rule as SVG/JSON/MD), and
  a per-page "⇪ LogSeq" button on `PageCard` for whole-page backfill of pages
  saved before this existed. Both disabled until a graph folder is verified.
- **Region cropping stays in LogSeq** — the plugin renders a sub-region from
  bounds in `{{renderer :smartpen-sketch, …, minX, minY, maxX, maxY}}`, chosen in
  the Visualizer where the result is visible. The bridge only decides *which
  strokes exist* in the graph.

**Also fixed:** `selectRange()` in `stores/selection.js` referenced
`removedIndices`/`sorted` — undefined in that scope, so **every Shift+click range
select threw a ReferenceError**. The block was a copy-paste of the tail of
`adjustSelectionAfterDeletion`; `selectRange` now just sets the anchor to the
range end, and the deletion-shift logic was restored to
`adjustSelectionAfterDeletion`, which had been silently leaving
`lastSelectedIndex` stale after a delete.

**New:** `src/lib/storage/graph-export.js`, `src/lib/__tests__/graph-export.test.js`.
**Edited:** `electron/main.cjs`, `electron/preload.cjs`, `publish-graph.js`,
`local-store.js`, `stores/settings.js`, `stores/index.js`, `stores/selection.js`,
`App.svelte`, `StrokeCanvas.svelte`, `PageCard.svelte`, `GraphFolderSettings.svelte`.

**Supersedes** the June 2026 "Publish to graph" entry below — the asset/index
file format and the plugin contract are unchanged; only *when* and *what* the
bridge writes changed.

### v2.2.0 — Book View transcript editor: ordering fix + editing UX (July 2026)

**Fixed scrambled transcript order on re-transcribe, plus a batch of Book View
transcript-editor improvements.**

**Transcript merge ordering (bug fix):**
- `mergeTranscript()` in `save-page.js` used to re-sort the **entire** merged
  list (existing + new lines) by `yBounds.minY` after appending. That scrambled
  the established order — new MyScript lines interleaved into the existing
  transcript by vertical page position, and any line missing `yBounds` (→ `0`)
  jumped to the top. Now existing lines keep their order untouched; only the
  **new** lines are sorted among themselves and **appended to the end**. New
  transcription always lands at the bottom, matching the "append" mental model.

**Book View transcript editor (`TranscriptPane.svelte`) UX:**
- **Vertical reordering** — move a line up/down via ↑/↓ row buttons or **Alt+↑ /
  Alt+↓**. `saveTranscriptLines()` → `recomputeParentIds()` keeps the hierarchy
  consistent after a reorder.
- **Strokes shown alongside while editing** — clicking **Edit** on a page's
  transcript makes the companion Book View slot show *that same page's strokes*
  for reference. The editor keeps its slot (draft preserved); only the companion
  slot remounts. Works in Single and Spread modes. Coordinated in
  `BookViewer.svelte` via `editingSide` + slot resolution; `PageSpreadView`
  forwards a `onEditingChange` signal up from `TranscriptPane`.
- **Removed the TODO/DONE toggle** from the editor (existing `checked` state is
  still preserved in data and rendered read-only in display mode).
- **Full-width line inputs** — the per-row action group (reorder/indent) now
  floats over the right edge of the input, revealed on hover / `:focus-within`
  with a feathered white backdrop, so text uses the whole row at rest.
- **Add / Delete block moved to the `.tp-toolbar`** — **Delete** acts on the
  focused line (disabled when nothing selected or only one line remains).
  **Add** is always active: adds a **sibling** after the selected block's whole
  subtree, or **appends to the end** when nothing is selected. Toolbar buttons
  use `on:mousedown|preventDefault` so they don't blur the focused line
  (`activeIndex` tracks it).
- **Page-turn arrows confined to `.tp-body`** — in transcript mode `.pv-nav`
  gets a top offset (`.below-toolbar`) so the prev/next arrows no longer overlap
  the toolbar's Edit/Copy/Save buttons.

**Edited:** `src/lib/storage/save-page.js`, `src/components/viewer/TranscriptPane.svelte`,
`src/components/viewer/PageSpreadView.svelte`, `src/components/viewer/BookViewer.svelte`.

### Publish to graph — close the loop with the JPI Tools plugin (June 2026) — SUPERSEDED by v2.3.0

> **Historical.** The auto-mirror-on-save described here was replaced in v2.3.0 by
> the manual, selective, additive **Export to LogSeq** flow. The asset/index file
> format and plugin contract below still apply; the `publishToGraph` setting and
> the `savePage()` hook no longer exist.

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
