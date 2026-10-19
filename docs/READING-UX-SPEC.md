# Reading-first UX: review and implementation spec

Status: packages A and B built and merged to `main` (2026-10-19); package C built on `claude/reading-ux-package-c`; D–E proposed. Review dated 2026-10-19, against v2.10.0.

**Target release: v3.0.0.** Packages A–E together are the v3.0.0 milestone ("reading-first"). v3.0.0
is the major bump because the app's frame and navigation change, not because data changes: **PageDoc
stays `"2.0"`, sidecar files and storage are untouched, and existing data folders open unchanged.**
Version policy while this is in flight:
- Land each package on its own branch/PR into `main`; packages are shippable alone but are **not**
  individually released. Don't bump `package.json` per package. Record each in `docs/CHANGELOG.md`
  under an `## Unreleased (toward v3.0.0)` heading (why, rejected alternatives, limitations), as for earlier
  features.
- Bump to `3.0.0` only when A–E are done (or Josh explicitly cuts a smaller 3.0.0), in a single
  "Bump to 3.0.0" commit like the previous bumps. Update the version line in CLAUDE.md at that point.
- If a package is dropped or changed, edit this spec in the same PR so it stays the source of truth.
Mockups: [READING-UX-MOCKUPS.html](READING-UX-MOCKUPS.html) (open in a browser; synthetic ink only).

## Why

The app began as a capture, edit and transcribe tool. Book View, the Timeline and the Dates grid
now carry most daily use (viewing, reading, finding by date), but they sit inside a frame built for
capture. The reading surface is the smallest thing on screen. Goal: make reading and finding the
default weight of the UI, and keep capture/edit one deliberate step away. **No change to data
formats, storage, or any invariant in CLAUDE.md.** This is layout, navigation and presentation.

## Evidence (real app, 1600×950 and 1280×760)

1. At 1280×760 the header (~170 px, wraps to 3 rows with unlabelled icon buttons) plus view bar plus feed
   header leave ~500 px of reading height. At 1600 the left panel takes 450 px, the feed column is ~760 px,
   and `.app { max-width: 1600px }` means wider monitors gain only margin.
2. Header is a capture toolbar (Connect, Fetch Notes, Save, Delete (0), Undo, Clear, Transcribe (0/0)),
   mostly disabled while reading.
3. Left panel is unrelated to the reading context: Strokes tab says "Connect pen and write to see strokes";
   Transcripts says "Select strokes and click Transcribe". Reading-relevant controls are only in Dates.
4. Three mode tiers plus five tabs: Editor|Book View → Books|Timeline → Paper, Home, Strokes|Transcript,
   Spread, Times, Newest first; left Strokes|Transcripts|Pages|Books|Dates. "Books" means two things.
5. Duplication: Timeline "Load … into Editor" appears 4 times (left button, feed header, day, card); range
   is set in two places; book filter in two places; "947 strokes · 2 pages" shown three times; "1 days".
6. The Pages tab and Books home list the same books in two designs. Neither shows when written or how much
   is transcribed.
7. Books home is a collapsed accordion; thumbnails (good) only appear after expanding; Recent is absent
   until pages have been opened.
8. Ink and transcript are either/or (Strokes|Transcript toggle). Each page carries its own full toolbar.
   No page position, no jump-to-page; written date shown only via hover (Times).
9. Full-text search lives at Transcripts → Search (or Ctrl+Shift+F); nothing in Book View hints at it.
10. One pink-red means primary action, selected state and (darkened) destructive.

**Keep:** the two-page spread, hover-to-reveal capture time, lazy Timeline feed, Dates heat grid, and
"Load into Editor" as the deliberate crossing from reading to editing.

## Constraints (read before touching anything)

