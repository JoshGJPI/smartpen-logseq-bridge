# Architecture Reference

Component hierarchy, store inventory and library inventory. CLAUDE.md holds the
rules that must not be broken; this file is the map you look things up in.

## Component Hierarchy
```
App.svelte (Root)
├── Header (one 44 px row: name, `nav` slot = Library | Timeline | Editor from App, search, Unsaved marker)
│   ├── SearchField (global search, Ctrl K: words, dates, notebooks, tags)
│   │   └── SearchResults (Tags / Pages / Notebooks / Days; Enter opens, Shift+Enter → Editor)
│   ├── TasksButton (v3.4.0: Tasks + open-task count → Library › Tasks)
│   ├── PenChip (pen state + battery; Connect / Disconnect; while connected, the dot + name open PenMemoryDialog)
│   ├── ActionBar (capture bar: Fetch, Save, Delete, Undo, Clear, Transcribe; always
│   │   mounted, `visible` from `lib/capture-bar.js`)
│   └── SettingsDropdown (gear, warning dot when the data folder is not ready; MyScript, Data Folder,
│       │                 Notebooks (folds, state remembered), Graph Folder, Troubleshooting)
│       ├── BooksTab (Settings → Notebooks: per-notebook aliases + volume routing)
│       ├── ConvertTaskBoxesDialog (Data Folder → Convert task boxes…: preview, then write; v3.3.0)
│       └── ActivityLogDialog (Troubleshooting → 🩺, filter by level + copy)
├── LeftPanel (contextual tabs — see "Left panel tabs" below; folds to a 48 px rail, `stores/left-panel.js`)
│   ├── LibraryContents ("Contents", Library — notebooks and pages from the scan, ● = transcribed)
│   ├── StrokeList ("Strokes", Editor — browse by book/page)
│   ├── TranscriptsPanel ("Transcripts", every destination)
│   │   ├── TranscriptionView (Review — incoming MyScript results)
│   │   └── TranscriptSearch (Search — full-text over saved pages on disk)
│   │       └── SearchResultCard (per-result import / open in the Library)
│   ├── SavedPagesTab ("Pages", Editor — folder-backed page list: import, export, edit structure)
│   └── DatesTab ("Dates", Timeline and Editor — range by capture date; load onto canvas in the Editor)
│       └── ActivityGrid (weekday heat grid, drag to select a range; Editor only — the Timeline has the strip)
└── Canvas Section (destination from `$destination`, in App.svelte)
    ├── PaneToolbar (Library and Timeline only: breadcrumb + ViewMenu "View ▾")
    │   └── SpreadToolbar (open Library page or page grid: Book | Tag order (when there is a sequence) ·
    │                      Go to page · − % + Fit for both pages)
    ├── StrokeCanvas (Editor — live capture/edit)
    │   ├── panel header: Select All · Deselect · CanvasSearch · stroke count
    │   ├── top toolbar: Decorative · Duplicate · Edit Points · Volume ▾ ·
    │   │                Text · Copy · Page Resets ▾
    │   ├── bottom bar: zoom · Fit · Reset View · Sketch · Unmark ·
    │   │               SketchStylePopover · PageSelector · Export ▾
    │   ├── Canvas Renderer (Drawing engine)
    │   ├── PointEditPanel (Edit Points mode — stray-point list + delete)
    │   └── FilteredStrokesPanel (Decorative strokes)
    ├── BookViewer (Library — read/edit saved pages as a book; ←/→ turn pages through `readingList`)
    │   ├── LibraryBrowse (no page open: picks the home, a notebook's grid, a tag's grid, the queue or Manage tags)
    │   │   ├── LibraryHome (Recent pages row, the Tasks card, then notebook cards or, grouped by Tag, tag cards)
    │   │   │   ├── TasksCard (v3.4.0: open / waiting / done counts, three newest open tasks → Tasks)
    │   │   │   ├── LibraryHomeHead (summary, Group by Notebook | Tag, sort chips, Suggestions (n), Manage tags, Rescan)
    │   │   │   ├── NotebookCard ×N (fan of 3 recent pages, name, Vol badge, pages, written, transcribed %)
    │   │   │   └── TagCardGrid (Projects / Keywords headings) → TagCard ×N + dashed Untagged card
    │   │   ├── NotebookPages (a notebook's page grid; `libraryNotebook`) → PageGrid
    │   │   ├── TagPages (a tag's pages, or the Untagged pages, across notebooks; `libraryView`) → PageGrid
    │   │   │   PageGrid = TagFilterRow (tags in this grid, Any | All) · Select → BulkTagBar ·
    │   │   │              PageTile ×N (date badge, ✓, tag line, hover "+ tag" popover, amber suggestion dot)
    │   │   ├── TagSuggestionQueue (suggested project numbers by number: Tag all n, Dismiss all, Re-check)
    │   │   ├── TagManagerView (Library › Manage tags, `{kind: 'tags'}`)
    │   │   │   └── TagManager (Undo bar; tag / pages / notebooks, headers sort; chip opens the tag; Rename, Merge into…, Delete; reset dismissals)
    │   │   └── TasksView (v3.4.0, Library › Tasks, `{kind: 'tasks'}`: Open / Waiting / Done / All, Group by)
    │   │       └── TaskRow ×N (TaskBox · text · under "parent" · page link · date written · project chip · TaskMenu ⋯)
    │   │   (PageThumb: lazy thumbnail via lib/viewer/thumbs.js; also in the fan, Recent row, search)
    │   ├── TaskToast (v3.4.0: "Marked DONE · B3017 p.142  Undo", for the Tasks view and the reader)
    │   └── ReaderSpread (the open page or spread; split out of BookViewer in v3.2.0)
    │       ├── ReaderTagsLayout (wraps the spread; a container query folds the strip into a bar under 900px)
    │       │   └── PageTagsStrip (P12 | P13 · TagInput: chips + type-ahead · Suggested from transcript ✓ ✕)
    │       └── PageSpreadView ×1–2 (one page: header + Strokes | Transcript | Ink + text)
    │       ├── PageHeader (title, strokes, written-on date / day chips, Load into Editor icon)
    │       ├── PageInk (SVG render, per-page zoom/pan/fit, refit on resize)
    │       │   ├── PageTurnButtons (‹ › edge strips over the ink)
    │       │   ├── OrientationControl compact (page corner)
    │       │   ├── SittingInk (highlighted day / line redrawn in ink, inside the SVG)
    │       │   └── SittingHover (hover hit-test + capture-time label; click → that day's Timeline)
    │       └── TranscriptPane (inline edit, copy LogSeq markdown)
    │           └── TranscriptLines (read view, line → ink hover, empty state; task markers are
                                TaskBox glyphs + TaskMenu, v3.4.0)
    └── TimelineFeed (Timeline — the Dates range as a scrolling feed;
        │             grows the range as you scroll off its end)
        ├── TimelineHead (‹ RangeMenu › · summary · BookFilterMenu · Load range into Editor)
        │   ├── RangeMenu ("Range ▾": From / To, Latest day · 1 · 7 · 30 days)
        │   └── ActivityStrip (every day with ink; the range as a draggable window)
        └── FeedDay ×N (one per day with ink; loads its pages when near; ⋯ = Load day)
            └── FeedCard ×N (one sitting — any number of pages; ⋯ = Load sitting)
                └── FeedPart ×N (one page's share: Open page + ⋯ (Whole page ⇄ strip))
                    (OverflowMenu is the shared ⋯ list, position: fixed)
```

