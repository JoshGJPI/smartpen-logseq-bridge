# CLAUDE.md

**smartpen-bridge** (v2.x, formerly `smartpen-logseq-bridge`) is an Electron desktop app that captures
NeoSmartpen (Lamy Safari) strokes over Web Bluetooth, runs MyScript handwriting recognition, and saves
plain JSON to a user-chosen folder: `<dataRoot>/pages/B###/P##.json`, one "PageDoc" per pen page.
v1 (≤ 1.3.4) stored to LogSeq over HTTP; v2.0 replaced that. Design: [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md).

**Stack:** Svelte 4 · Vite · Electron (Chromium renderer + Node main) · web_pen_sdk · MyScript Cloud API
(proxied through Electron main to preserve HTTP header casing) · Canvas API.

## Commands

```bash
npm run dev            # Vite dev server, localhost:3000
npm run build          # production build
npm test               # Vitest, single pass (happy-dom)
npm run test:watch
npm run electron:build # Windows installer
node scripts/fetch-neo-backgrounds.mjs <data-root> 3_27_388   # cache Neo page images (section_owner_book)
```

## Code map

```
electron/main.cjs, preload.cjs   all disk IO + MyScript proxy, exposed as window.storageAPI
src/stores/        one store per concern (strokes, selection, pending-changes, viewer, timeline, volumes, ...)
src/lib/           pure logic, no UI, testable without DOM
src/lib/storage/   PageDoc layer: local-store (IPC facade), save-page, load-page, load-range, scan, page-changes, graph-export
src/lib/viewer/    Book View helpers: SVG render, page cache, transcript markdown/save, feed loader
src/components/    grouped by feature (canvas, dialog, header, viewer, dates, books, transcription, ...)
```

Data flow: **pen → `strokes` store → canvas / MyScript → `savePageToFolder()` → PageDoc on disk.**

The right pane toggles **Editor** (`StrokeCanvas`) ⇄ **Book View** (Books | Timeline). The left panel has
tabs Strokes · Transcripts · Pages · Books · Dates; their ids (`'strokes'`, `'transcription'`,
`'saved-pages'`, `'books'`, `'dates'`) predate the current labels, so don't rename them
(`ActionBar` calls `setActiveTab('transcription')`). Full component tree, store and library inventory:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data formats

**In-memory stroke** (canvas format, what pen and canvas code pass around):

```js
{ pageInfo: { section, owner, book, page },   // book is a STRING key in memory, see Book keys
  startTime, endTime,                          // Unix ms
  dotArray: [{ x, y, f, timestamp }] }         // x/y in Ncode units, f = pen force
```

**PageDoc** (on disk, hybrid serializer: shell pretty-printed, one stroke per line):

```jsonc
{
  "version": "2.0",
  "pageInfo": { "section": 3, "owner": 1012, "book": 3017, "page": 42 },   // optional "volume" (omitted when 1)
  "metadata": { "lastUpdated": "…", "totalStrokes": 385, "bounds": { "minX": 0, "maxX": 0, "minY": 0, "maxY": 0 } },
  "transcript": {
    "lastTranscribed": "…",
    "lines": [{ "id": "…", "text": "…", "indentLevel": 0, "parentId": null,
                "checked": null /* null | true (DONE) | false (TODO) */,
                "yBounds": { "minY": 1.6, "maxY": 8.6 } }]
  },
  "strokes": [
    { "id": "s1765313505107", "startTime": 0, "endTime": 0, "lineId": "…|null",
      "sketch": true /* omitted when false */, "points": [[6.56, 37.25, 1765313505107, 412]] }
  ]
}
```

- **Point tuples are variable length:** `[x, y]`, `[x, y, ts]` or `[x, y, ts|null, force]`. Force is written for
  *every* stroke, not only sketches, because flagging happens long after capture. Older, shorter tuples
  read back fine and render at a constant `flatWidth`.
- `PAGE_DOC_VERSION` stays `"2.0"`. `validatePageDoc()` rejects anything else, so changes must be
  backward-compatible additions.
- Letter-suffixed pages (`P151b.json`) are real: the integer `pageInfo.page` is the NCode page, the suffix is the
  user's variant label and is preserved.