- CLAUDE.md invariants all apply. Specifically relevant: tab ids `'strokes' | 'transcription' |
  'saved-pages' | 'books' | 'dates'` must not be renamed (`ActionBar` calls `setActiveTab('transcription')`);
  capture-date rules (local day keys, half-open ranges, date from stroke `startTime` only; every timeline
  store reads `timelineIndexFiltered`); book keys are strings, use `lib/volumes.js` helpers; page rotation is
  display-only; stored `lineId`s are unreliable for pages transcribed before Aug 2026.
- Unsaved-work guards must survive: `viewerDirty` + the "Discard transcript edits?" confirm when leaving
  Book View or Books; `unsavedChanges` amber dot and the main-process close dialog (`setUnsavedState`).
- Live pen ink still switches the pane to the Editor (`showEditorForLiveInk()`), and must still be
  reachable with the capture bar hidden.
- Svelte 4 conventions; components stay under ~300 lines (several are over now; do not make them worse);
  business logic in `src/lib/` with unit tests.
- Mockups use synthetic ink. Don't commit real handwriting or Neo images.

## Work packages (one session each, in this order)

Each package is shippable alone and leaves `npm test` green. Do not combine packages: A–C all touch
`App.svelte`.

### A. Slim header + colour roles + copy polish  (high impact, small effort)
- `layout/Header.svelte`, `header/ActionBar.svelte`, `header/SettingsDropdown.svelte`, `App.svelte` styles.
- One ~44 px bar: name ("smartpen-bridge", drop "NeoSmartpen → Stroke Bridge"), primary nav, search entry
  (placeholder only until package E), pen chip (state, battery, Connect click target, unsaved amber dot),
  Settings gear with a warning dot only if the data folder is not ready.
