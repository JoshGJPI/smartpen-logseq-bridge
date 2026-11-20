# CLAUDE.md

**smartpen-bridge** (v3.x, formerly `smartpen-logseq-bridge`) is an Electron desktop app that captures
NeoSmartpen (Lamy Safari) strokes over Web Bluetooth, runs MyScript handwriting recognition, and saves
plain JSON to a user-chosen folder: `<dataRoot>/pages/B###/P##.json`, one "PageDoc" per pen page.
v1 (≤ 1.3.4) stored to LogSeq over HTTP; v2.0 replaced that. Design: [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md).

**Stack:** Svelte 4 · Vite · Electron (Chromium renderer + Node main) · web_pen_sdk · MyScript Cloud API
(proxied through Electron main to preserve HTTP header casing) · Canvas API.

## Commands

```bash
npm run dev            # Vite dev server, localhost:3000 (opens the Electron window)
npm run build          # production build
npm test               # Vitest, single pass (happy-dom)
npm run test:watch
npm run electron:build # Windows installer
node scripts/fetch-neo-backgrounds.mjs <data-root> 3_27_388   # cache Neo page images (section_owner_book)
```

## Code map

```
electron/main.cjs, preload.cjs   all disk IO + MyScript proxy, exposed as window.storageAPI
electron/page-store.cjs   book keys, path guards, writeFileAtomic, createLock, PageDoc serializer, page IO (tested from Vitest)
src/stores/        one store per concern (strokes, selection, pending-changes, viewer, timeline, volumes, tags, ...;
                   tag-scope: lines read only for pages with block corrections, the reader's scope UI state);
                   the Editor's Save and Transcribe run in canvas-save.js / canvas-transcribe.js (ActionBar only wires them)
src/lib/           pure logic, no UI, testable without DOM (tags: also tag types and `info`, v3.22.0; tag-details: the
                   Manage tags Details form; tag-scope: block scope of a Person / Project tag (v3.23.0);
                   tag-suggestions, task-markers: ☐ / ☑ → TODO / DONE,
                   tasks: task state and list, retime, move-lines, canvas-page-targets: what the Editor's rotate and
                   🏷 Tags act on, book-types, canvas-save-plan: which pages a save writes and which deletion marks it
                   settles, canvas-text-view: the Editor's text view, delete-lines: Delete line / block and what it
                   asks, deleted-ink: the deleted lines' ink and the `textless` flag; one line each in
                   docs/ARCHITECTURE.md "Key Libraries")
src/lib/storage/   PageDoc layer: local-store (IPC facade), save-page, load-page, load-range, scan, page-changes, graph-export,
                   convert-task-boxes (one-off conversion of old transcripts), line-match (stroke ↔ MyScript line, v3.21.0)
src/lib/relink.js, relink-plan.js, line-align.js   Relink old pages (v3.21.0, spec Phase B): what is sent, classify,
                   word fixes, guards; the write plan; in-order line alignment shared with the MCP. stores/relink.js runs
                   it (MyScript, cache, save, bulk); electron/relink-cache.cjs keeps runs in <userData>/relink-cache/
src/lib/viewer/    reader helpers: SVG render, page cache, thumbnails, transcript markdown/save, feed loader,
                   transcript-draft.js (the Library Edit's line operations),
                   task-state.js (the one task write path, v3.4.0)
src/components/    grouped by feature (canvas, dialog, header, viewer, dates, books, tags, transcription, ...)
mcp/               stdio MCP server over the data folder (10 read-only tools, PNG via @resvg/resvg-wasm, images capped
                   by pixels; list_tasks takes `person`, v3.23.0), imports src/lib unchanged; registered from this
                   checkout's mcp/server.js (mcp/README.md).
                   With SMARTPEN_MCP_WRITES=1 also edit_transcript / undo_transcript_edit, which ask the running app
                   (core/app-client.js) and never write a file (v3.18.0)
electron/mcp-endpoint.cjs   main's localhost endpoint for those edits (token, body limit, request ids, 30 s timeout,
                   <userData>/mcp-endpoint.json); mcp-edit-log.cjs their undo log in <userData>/mcp-edits/ (tested from Vitest)
src/lib/mcp-edits.js, stores/mcp-edits.js   the op engine (pure) and the renderer side: guards, Library Edit save, refresh
electron/*-sidecar.cjs   pure parse / patch of pages/_tags.json, _retimed.json, _book-types.json for main (tested from Vitest)
electron/task-summary.cjs   the scan's per-page task summary; mirrors lib/tasks.js buildTaskSummary (tested together)
src/lib/print/     Print to PDF (v3.8.0): print-layout.js (sheets, 2-up columns, Auto, ink scale), print-html.js (the
                   self-contained document), print-list.js (cross-notebook print order), print-selection.js (the Editor's
                   selected strokes by page, print-list items printed from memory); stores/print.js holds the session
                   print list (pages and selections) and runs a job, main's print:savePdf renders it with printToPDF; the dialog's preview
                   (v3.9.0) is that same PDF (print:previewPdf) drawn with pdf.js (components/dialog/pdf-sheets.js)
```

Data flow: **pen → `strokes` store → canvas / MyScript → `savePageToFolder()` → PageDoc on disk.**