- Sidecar files in `pages/`: `_aliases.json` (book names, keyed by book key), `_volumes.json` (active volume per
  NCode book), `_timeline.json` (per-page capture-day histograms; a pure cache, safe to delete).

## Invariants

Breaking these loses data or quietly produces wrong results. The reasoning and history behind each is in
[docs/CHANGELOG.md](docs/CHANGELOG.md).

### Storage and saves

- **Append-only.** `savePageToFolder()` starts from the PageDoc on disk, appends new strokes deduped by id
  (`s{startTime}`), and applies only *explicit* deletions (`pending-changes.js` → `getDeletedStrokeIdsForPage()`).
  Missing from the canvas never means deleted on disk, which is why partial loads (date ranges, unloaded pages)
  are safe to save from.
- **One geometry exception.** Stored `points` are rewritten only when the canvas stroke carries the in-memory
  `pointsEdited` marker, which only `removeStrokePoints()` sets. Never gate it on "canvas has fewer points than
  disk". An edit must keep `startTime`/`endTime` (so the id), each surviving point's force, and the sketch flag,
  and may never leave fewer than 2 points.
- **In-memory markers never reach disk** (`pointsEdited`, `movedFrom`): `strokeToStored()` builds from a fixed
  key list. Keep it that way.
- **One write path.** Every PageDoc write goes through `local-store.js` `savePage()`, atomic (`.tmp` + rename +
  fsync) in main. The renderer never touches `fs`; `requireBookKey()`/`requirePageId()` in `main.cjs` keep paths
  inside the data root.
- **Scans are metadata-only.** `savedPages` records hold summary fields, never strokes; load strokes lazily via
  `getPage()` / `viewer/page-cache.js`. `onDiskStrokeIds` (canvas pages only) holds scalar-sized records, so keep
  any new field as small.
- **Transcript merge:** existing lines keep their order; new lines are sorted among themselves and appended;
  `checked` survives when text matches; dangling `lineId`s are scrubbed.
- Deletions marked but unsaved have a 15-minute undo window.
- Settings and display prefs → localStorage. Stroke and transcript data → PageDoc only.

### Book keys and volumes

- Identical notebooks share an NCode book id, so `pageInfo.book` is a **string key everywhere in memory**:
  `"388"` = volume 1, `"388v2"` = volume 2 (`pages/B388v2/`). On disk it is a number plus optional `volume`.
- Helpers in `lib/volumes.js` are mandatory: `compareBookKeys()` (string sort puts `"388v2"` after `"3880"`),
  `BOOK_KEY_FRAGMENT` to build any regex that matches a page key. Never hand-write `\d+` for a book (an
  unanchored `/B(\d+)/` matches *inside* `B388v2`) and never do arithmetic on a book.
- Reassigning a volume is a **move**: it rewrites `pageInfo.book`, clears `blockUuid`, and stamps `movedFrom`;
  `getMovedAwayStrokeIdsForPage()` feeds the source page's deletions, and move-source pages are force-included in
  the save dialog. Without this the stroke ends up in both volumes.
- `applyActiveVolume()` is the single pen→app boundary and is idempotent. The remap stays out of the transport
  layer (`normalizeBookId`, transfer matching and pen-memory keys use the raw NCode id), but live canvas preview
  (`canvasRenderer.addDot`) needs the same remap as capture.

### Canvas stores

- `selectedIndices`, `deletedIndices` and point-edit keys (`"strokeIdx:pointIdx"`) are **positions into the
  `strokes` array**. Anything that removes strokes from the middle must shift them (see `stores/canvas.js`,
  `adjustDeletionsAfterRemoval()`). An unshifted deletion mark deletes a *different* stroke from disk at next save.
- `contextInk` is drawn but not owned: it stays out of `strokes`, so it can never be selected, saved, exported or
  transcribed. It counts toward page bounds, never toward capture date.
- `pendingChanges` has five buckets (additions, edits, modifications, moves, deletions); a stroke lands in
  exactly one. `SaveConfirmDialog` does **not** read it: it runs `page-changes.js` `computePageChangesFolder()`
  against the file on disk. That is a second implementation of the same question, so change both together.
