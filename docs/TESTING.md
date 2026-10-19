# Testing

## Automated unit tests

Run with `npm test` (single pass) or `npm run test:watch` (watch mode).
Framework: **Vitest 4.1.1**, environment: **happy-dom**.

Existing test files (all in `src/lib/__tests__/`):

| File | What it tests |
|------|---------------|
| `stroke-storage.test.js` | ID generation, `convertToStorageFormat` (lineId/blockUuid), `convertFromStorageFormat` round-trip, bounds, deduplication, JSON/MD export builders, `formatTranscribedText` / `formatPageName` / `getPageProperties` |
| `myscript-api.test.js` | `parseMyScriptResponse` — line parsing, Y-bounds from word bboxes, fallback interpolation, indentation, checkbox normalisation; `yBoundsToNcode` (origin mapping, monotonicity, origin shift, 0-0 marker); `batchOriginY` (subset vs page anchor, round-trip with `yBoundsToNcode`, empty/NaN input) |
| `transcript-search.test.js` | `tokenize` (hyphen preservation, property filtering), `searchPages` (partial matching, ranking), `highlightMatches` (HTML escaping) |
| `scan.test.js` | `metaToRecord` — summary fields only (**never** `strokes`/`pageDoc`/`strokeData`: the residency contract), letter-suffix `pageId`/`suffix`, volume book keys split into `ncodeBook`/`volume`, distinct records per volume, numeric book as volume 1, transcribed inference |
| `stroke-filter.test.js` | `filterDecorativeStrokes` / `detectDecorativeIndices` — underline, circle, single-stroke box detection, threshold behaviour |
| `page-sittings.test.js` | `src/lib/viewer/page-sittings.js` — `pageDayGroups` (empty/missing page, single stroke and its ink box and day, a whole day kept together across long pauses, one group per day ascending, time order vs file order with `groupOf`, split at local midnight by start, untimed strokes in no group, origin dot ignored in bounds, missing `endTime`), `buildHitIndex`/`hitTest` (on-stroke, tolerance edge and end cap, blank paper, nearest wins where groups overlap, exact tie keeps the earlier stroke, multi-cell segments, single-point dots, untimed ink skipped, empty/bad input), `hoverTolerance` (zoom scaling, far-out cap, zero size), `formatSittingLabel` (shared AM/PM, single moment, across noon, across midnight, no start) |
| `page-svg.test.js` | `computeStrokeBounds`, `strokeToPathD` (scaling, normalisation, <2-point skip), `generateThumbnailSVG` (empty placeholder, dimensions); `strokePointPressures` (4th tuple element, NaN for legacy), `strokeToWidthRuns` (run splitting, monotonic ramp, full segment coverage, constant-pressure collapse, flatWidth fallback, scale/profile response) |
| `sketch-width.test.js` | `normalizeProfile` (defaults, swapped/degenerate sanitising, null-vs-zero), presets, `profileKey`, `pressureToUnit` (band/clamp/NaN), `widthForPressure` (endpoints, gamma character), `smoothSeries` (symmetry, spike attenuation, edge windows), `limitSlew` (bidirectional), `widthsForPressures` (full pipeline, gap filling, all-missing → flatWidth), `strokePressures`/`hasPressureData` |
| `sketch-store.test.js` | `stores/sketch.js` (sanitised load, persistence, corrupt JSON, presets, edit-clears-preset, reset, summary) and the `stores/strokes.js` flag helpers (mark/unmark, Set or array, no-op detection, unsaved-changes signalling, `_sw` cache invalidation, `sketchStrokeCount`) |
| `canvas-renderer-sketch.test.js` | Renderer sketch path against a recording 2D-context stub: uniform handwriting (and that width no longer depends on the final dot), multi-width sketch runs, monotonic ramp, full segment coverage, run batching/quantisation, dashed fallback for deleted/decorative, width caching + profile invalidation, pasted-sketch taper; `fitToContent` centring for the computed layout and for a **dragged** page (bounds not at the origin) |
| `save-page.test.js` | `transcriptionOriginY` (recorded origin preferred, id re-derivation, page fallback, id forms, missing strokes); stroke→line matching (mm→Ncode conversion, batch origin vs page bounds, most-overlapping line wins a tie, tolerance reach, unusable yBounds link nothing, existing links preserved); `strokeToStored` (force as 4th element, integer rounding, null-timestamp placeholder, 3-element fallback for missing force, `sketch` omitted when false, key order); `savePageToFolder` sketch-flag sync onto strokes already on disk (mark, unmark removes the key, untouched when absent from canvas, points never rewritten *without the marker*, lineId sync preserved); **point edits** (rewrite gated on `pointsEdited`, refused without it, id/startTime/endTime survive losing the first point, force + sketch flag survive, marker never written to disk, other strokes untouched, bounds recomputed, key order stable, new-stroke case reports `edited: 0`) |
| `point-edit.test.js` | `detectStrayPoints` (origin exact/near/leading, non-finite, interior jump, fast-movement and short-flick non-detections, absolute-floor boundary, short strokes, single reason per point); `detectStrayPointsForStrokes`; `removePointsFromStroke` (order, identity preserved both ends, force + sketch preserved, `dotType` re-tag, cache drop, no mutation, min-points refusal, no-ops, Set input); key helpers; `removeStrokePoints`/`clearPointEditMarkers` store behaviour (marker stamping, dirty signalling, partial refusal, per-page clearing); `stores/point-edit.js` mode + selection (entry refusals, derived strokes/point count/strays, key pruning when a stroke leaves the selection, exit when the selection empties, toggle, select/delete strays, selection cleared after a delete) |
| `timeline.test.js` | `src/lib/timeline.js` — `dayKey` (local not UTC, so a late-evening stroke stays on its own day), `dayStart`/`addDays` across month and year boundaries, `rangeBoundsMs` (half-open: midnight on the first day is in, midnight after the last is out; reversed range normalised; null rather than an open range on bad input), `inRange`, `eachDay` (gaps included); `pagesInRange` (in-range vs context split, `firstDay` is the earliest day INSIDE the range, ordering, volume keys and letter suffixes kept distinct), `rangeSummary` (days with ink ≠ calendar days; `partialPages` counts only pages that would arrive partly loaded), `pagesOnDay`, `dayTotals`, `timelineExtent`; the book filter — `filterIndexByBooks` (identity when nothing excluded, downstream answers change, volumes filtered separately, original untouched) and `indexBooks` (totals vs in-range, book-key order) |
| `timeline-feed.test.js` | `src/lib/timeline-feed.js` + `viewer/feed-pages.js` — `daySessions` (local-day filter incl. both midnights; the 5/10/12/17/26/37 vs 80-minute chaining example; one session across a page turn with a part per page; one part per page however often it's revisited; cut on a pause measured from the previous stroke's END, across pages too; exactly-the-gap stays together; custom gap; cross-page ordering; distinct ids; stroke identity not ids; id-less strokes), `extendFeedRange` (next ink days in both orders, fewer left, end of ink, empty days skipped), `indexPageStrokes` (minimum frame, wider notebooks, bogus-only strokes dropped), `sessionBand` (padding, minimum height, clamped at both page edges), `sessionBands` (blank page cut out between clusters — the two-ticks case — merge threshold, no overlapping strips), `feedSkeleton` (newest/oldest order, empty runs between days only, reversed range), `nextFeedRange`, `estimateDayHeight`, `formatDuration`; the loader's sharing, ref-count release, retry after failure, volume/suffix keying |
| `neo-backgrounds.test.js` | `src/lib/neo-backgrounds.js` — `PT_PER_NCODE` (the SDK's formula), `parseNproj` (identity, `ncode_start_page` numbering, rectangle + `crop_margin`, rejects non-nproj), `frameOfPageItem` (inset by the crop, Ncode units, ~14 px/unit), `summarizeNproj` (uniform / jittered-but-uniform / non-uniform / rotated / empty), manifest build → JSON → `normalizeManifest` round trip and the bad-manifest rejections, `pageNumberOfId` (letter suffix, path-like ids refused), `manifestCoversPage`, zip entry names |
| `backgrounds-store.test.js` | `stores/backgrounds.js` — `resolvePageBackground` (frame + object URL; volume shares its NCode book's paper; suffixed page → integer page; null for no manifest / out of range / missing or empty image / unusable ids / invalid manifest / backend error, never a throw; failed image read not cached), manifest read once per book and image once per page, caches cleared on refresh, `refreshBackgrounds` availability, enabled-preference persistence (mocks `local-store.js`) |
| `left-panel.test.js` | `lib/left-panel.js` + `stores/left-panel.js` + the reveal helpers in `stores/ui.js` — stored value parsing (missing / corrupt = expanded), `isTypingTarget` (input, textarea, select, contenteditable, non-elements), `isPanelToggleKey` (bare `[` only; rejects Ctrl/Alt/Meta, typing targets, IME, handled keys), store persistence across a simulated reload and a throwing localStorage, `revealLeftPanel`, `setActiveTab` staying passive, `openTranscriptSearch` expanding before it bumps the focus token, `openTranscriptReview` |
| `navigation.test.js` | `lib/navigation.js` + `navigateTo` / `openPageInLibrary` in `stores/viewer.js` — destination ⇄ (`viewerMode`, `bookViewMode`) mapping and round-trip, the Editor leaving `bookViewMode` alone; `planNavigation` (same destination is a no-op even when dirty, asks for Editor and Timeline when dirty, never on the way into the Library); store: switch and report, back to the last reading view, same = no prompt, **cancel keeps destination and edits**, accept clears dirty, **unsaved strokes never prompt and stay unsaved**, unknown destination refused, live ink still blocked (not prompted) while dirty; `openPageInLibrary` from the Timeline, asks before replacing a dirty page, no prompt for the page already open |
| `pane-toolbar.test.js` | `lib/pane-toolbar.js` — `viewOptionsFor` (Editor and the Library home grid get nothing; an open page gets content + layout, Times whenever ink shows (Strokes, Ink + text), Paper only when available; Timeline gets order and optional Paper), `pageCrumb` ("… of N"; single, spread pairing incl. a suffixed page, last page alone, record without `pageId`, unknown book/page/selection) |
| `page-reader.test.js` | `lib/viewer/page-reader.js` — `pagePosition` (single, spread pairing across a suffix, last page alone, a volume's own count, missing input), `resolveGoToPage` (P-prefix, spaces, case, exact suffixed id, bare number prefers the unsuffixed page, number existing only as suffixed variants, unknown suffix not found, leading zeros, junk), `turnTarget` (single/spread steps, back from the second record, both ends, bad input), `pageTurnKey` (← / → only; never with a modifier, in input/textarea/select/contenteditable, mid-IME, already handled, or while editing), `zoomText` |
| `written-on.test.js` | `lib/viewer/written-on.js` — `writtenLabel` (one day, range in a year, across years, bad keys), `writtenChips` (order, counts in the title, year shown only across years), agreement with `pageDayGroups` at local midnight |
| `ink-text.test.js` | `lib/viewer/ink-text.js` — `isTrustworthyTranscript` (fixed-code page trusted, pre-fix signature never, pre-fix page with a fresh `lastTranscribed` still not, before `TRUST_SINCE` not, no links / lines / date / doc, unusable yBounds and dangling links ignored), `strokesByLine` |
| `timeline-range.test.js` | `lib/timeline-range.js` — `rangePreset` (latest ignores the range, anchors on an in-ink range end, else the last day; null without ink), `dayOffset` across EU and US DST changes, `stripLayout` (every calendar day, bucketing with a short last column, single day, no ink, bad column count), `dayAtFraction` / `windowFraction` (clamping, clipping a range past the ink, wholly outside → null), `moveWindow` (keeps length, stops at both ends, over-long range pins), `resizeWindow` (ends never cross) |
| `contextual-panel.test.js` | `tabsFor` / `resolvePanelTab` (one set per destination, Transcripts in every set, out-of-set and legacy `'books'` ids fall back), the `panelTab` store following `navigateTo` without rewriting `activeTab`, the ink click's `setActiveTab('dates')` + Timeline, search revealing Transcripts in the Library with the panel collapsed; `contentsOpenBooks`; `buildContents` (bookIds order, empty books dropped, transcribed counts, default name, missing input) |
| `page-orientation.test.js` | `src/lib/page-orientation.js` — `normalizeRotation` (wrap, junk → 0), `rotateBy`, labels; sidecar keys for plain / volume / suffixed pages, non-canonical and path-like keys refused, `normalizeOrientations` (missing or corrupt sidecar → all portrait, invalid entries dropped), `rotationFor`; `rotateFrame`; corners at 90/180/270 in an off-origin frame; round-trip identity at every rotation and four quarter turns; `rotationMatrix` agrees with `rotatePoint` when scaled; `rotateBox` exact; stored-point and canvas-stroke copies keep every other column and never mutate input |
| `orientation-store.test.js` | `stores/orientation.js` — load normalises; missing folder / garbage sidecar → portrait; set applies at once and persists by book key + page id; portrait clears; failed write rolls back only its own page; two pages turned in quick succession both kept (mocks `local-store.js`) |
| `canvas-renderer-rotation.test.js` | Editor projection — unrotated pages follow the CLAUDE.md formula exactly and ignore other pages' rotations; at 90/180/270 the layout box is the turned box and `screenToNcode` inverts `ncodeToScreen`; page box holds the turned ink; sideways writing reads left to right; `hitTest` and `findStrokesInRect` pick the stroke drawn there; culling uses the turned box |
| `volumes.test.js` | `src/lib/volumes.js` — `makeBookKey`/`parseBookKey` round-trip, canonical-form rejection (`"388v1"`, `"388v0"`, `"0388"`, `"388v02"`), `compareBookKeys` ordering (`"388"` < `"388v2"` < `"3880"` — the case naive string sort gets wrong), `withVolume`, `bookDirName`/`parseBookDirName`, the disk↔memory `pageInfo` boundary (volume 1 omitted), display helpers, `BOOK_KEY_FRAGMENT` matching |
| `viewer-store.test.js` | `stores/viewer.js` — startup view (Book View → Timeline), `showEditorForLiveInk` (switches from Book View, no-op in the Editor, held back by unsaved transcript edits, switches once they clear) |
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

## Manual testing scenarios

When making changes, also verify manually:
- Navigation spine (v3.0 package C): the app opens on **Timeline** with Dates on the left (no heat grid there; it shows in the Editor's Dates tab). Header **Library | Timeline | Editor**; the left panel follows (Library → Contents · Transcripts, Timeline → Dates · Transcripts, Editor → Strokes · Transcripts · Pages · Dates) and the rail does too when collapsed. Library → open a page from **Contents** (● = transcribed; the open page is highlighted) → breadcrumb reads Library › notebook › P12–P13 → **Load into Editor**. Timeline: **Range ▾** presets and From/To, drag the strip's window (moves, keeps length), an edge (resizes), across the strip (new range); the Dates list's In view and the strip's red marker follow the scroll; a day's ⋯ → Load day loads exactly that day's stroke count, a card's ⋯ → Load sitting the card's count, **Load range into Editor** the summary's count; **Open page** lands on that page in the Library. Book filter **Only** one book → summary, strip, feed and Dates list all drop the others. Edit a transcript, then try to leave by the header (Timeline, Editor), the breadcrumb, View ▾ (Single, Strokes), another page in Contents and an ink click: each asks once; Cancel keeps you there with the edit, OK leaves and clears the Unsaved marker (the ink click lands on that day in the Timeline). With unsaved strokes, the Unsaved marker shows in all three and no route asks. View ▾ → Paper / Times; rotate a page. Settings → **Notebooks**: rename a notebook and change its capture volume (the destination folder updates). At 1280 and 1200 wide, `scrollWidth <= innerWidth` in all three destinations
- Page reader (v3.0 package D): Library → Contents → JPI Ruled P26: crumb "P26–P27 of 13"; + / − / Fit in the pane toolbar change **both** pages; ↻ on one page's corner turns only that page and hover times still hit its ink (↺ back). ← / → turn (two pages in a spread, one in Single); nothing with Alt/Shift held, typing in Go to page, or with a transcript open for editing. Go to page: 29, 999 (field turns red, stays), `151b` and `152` (→ P152b) in Study Notes 1, a page in Study Notes 3 (volume). P27's header shows "Feb 5 – Jun 25, 2026" and two chips: hover one → only that day's ink is black; click → Timeline on that day with Dates selected (collapse the panel first: it stays collapsed). View ▾ → Ink + text: single = ink left, text right; spread = text under each page; JPI Dotted P170 (Oct 2026): hovering a line lights its ink; P101 (Jun 2026): a note and no linking. Edit a transcript, then Go to page, header Timeline, a page's Load into Editor icon, a ribbon chip and the breadcrumb Library: each asks once; Cancel keeps the edit, OK leaves. A page with no transcript: without MyScript keys it says where to add them; with keys, Transcribe in Editor loads the page there. At 1200 nothing clips (the old per-page toolbar cut off Load into Editor) and `scrollWidth <= innerWidth` panel expanded and collapsed
- Left panel (v3.0 package B): collapse with the chevron and `[`; header search and canvas Ctrl+Shift+F each expand it (search input focused); a Book View ink click leaves it collapsed; `[` typed in an input does not collapse it; state survives reload; in the Editor at 1280 and 1200 wide, `document.documentElement.scrollWidth <= innerWidth` with the panel expanded and collapsed
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
- **Dates tab** (v2.8; in the Editor since package C): open Dates → the activity grid fills and the range
  defaults to the most recent capture day. Drag across cells and confirm the
  tallies and day list track the selection. Pick a range that includes a page
  written across two days (the amber note names how many such pages there are)
  → **Load onto canvas**: only that range's ink draws in black, the rest of each
  page draws grey, and the canvas lays pages out one row per day with the date
  in each page label. Confirm the grey ink cannot be selected (Select All,
  box-select), is not counted by the stroke count, and that Save reports nothing
  pending for a page you haven't edited. Untick **Order canvas by date** and
  confirm the layout returns to book order. Unload one of those pages from the
  page filter → its grey ink goes with it. Clear → all grey ink goes. Then save
  a page, return to Dates, and confirm the new day is in the grid without a
  restart. Finally transcribe while a partial page is loaded and confirm the
  warning about covering the loaded strokes only
- **Timeline feed** (v2.9; since package C **Whole page** and **Load into Editor** are in each card's ⋯, the order toggle is in View ▾, and in the Timeline the books filter is in the feed head only): **Timeline**. The feed shows the Dates
  range, newest day on top, a card per sitting with its start time on the rail
  and "N min later" between cards (within a day the cards run oldest to
  newest, whichever way the days are ordered). A meeting that turned a page is ONE card
  with a strip per page. Pick 30 days in the Dates tab and scroll: the day
  heading pins, "In view" in the Dates list and the strip's red marker follow, days
  load ("Reading N pages…") as they approach and a fast fling past one shows its
  dashed placeholder. Keep scrolling past the last day: the next earlier days
  arrive without a jump and the Dates range's **From** moves back to match; at the
  first day with ink the footer says so. A part whose ink is at the top and
  bottom of a page (two ticks) shows two strips with a dashed cut. **Whole page**
  expands with the band tinted; **Strip** collapses. **Load into Editor** on a
  card brings only that sitting live (every page of it) and the rest grey, fitted
  and centred (try a page you once dragged), with no `*` on the page label.
  **Open page** lands in Books on that page. **Newest first ⇄ Oldest first**
  flips days *and* cards. **Books filter** (feed header or Dates tab): **Only**
  one book → both buttons read "1 of N books", tallies, grid, day list and feed
  all drop the others, and a range load brings in only that book; **All** restores
- Canvas pan/zoom/navigation
- Page positioning and scaling
- **Hover times** (v2.10): Book View → Books → open a page written on two or more
  days. Hover ink: that day's ink goes black, the rest grey, and a label just outside
  the top-right of that ink reads "Wed Sep 30, 2026 · 12:45–12:48 PM · Timeline ›";
  writing from 9 AM and 4 PM of one day is one group. Blank paper shows nothing.
  Drag to pan starting on ink: the page pans and nothing navigates. Click the ink:
  the Timeline opens on that day and the Dates range is that one day. **Times** in
  the Book View bar turns hovering off, and it stays off after a restart.
- **Page rotation** (v2.10): use a copy of the data folder. On a Library page's
  corner control (its toolbar before v3.0 D), ↻ turns the page to Landscape ↻, ↺ twice to Landscape ↺; the page lays
  out landscape with its Neo paper turning with the ink, and `pages/_orientation.json`
  gains `"<book>/<page>": 90` (or 270) while the PageDoc is unchanged. Hover times
  still highlight and label the right ink on the turned page. The Timeline card's
  strip is a horizontal slice of the upright page. In the Editor the same page shows
  upright; box-select a word and only that word's strokes select; rotating from the
  canvas toolbar doesn't mark anything unsaved. Two fast clicks of ↻ end at 180°.
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