The right pane is one of three destinations, **Library** (`BookViewer`), **Timeline** (`TimelineFeed`) and
**Editor** (`StrokeCanvas`), a view over `viewerMode` + `bookViewMode` (`lib/navigation.js`). Every route between
them goes through `navigateTo()` / `openPageInLibrary()` (`stores/viewer.js`), the one place the unsaved-transcript
prompt is asked. Back / Forward (v3.13.0, `stores/view-history.js`) records from those stores rather than from each
route and restores them itself (same prompt); a reader page turn calls `replaceNextView()` first. The app opens on the Timeline, and live pen ink switches to the Editor. The Library reader opens on Ink + text (v3.15.0). Tab ids (`'strokes'`,
`'transcription'`, `'saved-pages'`, `'books'`, `'dates'`, `'contents'`) predate the labels, so don't rename them
(`stores/canvas-transcribe.js` calls `setActiveTab('transcription')`). The open page, reading order and grid filters are session-only:
each launch opens the Library on its home. Left panel tabs, Library views, the reader, search and Tasks:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) "Navigation and the Library".

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
                "checked": null /* null | true (DONE) | false (TODO); the box is not in text */,
                /* "marker": "WAITING" | "CANCELLED"   optional, set by hand: WAITING (v3.4.0) only beside
                   checked: false, CANCELLED (v3.5.0) only beside checked: true */
                "yBounds": { "minY": 1.6, "maxY": 8.6 } }]
  },
  "strokes": [
    { "id": "s1765313505107", "startTime": 0, "endTime": 0, "lineId": "…|null",
      "sketch": true /* omitted when false */, "textless": true /* omitted when false, v3.20.0 */,
      "points": [[6.56, 37.25, 1765313505107, 412]] }
  ]
}
```

- **`textless: true`** (v3.20.0, "Not text") marks ink left out of transcripts on purpose: never sent to MyScript,
  never matched to a line, always `lineId: null`. Written only when true, like `sketch`; older builds ignore it.
- **Point tuples are variable length:** `[x, y]`, `[x, y, ts]` or `[x, y, ts|null, force]`. Force is written for
  *every* stroke, not only sketches, because flagging happens long after capture. Older, shorter tuples
  read back fine and render at a constant `flatWidth`.
- **`_tags.json` `info`** (v3.22.0, spec Phase C; the version stays 1): `{ "<tag>": record }`, no entry = no details.
  The type is **project** by the pattern alone (job `####-###`, proposal `P####-###`; never stored, never changed),
  **person** when the record says `"type": "person"` (the only type stored), else **topic**. A record holds, per type:
  every type `aliases` (strings, case kept, exact duplicates dropped) and `note`; person `type`, `label` (display
  name, case kept) and `company`; topic `label`; project `name`, `client`, `active` (boolean) and, on a proposal, `job`
  (the job number it became). Keys stay normalized tags (`tom`); capitals live only in `label` and `aliases`.
  `lib/tags.js` `normalizeTagInfo()` owns it (drops other fields, a label equal to the key, a type on a project).
- **`_tags.json` `blocks`** (v3.23.0, spec Phase D; the version stays 1): hand corrections to block scope,
  `{ "<bookKey>/<pageId>": { "<tag>": { "add": [lineId], "remove": [lineId] } } }`. *add* makes a line a root of the
  tag although its name isn't written there, *remove* drops a root that matched by accident; an id is in one list at
  most (an id in both stays an add). Only Person and Project tags have block scope. Ids no longer on the page are
  ignored, never cleaned. `lib/tags.js` owns it (`normalizeBlocksMap`, `withBlockRoot`, `withoutBlockRoot`, …).
- **Task summary `heads`** (v3.23.0): each scan `tasks` entry also has `heads: [{ id, text }]`, the task's ancestor
  lines by indent (earlier lines with text and a smaller indent that no line in between closed), the nearest 3,
  outermost first, each text clipped to 80. Built in both `lib/tasks.js` and `electron/task-summary.cjs`.
- `PAGE_DOC_VERSION` stays `"2.0"`. `validatePageDoc()` rejects anything else, so changes must be
  backward-compatible additions.
- `marker` is written only as `"WAITING"` beside `checked: false` (v3.4.0) or `"CANCELLED"` beside `checked: true`
  (v3.5.0), and is absent otherwise, so older code reads a WAITING line as TODO and a CANCELLED line as DONE (closed,
  never open). Anything that copies a transcript line carries it with `lib/tasks.js` `markerField()`. The UI offers
  TODO, DONE, WAITING and CANCELLED only (never DOING / NOW / LATER), and WAITING / CANCELLED are never read from text.
- Letter-suffixed pages (`P151b.json`) are real: the integer `pageInfo.page` is the NCode page, the suffix is the
  user's variant label and is preserved.