- Capture bar (Save, Undo, Delete (n), Clear, Transcribe n/m) renders only when: Editor active, pen
  connected, or anything unsaved (`unsavedChanges || $viewerDirty`). Check `ActionBar`'s own state before
  moving it (1,100 lines; it owns dialogs and side effects, so move the *rendering condition*, don't rewrite it).
- Folder status text moves to Settings.
- Colours: selected/"on" = neutral raised + blue underline; red accent = the single primary action; dark red =
  destructive only. Apply to `.view-switch-btn`, `.vg-btn.active`, `.vg-segment .active`, `.panel-tab`.
- Copy: pluralise "1 days" (DatesTab tally) and similar; empty states in reading contexts talk about
  reading, not pen capture; heat grid weekday labels; styled scrollbar under the grid; raise smallest labels
  to ≥ 0.75 rem.
- Done when: at 1280×760 the header is one row and reading height grows by ~125 px; capture bar appears in
  Editor / pen connected / unsaved and not otherwise; unsaved dot visible from every view.

**As built (differences from the bullets above).** Record kept here so the spec stays the source of truth:
- Header nav is the *existing* Editor | Book View switch, passed into `Header` through a `nav` slot (`switchView`
  and its discard prompt stay in `App.svelte`). Library | Timeline | Editor is still package C. In the Editor the
  pane bar is dropped; Books | Timeline and the other per-view toggles stay in the Book View pane bar.
- Search entry is a button into the existing Transcripts → Search (`openTranscriptSearch()`), not a dead
  placeholder. No Ctrl K yet (package E).
- Unsaved marker ("Unsaved", amber dot) sits next to the pen chip, not inside it. Pen chip: state + battery +
  Connect / Disconnect (`PenChip.svelte`); the pen-memory percentage is no longer shown in the header.
- Capture bar condition (`lib/capture-bar.js`) also includes "a transcription or offline transfer is running",
  because the progress popups hang off the bar. `ActionBar` stays mounted and takes a `visible` prop; it owns the
  save dialog and in-flight handlers, so never wrap it in `{#if}`.
- Layout contract B must keep: `.main-grid` has `grid-template-rows: minmax(0, 1fr)` and the left panel has
  `max-height: 100%` (no `calc(100vh - …)` guess). Header height now varies (45 px, or 96 px with the capture bar).
- Colour tokens live in `App.svelte :root` (`--selected-*`, `--destructive*`, `--ok-solid*`).

### B. Collapsible left panel + width cap  (high impact, small effort)
- `layout/LeftPanel.svelte`, `App.svelte` (`.main-grid`, `.app` max-width), a small store + pure helpers in `src/lib/`.
- Chevron and `[` key collapse the panel to a ~48 px rail (state in localStorage, per-viewer convenience; wrap
  every storage read/write in try/catch). The key must not fire while typing (`input`, `textarea`, `select`,
  `contenteditable`) or with Ctrl/Alt/Meta held. The rail keeps what a collapsed panel would otherwise hide: an expand
  chevron, one icon per tab (click = expand and select that tab) and the Transcripts count badge
  (`pageTranscriptionCount`), so a finished MyScript run is still visible. Keep `setActiveTab` ids unchanged.
- **Nothing may open into a hidden panel.** Several callers change the left panel on the assumption the user can see
  it. With the panel collapsed they would silently do nothing visible. Add one `revealLeftPanel(tabId?)` (expands, and
  selects the tab if given) and call it from the callers where the user *asked* to see the panel:
  - `openTranscriptSearch()` (header search button, canvas Ctrl+Shift+F, canvas search button): expand, switch to
    Transcripts → Search and focus the input. Focus must still land (the existing `transcriptSearchFocus` token
    plus `tick()` in `TranscriptsPanel` assumes the input exists, so expand before bumping the token).
  - `openTranscriptReview()`.
  - `TimelineFeed` "Change range" (`setActiveTab('dates')`).
  - Leave passive callers alone so a panel the user collapsed does not pop open: the Book View ink click in
    `PageSpreadView` (sets the range and opens the Timeline day) and `ActionBar`'s post-transcription
    `setActiveTab('transcription')` (the rail badge covers it). Re-check with `grep -rn "setActiveTab\|openTranscript"`
    before building; any caller added since is yours to classify.
  - Package C will replace "Change range" with a Range menu; keep the call site easy to find.
- **Width cap.** Lift `.app { max-width: 1600px }` for Book View (Books and Timeline) so wide monitors enlarge
  the reading surface; **keep the 1600 px cap for the Editor** (a stretched canvas toolbar is worse, and the
  canvas is sized from ink bounds). Drive it from `$viewerMode` with a class on `.app`, not a media query, and keep the
  padding. Collapsing the panel changes the grid's first column (`48px 1fr`); keep `grid-template-rows: minmax(0, 1fr)`,
  the left panel's `max-height: 100%` and the ≤ 1400 / ≤ 1000 px media queries working.
- **Editor at narrow widths.** The Editor already overflows horizontally at 1280 wide (the document scrolls sideways,
  clipping the right end of the canvas toolbar; present before package A). The window's minimum is 1200 px. Find which
  element sets the minimum content width (likely the canvas toolbar row in `StrokeCanvas.svelte`) and fix it so the
  toolbar wraps or scrolls inside the pane instead of widening the page. Collapsing the panel gives the Editor 400 px
  back, which may hide the problem but is not the fix: it must hold with the panel expanded.
- The canvas must redraw when the panel toggles (`StrokeCanvas` already has a `ResizeObserver`; confirm the page
  does not keep a stale size or lose zoom/pan).
- Done when: collapsed panel gives the Timeline/spread the full width; at ≥ 1920 wide Book View fills and the Editor
  stays at 1600; the key does not fire while typing in inputs; state persists across reload; header search, canvas
  Ctrl+Shift+F, Review and "Change range" each work with the panel collapsed (it expands, and the search input has
  focus); passive callers leave it collapsed; at 1280 and 1200 wide `document.documentElement.scrollWidth <= innerWidth`
  in the Editor with the panel both expanded and collapsed; unit tests for the collapse store (persistence,
  corrupt storage, reveal) and the typing-target check.

**As built (differences from the bullets above).**
- Callers: `openTranscriptSearch` is reached from the header search button and the canvas's
  Ctrl+Shift+F only. The canvas's own search button is `CanvasSearch` (find a page on the
  canvas, Ctrl+F) and does not touch the left panel, so it needs no reveal. `openTranscriptReview`
  has no UI caller today; it reveals anyway.
