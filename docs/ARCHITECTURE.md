# Architecture Reference

Component hierarchy, store inventory and library inventory. CLAUDE.md holds the
rules that must not be broken; this file is the map you look things up in.

## Component Hierarchy
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
│   ├── BooksTab ("Books" — per-notebook aliases + volume routing)
│   └── DatesTab ("Dates" — load the canvas by capture date)
│       └── ActivityGrid (weekday heat grid, drag to select a range)
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
    ├── BookViewer (Book View → Books — read/edit saved pages as a book)
    │   ├── Home grid (recent + collapsible by-book page thumbnails)
    │   └── PageSpreadView ×1–2 (side-by-side spread, page-turn nav)
    │       ├── SVG stroke render (per-page zoom/pan/fit)
    │       └── TranscriptPane (view/inline-edit lines, copy LogSeq markdown)
    └── TimelineFeed (Book View → Timeline — the Dates range as a scrolling feed;
        │             grows the range as you scroll off its end)
        ├── BookFilterMenu (which notebooks count — also in the Dates tab)
        └── FeedDay ×N (one per day with ink; loads its pages when near)
            └── FeedCard ×N (one sitting — any number of pages)
                └── FeedPart ×N (one page's share: strips ⇄ whole page)
```

The right-hand pane toggles between the **Editor** (`StrokeCanvas`) and **Book View**
via a segmented control in the top bar (`App.svelte`). Book View has two modes,
**Books** (`BookViewer`) and **Timeline** (`TimelineFeed`), switched by a second
segment beside it (`bookViewMode`). Books' global controls (Home ·
Strokes/Transcript · Single/Spread) live in that same top bar and drive the bound
`BookViewer` instance; each page's toolbar has a **Load into Editor** action that
imports that page's strokes into the Editor canvas and switches to it. Timeline's
one global control is the Newest/Oldest-first toggle (`feedOrder`).

**Left panel tabs.** Tab *ids* are unchanged from the pre-v2.7 nested version
(`'strokes'`, `'transcription'`, `'saved-pages'`, plus `'books'` and `'dates'`)
even though two labels differ — `ActionBar` calls `setActiveTab('transcription')`
after a transcription run.

**Two searches, deliberately separate.** `CanvasSearch` (panel header) searches
only pages already loaded and *pans* to one — <kbd>Ctrl+F</kbd>. `TranscriptSearch`
(left panel) searches every saved page on disk to decide what to *load* —
<kbd>Ctrl+Shift+F</kbd>, or `openTranscriptSearch()`.

**Three resets, deliberately distinct.** `Reset View` (bottom bar) is zoom/pan.
`Page Resets ▾` holds `Reset Layout` (dragged page positions) and `Reset Sizes`
(page scaling). The bottom-bar button was labelled just "Reset", which read as if
it covered all three.

## State Management (Svelte Stores)

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
  - **Timeline feed (v2.9):** `bookViewMode` (`'books' | 'timeline'`) + `setBookViewMode()`,
    `feedOrder` (`'newest' | 'oldest'`, default newest) + `setFeedOrder()`/`toggleFeedOrder()`
    — both persisted to localStorage as per-viewer conveniences. `feedVisible` (derived:
    Book View *and* Timeline). `feedDayInView` (scroll-spy — the day key heading the
    feed's viewport) and `feedJumpRequest` + `requestFeedJump(day)` (a counter, like
    `transcriptSearchFocus`, so asking for the same day twice scrolls twice) — both
    session-only; the Dates tab reads the first and writes the second

**Sketch Strokes (v2.4):**
- `sketch.js` — the pressure → thickness render profile (`sketchProfile`, `sketchPresetName`, `sketchPresets`, `sketchProfileSummary`, `applySketchPreset()`, `updateSketchProfile()`, `resetSketchProfile()`). Persisted to localStorage: it's a *display* preference, so it restyles every sketch at once and never touches disk. Any manual edit clears the preset name (showing "Brush" as active after its numbers changed would lie).
- `strokes.js` also owns the flag itself — `sketchStrokeCount` (derived), `setStrokesSketch()` / `markStrokesAsSketch()` / `unmarkStrokesAsSketch()`. Flagging marks the session dirty (the flag lives in the PageDoc) and drops the renderer's cached `_sw` width array.

**Volumes (v2.6):**
- `volumes.js` — capture routing for physical notebooks that share an NCode book id. `volumeRegistry` (`{version, active: {ncodeBook: volume}}`, persisted to `<dataRoot>/pages/_volumes.json`), `activeVolumeFor()`, `applyActiveVolume()` (the single pen→app boundary; **idempotent** — a pageInfo that already carries `volume` is returned untouched, so re-adding an imported stroke can't demote it), `loadVolumes()`, `setActiveVolume()`, `volumesForBook()`
- `strokes.js` also owns reassignment — `reassignVolume(indices, volume)` rewrites `pageInfo.book` to the target book key, clears `blockUuid` (the transcript line belongs to the *source* page) and stamps the in-memory `movedFrom` marker; `clearMovedFromMarkers(book, page)` drops it after the source page saves
- `pending-changes.js` — `getMovedAwayStrokeIdsForPage()` and the `moves` category (see below)

**Dates / capture-date loading (v2.8):**
- `timeline.js` — the capture-date index and the selected span. `timelineIndex`
  (raw index), `timelineRange` (`{from, to}` local day keys), `timelineDays`
  (derived, every day with ink), `timelineSummary` (what loading the range would
  bring in), `timelineRangeDays` (the day list with its page chips),
  `timelineRangeExtent`, `loadTimeline()`, `setTimelineRange()`, plus
  `canvasPageOrder` (`'book' | 'date'`) and `setCanvasPageOrder()`.
  The index is histograms, not strokes (~60KB for a 290-page corpus), so unlike
  the page scan there is no reason to keep it off the heap.
  **Book filter (v2.9):** `timelineExcludedBooks` (a `Set` of book keys, stored as
  *exclusions* so a new notebook appears without being ticked; localStorage),
  `setBookIncluded()`/`includeAllBooks()`/`includeOnlyBook()`, `timelineBooks`
  (every book with its in-range strokes — the menu's rows) and
  `timelineIndexFiltered`. **Every derived store above reads the filtered index**,
  and so must any caller passing `index:` to a date load — that is what keeps the
  grid, tallies, feed and Editor loads agreeing. `timelineIndex` stays raw (the
  book list needs every book)
- `context-ink.js` — `contextInk`: strokes the canvas DRAWS but does not own.
  A date load puts only in-range strokes in `strokes`; the rest of each touched
  page lands here and renders halftoned. Kept out of `strokes` deliberately, so
  the index-keyed stores (`selectedIndices`, `deletedIndices`, point-edit keys)
  cannot be thrown off by it and it can never be selected, saved, exported or
  transcribed. It IS counted in the renderer's page-bounds pass, so a partially
  loaded page keeps its real size. `addContextInk()` (merges by id, drops
  anything already live), `pruneContextInk()`, `removeContextInkForPage()`,
  `clearContextInk()`

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

## Key Libraries

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
- `timeline.js` - **Capture dates** (pure). Interprets the index built in
  `main.cjs`. Two units that are NOT interchangeable: a **day key**
  (`"YYYY-MM-DD"`, a LOCAL calendar day — string comparison is the range test)
  and a **timestamp** (epoch ms, what `startTime` is). `rangeBoundsMs()` is the
  only converter and returns a **half-open** `[startMs, endMs)`; the loader
  filters strokes on those numbers rather than deriving a day key per stroke.
  Also `dayKey`/`dayStart`/`addDays`/`eachDay`/`inRange`, `dayTotals`,
  `timelineExtent`, `pagesInRange` (splits each page into in-range vs context
  strokes; `firstDay` is the earliest day *inside* the range), `rangeSummary`,
  `pagesOnDay`, and the book filter's `filterIndexByBooks()` (returns the same
  object when nothing is excluded) and `indexBooks()` (book-key order)
- `transcript-search.js` - Full-text search across transcriptions
- `timeline-feed.js` - **Timeline feed** (pure). `feedSkeleton()` (days with ink in a
  range, from the index alone, plus one `empty` entry per run of blank days between
  them; newest first by default), `daySessions()` (one day's strokes across every page
  it touched, sorted by `startTime` and chained into **sessions** — a card — for as
  long as each stroke starts within `SESSION_GAP_MS` = 20 min of the previous one's
  *end*. **Not** cut on a page change: a session carries `parts`, one per page in the
  order first written on. Sessions and parts hold doc stroke **objects**, not ids),
  `extendFeedRange()` (the range grown by the next N days with ink toward the end the
  feed scrolls to — endless scroll), `indexPageStrokes()`
  (per-stroke Y extent + the card frame, at least `PAGE_MIN_WIDTH`×`PAGE_MIN_HEIGHT`
  so handwriting is one size across cards), `sessionBands()` (the strips a collapsed
  part shows: ink clustered vertically, blank page > `BAND_MERGE_GAP` cut out),
  `sessionBand()`, `nextFeedRange()`, `estimateDayHeight()`, `formatDuration()`.
  Stray Ncode-origin points are ignored for extents (`ORIGIN_TOLERANCE` from
  `point-edit.js`) — one would stretch a strip to the top of the page

**Storage Layer (`src/lib/storage/`)** — v2.0:
- `page-doc.js` — PageDoc schema types, `emptyPageDoc()`, `computeBounds()`, `validatePageDoc()`
- `page-doc-format.js` — hybrid pretty/compact serializer (document shell pretty-printed; each stroke on one line)
- `local-store.js` — renderer-side facade over `window.storageAPI` IPC: `listPages`, `getPage`, `savePage`, `deletePage`, alias CRUD, `pickFolder`, `isAvailable`, `openInExplorer`. **`savePage()` is the single choke point all PageDoc writes funnel through.** It does NOT publish to the LogSeq graph — that was removed in v2.3 (see `graph-export.js`)
- `save-page.js` — `savePageToFolder()` — append-only stroke merge with explicit deletions, Y-bounds-based transcript merge with checkbox preservation
- `graph-index.js` — pure helpers for **Export to LogSeq**: `smartpenAssetName()`/`smartpenAssetRelPath()` (the `smartpen-B{book}-P{pageId}.json` asset convention), `buildSmartpenIndexEntry()`, `upsertSmartpenIndex()`, `emptySmartpenIndex()`. Mirrors the JPI Tools plugin's `tools/migrate-smartpen-assets.mjs` index logic (plugin spec §4.6/§6.1). Identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
- `publish-graph.js` — graph **transport only**: `readGraphPage(book, pageId)` (the published asset, or null) and `writeGraphPage(book, pageId, doc)` (asset via `serializePageDoc` + `smartpen-index.json` upsert, both atomic via IPC). **Throws on failure** — export is a deliberate user action, so errors surface. No LogSeq runtime dependency (pure filesystem). Does *not* decide what to publish
- `graph-export.js` — **what** to publish. Pure core (`stripTranscriptRefs`, `mergeGraphStrokes`, `resolveGraphPageInfo`, `buildGraphPageDoc`, `groupCanvasStrokesByPage`) + facades `exportSelectionToGraph(canvasStrokes)` (fans out one merge+write per page in the selection) and `exportPageDocToGraph(book, pageId, doc)` (whole-page backfill). Two invariants: **additive** (merge into what's already published, dedupe by stroke id — re-exporting is a safe no-op) and **transcript-free** (`transcript.lines` emptied, every `lineId` cleared). Tested in `graph-export.test.js`
- `load-page.js` — `importStrokesFromFolder()`, `importStrokesForLoadedPagesFromFolder()` — converts StoredStroke → canvas dotArray format. `canvasPageInfoFor()` + `storedStrokesToCanvas()` are split out so a caller can convert a **subset** of a page against one shared `pageInfo` (what a date-range load needs); `mergeCanvasStrokes()` is the dedupe-by-id merge
- `load-range.js` — `importDateRangeFromFolder()` — stroke-level date filtering. Splits each touched page into in-range strokes (→ `strokes`) and the rest (→ `contextInk`). Primes `noteOnDiskStrokeIds` from the page's **full** stored list, so a partial load reports nothing pending. Merges into the canvas rather than replacing it. `importSessionFromFolder({pages, startMs, endMs})` (v2.9) is the same split over a `[startMs, endMs)` window on a sitting's pages — a Timeline card's Load into Editor; both share the private `importWindow()` core. `LARGE_LOAD_STROKES` (12,000) is the second-confirmation threshold shared by the Dates tab and the feed
- `scan.js` — `scanLocalPages()` + `metaToRecord()` (pure, tested) — populates the `savedPages` store from disk. **Metadata-only (perf #3):** records carry summary fields ONLY (`strokeCount`, `lastUpdated`, `transcriptionText`, `transcribed`, `transcriptLineCount`, `pageId`/`suffix`) — never `strokes`/`pageDoc`/`strokeData`, so the corpus never stays resident; each page's strokes load lazily on view. Records load by `pageId`, so letter-suffixed variants (`P127.json` + `P127b.json`) don't collapse onto the integer page. (`main.cjs listAllPages` → `extractPageMeta` parses just the doc shell, skipping the strokes array, so the scan is fast; the tiny `transcriptionText` rides along to power search/preview without loading strokes.)
- `page-changes.js` — `computePageChangesFolder()` — preview diff for the SaveConfirmDialog. Reads the PageDoc off disk rather than the `onDiskStrokeIds` index, so it is a **second implementation** of the `pendingChanges` question and has to stay in step with it — it returns `strokeAdditions`/`strokeModifications`/`strokeDeletions` on the same rules

**Book View Layer (`src/lib/viewer/`)** — v2.1:
- `page-svg.js` — `computeStrokeBounds()`, `strokeToPathD()`, `generateThumbnailSVG()` — SVG render for the spread pages + home-grid thumbnails (`NCODE_SCALE = 2.371`). Also `strokePointPressures()` + `strokeToWidthRuns()` for sketch strokes: SVG applies one `stroke-width` per `<path>`, so a pressure-varying line is emitted as consecutive constant-width runs (thumbnails stay flat — too small to matter)
- `feed-pages.js` — `createFeedPageLoader(load)` — the Timeline feed's **ref-counted** PageDoc holder: `acquire()`/`release()`/`clear()`/`size()`. Pages are shared across days (most hold ink from several), so a page is read once while any loaded day needs it and forgotten when the last lets go; a failed read is forgotten so the next acquire retries. Deliberately not `page-cache.js` — one busy day would evict the Books spread's six docs
- `page-cache.js` — small LRU (`getCachedPage`/`invalidatePage`/`clearPageCache`, MAX 6) over full PageDocs. Book View loads strokes lazily through this (records no longer embed them, perf #3) so turning a spread doesn't re-read disk; older docs are evicted. Keyed by `B{book}/P{pageId}` (suffix-safe)
- `transcript-markdown.js` — `linesToLogseqMarkdown()` — tab-indented `- ` bullets with `- TODO`/`- DONE` markers; `key:: value` property lines stripped (LogSeq-pasteable copy). Also `indentMarkdownBlock()`, `textToTranscriptLines()` (flat-text fallback) and `pagesToLogseqMarkdown()` (multi-page payload: one page copies bare, several nest under `- {label}` bullets) — used by the canvas text-view copy
- `save-transcript.js` — `saveTranscriptLines(book, pageId, lines)` — writes inline transcript edits back to the PageDoc verbatim (getPage → replace `transcript.lines` → scrub deleted `lineId`s on strokes → `savePage`); `recomputeParentIds()` keeps the hierarchy consistent after indent edits

## Transcription Result (in-memory)

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