- Unloading a page from the canvas is not an edit and must not call `markUnsavedChanges()`.
- Anything that adds unsaved state must call `markUnsavedChanges()` (amber dot, `beforeunload` prompt).

### Capture dates

- Day keys are **local** calendar days, and three places must agree: `main.cjs` `dayKeyLocal`, `lib/timeline.js`
  `dayKey`, `canvas-renderer` `captureDayKey`. Ranges are half-open `[startMs, endMs)` via `rangeBoundsMs()`.
- Capture date comes only from stroke `startTime`. `metadata.lastUpdated` is a file-write time and can differ by
  months.
- Every derived timeline store reads the book-filtered index (`timelineIndexFiltered`); so must any caller that
  passes `index:` to a date load.

### Transcription

- MyScript `yBounds` are millimetres measured from the top of the batch that was *sent*; stroke points are raw
  Ncode (~2.4mm per unit). Convert with `yBoundsToNcode()` using the batch origin (`batchOriginY()`, stored as
  `originNcodeY`) before matching strokes to lines. `LINE_MATCH_TOLERANCE_NCODE = 1` deliberately matches
  `TranscriptStrokePreview`.
- Pages transcribed before Aug 2026 mostly have wrong stroke `lineId`s (left alone; re-transcribing fixes a page).
- MyScript only sees strokes that are loaded, so transcribing a partially loaded page covers those strokes only.
- Free tier is 2,000 requests/month, HMAC-authenticated; process page by page.

### Pen and SDK

- Web Bluetooth works only in Chromium/Electron, needs an explicit pairing dialog, and connections drop.
- The SDK emits `{x:-1, y:-1, f:0}` as the first dot of every stroke with stale `pageInfo`. `processDot()` keeps
  `pageInfo: null` / empty `dotArray` until the first real dot and finalises only confirmed strokes.
- Offline import (`pen-sdk.js`, `TRANSFER_CONFIG`): the SDK fires `OFFLINE_DATA_SEND_SUCCESS` once per *page*, not
  per book, so hold the promise until received ≥ expected; null the resolver before calling it; a book-id
  mismatch makes `handleOfflineDataReceived()` return `false`. `OFFLINE_DATA_RESPONSE` never reaches the app
  callback, so the expected count is estimated from `OFFLINE_DATA_SEND_STATUS` percent.

### Rendering

- Ncode → screen: `screenX = (dot.x - bounds.minX + offsetX) * scale * zoom + panX`, `scale = 2.371`.
  `offsetY` is `offset.bounds.minY - globalMinY` (not `-globalMinY`, which double-subtracts).
  `clear(resetBounds=true)` does not reset zoom/pan.
- Canvas2D reads `lineWidth` once, at `stroke()`. Never assign it inside a `moveTo`/`lineTo` loop; variable width
  means splitting into constant-width runs (`strokeVariableWidth()`, SVG `strokeToWidthRuns()`).
- Live writing calls `setLiveWritingView()` once per session (zoom 3, top-left); offline import calls
  `fitContent()` once on the first batch. `liveWritingViewSet` stops repeat viewport jumps.
- Performance matters above ~1,000 strokes: cull, use `requestAnimationFrame`, debounce. Above ~2,000 per page,
  use the page selector.