- `openTranscriptSearch()` is async: it expands the panel, sets tab and mode, awaits `tick()`
  and only then bumps `transcriptSearchFocus`. Tab content is unmounted while collapsed, and
  `TranscriptsPanel` reads the token at mount as its baseline, so a bump in the same tick as the
  expansion would be lost.
- Store `stores/left-panel.js`, helpers `lib/left-panel.js`; `revealLeftPanel` is in `ui.js`.
  The old unused `sidebarCollapsed` in `ui.js` was left alone.
- Editor overflow cause: the grid item `.canvas-section` had `min-width: auto`, and the canvas
  toolbar's scroll container still contributes its full length to min-content. Fix is
  `.canvas-section { min-width: 0 }` in `App.svelte`, not a change to the toolbar.
- Tab padding 16 → 11 px so the collapse chevron shares the first row of the 450 px panel.
- Collapsing does not widen the Timeline feed's cards past their own max width.

### C. Navigation spine + View menu + Timeline consolidation  (high impact, medium effort)
- `App.svelte` (topbar), `viewer/TimelineFeed.svelte`, `dates/DatesTab.svelte`, `dates/ActivityGrid.svelte`,
  `stores/viewer.js`, `stores/ui.js`.
- Top-level destinations: **Library** (today's Book View → Books), **Timeline**, **Editor**. Keep the store
  fields (`viewerMode`, `bookViewMode`) and map them; don't churn persisted keys. One guarded navigation
  function replaces the duplicated confirm in `switchView` / `switchBookMode`.
- Pane toolbar: breadcrumb + **View ▾** popover holding only options valid for the current view (Paper,
  Times, Spread/Single, Strokes|Transcript|Ink+text once D lands, Newest/Oldest).
- Left panel becomes contextual: Library → book/page table of contents (replaces the Pages tab; dots for
  transcribed); Timeline → grid + range controls; Editor → today's Strokes/Transcripts. Books-tab config
  (aliases, volume routing) moves to Settings → Notebooks. Preserve `setActiveTab` ids internally.
- Timeline: horizontal activity strip across the feed top with the visible range as a draggable window; a
  single **Range ▾** menu (From/To, Latest/1/7/30); sticky day headers; per-card actions = Open page + ⋯
  (Load into Editor lives in the overflow); one range-level load as a quiet secondary button; summary shown
  once. Keep scroll-spy, `feedJumpRequest`, endless-scroll range growth, and the book filter working.
- Open question for Josh before building: keep the Dates heat grid vertical in the left panel as well, or
  strip only?
- Done when: no feature is lost (every action reachable), "Load into Editor" appears once per level at most
  and not as a primary button, jump/scroll-spy/filter still agree with the Editor loads, tests green.

**As built (differences from the bullets above).**
- Open question: the heat grid **stays** in the Timeline's left panel (with From/To, presets and the day list) and
  the strip is added in the feed. Decision still Josh's; removing the grid later is a one-line change to
  `CONTEXT_TABS` plus moving the day list.
- Navigation: `navigateTo(dest)` and `openPageInLibrary(book, pageId)` in `stores/viewer.js`, pure rule in
  `lib/navigation.js`. Also routed through it: the Book View ink click (was unguarded) and search-result Open (did
  not switch to Books from the Timeline).
- Left panel sets: Library → Contents · Transcripts; Timeline → Dates · Transcripts; Editor → Strokes · Transcripts ·
  **Pages · Dates**. Transcripts is everywhere because search opens there. The Pages tab is kept (with the Editor),
  not replaced: its cards hold Import / Import all, Export to graph, Edit structure and Reset transcript. Contents is
  a new id, `'contents'`; ids outside the current set (including `'books'`) show the set's first tab.
- The Editor has no pane toolbar (no View option applies). Timeline breadcrumb is just "Timeline": the range is the
  Range ▾ button's label, so it is said once.
- In the Timeline the Dates panel drops its tally, book filter and Load (all in the feed head); in the Editor it is
  unchanged ("Load onto canvas", "View as timeline").
- Card ⋯ holds Whole page / Show only this sitting and Load sitting into Editor; a day's ⋯ holds Load day.
  Sticky day headers already existed.

### D. Page reader  (high impact, medium effort)
- Found in package C: at 1200 wide each spread page's own toolbar clips its "Load into Editor" (also on `main`);
  the shared toolbar below fixes it.
- `viewer/BookViewer.svelte`, `PageSpreadView.svelte`, `TranscriptPane.svelte`, `SittingHover.svelte`,
  `lib/viewer/page-sittings.js`.
- One shared toolbar over the spread (zoom/Fit apply to both pages; rotate/orientation per page via a small
  control on the page corner). Per-page header: title, stroke count, written date.
- Position and jump: "P101–P103 of N", slider or "Go to page…", ←/→ keys.
- Written-on ribbon: single date or day chips per page (from `pageDayGroups`); hover highlights that day's
  ink; click opens that day in the Timeline (existing behaviour, made discoverable).
- **Ink + text** third content mode: single page = ink left, text right; spread = text under each page.
  Line→ink hover linking only for pages transcribed after Aug 2026 (trustworthy `yBounds`); older pages
  side-by-side with no linking. No changes to transcript merge or `lineId` handling.
- Transcript empty state: "Transcribe this page" only when MyScript is configured.
- Done when: all of the above work in single and spread modes, rotation still applies as one transform per
  page, and reading a 2,000-stroke page isn't slower (check the hover hit-index cost).

### E. Library home + global search  (medium impact, medium effort)
- `viewer/BookViewer.svelte` (home), `stores/saved-pages.js`, `stores/timeline.js`, `lib/transcript-search.js`,
  `transcription/TranscriptSearch.svelte`, `App.svelte` (top bar).
- Library home: notebook cards with alias, volume badge, page count, first–last written (timeline index),
  last-written, transcribed % bar (scan's `transcribed` flag), three-page thumbnail fan using the most
  recently written pages. Sort chips: Recently written / Name / Most pages. Recent pages row when non-empty.
  Opening a book: thumbnail grid with date badge and ✓ per page, "Go to page…".
- Global search: top-bar field and Ctrl K, same index as `transcript-search.js` plus parsing of dates and
  notebook names; grouped results (Pages / Notebooks / Days) with snippet, thumbnail, written date; Enter
  opens the page in the reader (highlight the line only where trustworthy); Shift+Enter loads into Editor.
  Keep Ctrl+F (canvas) and Ctrl+Shift+F behaviour.
- Done when: home shows real data with no extra page reads (metadata-only scan rule); search results open in
  the reader; nothing loads strokes until a page is opened.

## How to verify each package

- `npm test` (add unit tests for any new pure logic in `src/lib/`).
- Run the real Electron app against a **scratch copy** of the data folder, in an isolated profile so the
  user's running app is untouched (a second instance with the default profile quits on the single-instance
  lock): copy `<dataRoot>/pages` to a temp dir, then launch
  `electron . --user-data-dir=<temp> --remote-debugging-port=9444 --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`
  and, over CDP, set `localStorage['smartpen-bridge-settings'] = JSON.stringify({dataRoot: '<temp>/data'})`
  and reload. Capture screenshots at 1600×950 and 1280×760 before and after. Stop only that instance.
- Walk the flows that must not regress: open on Timeline; Dates range → feed → Load into Editor; Library →
  spread → Load into Editor; transcript edit then leave view (discard prompt); Times hover → click opens
  Timeline day; rotate a page; Paper toggle. Live pen, MyScript and offline import can't be exercised
  without hardware or keys: say so rather than claiming they were checked.

## Not in scope

Data model, PageDoc/sidecar formats, save/transcribe logic, the Planner idea in CLAUDE.md, mobile layouts.
