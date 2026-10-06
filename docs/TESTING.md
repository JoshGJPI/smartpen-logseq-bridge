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

## Manual testing scenarios

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
- **Dates tab** (v2.8): open Dates → the activity grid fills and the range
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
- **Timeline feed** (v2.9): Book View → **Timeline**. The feed shows the Dates
  range, newest day on top, a card per sitting with its start time on the rail
  and "N min later" between cards (within a day the cards run oldest to
  newest, whichever way the days are ordered). A meeting that turned a page is ONE card
  with a strip per page. Pick 30 days in the Dates tab and scroll: the day
  heading pins, "In view" in the Dates list and the ring in the grid follow, days
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