**Destinations (v3.0 package C).** The right pane is one of three destinations,
**Library** (`BookViewer`), **Timeline** (`TimelineFeed`) and **Editor**
(`StrokeCanvas`), chosen in the header. They are a view over the two store fields
that existed before (`lib/navigation.js`: library = `viewerMode 'book'` +
`bookViewMode 'books'`, timeline = `'book'` + `'timeline'`, editor = `'editor'`,
which leaves `bookViewMode` as it was), exposed as the derived `destination`.
Every route between them goes through **`navigateTo(dest)`** (`stores/viewer.js`),
which asks "Discard transcript edits?" when leaving for anything but the Library
with `viewerDirty` set; opening a particular page goes through
`openPageInLibrary(book, pageId)` (feed **Open page**, search results, the contents
list). Unsaved strokes never prompt. `showEditorForLiveInk()` keeps its own rule.

Over the Library and the Timeline sits **PaneToolbar**: a breadcrumb (Library ›
notebook › P12–P13; "Library" goes back to the notebook cards, the notebook crumb to
that notebook's page grid) and **View ▾**, which
offers only what applies (`lib/pane-toolbar.js` `viewOptionsFor`): Strokes |
Transcript | Ink + text, Spread | Single and **Times** (hover-to-reveal capture time,
`sittingHoverEnabled`) for an open page, **Paper** where any book has paper,
Newest | Oldest in the Timeline (`feedOrder`). Spread/Single and
Strokes/Transcript drive the bound `BookViewer` instance, whose `guardNav()`
asks before dropping edits. The Editor has no pane toolbar. With a page open the
toolbar also holds **SpreadToolbar** (Go to page, shared zoom); the crumb reads
"P26–P27 of 13". Each page's header has the written-on chips (hover = that day's
ink, click = that day in the Timeline) and **Load into Editor** (package D). Hovering ink in Times mode draws the day it was
written in black, the rest grey, with the date and time; clicking opens that day
in the Timeline (`SittingHover` + `SittingInk`, `page-sittings.js`), guarded by
`navigateTo`.

The Timeline's head says the range and its summary once: **Range ▾**
(`lib/timeline-range.js` presets), the activity strip (drag the window to move,
an edge to resize, across the strip to pick; set on release), the book filter and
a quiet **Load range into Editor**. Cards show **Open page** and ⋯ (Whole page,
Load sitting into Editor); a day's ⋯ holds Load day into Editor.