- Neo page backgrounds are drawn only in the read-only views (Book View, Timeline), never in the Editor, whose
  page bounds come from ink. `resolvePageBackground()` never throws: any failure means "no background". They are keyed
  by NCode book number (a volume shares its book's paper) and a suffixed page uses its integer page's image.

## Conventions

- Svelte 4: `$:` for reactive statements; import stores directly (never pass them as props); derived stores for
  computed values. Components group by feature and stay under ~300 lines.
- Business logic lives in `src/lib/` as pure functions with unit tests. Filesystem access is IPC only.
- Long operations: try/catch, report to ActivityLog with `log()`, show progress.
- Before a major change, settle: which stores change, where it persists, rendering cost at 1,000+ strokes, and what
  happens when MyScript fails or the data folder is missing.

Saving a page:

```js
const result = await savePageToFolder({
  book, page,
  activeStrokes,          // canvas-format strokes (with dotArray)
  deletedStrokeIds,       // Set<string>, explicit deletions only
  pageTranscription,      // MyScript result for untranscribed strokes, or null
});
// result: { success, added, deleted, total, error }
```

Reading one: `const doc = await getPage(book, page)` from `$lib/storage/local-store.js` (PageDoc or null).

## Testing

`npm test` runs Vitest (happy-dom); tests live in `src/lib/__tests__/`. Follow the existing files: mock Svelte stores
with `vi.mock()` before imports, use small factories (`makeStroke`, `line`), and test boundaries (empty, zero, null).
What each file covers, plus the manual checklist, is in [docs/TESTING.md](docs/TESTING.md).

Some behaviour only shows with a real pen. When driving the Electron window over CDP while it is covered,
`visibilityState` is `hidden`, which pauses `requestAnimationFrame` and `IntersectionObserver` (the Timeline feed
then looks broken when it isn't). Launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.

## Known limitations and open items

- **Offline import with volumes is unverified on hardware** (live capture, volume definition and reassignment were
  verified 2026-08-07). Check: multi-book batch imports completely, strokes land in the active volume, reassignment
  works on imported strokes. See [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) §11.
- Writing in physical volume 1 while volume 2 is active cannot be detected; reassignment is the remedy.
- LogSeq export: volume 2+ is refused (`requireGraphBook`); a stroke already exported keeps its pre-edit geometry
  (`mergeGraphStrokes()` lets the published copy win); the JPI Tools plugin's SVG generator needs matching
  pressure/sketch support.
- `handleClearCanvas()` in `ActionBar.svelte` doesn't clear `selectedIndices`.
- `PenInfo.svelte` is unreachable (only `Sidebar` imported it, and that was deleted).
- Timeline: no transcripts on cards (stored `lineId`s are unreliable); `SESSION_GAP_MS` is a constant.
- Date view shows one tile per page, filed under its first day in range.
- **Neo page backgrounds are a spike** (books 388 and 3017 fetched; see [docs/CHANGELOG.md](docs/CHANGELOG.md) v2.10):
  no thumbnails, opacity control or export support; fetched by script only; images are Neo's, so keep
  `pages/_backgrounds/` and `docs/mockups/` out of commits.
- **Planner (to look into later, Josh 2026-09-30).** Considering the 2027 Neo Smart Planner (the 2026 Pro is book
  `3_1012_3207`, not imported). Its `.nproj` encodes each hourly slot as `ws_YYYYMMDDHH`, so a stroke → date/hour is a
  rectangle lookup. Calendar sync to Microsoft 365 would still need recognition (MyScript, batched), a confirm-before-create
  step, duplicate protection, and a write path. **Start with the `.ics` export** (no sign-in or IT approval) or a Power
  Automate flow; Microsoft Graph with in-app sign-in is the heavy option and may need JPI IT consent. Neo's own
  phone-app sync can't share the pen with this app.

## Documentation

| Doc | Read it for |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component tree, every store, every library, UI structure notes |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Why each feature is built the way it is; rejected alternatives; history to Apr 2026 |
| [docs/TESTING.md](docs/TESTING.md) | Test-file inventory and the manual test checklist |
| [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) | Storage design; §12 records changes to `strokes[]` since v2.0 |
| [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) | Notebook volumes: design and rejected alternatives |
| [docs/QUICK-ARCHITECTURE-REFERENCE.md](docs/QUICK-ARCHITECTURE-REFERENCE.md) | Canvas / pen / MyScript lookups (v1 era, mostly current) |
| [docs/NEOSMARTPEN-SDK-USAGE.md](docs/NEOSMARTPEN-SDK-USAGE.md) | Pen SDK usage |
| [docs/Archive/ARCHIVE-INDEX.md](docs/Archive/ARCHIVE-INDEX.md) | Superseded planning and implementation docs |
| [scripts/migrate-from-logseq.cjs](scripts/migrate-from-logseq.cjs) | One-shot v1 LogSeq → v2 PageDoc importer |

External: [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0) · [MyScript API](https://developer.myscript.com/) · [Svelte 4](https://svelte.dev/docs/svelte/overview).