- Sidecar files in `pages/`: `_aliases.json` (book names, keyed by book key), `_volumes.json` (active volume per
  NCode book; both: missing or corrupt = empty, and a corrupt one is copied to `.corrupt-<ms>` before the next write
  replaces it, `page-store.cjs` `readSidecarJson`), `_timeline.json` (per-page capture-day histograms; a pure cache, safe to delete), `_orientation.json`
  (display rotation per page, `"<bookKey>/<pageId>": 90|180|270`, portrait by absence; missing or corrupt = all portrait),
  `_tags.json` (page tags and dismissed suggestions, `{ version: 1, pages: { "<bookKey>/<pageId>": [tags] }, dismissed:
  {...}, info: {...} }`, untagged by absence; missing or corrupt = no tags, and a corrupt file is replaced only by the next tag change;
  `info` (v3.22.0) is each tag's type and details keyed by the normalized tag, below),
  `_retimed.json` (v3.6.0, pen ids retimed away, `{ version: 1, pages: { "<ncodeBook>/<page>": { "s<penId>": "s<idNow>" } } }`,
  keyed by the PHYSICAL page, not the book key; offline import drops pen strokes listed here. Not a cache: deleting it
  lets a pen re-import bring retimed strokes back at their old times).
  `_book-types.json` (v3.15.0, notebook types, `{ version: 1, books: { "<bookKey>": "Work" } }`; a volume without one
  takes volume 1's; untyped by absence; missing or corrupt = no types). Display metadata like tags: set at once through
  `stores/book-types.js` `setNotebookType()`, never in a PageDoc. The type filter (`bookTypeFilter`, localStorage) is one
  store read by the Library home, Contents and `timelineIndexFiltered`; `lib/book-types.js` has the rules.

## Invariants

Breaking these loses data or quietly produces wrong results. The reasoning and history behind each is in
[docs/CHANGELOG.md](docs/CHANGELOG.md).

### Storage and saves

- **Append-only.** `savePageToFolder()` starts from the PageDoc on disk, appends new strokes deduped by id
  (`s{startTime}`), and applies only *explicit* deletions (`pending-changes.js` → `getDeletedStrokeIdsForPage()`).
  Missing from the canvas never means deleted on disk, which is why partial loads (date ranges, unloaded pages)
  are safe to save from.
- **One id per stroke per page.** The save's append loop adds each landed id to `existingIds`, so two new strokes
  with one start time never share an id: an exact copy is dropped, different ink lands 1 ms later
  (`lib/storage/duplicate-strokes.js`). Pages that already have shared ids are counted by main's timeline pass
  (`duplicateStrokes`) and cleaned from Settings → Maintenance → Clean up duplicate strokes… (preview first).
- **One geometry exception.** Stored `points` are rewritten only when the canvas stroke carries the in-memory
  `pointsEdited` marker, which only `removeStrokePoints()` and `snapStrokePoints()` set. Never gate it on "canvas has
  fewer points than disk". An edit must keep `startTime`/`endTime` (so the id), each surviving point's force, and the
  sketch flag, and may never leave fewer than 2 points. A snap keeps the count, so the dirty diff reads the marker
  too (`computePendingChangesMap`) and the save dialog compares coordinates (`page-changes.js` `isPointEdited`).
- **In-memory markers never reach disk** (`pointsEdited`, `movedFrom`, `textlessFrom`): `strokeToStored()` builds from a fixed
  key list. Keep it that way. `textless` is on that list on purpose: it is a stored field.
- **One write path.** Every PageDoc write goes through `local-store.js` `savePage()`, atomic (random `.tmp` + fsync +
  rename) in main (`electron/page-store.cjs` `writeFileAtomic`, one write per path at a time). The renderer never touches
  `fs`; `requireBookKey()`/`requirePageId()` (page-store.cjs) keep paths inside the data root.
- **Scans are metadata-only.** `savedPages` records hold summary fields, never strokes; load strokes lazily via
  `getPage()` / `viewer/page-cache.js`. Thumbnails go through `viewer/thumbs.js`, never the page cache (a screen
  of them would evict the reader's spread), and only when on screen. `onDiskStrokeIds` (canvas pages only) holds scalar-sized records, so keep
  any new field as small.
- **Transcript merge:** existing lines keep their order; new lines are sorted among themselves and appended;
  `checked` survives when text matches; dangling `lineId`s are scrubbed. A result confirmed in the Editor's Edit
  Transcription dialog (`editorBaseIds` on the page transcription) is the whole transcript instead: saved lines are
  updated in place by id, dropped ones removed (`applyEditorLines`). `save-page.js` `planTranscript()` decides both,
  and the save dialog (`page-changes.js`) asks it too, so never compare transcript text there. A saved page's
  transcription is cleared from `pageTranscriptions` (otherwise it stays "changed" and pending in Review).
- **Re-transcribing a saved page** (v3.17.0, `stores/transcript-reset.js`): Reset unlinks a loaded page's strokes in
  memory and marks its next transcription `replace`; that save drops the old lines, relinks every stroke of the page
  from the new run (left-out ink, such as a drawing, ends up unlinked) and carries task state by text
  (`carryTaskState`). Reset is refused while only part of the page is loaded. A null in-memory link never clears a
  stored one, so a Reset that is never transcribed and saved changes nothing on disk.
- Deletions marked but unsaved have a 15-minute undo window. A save settles only the marks on pages it wrote
  (`lib/canvas-save-plan.js` `settledDeletionIndices`); marks on unticked or failed pages stay marked.
- Settings and display prefs → localStorage. Where you are in the Library (open page, reading order, grid filters,
  `libraryView`) is session-only on purpose. Stroke and transcript data → PageDoc only. Read localStorage through
  `lib/safe-storage.js` (or your own try/catch): a corrupt value read at module load must never stop the app starting.
- **The reading views hold copies** (scan records, the reader's page cache, thumbnail SVGs, the capture-date index).
  Anything that writes PageDocs outside the Library reader calls `refreshAfterSave(pages)` afterwards, and a data-folder
  change calls `resetForDataFolder()` (`lib/storage/refresh.js`); otherwise they show stale data until Rescan. Since
  v3.18.0 `refreshAfterSave` also signals `lastPageWrite`, so an open reader page reads its page again.

### Claude's transcript edits (v3.18.0, docs/MCP-WRITE-SPEC.md)

- **The MCP never writes a page.** `edit_transcript` posts to the running app's endpoint (`electron/mcp-endpoint.cjs`,
  main checks only the token and the shape) and `stores/mcp-edits.js` saves through `saveTranscriptLines(…, { base })`,
  then `refreshAfterSave()`. Opt-in in both places: `SMARTPEN_MCP_WRITES=1` registers the tools, and the app runs the
  endpoint only while Settings → Data folder → "Allow Claude to edit transcripts" (`allowClaudeEdits`) is on.
- **Refused, dry runs too** (`lib/mcp-edits.js` `editRefusal`): another data folder than the MCP's; a Library draft;
  **any transcript editor open on the page** (`transcriptEditorHold()` in `stores/viewer.js`: a clean Edit still saves
  its old lines back, so `isViewerPageDirty` is not enough; a new editor on a saved transcript must take a hold); a
  pending Editor transcription; a re-transcribe reset.
- `#n` plus `expect`; every number means the transcript before the call (resolved to ids first). All-or-nothing.
  Applying needs the dry run's `revision` (`metadata.lastUpdated`). Untouched lines are compared field by field
  (`untouchedChanged`) before and after the save.
- **Never ink or task state**: inserted lines get no `lineId`s; no WAITING / CANCELLED / DOING / NOW / LATER as a
  leading word; a deleted task needs `task_ok`. Task state stays with `setTaskState()`.
- **Undo log in `<userData>/mcp-edits/`, never the data folder**: appended before the save, dropped if it fails,
  stamped with the revision written; undo restores verbatim through `savePage()` only at that revision.

### Page tags (v3.1.0)

- **Tags are display metadata in `_tags.json`; never write them into a PageDoc.** A tag change is written at once
  (`stores/tags.js`, optimistic, per-page rollback): never `markUnsavedChanges()`, never `savePageToFolder()`, no
  `refreshAfterSave()` (every view reads the store). Main applies per-page patches inside one lock
  (`storage:patchTags`, `electron/tags-sidecar.cjs`); the format and every edit belong to `lib/tags.js`.
- **Tags are keyed by page key** (`tagKey()` = the orientation key), so a volume move must carry them:
  `finalizePageMoves().emptied` → `carryTagsForMoves()` (whole-page moves only, never onto a page that has tags).
- **Suggestions are never stored**, only dismissals; they are computed from stored transcript text
  (`record.transcriptionText`, so no page read) and never applied without a click.

### Tag types and details (v3.22.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase C)

- **`info` lives in `_tags.json`, never in a PageDoc**, and goes through the same `storage:patchTags` and the same lock:
  a patch's `info: { tag: record | null }` is applied in the same read-merge-write as its page lists. Main checks only
  the shape (`tags-sidecar.cjs` `checkInfo`: plain fields, `type` only `"person"` and never on a project number); the
  renderer owns the fields. A patch without `info` leaves the section untouched, so a 3.21 build writing tags keeps it.
- **One write for a tag manager change**: rename, merge and delete carry or drop `info` in the same patch as the pages
  (`renameTagInfo`: a rename moves the record; a merge keeps the target's fields and adds the source's display name,
  aliases and, for a person, its key as aliases; `deleteTagInfo`). A rename is a merge whenever the target is on a page
  **or has info of its own** (`renameIsMerge`, one rule for the store's label and the manager's confirm). `stores/tags.js` `commit()` diffs pages, dismissals and info together, applies them
  optimistically, rolls back per page and per tag (`rollbackInfoPatch`, only where nothing changed since), and Undo
  restores info too.
- **Three types only; a project is never stored.** `tagTypeOf()` reads the pattern first, so a stored type on a
  project number is ignored, and `withTagType()` never makes a keyword a project. Read a tag's type, label and names
  only through `tagTypeOf()` / `tagLabel()` / `tagNames()`; chips (`TagChip`, which reads `tagInfo` itself) show the
  label in the type's colour.
- Nothing is typed without a click: "Add as Person" in the tag input, or Manage tags → Details. No MCP tool sets a type.
  **"Add as Person" is one write**: TagInput hands its host `onAdd(tag, typeAs)` and every host passes `{ typeAs }` to
  `setPageTagList()` / `addTagToPages()`, which put the page list and the person in one patch (never a separate
  `setTagType()` call).
- A tag removed from its last page by hand keeps its `info`; Manage tags lists such tags with 0 pages
  (`withInfoOnlyTags`) so they can be edited, renamed or deleted.
- `collapsedTagGroups` holds type ids (`project`, `person`, `topic`); `parseCollapsedGroups()` reads the old
  `projects` / `keywords` as Projects / Topics.

### Block scope and people (v3.23.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase D)

- **A tag covers blocks, never by text alone.** `lib/tag-scope.js` is the one rule: roots are lines naming the tag (a
  project by `findProjectNumbers()`; a person by display name or alias, whole word, **case-sensitive** (decision 4),
  possessive allowed; no display name = the key capitalised), a block is a root and every following deeper line, a
  nested root covers only itself and its children, and no root = the whole page. Scope is computed only for tags ON the
  page; a name in text never puts a page under a person (decision 5): "Mentioned, not tagged" and "Tag this block…"
  tag a page only from a click.
- **`blocks` lives in `_tags.json`, never in a PageDoc**, in the same `storage:patchTags` and lock as pages and info
  (`tags-sidecar.cjs` `checkBlocksPage`: page keys by main's guards, normalized tags, `add` / `remove` string ids, nothing
  else; a bad entry rejects the whole patch; a patch without `blocks` leaves the section as it was). `stores/tags.js`
  `commit()` diffs it with pages, dismissals and info, applies it optimistically and rolls back per page
  (`rollbackBlocksPatch`); Undo restores it. Rename / merge move a tag's entries (`renameTagBlocks`, lists joined on a
  merge), delete drops them (`deleteTagBlocks`), and a volume move carries them with the page (`planTagCarry`), each in
  the same write as the pages. **Tag this block… is one write** (`tagBlock()`: the page's tag, a new person's type and
  the root together).
- **No page reads for scope.** The Person page, the Tasks view and the strip read scope from the scan records'
  `transcriptionText` (`linesFromText()`; it must give the same scope as the lines, tested). Hand corrections need line
  ids, so `stores/tag-scope.js` `scopeLines` reads ONLY the pages that have a `blocks` entry, with `getPage()` (never
  the reader's page cache), keeps `{ id, text, indentLevel }`, and reads again when the record's `lastUpdated` changes.
  Opening a block reads its page for the line id (`openScopeLine`).
- **People on tasks** come from block scope: `buildTaskRows()` `people` = Person tags on the page whose scope holds the
  task (its text, a `heads` text, an added root among its heads, or the whole page). `heads` is in BOTH summary
  builders (change both; `task-summary.test.js` runs them over one fixture). A task's `project` is unchanged.
- **Ticks only through `changeTask()`**: the Person page's Open items are `TaskRow`s, so task state still has one write
  path; nothing in Phase D writes a PageDoc.

### Deleted lines and Not text (v3.20.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase A)

- **No stroke is ever deleted by deleting a line.** Its ink is unlinked and, with the ink choice's default
  **Not text**, flagged `textless`; with *Transcribe it again* only unlinked. The Edit Transcription dialog reports
  its deletes on its result (`deletedLineIds`, `deletedLines` for lines of an unsaved run, `deletedInk`);
  `planTranscript()` returns `textlessIds` and the save applies them beside `lineIdAssignments` in the same write.
  Library Edit and the Pages tab's Edit structure go through `lib/deleted-ink.js` `relinkAfterEdit()`. Only lines the
  user deleted count: a Reset's replaced lines and merged-away lines never become Not text. A line left empty in the
  dialog is a Delete at Confirm (`emptiedLines`: task confirm, ink choice), never a silent drop. A deleted line of an
  unsaved run owns only strokes that were in its batch (the in-memory `transcribedStrokeIds`, never on disk; the match
  is by Y alone); with the batch unknown its ink is only unlinked, never flagged.
- **A textless stroke is in no line.** The save drops a link on any textless stroke (a stale canvas link
  included), leaves textless strokes out of new-line matching (Reset's replace too), and Transcribe never sends them
  (`groupStrokesForTranscription`, `getUntranscribedStrokes`).
- **Three-way on the canvas.** A loaded stroke has `textless: true` only when stored so; Leave out / Include
  (`stores/textless.js` `setStrokesTextless`) set `true` / `false`. Only an explicit `true` / `false` is synced by the
  save and counted as a **modification**, in both `pendingChanges` and `computePageChangesFolder()` (change both). A
  stroke without the key has no say, so a page loaded before Library Edit flagged its ink can't clear the flag.
- After a save, `applySavedDeletedInk()` brings the canvas copies in line with the disk (not an unsaved edit), and
  `clearTextlessMarkers()` spends the `textlessFrom` links Leave out keeps so an Include before the save restores
  the link. Library Edit and the Pages tab call `syncCanvasAfterPageWrite()` after their direct writes (the deleted
  lines' ink and the on-disk state index of a page also on the canvas).
- **A canvas link never replaces a live disk link with a dead one.** The save syncs a canvas `lineId` only if it is a
  line of the transcript written; otherwise the disk's link stands (`diskLinkBeforeSync`).
- **Claude's edits never set it.** `saveTranscriptLines()` flags only when passed `deletedInk: 'textless'` (Library
  Edit's choice); `edit_transcript` passes nothing, so its deletes only unlink.

### Relink (v3.21.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase B)

- **Relink keeps the transcript; Reset replaces it.** `planTranscript(…, { relink })` (`lib/relink-plan.js`) writes
  only linked lines' `yBounds`, the sent strokes' `lineId`, `lastTranscribed` and `lastUpdated`, plus the word fixes
  the review took and lines from "Add as new line". Never line ids, other text, order, indent, `parentId`, `checked`,
  `marker` or kind lines, so no task state is carried. No stroke is deleted; leftover ink is unlinked or, by choice,
  flagged Not text in the same write. One write path: `savePageToFolder({ relink })`, then `refreshAfterSave()`.
- **A relink must link at least one line** (`noLinks` in the save, `NO_LINKS` in `saveRelink`, Save disabled in the
  dialog): bumping `lastTranscribed` with nothing linked would make the page read as trustworthy with all its ink
  unlinked. A text line left unlinked is written with `yBounds: null` (its pre-fix ones were never re-measured and
  would look like a position on a trustworthy page; null was already a valid stored value).
- **Never sent, never relinked**: textless strokes and strokes linked to a line with any `kind` (`relinkSendStrokes`;
  `planRelink` skips a kind line's strokes).
- **Decorative ink is held back** (`holdBackDecorative`, Deselect Decorative's detector on the turned copies; never a
  task box): recorded as the run's `heldBack`, and the save always unlinks it (Not text too, unless the review
  unticks it). A held-back stroke never keeps an old link. A cache entry without `heldBack` is invalid.
- **Relink selection** (the Editor's selection ⋯) sends one page's selected strokes, uncached; refused over several
  pages or with unsaved changes on the page. Ink not sent is unlinked when the page was untrustworthy before the save
  and keeps its links when it was trustworthy (`planRelink` `trusted`, decided by the save from the disk), so a
  table can be relinked a column at a time. Kind lines are never aligned
  (`textLines`), so Phase E's sketch lines need no change here.
- **Moved lines keep their place.** A line stored out of place pairs with its reading elsewhere (`movedPairs`) as a
  confirm row marked `moved`; linking it writes only `yBounds` and ink. A page with one is never saved by the bulk run
  without review. A line merged by hand takes several consecutive MyScript lines (`alignLinesJoined`, union of
  their bounds); "Add to #N" gives leftover ink to the linked line above. Neither changes text. A page already linked
  is relinked only through the reader's ⋯ → Relink again… after a confirm (`relinkRefusal(…, { again })`).
- **Guards** (`relinkRefusal`): the same four flags as `editRefusal`, read by one function, `stores/page-guards.js`
  `pageGuardState()` (change both refusals together), plus a trustworthy page, no text lines, no ink to send. The
  dialog takes a `transcriptEditorHold()` while reviewing. The save re-checks the revision: a page written since its
  MyScript run is refused (`stale`) and sent again.
- **The cache lives in `<userData>/relink-cache/<bookKey>/<pageId>.json`, never in the data folder**, keyed by the
  page's `metadata.lastUpdated` (`cachedRunValid`); dropped after a save. No MyScript request without a click (the
  dialog's Send, or the bulk Run).
- A page also loaded in the Editor takes the written links and flags on its canvas copy, and the on-disk index
  follows, through Phase A's `syncCanvasAfterPageWrite(book, page, { strokes, textlessIds, links })`
  (`stores/textless.js`); otherwise the Editor's next save would put the old links back, or a Not text flag would read
  as unsaved. The canvas keys strokes by the integer NCode page, so a **letter-suffixed page is refused while its page
  number is on the canvas** (`suffixOnCanvas`).

### Tasks (v3.4.0)

- **One write path for a task's state:** `lib/viewer/task-state.js` `setTaskState()` (from the UI through
  `stores/tasks.js` `changeTask()`). It changes one line's `checked` / `marker` and `metadata.lastUpdated`, nothing
  else: never `transcript.lastTranscribed` (`isTrustworthyTranscript()` reads it), text, other lines or strokes.
- **Refused on a page with an unsaved Library transcript draft** (`isViewerPageDirty`): the draft's save writes every
  line verbatim and would undo the tick. A line id that is gone or is not a task → error, no write. Undo is kept, not
  spent, while it would be refused.
- **Not a task** (v3.7.0, `NOT_A_TASK = 'none'`, ⋯ menu) makes a task a plain line (`checked: null`) through the same path. It
  is not a fifth state: no row, count or filter shows it. Making a plain line a task needs `allowPlain`: the reader's
  ⋯ Make task on a plain line (v3.7.1), and the Undo of Not a task. In Library Edit, a box typed in front of a new or edited
  plain line (`TODO`, `[ ]`, ☐, `DONE`, `[x]`, ☑) makes it a task on save (`parseTypedTasks`), as in the Editor's dialog.
- **Edits never change task state.** The Edit Transcription dialog's merge / split carry it (`lib/editor-lines.js`),
  and every editor save takes the disk's state for lines whose state it didn't change (`keepDiskTaskState`: Library
  Edit via `saveTranscriptLines(…, { base })`, Editor Pages tab via `buildEditedTranscript`).
- It refreshes its own copies instead of calling `refreshAfterSave()`: the scan record (`applyTaskStateToRecord`), the
  page cache (`invalidatePage`) and the open reader page (`noteTaskWritten` → `lastTaskWrite`). Keep that list in step
  if another view starts showing task state from its own copy.
- The scan's `tasks` summary is built in main (`electron/task-summary.cjs`) and mirrors `lib/tasks.js`
  `buildTaskSummary()`; change both (`task-summary.test.js` runs them over one fixture). Keep it scalar-small.

### Retiming strokes (v3.6.0)

- **The id is the time.** A stroke's id is `s{startTime}`, so the Editor's Set time… (`lib/retime.js`, store action
  `retimeStrokes()`) changes it. `shiftStroke()` stamps the in-memory `retimedFrom: { id }` (the id on disk, kept from
  the FIRST retime) and the save deletes that id (`getRetimedAwayStrokeIdsForPage()`) while appending the new one.
  Without it every retimed stroke would be saved twice.
- **Every "id to remove from disk" goes through `strokeDiskId()`**: deletion (`getDeletedStrokeIdsForPage`), volume
  move (`getMovedAwayStrokeIdsForPage`) and retime. Using `s{startTime}` there misses a retimed stroke's stored copy.
- Start, end and numeric point timestamps shift together; null point timestamps, force, sketch and `lineId` don't.
  Pasted strokes are never retimed.
- **Sidecar first, then the page.** The save records `pages/_retimed.json` before writing the page (a failed write
  holds the page back), then `clearRetimedMarkers()`. A stroke that also moved volume keeps its marker until
  `clearMovedFromMarkers()` (its old id is on the source page).
- `pendingChanges` and `computePageChangesFolder()` both have a **retimes** bucket (old id on disk on this page, new id
  not); change both. The dialog refuses a shift that lands on an id already taken on the page (`findRetimeCollisions`).

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
  `strokes` array**. Anything that removes strokes from the middle must shift them (as `stores/canvas.js` does through
  `pending-changes.js` `adjustDeletionsAfterRemoval()`). An unshifted deletion mark deletes a *different* stroke from disk at next save.
- `contextInk` is drawn but not owned: it stays out of `strokes`, so it can never be selected, saved, exported or
  transcribed. It counts toward page bounds, never toward capture date.
- `pendingChanges` has six buckets (additions, edits, modifications, moves, retimes, deletions); a stroke lands in
  exactly one. Modifications are the flag toggles: `sketch`, and `textless` when set true / false on the canvas.
  `SaveConfirmDialog` does **not** read it: it runs `page-changes.js` `computePageChangesFolder()`
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
- Pages transcribed before Aug 2026 mostly have wrong stroke `lineId`s (left alone until relinked: Relink, v3.21.0, fixes a
  page and keeps its text; re-transcribing replaces the transcript).
  The batch origin is never stored, so line → ink in the Library's Ink + text uses the stored `lineId`s, and only
  where `isTrustworthyTranscript()` (`lib/viewer/ink-text.js`) says the page was matched by the fixed code; a
  date check alone is wrong (Library transcript edits bump `lastTranscribed`).
- **Task boxes are parsed on transcription** (v3.3.0): `mergeTranscript()` runs each new MyScript line through
  `parseTaskMarker()` (`lib/task-markers.js`), so a leading `☐` / `[ ]` / `TODO` becomes `checked: false` and
  `☑` / `☒` / `[x]` / `DONE` becomes `checked: true`, with the marker stripped from `text`. A bare `✓`, `WAITING`, `CANCELLED`
  and lowercase `todo` stay text. The duplicate check compares marker-stripped text on both sides. Pages
  transcribed earlier are converted once from Settings → Maintenance → Convert task boxes… (preview first;
  `lib/storage/convert-task-boxes.js`), which bumps `metadata.lastUpdated` but never `lastTranscribed`, and never
  overrides a `checked` already set (a glyph that disagrees is left in the text as a conflict).
- MyScript only sees strokes that are loaded, so transcribing a partially loaded page covers those strokes only.
- Free tier is 2,000 requests/month, HMAC-authenticated; process page by page.
- **Deselect Decorative** (`lib/stroke-filter.js`) runs per page and must never take a task box (☐ / ☑, which
  `parseTaskMarker()` needs) or a strike-through (left for MyScript to see). Tune it against the real data folder,
  not only the synthetic tests (CHANGELOG, "Deselect Decorative: rewritten detector").

### Pen and SDK

- Web Bluetooth works only in Chromium/Electron, needs an explicit pairing dialog, and connections drop.
- The SDK emits `{x:-1, y:-1, f:0}` as the first dot of every stroke with stale `pageInfo`. `processDot()` keeps
  `pageInfo: null` / empty `dotArray` until the first real dot and finalises only confirmed strokes.
- **Remembered pen (picker skip).** `connectPen()` arms main with the last pen (`rememberedPen`, saved after a successful handshake; `autoPickPen` setting) via `bluetooth-set-auto-target`. Main's `select-bluetooth-device` handler then calls `callback(id)` for a match (`electron/pen-match.cjs`: id first, else a *unique* name) and never opens the picker; after `AUTO_PICK_WAIT_MS` (5s) with no match the picker opens as before. The pen must already be on when Connect is clicked. No background scan or reconnect loop, by design (a dirty GATT release can wedge the Windows stack). Unverified on hardware.
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
- **Page rotation is display-only** (`lib/page-orientation.js`): never rewrite stored points for it. Turn a page within
  its paper frame (Neo frame, or `NOMINAL_FRAME`), never its ink box, and apply it as ONE transform per page: an SVG
  `<g transform>` in the Library / Timeline, the Editor's per-page `pageProjection()` affine. Every canvas Ncode↔screen
  mapping must go through `pageProjection()` / `ncodeToScreen()` / `screenToNcode()` so it follows the turn.
  Transcription sends turned copies and matches stored strokes in that frame (`strokesInTranscriptionFrame()`).
- Neo page backgrounds are drawn only in the read-only views (Library, Timeline), never in the Editor, whose
  page bounds come from ink. `resolvePageBackground()` never throws: any failure means "no background". They are keyed
  by NCode book number (a volume shares its book's paper) and a suffixed page uses its integer page's image.

## Conventions

- Svelte 4: `$:` for reactive statements; import stores directly (never pass them as props); derived stores for
  computed values. Components group by feature and stay under ~300 lines.
- Svelte 4 treats `el.prop = x` as an assignment to `el`. If a `$:` depends on `el` and (directly or through a
  function) assigns one of its members, it re-triggers itself forever and freezes the window. Use a method
  (`el.scrollTo(...)`) or a local alias.
- Business logic lives in `src/lib/` as pure functions with unit tests. Filesystem access is IPC only.
- Long operations: try/catch, report to ActivityLog with `log()`, show progress.
- Window-level keyboard shortcuts stand down while typing (`isTypingTarget`), mid-IME, when the key was already handled
  (`defaultPrevented`) and under a modal (`modalOpen()`: anything with `aria-modal="true"`). A menu or dialog that
  handles Escape calls `preventDefault()` so the reader / canvas behind it leaves the key alone.
- Tracing goes through `debug()` (`lib/debug.js`), not `console.log`.
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

The full list (per feature: rotation, volumes, tags, retime, tasks, print, LogSeq export, backgrounds) is in
[docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md). The ones that change how you work:

- **Never open OS print dialogs or print jobs from test processes or on Josh's desktop** (it stalled his other Electron
  apps). Print to a printer is `print:toPrinter` through the Windows dialog, never silent. Verify print output by
  rendering the job's HTML with `printToPDF` from a scratch process.
- Several components are over the ~300-line guideline (StrokeCanvas ~2,810, TranscriptionView ~720, TranscriptionEditorModal ~490, CreatePageDialog,
  SaveConfirmDialog, PageCard, BooksTab, PenMemoryDialog, …); don't grow them, split when touching.
- Main-process and renderer tracing is behind `lib/debug.js` (`localStorage['smartpen-debug'] = '1'`, or the dev
  server). Never log MyScript keys or the HMAC, not even fragments.
- Neo page backgrounds are a spike (see [docs/CHANGELOG.md](docs/CHANGELOG.md), "Neo page backgrounds"): images are
  Neo's, so keep `pages/_backgrounds/` and any real-handwriting screenshots out of commits.
- Open idea, not started: calendar sync from the 2027 Neo Smart Planner (Josh, 2026-09-30); start with an `.ics`
  export. Notes in [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md).

## Documentation

| Doc | Read it for |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component tree, every store, every library, UI structure notes |
| [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md) | Per-feature limitations and open ideas (the planner note) |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Why each feature is built the way it is; rejected alternatives; history from v1 to v3.0.0 |
| [docs/TESTING.md](docs/TESTING.md) | Test-file inventory and the manual test checklist |
| [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) | Storage design; §12 records changes to `strokes[]` since v2.0 |
| [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) | Notebook volumes: design and rejected alternatives |
| [docs/READING-UX-SPEC.md](docs/READING-UX-SPEC.md) | **v3.0.0** reading-first UI/UX, packages A–E (built), with [mockups](docs/READING-UX-MOCKUPS.html) |
| [docs/PAGE-TAGS-SPEC.md](docs/PAGE-TAGS-SPEC.md) | **v3.1.0** page tags (built), with [mockups](docs/TAGS-UI-MOCKUPS.html) |
| [docs/MCP-SERVER-SPEC.md](docs/MCP-SERVER-SPEC.md), [mcp/README.md](mcp/README.md) | The read-only MCP server: decisions (spec); tools, caps and setup (README) |
| [docs/MCP-WRITE-SPEC.md](docs/MCP-WRITE-SPEC.md) | **v3.18.0** transcript edits from Claude through the running app (built) |
| [docs/TRANSCRIPT-STRUCTURE-SPEC.md](docs/TRANSCRIPT-STRUCTURE-SPEC.md) | Delete lines + Not text (A, v3.20.0), Relink (B, v3.21.0), tag types (C, v3.22.0), block scope and people (D, v3.23.0) built; sketches (E) to come |
| [docs/NEOSMARTPEN-SDK-USAGE.md](docs/NEOSMARTPEN-SDK-USAGE.md) | Pen SDK usage |
| [docs/EDITOR-IMPORT-SPEC.md](docs/EDITOR-IMPORT-SPEC.md) | The handwriting editor's import formats, which the JSON / Markdown exports follow |
| [docs/Archive/ARCHIVE-INDEX.md](docs/Archive/ARCHIVE-INDEX.md) | Superseded v1 / LogSeq-era specs, reviews and implementation logs |
| [scripts/migrate-from-logseq.cjs](scripts/migrate-from-logseq.cjs) | One-shot v1 LogSeq → v2 PageDoc importer |

External: [NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0) · [MyScript API](https://developer.myscript.com/) · [Svelte 4](https://svelte.dev/docs/svelte/overview).