The app opens on the **Timeline** with the **Dates** tab on the left (range
fields and the day list; the heat grid shows only in the Editor's Dates tab), showing the most recent day with ink
(`loadTimeline()` defaults an unset range to the index's last capture day), rather
than an empty Editor canvas. Live pen ink switches the pane to the Editor
(`pen-sdk.js` → `showEditorForLiveInk()`, once per stroke) unless the Library has
unsaved transcript edits; then it stays put, logs a warning, and the strokes are
still captured.

**Collapsible left panel (v3.0 package B).** `leftPanelCollapsed` (`stores/left-panel.js`, localStorage, a missing, corrupt or blocked value means expanded) folds the panel to a 48 px rail: expand chevron, one icon per tab (click = `revealLeftPanel(tab)`), the Transcripts badge. `App.svelte` adds `panel-collapsed` to `.main-grid` (`48px 1fr`) and handles the `[` key (`isPanelToggleKey()` in `lib/left-panel.js`). Tab content is *not mounted* while collapsed. Callers that mean "show me the panel" use `revealLeftPanel()` (`ui.js`: `openTranscriptSearch`, `openTranscriptReview`); passive callers keep `setActiveTab()` so a collapsed panel stays collapsed. `.app` has no max width: every destination fills the window (the Editor kept a 1600 px cap until the v3.0.0 pre-release review).

**Left panel tabs (contextual since v3.0 package C).** The tabs follow the
destination (`lib/left-panel.js` `CONTEXT_TABS`): Library → Contents ·
Transcripts; Timeline → Dates · Transcripts; Editor → Strokes · Transcripts ·
Pages · Dates. Transcripts is in every set because search opens there from any
view. `panelTab` (`stores/ui.js`, derived) shows `activeTab` when it belongs to
the current set and the set's first tab otherwise, so nothing is rewritten when
you move. Tab *ids* are unchanged from the pre-v2.7 nested version
(`'strokes'`, `'transcription'`, `'saved-pages'`, `'books'`, `'dates'`, plus
`'contents'`); `ActionBar` calls `setActiveTab('transcription')` after a
transcription run. `'books'` is in no set: notebook names and volume routing are
in Settings → Notebooks (the same `BooksTab` component). Pages and Dates stay
with the Editor because they load onto the canvas, and the Pages cards carry
Export to graph, Edit structure and Reset transcript.

**Three searches, deliberately separate.** `CanvasSearch` (panel header) searches
only pages already loaded and *pans* to one — <kbd>Ctrl+F</kbd>, Editor only.
`TranscriptSearch` (left panel) searches every saved page on disk to decide what to
*load* — <kbd>Ctrl+Shift+F</kbd> on the canvas, or `openTranscriptSearch()`. The
header's `SearchField` (v3.0 package E) is for *reading*: words, dates and notebook
names, from any destination — <kbd>Ctrl K</kbd> (`isSearchShortcut`: never while
typing or with a transcript in edit mode). Its index is built once per scan
(`stores/library.js` `globalSearchIndex`).

**Library home (v3.0 package E).** With no page open the Library shows the notebook
cards (`LibraryHome`) or, when `libraryNotebook` is set, that notebook's page grid
(`NotebookPages`). Card numbers come from the scan records and the unfiltered
capture-date index (`notebookCardList`), never from a page read; only on-screen
thumbnails read pages, through `lib/viewer/thumbs.js`, which never touches the
reader's page cache order.

**Page tags (v3.1.0).** Tags are display metadata on pages, in `pages/_tags.json`
(never in a PageDoc), keyed `"<bookKey>/<pageId>"` like `_orientation.json`. Main
applies per-page patches inside one lock (`electron/tags-sidecar.cjs`); every edit is
worked out in `lib/tags.js` and applied optimistically by `stores/tags.js`. The
Library groups by Tag (`libraryGroupBy`), any page grid filters and bulk-tags
(`PageGrid`), and project numbers in stored transcripts are suggested, never applied
without a click (`lib/tag-suggestions.js`: no page reads, the scan records already
carry the text). Tag components live in `components/tags/`.

**Tasks (v3.4.0).** A task is a transcript line with `checked` set; WAITING is the
optional `marker: 'WAITING'` beside `checked: false`, set by hand. The scan carries a
small `tasks` summary per record (built in main by `electron/task-summary.cjs`, which
mirrors `lib/tasks.js` `buildTaskSummary()`), so the Tasks view
(`components/tasks/`) never reads a page. A tick writes one line of one PageDoc
through `lib/viewer/task-state.js` `setTaskState()` and refreshes the scan record, the
page cache and the open reader page (`lastTaskWrite`) without a rescan; it is refused
on a page with an unsaved transcript draft. `stores/tasks.js` applies it
optimistically, with Undo and per-task rollback.

**Three resets, deliberately distinct.** `Reset View` (bottom bar) is zoom/pan.
`Page Resets ▾` holds `Reset Layout` (dragged page positions) and `Reset Sizes`
(page scaling). The bottom-bar button was labelled just "Reset", which read as if
it covered all three.

## State Management (Svelte Stores)

All state is managed through Svelte stores located in `src/stores/`:

**Core Data:**
- `strokes.js` - All captured strokes from pen; `pages` (derived, `S/O/B/P` → strokes) and `canvasPageKeys` (derived, `Set<"B{book}/P{page}">`) expose what's currently loaded — the Pages tab reads `canvasPageKeys` to disable Import Strokes for pages already on the canvas
- `selection.js` - Selected stroke indices and selection state
- `pasted-strokes.js` - Duplicated/pasted strokes management

**Transcription:**
- `transcription.js` - MyScript transcription results and cache
- Page-level transcription data with hierarchy

**Saved-Pages Index:**
- `saved-pages.js` — holds the scanned list of `pages/B###/P##.json` records the Library, Contents, Pages tab and search read. Store is `savedPages` (renamed from `logseqPages` in v2.3; nothing LogSeq-specific remains). `applyTranscriptToRecord(book, pageId, lines)` reflects a Library transcript save into its record and drops the page's cached doc
- `library.js` (v3.0 package E) — `librarySort` + `setLibrarySort()` (localStorage `smartpen-library-sort`, try/catch), `libraryPageDates` (`pageDates` of the unfiltered index), `notebookCardList`, `notebookNames`, `globalSearchIndex` (built once per `savedPages` change), `searchRecords`, `searchDates` (`pageDates` of `timelineIndexFiltered`), `ensureTimelineLoaded()`; v3.1.0: `libraryGroupBy` / `setLibraryGroupBy()` (`'book' | 'tag'`, localStorage `smartpen-library-group` via safe-storage), `libraryTagSort` / `setLibraryTagSort()` (`smartpen-library-tag-sort`), `tagCardList` (`tagCards` of `tagIndex` + `searchRecords` + dates), `untaggedSummary`
- `storage.js` — save status, unsaved-changes flag (`unsavedChanges` writable, `markUnsavedChanges()`, cleared on successful save)
- `book-aliases.js` — custom book name mappings (persisted to `<dataRoot>/pages/_aliases.json`)

**Library and Timeline (since v2.1 as Book View):**
- `viewer.js` — reading-pane state:
  - `viewerMode` (`'editor' | 'book'`, starts `'book'`) — which view the right pane shows; `setViewerMode()`
  - `viewerDirty` (derived) + `markViewerDirtyPage()`/`clearViewerDirtyPage()` — per-page unsaved-transcript-edit tracking, kept **separate** from the canvas `unsavedChanges` so saving a transcript never masks unsaved stroke changes (App's `beforeunload` checks both)
  - `viewerSelection` — the open `{book, pageId}`, session-only (v3.2.0): the Library reopens it when you come back from the Timeline or Editor, but each launch starts on the Library home; `setViewerSelection()`/`clearViewerSelection()`
  - `readerSequence` / `readerOrder` (v3.2.0) — the grid a page was opened from (`buildSequence`: page keys, notebook then page, its filter and origin) and Book | Tag; `setReaderSequence(seq)` turns Tag order on (null → Book), `openPageInLibrary` clears it. `gridFilters` / `setGridFilter(key, {chosen, mode})` keep each page grid's tag filter for the session (`nb:<book>`, `tag:<tag>`, `untagged`)
  - `recentViews` + `recordRecentView()` — recently-opened pages for the home's Recent pages row
  - **Library home + search (v3.0 package E), session-only:** `libraryNotebook` (book key of the page grid
    shown when no page is open) + `openNotebookInLibrary(book, {confirm?})` (asks before dropping an open
    page's transcript edits), `transcriptEditing` (a Library transcript is in edit mode; Ctrl K stays out),
    `readerPages` (page ids on screen, for the contents highlight), `readerFocus` + `focusReaderLine()` /
    `clearReaderFocus()` (a search hit's words for the reader's line highlight)
  - **Timeline feed (v2.9):** `bookViewMode` (`'books' | 'timeline'`, session-only, starts
    `'timeline'`) + `setBookViewMode()`, `feedOrder` (`'newest' | 'oldest'`, default newest)
    + `setFeedOrder()` — persisted to localStorage as a per-viewer convenience. `feedVisible` (derived:
    the Timeline destination). `feedDayInView` (scroll-spy — the day key heading the
    feed's viewport) and `feedJumpRequest` + `requestFeedJump(day)` (a counter, like
    `transcriptSearchFocus`, so asking for the same day twice scrolls twice) — both
    session-only; the Dates tab reads the first and writes the second
  - `sittingHoverEnabled` + `toggleSittingHover()` — the Library reader's hover-to-reveal capture
    time, persisted to localStorage (`smartpen-sitting-hover`, default on)

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

**Left panel collapse (v3.0 package B):**
- `left-panel.js` — `leftPanelCollapsed`, `setLeftPanelCollapsed()`, `toggleLeftPanel()`, `expandLeftPanel()`, `collapseLeftPanel()`. localStorage key `smartpen-left-panel-collapsed`; every access in try/catch. `revealLeftPanel(tabId?)` and the `openTranscript*` helpers live in `ui.js`, built on `expandLeftPanel()`. Since package C also `contentsOpenBooks` / `setContentsBookOpen()` (notebooks open in the Library contents list; session only, since tab content is unmounted when collapsed or switched away)
- `ui.js` — `panelTab` (package C): derived from `destination` + `activeTab` via `resolvePanelTab()`; what the left panel actually shows

**Navigation spine (v3.0 package C), in `viewer.js`:**
- `destination` (derived: `'library' | 'timeline' | 'editor'` from `viewerMode` + `bookViewMode`), `navigateTo(dest, {confirm?})` → `'same' | 'cancelled' | 'navigated' | 'invalid'` (the one place the discard prompt is asked when changing destination), `openPageInLibrary(book, pageId, {confirm?})` → `'cancelled' | 'opened'` (also asks when replacing a page with unsaved edits). No persisted keys; `viewerMode` and `bookViewMode` were never persisted

**Page orientation (v2.10):**
- `orientation.js` — `pageOrientations` (`{ "<bookKey>/<pageId>": 90|180|270 }`, portrait by absence), `loadOrientations()` (called by `scanLocalPages()`; missing folder, missing or corrupt sidecar → every page portrait), `setPageRotation(book, pageId, rotation)` (optimistic, written at once to `<dataRoot>/pages/_orientation.json`; a failed write undoes only its own page). Display-only: never touches a PageDoc and never marks unsaved changes. UI: `components/viewer/OrientationControl.svelte` (↺ / picker / ↻) on each Library page's corner (`compact`) and in the Editor canvas toolbar

**Page tags (v3.1.0):**
- `tags.js` — `pageTags` (`{ "<bookKey>/<pageId>": ["P2026-141", "beam"] }`, untagged by absence), `dismissedTags` (suggestions turned down, per page), `tagIndex` (tag → keys), `tagStatsList` (tag, pages, notebooks: the manager and type-ahead), `loadTags()` (called by `scanLocalPages()` with the orientations; waits for writes in flight; missing / corrupt sidecar → no tags, corrupt and newer-version files logged), `clearTags()` (data-folder change), `setPageTagList()`, `addTagToPages()` / `removeTagFromPages()` (bulk, one write), `renameTag()` / `mergeTags()` / `deleteTag()`, `dismissSuggestion()`, `resetDismissed()`, `carryTagsForMoves()` (volume moves), `tagsFor()`. Every edit is optimistic and sent to main as a per-page patch; a failed write rolls back only the pages it changed, only if nothing changed them since, with an Activity Log error. Never a PageDoc, never `markUnsavedChanges()`, no `refreshAfterSave()`
- `tag-suggestions.js` — `suggestionsFound` (key → numbers in its stored transcript, the pass's output), `pendingSuggestions` (derived: found − tags − dismissals, so a ✓ / ✕ anywhere updates every view), `suggestionCount`, `suggestionScan` (`{running, done, total}`), `ensureSuggestionScan({force})` (once per `savedPages` array; not during a scan or offline import), `cancelSuggestionScan()`, `clearSuggestions()`
- `viewer.js` gains `libraryView` (`{kind: 'tag', tag} | {kind: 'untagged'} | {kind: 'suggestions'} | {kind: 'tags'} (v3.2.0) | {kind: 'tasks'} (v3.4.0) | null`), `showLibraryGrid(book)` and `openLibraryView(view, {confirm?})` (asks like `openNotebookInLibrary`)

**Tasks (v3.4.0):**
- `tasks.js` — `taskRows` (derived: scan records' `tasks` + `pageTags` + `libraryPageDates` + `taskOverrides` → `buildTaskRows()`), `taskCountsStore` (`{open, waiting, done, all}`), `openTaskCount` (header badge), `taskFilter` / `setTaskFilter()` (session only), `taskGroupBy` / `setTaskGroupBy()` (localStorage `smartpen-tasks-group`), `taskOverrides` (taskKey → state set but not yet in the scan), `changeTask(book, pageId, lineId, state, {from, undoable})` (optimistic; refuses on a page with an unsaved draft; writes per page in order; a failed write rolls back only that task, only if nothing changed it since, with an Activity Log error), `toggleTask()` (DONE ↔ TODO, WAITING → DONE), `taskUndo` / `undoTaskChange()` (the last change), `currentTaskState()`, `clearTasks()` (data-folder change)
- `viewer.js` gains `viewerDirtyPages` / `isViewerPageDirty(book, pageId)` (the tick guard), `focusReaderLineId(book, pageId, lineId)` (a task's page link: marks that line on any page, lights its ink on trusted pages, and BookViewer moves Strokes to Ink + text), `lastTaskWrite` / `noteTaskWritten()` (the open reader page patches its doc)
- `saved-pages.js` gains `applyTaskStateToRecord(book, pageId, lineId, state, lastUpdated)`; `applyTranscriptToRecord()` also rebuilds `tasks`

**Page backgrounds (spike, released in 2.8.0):**
- `backgrounds.js` — `backgroundsEnabled` (localStorage; the **Paper** toggle), `installedBackgrounds` / `backgroundsAvailable` (gate the toggle), `resolvePageBackground()` (→ `{frame, url}` or null, never throws), `refreshBackgrounds()`. Read-only: the images are put there by `scripts/fetch-neo-backgrounds.mjs`. Used by the Library and the Timeline only — **never the Editor**

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
- `stroke-filter.js` - Decorative element detection (boxes, underlines)
- `stroke-storage.js` - Stroke ID generation, format conversion, bounds, dedupe, user JSON/MD exports (the handwriting editor's import formats 1 and 4, [EDITOR-IMPORT-SPEC.md](EDITOR-IMPORT-SPEC.md))
- `point-edit.js` - Point-level stroke editing (pure): `detectStrayPoints()` (`origin` — at/near Ncode (0,0) or non-finite; `jump` — far from both neighbours, relative to the stroke's median spacing **and** past `MIN_JUMP_DISTANCE`, an absolute floor that keeps short flick strokes out of the results), `detectStrayPointsForStrokes()`, `removePointsFromStroke()` (identity- and force-preserving, re-tags `dotType`, drops the `_nb`/`_sw` caches, refuses to go below `MIN_STROKE_POINTS`), `pointKey`/`parsePointKey`/`groupPointKeys`, `formatPointCoords`
- `sketch-width.js` - Pressure → line thickness mapping for sketch strokes (pure): profile normalisation/presets, `pressureToUnit`, `smoothSeries` (symmetric, spike attenuation), `limitSlew`, `widthsForPressures`, `widthsForStrokeSeries` (the single "no pressure data → flatWidth" rule), `profileKey` for width-cache tagging
- `capture-bar.js` - `shouldShowCaptureBar()` (pure): Editor, pen connected, anything unsaved, or a transcription/transfer running
- `plural.js` - `plural(n, one, many?)`, the noun that agrees with a count
- `safe-storage.js` - `readJson(key, fallback, accept?)`, `readString()`, `write()`, `remove()`, `isPlainObject()`: localStorage access that never throws (page-order and page-scale read through it at module load)
- `debug.js` - `debug(...)`: console tracing that prints only in the dev server or with `localStorage['smartpen-debug'] = '1'`
- `left-panel.js` - pure helpers for the collapsible left panel: `parseCollapsed()` / `serializeCollapsed()`, `isTypingTarget()` (input, textarea, select, contenteditable), `isPanelToggleKey()` (bare `[`, no Ctrl/Alt/Meta, not typing, not IME); since package C the contextual tab sets `CONTEXT_TABS`, `tabsFor()`, `resolvePanelTab()`; `modalOpen()` (an `aria-modal` dialog is up: every window-level shortcut, `[`, Ctrl K, ←/→ and the Editor canvas keys, stands down)
- `navigation.js` - destinations (package C, pure): `DESTINATIONS`, `destinationOf(viewerMode, bookViewMode)`, `modesFor(dest)`, `planNavigation({from, to, viewerDirty})` → `'same' | 'go' | 'confirm'`, `DISCARD_PROMPT`
- `pane-toolbar.js` - `viewOptionsFor({destination, hasSelection, contentMode, backgroundsAvailable})` (which View ▾ options apply; `CONTENT_MODES` = strokes, transcript, inktext), `pageCrumb()` (breadcrumb label "P12–P13 of 48", via `pagePosition`)
- `timeline-range.js` - Range ▾ presets (`RANGE_PRESETS`, `rangePreset()`, shared with the Dates tab) and activity-strip geometry: `dayOffset()` (calendar days, DST-safe), `stripLayout()` (every day from first to last ink, bucketed to fit), `dayAtFraction()`, `windowFraction()`, `moveWindow()` (keeps length, stays inside the ink's span), `resizeWindow()` (ends never cross)
- `library-contents.js` - `buildContents(pagesByBook, bookIds, nameOf)`: the Library contents list from scan records only (pages, `transcribed`, `strokeCount`)
- `library-home.js` - the Library home (package E, pure): `pageDates(index)` (first / last day, day count, last time per page; untimed pages absent), `notebookCards(pagesByBook, bookIds, dates, nameOf)` (pages, transcribed %, strokes, first / last written, volume, `fan` = 3 most recently written pages topped up from the book's end), `sortNotebooks(cards, order)`, `SORT_ORDERS`, `parseSortOrder()`, `recentRecords()`, `pageTiles()`, `shortDay()`, `writtenRange()`, `relativeDay()`, `pageKeyOf()`
- `search-query.js` - `matchTags(text, tags)` (v3.1.0: a project-number-shaped query matches that tag exactly, normalized; words by substring); `parseSearchQuery(text, {now})` → `{text, tokens, days}` (Oct 14, October 14th, 14 Oct 2025, 2026-10-14, 10/14, 10/14/26 month first, today, yesterday; no year = latest on or before today; invalid dates and a month alone stay words) and `matchNotebooks(text, notebooks)` (every word in the name, or an exact book key)
- `global-search.js` - the header search (pure): `buildSearchIndex(records)`, `searchIndex()` (same matching as `searchPages`, ranked by words matched, whole words, recency), `runSearch(query, ctx)` → `{tags, pages, notebooks, days, order}` (v3.1.0: Tags always just above Pages), `flattenResults()`, `bestLine()`, `matchingLineId(lines, tokens)` (the reader's highlight), `snippetHtml()`, `recordsByKey()`, `isSearchShortcut(e, {editing})` (Ctrl K rule)
- `tasks.js` - **Tasks** (v3.4.0, pure): `WAITING`, `markerField(line)` (spread into every line copy: `{marker:'WAITING'}` only beside `checked: false`), `taskStateOf()`, `withTaskState(line, state)`, `stateLabel()`, `toggledState()`, `taskMenuChoices()` (the ⋯ menu), `buildTaskSummary(lines)` (the scan summary, mirrored by `electron/task-summary.cjs`; parent = `parentId` line, else nearest shallower line; text clipped), `normalizeTaskSummary()`, `summaryWithState()`, `taskKey()`, `buildTaskRows(records, {tags, dates, overrides})`, `taskCounts()`, `filterTaskRows()`, `groupTaskRows(rows, 'project'|'date'|'book')` (newest first; "No project tag" / "No date" last), `compareTaskRows()`
- `tags.js` - **Page tags** (v3.1.0, pure): `normalizeTag()` (project numbers → `P####-###` / `####-###`, brackets and spaces dropped, dash types tolerated, letters-for-digits not; keywords lowercase `a-z 0-9 - _`, ≤ 40), `isProjectTag()`, `compareTags()` (projects first), `normalizeTagList()`, `tagKey()` / `parseTagKey()` (the orientation key), `recordTagKey()`, `normalizeTagsFile()`; edits as map → map (`withPageList`, `addTagToKeys`, `removeTagFromKeys`, `renameTagInMap` (onto an existing tag = merge), `deleteTagFromMap`), `diffTagMaps()` (the patch main applies), `rollbackPatch()`, `planTagCarry()` (volume moves); suggestions `findProjectNumbers()`, `suggestProjectNumbers(lines, {exclude})`, `splitSuggestionLine()`; derived `buildTagIndex()`, `recordsForKeys()`, `untaggedRecords()`, `tagCards()`, `untaggedCard()`, `sortTagCards()`, `tagStats()`, `filterByTags()` / `filterChoices()` (Any / All; All offers only tags that still match), `tagOptions()` (type-ahead)
- `task-markers.js` - **Task boxes** (v3.3.0, pure, no imports): `parseTaskMarker(text)` → `{ checked, text }` (leading `☐` / `[ ]` / `TODO` → false, `☑` / `☒` / `[x]` / `DONE` → true, marker, a colon and a stray list dash stripped; keywords whole capital words only; bare `✓`, `WAITING`, mid-line glyphs and a marker with nothing after it → `checked: null`, text unchanged), `stripTaskMarker(text)` (what two readings of a line are compared on). Used by `mergeTranscript()` and `convert-task-boxes.js`
- `tag-suggestions.js` - the Library-wide suggestion pass (v3.1.0): `foundInText()`, `pendingFrom(found, tags, dismissed)`, `countPending()`, `groupSuggestions()` (the queue: by number, most pages first, first source line), `createSuggestionScanner({chunk, budgetMs, pause})` (per-page cache keyed by transcript text; yields by time budget; cancellable)
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
- `neo-backgrounds.js` - **Neo printed pages** (pure; shared by the importer script, the store and tests). `parseNproj()`, `frameOfPageItem()` (rectangle inset by `crop_margin`, 72-dpi pt → Ncode via `PT_PER_NCODE` = 6.72), `summarizeNproj()` (one frame per book, `uniform`/`rotated` flags), `buildManifest()`/`normalizeManifest()` (a bad manifest means "no background", never a throw), `pageNumberOfId()`, `manifestCoversPage()`, `frameToBounds()` (the shape `computeStrokeBounds()` returns, so a view can fit the sheet instead of the ink)
- `page-orientation.js` - **Page rotation** (pure). `ROTATIONS`, `normalizeRotation()` (anything unknown → 0), `rotateBy()`, `rotationLabel()`; sidecar keys `orientationKey()`/`parseOrientationKey()` (book part via `volumes.js`), `normalizeOrientations()`, `rotationFor()`; geometry within a paper FRAME: `rotateFrame()` (same top-left, w/h swapped), `rotationMatrix()` (`[a,b,c,d,e,f]`, SVG `matrix()` / Canvas `transform()` order, optional scale), `svgRotationTransform()` ('' for portrait), `rotatePoint()`/`unrotatePoint()`, `rotateBox()` (exact for right angles), `rotateStoredPoints()`/`rotateCanvasStrokes()` (copies, for MyScript and the transcript preview only). `NOMINAL_FRAME` is the sheet used where no paper is known (Editor, transcription), where only the translation depends on it
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
- `save-page.js` — `savePageToFolder()` — append-only stroke merge with explicit deletions, Y-bounds-based transcript merge with checkbox preservation; each new MyScript line's leading task box becomes its `checked` (`parseTaskMarker()`), and the duplicate check compares marker-stripped text
- `convert-task-boxes.js` — **one-off conversion** (v3.3.0, pure) of transcripts saved while boxes stayed in the text: `mightHaveTaskBoxes(transcriptionText)` (scan-record pre-filter), `planPageConversion(doc)` → `{ changes: [{ lineId, oldText, newText, checked, wasSet }], conflicts: [{ lineId, text, checked, marker }] }` (a `checked` already set is kept; a glyph that disagrees with it is a conflict and left alone), `applyPageConversion(doc, changes, now)` → `{ doc, applied, skipped }` (applies a change only while the line still holds `oldText`; text and `checked` only, plus `metadata.lastUpdated`, never `lastTranscribed`), `summarizeConversion(pagePlans)` (preview rows and counts). Read and written by `ConvertTaskBoxesDialog`
- `graph-index.js` — pure helpers for **Export to LogSeq**: `smartpenAssetName()`/`smartpenAssetRelPath()` (the `smartpen-B{book}-P{pageId}.json` asset convention), `buildSmartpenIndexEntry()`, `upsertSmartpenIndex()`, `emptySmartpenIndex()`. Mirrors the JPI Tools plugin's `tools/migrate-smartpen-assets.mjs` index logic (plugin spec §4.6/§6.1). Identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
- `publish-graph.js` — graph **transport only**: `readGraphPage(book, pageId)` (the published asset, or null) and `writeGraphPage(book, pageId, doc)` (asset via `serializePageDoc` + `smartpen-index.json` upsert, both atomic via IPC). **Throws on failure** — export is a deliberate user action, so errors surface. No LogSeq runtime dependency (pure filesystem). Does *not* decide what to publish
- `graph-export.js` — **what** to publish. Pure core (`stripTranscriptRefs`, `mergeGraphStrokes`, `resolveGraphPageInfo`, `buildGraphPageDoc`, `groupCanvasStrokesByPage`) + facades `exportSelectionToGraph(canvasStrokes)` (fans out one merge+write per page in the selection) and `exportPageDocToGraph(book, pageId, doc)` (whole-page backfill). Two invariants: **additive** (merge into what's already published, dedupe by stroke id — re-exporting is a safe no-op) and **transcript-free** (`transcript.lines` emptied, every `lineId` cleared). Tested in `graph-export.test.js`
- `load-page.js` — `importStrokesFromFolder()`, `importStrokesForLoadedPagesFromFolder()` — converts StoredStroke → canvas dotArray format. `canvasPageInfoFor()` + `storedStrokesToCanvas()` are split out so a caller can convert a **subset** of a page against one shared `pageInfo` (what a date-range load needs); `mergeCanvasStrokes()` is the dedupe-by-id merge
- `load-range.js` — `importDateRangeFromFolder()` — stroke-level date filtering. Splits each touched page into in-range strokes (→ `strokes`) and the rest (→ `contextInk`). Primes `noteOnDiskStrokeIds` from the page's **full** stored list, so a partial load reports nothing pending. Merges into the canvas rather than replacing it. `importSessionFromFolder({pages, startMs, endMs})` (v2.9) is the same split over a `[startMs, endMs)` window on a sitting's pages — a Timeline card's Load into Editor; both share the private `importWindow()` core. `LARGE_LOAD_STROKES` (12,000) is the second-confirmation threshold shared by the Dates tab and the feed
- `scan.js` — `metaToRecord()` also keeps the `tasks` summary from main (`normalizeTaskSummary()`; none from an older main)
- `refresh.js` — keeps the reading views in step with the disk: `refreshAfterSave(pages)` (Editor and Create Page saves: invalidate those pages in the page cache and thumbnails, rescan, refresh the capture-date index) and `resetForDataFolder()` (a new folder: clear the scan, caches, index, selection and notebook, then load volumes, scan, backgrounds and dates as boot does)
- `scan.js` — `scanLocalPages()` + `metaToRecord()` (pure, tested) — populates the `savedPages` store from disk. **Metadata-only (perf #3):** records carry summary fields ONLY (`strokeCount`, `lastUpdated`, `transcriptionText`, `transcribed`, `transcriptLineCount`, `pageId`/`suffix`) — never `strokes`/`pageDoc`/`strokeData`, so the corpus never stays resident; each page's strokes load lazily on view. Records load by `pageId`, so letter-suffixed variants (`P127.json` + `P127b.json`) don't collapse onto the integer page. (`main.cjs listAllPages` → `extractPageMeta` parses just the doc shell, skipping the strokes array, so the scan is fast; the tiny `transcriptionText` rides along to power search/preview without loading strokes.)
- `page-changes.js` — `computePageChangesFolder()` — preview diff for the SaveConfirmDialog. Reads the PageDoc off disk rather than the `onDiskStrokeIds` index, so it is a **second implementation** of the `pendingChanges` question and has to stay in step with it — it returns `strokeAdditions`/`strokeModifications`/`strokeDeletions` on the same rules

**Reader layer (`src/lib/viewer/`)** — since v2.1:
- `page-svg.js` — `computeStrokeBounds()`, `strokeToPathD()`, `generateThumbnailSVG()` — SVG render for the spread pages + home-grid thumbnails (`NCODE_SCALE = 2.371`). Also `strokePointPressures()` + `strokeToWidthRuns()` for sketch strokes: SVG applies one `stroke-width` per `<path>`, so a pressure-varying line is emitted as consecutive constant-width runs (thumbnails stay flat — too small to matter)
- `page-sittings.js` — **hover-to-reveal capture time** (pure). `pageDayGroups(strokes)` (one page's strokes grouped by local day of `startTime` via `dayKey`, each group with its `day` key, ink box and a `groupOf` stroke→group map), `buildHitIndex()` + `hitTest()` (a uniform grid of stroke segments, nearest stroke within the tolerance wins), `hoverTolerance()` (a few screen px in Ncode units, capped) and `formatSittingLabel()` ("Wed Oct 14, 2026 · 9:05–9:42 AM", both dates across midnight). Built once per page load; ~25 ms and ~2 µs per hover on a 2,400-stroke page
- `reading-order.js` — Book | Tag order (pure, v3.2.0): `buildSequence({records, origin, chosen, mode})` (null for an unfiltered notebook grid), `sequenceRecords(seq, recordsByKey)` (skips pages gone), `readerPageList({order, sequence, selection, bookPages})` (Tag only while the open page is in the sequence), `landingInSequence(seq, current)`, `sequenceCrumb(index, total, spread)` ("3–4 of 9"), `sequenceLabel(seq, nameOf)`. `stores/library.js` derives `readingSequence`, `readingList` (`{pages, order}`) and `readingLabel` from it
- `page-reader.js` — the Library reader's movement (pure, package D): `pageIdOf`, `pagePosition(selection, pagesByBook, spread)` (index, total, "P26–P27 of 13"), `resolveGoToPage(input, pages)` (exact id, else first suffixed variant of a bare number), `turnTarget(index, total, dir, spread)`, `pageTurnKey(e, {editing})` (←/→ rule) and `zoomText(a, b)`
- `written-on.js` — the page header's `writtenLabel(groups)` ("Feb 5 – Jun 25, 2026") and `writtenChips(groups)` from `pageDayGroups`
- `ink-text.js` — Ink + text: `isTrustworthyTranscript(doc)` (≥ `TRUST_SINCE`, has links, links lack the pre-fix raw-mm signature) and `strokesByLine(strokes, lines)` (stored `lineId`s)
- `feed-pages.js` — `createFeedPageLoader(load)` — the Timeline feed's **ref-counted** PageDoc holder: `acquire()`/`release()`/`clear()`/`size()`. Pages are shared across days (most hold ink from several), so a page is read once while any loaded day needs it and forgotten when the last lets go; a failed read is forgotten so the next acquire retries. Deliberately not `page-cache.js` — one busy day would evict the Library spread's six docs
- `thumbs.js` — page thumbnails for the Library home, page grid and search results (package E): `createThumbLoader({read, peek, render})` and the app's `thumbs` (`get(book, pageId, rotation)`, `peekSvg()`, `clear()`). Uses a page-cache doc without bumping it, otherwise reads directly and keeps only the SVG (LRU 150), two reads at a time; never evicts the reader's spread
- `load-into-editor.js` — `loadPageIntoEditor(record, {confirm?})`: the one guarded load of a saved page onto the Editor canvas from a reading view (page header, Transcribe in Editor, Shift+Enter on a search result)
- `page-cache.js` — small LRU (`getCachedPage`/`invalidatePage`/`clearPageCache`/`peekCachedPage`, MAX 6) over full PageDocs. The Library reader loads strokes lazily through this (records no longer embed them, perf #3) so turning a spread doesn't re-read disk; older docs are evicted. Keyed by `B{book}/P{pageId}` (suffix-safe)
- `transcript-markdown.js` — `linesToLogseqMarkdown()` — tab-indented `- ` bullets with `- TODO` / `- DONE` / `- WAITING` (v3.4.0) markers; `key:: value` property lines stripped (LogSeq-pasteable copy). Also `indentMarkdownBlock()`, `textToTranscriptLines()` (flat-text fallback) and `pagesToLogseqMarkdown()` (multi-page payload: one page copies bare, several nest under `- {label}` bullets) — used by the canvas text-view copy; `subtreeLines(lines, index)` (one node and its deeper lines, re-based to level 0) — the Library transcript's per-node copy
- `task-state.js` — **the task write path** (v3.4.0): `setTaskState(book, pageId, lineId, 'todo'|'done'|'waiting')` reads the PageDoc, changes that one line (`withTaskState`), bumps `metadata.lastUpdated` only (never `lastTranscribed`) and writes via `savePage()`; then `applyTaskStateToRecord()`, `invalidatePage()`, `noteTaskWritten()`. Throws `TaskStateError` (`code` 'dirty' | 'no-page' | 'no-line' | 'not-task' | 'bad-state') with nothing written. `docWithTaskState()` is the pure core; `taskChangeLabel()` the toast text
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
