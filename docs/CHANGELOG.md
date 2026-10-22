# Changelog and Design Rationale

Newest first. Each entry records *why* a change was made, what was rejected, and the
limitations it left behind; the code and `git log` say *what* changed, so per-entry
file lists have been dropped. Current rules distilled from these entries live in
CLAUDE.md (Invariants); the store and library map is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## v3.6.0 — Set time… for selected strokes (October 2026)

**Move the earliest selected stroke to a chosen time; the rest keep their spacing.** Editor → select strokes →
**🕒 Set time…** opens a dialog with the selection's earliest and latest times, a local date + time (seconds) field,
±day / hour / minute nudges, the resulting shift and each page's capture days before → after. Applying is an unsaved
Editor change (amber dot) like a sketch flag or a volume move; nothing is written until Save. Feasibility review and
mockups: [RETIME-MOCKUPS.html](RETIME-MOCKUPS.html).

**The id is the time, so a retime is a delete plus an add.** Stored ids are `s{startTime}` and saves are append-only,
so a retimed stroke saved naively lands under its new id and the old copy stays: every stroke twice, silently. The
fix is the `movedFrom` pattern: `shiftStroke()` stamps an in-memory `retimedFrom: { id }` (the FIRST disk id, so a
second retime before saving still names the stored copy; shifting back to it drops the marker), and the save unions
`getRetimedAwayStrokeIdsForPage()` into the deletion set. Two existing paths had the same blind spot and now read
`strokeDiskId()`: deleting a retimed stroke before saving and moving one to another volume both named the new id and
left the stored copy. A stroke that is both retimed and moved has its old id on the source page, so the move-away
handles it there and its marker lasts until `clearMovedFromMarkers()`.

**Collisions are refused, not nudged silently.** A shifted stroke landing on the exact millisecond of a stroke that
isn't moving (on disk or on the canvas) would be dropped by the dedupe. The dialog reads the affected pages once for
their ids and disables Apply with a "+1 ms" offer. Ids vacated by the selection itself, or by an earlier unsaved
retime, are free.

**The pen still has the old times: `pages/_retimed.json`.** Offline import dedupes by id, so re-importing pen memory
would bring every retimed stroke back at its original time. The save records `{ "<ncodeBook>/<page>": { "s<penId>":
"s<idNow>" } }` (physical page, since volumes share paper and the pen id doesn't depend on the volume) and import
drops those strokes with an Activity Log note. Chains collapse to the pen id (`s1 → s2`, then `s2 → s3` = `s1 → s3`);
a retime back to the pen time removes the entry. Written BEFORE the page: if the page write then fails the old id is
still on disk, and dropping the pen's copy of it loses nothing; a failed sidecar write holds the page save back.
Rejected: only warning to clear pen memory (import is exactly when a bad pen clock shows up), and remapping the
imported stroke to its new time (the retimed copy is already on disk, so dropping is the same result with less code).

**Save dialog** gains a Retiming count and a per-page "🕒 n retimed" chip; the summary row now wraps (nine counts no
longer fit). Checked in the app on a scratch data folder with a separate profile: +2 d 1 h on six strokes → the file
has six strokes at the new times (point timestamps shifted, force kept), `_retimed.json` maps all six; shifting back
restores the original ids and empties the sidecar. Not checked on hardware: the import drop (unit-tested).
Limitations: re-exporting a retimed page to LogSeq adds a second copy there; no separate undo after Apply.

## v3.5.0 — CANCELLED task state (October 2026)

**A fourth state, set by hand like WAITING.** A task that won't be done can be marked CANCELLED from its ⋯ menu (Tasks
view and reader); it is never read from text. It is stored as `marker: 'CANCELLED'` beside `checked: true`, the
mirror of WAITING beside `checked: false`. Rejected: storing it beside `checked: false`, which would make every
older reader (and the LogSeq copy before this version) show a cancelled task as open TODO; beside `true` it reads as
DONE, so it is at worst shown closed. `markerOf()` keeps a marker only on its own side, so a stray
`CANCELLED`-beside-`false` is dropped like a stray WAITING-beside-`true`. A cancelled task is drawn struck through
with a grey ✕ box / ⊘ marker and a CANCELLED chip, has its own Cancelled filter and count (the open badge is
unchanged), and clicking its box reopens it as TODO (the menu's "Restore (back to TODO)"); the menu always offers
the three other states. Copy all writes `- CANCELLED …`, which LogSeq treats as a closed task. Checked in the app on
a copy of the data folder: cancel from the row menu and from the reader, the file changes only that line
(`checked: true`, `marker`) and `lastUpdated`; reopen and Undo; saving from the transcript editor keeps the marker;
Copy all output.

## v3.4.0 — Tasks view, ticking in the reader, WAITING (October 2026)

**A task list built from the scan, not from reading pages.** After v3.3.0 about 98 lines across 120 transcribed
pages carry a TODO / DONE state, almost all under a meeting heading and most on a page with a project tag. Library ›
**Tasks** (`libraryView` `{ kind: 'tasks' }`, from a Tasks card on the Library home and a header button with the
open count) lists them, filtered Open / Waiting / Done / All and grouped by project tag, date written or notebook.
Each scan record carries a small `tasks` summary (id, text, state, parent line's text; text clipped), built in main
next to `transcriptionText` (`electron/task-summary.cjs`, mirroring `lib/tasks.js` `buildTaskSummary()`, with a
shared fixture test so the two can't drift). Rejected: deriving tasks from `transcriptionText` (it has no line ids or
state) and reading PageDocs when the view opens (the scan is metadata-only on purpose). The parent is the line
`parentId` names, else the nearest shallower line, because 12 of the real tasks' `parentId`s point at lines that no
longer exist. The project is the page's first project tag (tags are per page, so every task on a page shares it);
the date is the page's capture days from the timeline index, since stored `lineId`s are unreliable before Aug 2026
and a per-line date would need stroke reads. A page written over several days shows its range and groups under its
first day.

**A tick is a one-line PageDoc write.** `setTaskState()` (`lib/viewer/task-state.js`) reads the page, changes that
one line's `checked` (and `marker`), bumps `metadata.lastUpdated` and writes through `savePage()`. It never touches
`transcript.lastTranscribed`: that date says when MyScript last matched lines to ink, and `isTrustworthyTranscript()`
reads it. Instead of `refreshAfterSave()` (a full rescan and timeline refresh per tick) it updates the copies that
can change: the scan record's summary and `lastUpdated`, the reader's cached doc, and the open reader page, which
patches its doc from `lastTaskWrite` so it follows at once. Thumbnails, search and capture dates don't depend on the
state. It is refused on a page with an unsaved Library transcript draft (the draft's save writes every line verbatim
and would put the old state back), on a line that no longer exists, and on a line that isn't a task; nothing is
written then. The Editor needs no guard: its save starts from disk and keeps existing lines untouched, so a tick
survives it, and re-transcription keeps an existing line's state. `stores/tasks.js` applies a change optimistically,
like a tag change: an override shows it at once, writes to one page run in order, a failed write rolls back only that
task (only if nothing changed it since) and logs why, and the last change can be undone from a toast.

**WAITING is set by hand.** The third state is an optional `marker: 'WAITING'` beside `checked: false`, written only
for WAITING, so `PAGE_DOC_VERSION` stays "2.0" and older code reads the line as an ordinary TODO. TODO and DONE clear
it. It is set and cleared only from a task's ⋯ menu (in the Tasks view and beside a reader line), never read from
text, which is why "☐ waiting on …" lines stay TODO. Every place that copies a line carries it (`markerField()`: the
Library editor's clone and save, the Pages-tab editor; the transcript merge keeps existing lines as they are), and
Copy all writes `- WAITING …`. No DOING / NOW / LATER anywhere.

**Ticking in the reader.** In the Library's read-only transcript the ☐ / ☑ / ◷ marker is a button (DONE ↔ TODO) with
the same ⋯ menu beside it on hover. A task's page link opens the reader with that line marked by id (on any page,
not only trusted ones; its ink lights only where links are trusted) and moves Strokes to Ink + text so the line is
visible. Edit mode is unchanged and keeps `marker`. Not built: the ink snippet on hover from the mockup, and any
LogSeq copy or sync of tasks. Checked on a copy of the real folder after Convert task boxes: 98 tasks (82 open, 16
done); a tick, WAITING, Undo and a reader tick each changed only that line and `metadata.lastUpdated` on disk.

## v3.3.0 — Task boxes become TODO / DONE (October 2026)

**Boxes are a line's state, not its text.** A transcript line has had `checked` (null | false = TODO | true = DONE)
since v2.0, and the Library reader and Copy all already render it, but `mergeTranscript()` set it to null for every
new MyScript line. MyScript returns a drawn box as `☐` and a ticked one as `☑` at the start of the line, so they
stayed in the text and a paste into LogSeq gave `- ☐ Call Troy…` instead of a task. Each new line now goes through
`parseTaskMarker()` (`lib/task-markers.js`): `☐` / `[ ]` / `TODO` → TODO, `☑` / `☒` / `[x]` / `DONE` → DONE, marker
stripped (and a list dash written after the box). In the Oct 2026 data MyScript never read a box as O, D or 0 and
never put one mid-line, so the rule is start-of-line glyphs only. Not markers, on purpose: a bare `✓` (one in the data,
a remark rather than a task); lowercase or mixed-case `todo` ("Todo list for Friday" is a heading, and a typed
marker comes from LogSeq habit, which is capitals); and `WAITING`. Rejected: reading "waiting on …" from the text as
a third state. There were two such lines, and WAITING will be set by hand in the app instead, so those lines stay
TODO (from their box) or plain text (typed `WAITING`). The duplicate check now compares marker-stripped text on both
sides, so re-transcribing a page whose old line still says `☐ Call Troy` does not add a second `Call Troy`. An
existing line's `checked` was already kept through re-transcription, so a DONE is never reset by ink that still
shows an empty box.

**Converting pages transcribed earlier.** Settings → Data Folder → **Convert task boxes…** (`ConvertTaskBoxesDialog`,
planner in `lib/storage/convert-task-boxes.js`) reads only pages whose scan text can hold a marker, lists every line
it would change (page, TODO / DONE, old → new) and writes nothing until Convert. Each page is then read again and
converted from what is on disk at that moment; a line edited since the preview is skipped, not converted from stale
text. Writes go through `savePage()`, then one `refreshAfterSave()`. Only `text` and `checked` change, plus
`metadata.lastUpdated`. `transcript.lastTranscribed` is left alone because nothing was re-recognised, and that keeps
`isTrustworthyTranscript()` giving the same answer (it reads only the date, line ids, yBounds and stroke links).
Conflicts: a line whose `checked` is already set keeps it, because it was set deliberately (v1 migration, a Library
edit) after the ink was read. If the glyph agrees, the glyph is stripped. If it disagrees (`☐` on a DONE), the line
is left exactly as it is and listed as left alone, so the disagreement stays visible instead of being silently
resolved. None of the real data hit this case. Convert is disabled while a Library transcript edit is open, because
its save would write the old text back. On a copy of the real folder: 53 lines on 23 pages (41 TODO, 12 DONE).
Rejected: converting on read (every view and the scan text would need the parser, and the LogSeq copy would
disagree with the file) and converting silently at startup (it rewrites saved files, so it should be visible and
confirmed).

## v3.2.0 — Tag reading order, tag manager in the Library (October 2026)

**Reading a tag's pages as a book.** A tag's grid (or Untagged, or any grid with a tag filter on) only showed
thumbnails; opening one put the reader back in that page's notebook, so ←/→ left the tag at once. Now the grid hands
the reader its pages (`buildSequence`, `lib/viewer/reading-order.js`), sorted notebook then page, and the reader
starts in **Tag** order, with a Book | Tag toggle in the spread toolbar. Rejected: a third Library "mode" with its
own grid → reader route (the reader already exists; only what ←/→ walk changes), and re-evaluating the filter live
while reading (retagging the open page would pull it out from under you mid-read; the sequence is a snapshot of the
click, and pages deleted since are skipped). Tag order applies only while the open page is in the sequence, so a
page opened some other way (search, Contents, a feed card, Recent) reads in Book order and `openPageInLibrary`
drops the sequence. Switching to Tag from a page Book order turned to lands on the next tagged page
(`landingInSequence`). Go to page stays per notebook and switches to Book when the target is not tagged. Each grid's
filter is now kept for the session (`gridFilters`), so the crumb back from the reader finds the grid as it was. A
spread can pair two notebooks' pages: each page header already names its notebook, and the Contents highlight
leaves out the other notebook's page. `ReaderSpread` was split out of BookViewer, which was over the size guideline.

**Tag manager in the Library.** It is about pages, and the Library is where pages and notebooks are managed, so
it moved from the Settings dialog to a Library view (`libraryView` `{ kind: 'tags' }`, **Manage tags** on the
home, `Library › Manage tags`), restyled for the light reading surface; a tag's chip opens its pages, and the
Tag / Pages / Notebooks headers sort the table (click again to reverse; remembered per viewer as
`smartpen-tag-manager-sort`, `sortTagStats()` in `lib/tags.js`). A rename, merge, delete or reset of dismissals
now shows **Undo** in a bar above the table (`tagUndo` / `undoTagChange()` in `stores/tags.js`): a merge forgets
which pages had which tag, so a mistaken one could not otherwise be split again (merged the wrong way round only
needs a rename back). Undo puts back each page the change touched with the same `rollbackPatch` a failed write
uses, in one write. It covers only the last change and ends at the next tag change of any kind, a failed write or
a data-folder change (so nothing can have moved under it), and is session-only: undoing across a restart would
need a stored history, which wasn't worth a second sidecar.
`TagManagerDialog` and the Settings → Tags section are gone.

**The Library opens on its home each launch.** The open page used to be restored from localStorage
(`smartpen-viewer-selection`), so the first Library click of a session dropped you into an old spread. It is now
session-only, like the rest of the Library's place: coming back from the Timeline or Editor still returns to it.
The old key is removed at startup.

## Unreleased — Settings layout (October 2026)

Settings had grown into one long scroll, with the tag table in the middle of it. **Manage Pen Memory** left
Settings for the header's pen chip: it is about the pen, so while one is connected the dot and the pen's name
are a button that opens it (no button when disconnected, since the dialog needs the pen). The **tag manager**
moved into its own dialog behind Settings → Tags → Manage Tags: its table and Rename / Merge into… actions
need more than the dropdown's 400–500 px, and a long tag list pushed every setting below it out of view
(folding it in place was the alternative; a dialog gives it the width). **Notebooks** folds (a `<details>`,
closed by default, the open state kept in localStorage as `settingsNotebooksOpen`), being a row per notebook.

## v3.1.0 — Page tags (October 2026)

Spec: [PAGE-TAGS-SPEC.md](PAGE-TAGS-SPEC.md), with [mockups](TAGS-UI-MOCKUPS.html). Pages can carry
keywords (`beam`, `site-visit`) and project numbers (`P2026-141`, `2327-018`). The Library can be read by tag
as well as by notebook, any page grid filters and bulk-tags, project numbers found in transcripts are
suggested, and Ctrl K finds tags. PageDoc stays `"2.0"`; nothing in a PageDoc changed.

**A sidecar, not a PageDoc field.** Tags live in `pages/_tags.json`, keyed `"<bookKey>/<pageId>"` like
`_orientation.json`, untagged by absence. Putting them in the PageDoc was rejected for the same reasons
rotation was: a tag is not a stroke or transcript edit, and storing it there would route a label through the
append-only save path, `validatePageDoc()`, the SaveConfirmDialog diff and the unsaved-changes marker, and make
every tag change a rewrite of a 250 KB page. A tag change is written at once, is not an unsaved edit, and needs
no `refreshAfterSave()`: every view (grid tiles, tag cards, the queue, the search index, the reader strip)
reads the same store. Bulk edits (tag 40 pages, rename a tag on 300) are one small write instead of hundreds.

**One write handler, the logic in the renderer.** The spec sketched a handler per edit (set, bulk, rename,
merge, delete, dismiss, reset). Instead every edit is a map → map function in `lib/tags.js`, the store applies
it optimistically, and main gets the difference as a per-page patch (`storage:patchTags`:
`{ pages: { key: tags[] | null }, dismissed: {...} }`), applied read-merge-write inside one lock with an atomic
write. So there is one implementation of each edit (tested), main stays a validator (keys through
`requireBookKey` / `requirePageId`, tags must already be in normalized shape, a bad entry rejects the whole
patch), two quick edits to different pages can't overwrite each other, and a failed write rolls back only the
pages it changed, only where nothing has changed them since (the `setPageRotation` rule). Main's half is a
pure module (`electron/tags-sidecar.cjs`) so it is tested from Vitest. A corrupt file reads as empty and is
left alone by reads; the first tag change replaces it and says so. A file from a newer version is read but
never rewritten. Unknown top-level fields survive a write.

**Normalization.** Project numbers are recognised after trimming, removing spaces, dropping `[[ ]]` and
mapping dash types to `-`: `p 2026–141` and `[[P2026-141]]` are `P2026-141`; a job number gets no P.
Keywords are lowercase `a-z 0-9 - _`, whitespace to `-`, accents dropped, at most 40 characters. Page lists
are de-duplicated and sorted, project numbers first.

**Suggestions are pattern-only and never stored.** A number shaped like `P####-###` or `####-###` in a
page's transcript is offered, with the line it came from; ✓ tags that page only, ✕ dismisses it for that
page. Only dismissals are stored, so re-transcribing refreshes suggestions while a dismissal survives.
Validation against LogSeq / BQE was rejected for v1: the app can't see either, and a wrong number costs one
✕. Mapping letters to digits (`O`→`0`, `l`→`1`) was rejected: in real notes it would turn ordinary words and
codes into project numbers. Dates (`2026-10-21`), phone numbers and longer digit runs don't match. On the real
planner (book 3017) the pass finds 43 numbers on 79 pages, `9999-110` (overhead) on 33 of them; Dismiss all
handles that in one click.

**No page reads for suggestions.** The spec's background scanner read each transcribed page through
`getPage()`. The scan records already carry each page's stored transcript as `transcriptionText` (global
search uses it), so the pass reads those instead: no IPC, nothing through the page cache or the thumbnail
cache. Matching 740 transcribed pages takes about 15 ms. It still keeps the spec's shape: it runs when a
Library list view asks and the scan is idle (never during a scan or an offline import), reports progress,
can be cancelled, caches per page by transcript text, and keeps what it found apart from what is pending
(found − tags − dismissals, re-derived on every tag change), so a ✓ or ✕ anywhere updates every view at
once. It first yielded every 40 pages, which on a 1,036-page root left it waiting behind queued thumbnail
reads (2.4 s to re-check); it now yields after 12 ms of work (0.75 s including the queue's re-render). The
reader strip computes from the open page's record the same way.

**UI without growing the big components.** `LibraryBrowse` takes over BookViewer's home / grid branch
(BookViewer 302 → 301 lines with the strip added), `LibraryHomeHead` takes LibraryHome's header (189 → 128),
and `NotebookPages` renders the shared `PageGrid` (125 → 64). `PageGrid` is the generalized page-list source:
a notebook's records, a tag's (`recordsForKeys`) or the Untagged ones, with `TagFilterRow` (tags in this
grid with counts; All offers only tags that still match, so a click can't empty the grid), select mode
(shift-click range) and `BulkTagBar`. The reader's strip sits beside the spread and folds into one bar above
it under 900 px of reader (a container query, so it follows the pane, not the window); in a spread
`P12 | P13` picks the page. Opening anything still goes through `openPageInLibrary` / `openLibraryView`, so
the unsaved-transcript prompt stays in one place. Settings → Tags (`TagManager`) and the Tags group in Ctrl K
(always just above Pages; a project-number-shaped query matches the tag exactly) read `tagStatsList`, rebuilt
per tag change, not per keystroke.

**Volume moves carry tags.** Tags are keyed by page key, so reassigning a page's strokes to another volume
would strand them. `finalizePageMoves()` already decides whether a move emptied its source page into exactly
one target (that is when the transcript follows); it now reports those moves (`emptied`) and ActionBar passes
them to `carryTagsForMoves()`, which moves the source's tags and dismissals onto the target only when the
target has none. A partial move leaves tags where they are. Checked in the app: `390v2/1` reassigned to a new
volume 3 → the emptied source file was removed as before and its tag moved to `390v3/1`.

**Measured on a 1,036-page data root** (the real folder plus the planner copied into six more books, 691 pages
tagged): Group by Tag 150 ms, a 345-page Untagged grid 280 ms, a 173-page tag grid 250 ms, a filter click
about 280 ms, the queue (724 suggestions) 380 ms to open; only on-screen thumbnails load.

**Limitations.**
- Suggestions are pattern-only: no check that a number is a real project, and letters read for digits
  (`P2O26-141`) are missed.
- Tags don't follow a partial volume move.
- Project names aren't shown on chips (storage is unaffected if they are added later).
- No tags on Timeline cards or in the Editor; tags aren't exported to LogSeq.
- Tags on a page deleted later stay in the sidecar: hidden everywhere, but counted in Settings → Tags.
- "Recently written" in tag grouping is the newest capture date under the tag; no tag timestamps are stored.
- `SettingsDropdown` (already over the guideline) grew by six lines for the Tags section; `ActionBar` by four
  for the carry hook.

## v3.0.0 — Reading first (October 2026)

Reading-first UI: [READING-UX-SPEC.md](READING-UX-SPEC.md), packages A–E plus a pre-release
review. The app's frame and navigation changed (Library | Timeline | Editor, Library home,
page reader, global search); data did not: PageDoc stays `"2.0"`, sidecar files and storage
are untouched, and existing data folders open unchanged.

### Pre-release review: refresh after saves, safer keys and storage, cleanup (October 2026)

A review of the whole app before the 3.0.0 bump found loose ends that predate the
reading-first work but show more now that the Library and search keep their own
copies of the data.

**The reading views now follow writes made elsewhere.** The Library, its thumbnails,
the global search and the Timeline read in-memory copies: the scan records, the
reader's page cache, the thumbnail SVG cache and the capture-date index. Nothing
refreshed them after an Editor save, so a new page was missing from the Library and a
re-saved page kept its old ink in the reader until Rescan. Choosing a different data
folder in Settings changed where pages were read from but left the old folder's
notebooks, search index and dates on screen. `lib/storage/refresh.js`:
`refreshAfterSave(pages)` (Editor Save and Create Page: drop those pages' cached
docs and thumbnails, rescan, refresh dates; the scan is metadata-only and the index
incremental) and `resetForDataFolder()` (clear everything from the old folder, then
load the new one as boot does).

**A corrupt preference can no longer stop the app starting.** `page-order.js` and
`page-scale.js` ran `JSON.parse(localStorage…)` at module load, unguarded, so a
corrupt value threw before anything rendered. They read through
`lib/safe-storage.js` now (bad, wrong-shaped or blocked → defaults); the keys are
unchanged.

**Keyboard shortcuts stay out of text fields and dialogs.** The Editor canvas's
window shortcuts did not check where you were typing: Ctrl+A in the canvas search or
the transcript editor selected every stroke (and blocked the field's select-all),
Delete / Backspace could delete pasted strokes or points, and Escape in a dialog also
cleared the canvas's pasted selection. They now stand down while typing, mid-IME,
when the key was already handled, and under a modal (`modalOpen()`: an element with
`aria-modal="true"`, which the transcript editor, save, Create Page and SVG export
dialogs now carry). `[`, Ctrl K and the reader's ← / → also stand down under a modal;
menus and dialogs that close on Escape mark it handled, so it no longer also clears
a search highlight. The transcript editor modal leaves Ctrl+A / Z / Y to its text
fields.

**Smaller fixes.** Clear canvas clears the stroke selection (stale indices would
have selected whatever landed at those positions next). The Electron **Pen** menu is
gone: Connect (Ctrl+B) and Fetch Offline Data (Ctrl+F) sent IPC messages nothing
listened for, and its Ctrl+F shadowed the canvas's find. The main process no longer
logs the MyScript request headers (the application key and HMAC in full) or key
fragments. The window title and Help → About say smartpen-bridge; leftover "Book
View" wording (Transcripts search's **Open in Library**, the Transcripts review empty
state, a pen log line) and "Settings → LogSeq Graph" (the section is **Publish to
LogSeq Graph**) are corrected; the Strokes tab's empty state no longer has a branch
that could not show.

**Cleanup.** Removed what nothing imported: `PenInfo`, `PenControls`,
`TransferProgress`, `AnalysisView`, `SelectionInfo`, `CommandList`, `HierarchyTree`,
`LineDisplay`, `stroke-analyzer.js`, `excalidraw-export.js`, `uuid/bridge-uuid.js`
and the `clipboard` store, plus 47 store and utility exports with no caller (about
2,400 lines). Console tracing in the pen SDK, MyScript client, canvas, stores and
dialogs goes through `lib/debug.js`: on in the dev server, otherwise only with
`localStorage['smartpen-debug'] = '1'`; warnings, errors and the Activity Log are
unchanged. Docs: README rewritten for v3 (it still described the five-tab Book View
app, GitHub Pages and the v1 LogSeq workflow); "Book View" wording, version lines and
the manual checklist in CLAUDE.md, ARCHITECTURE.md and TESTING.md; renamed folders in
LOCAL-STORAGE-PIVOT-SPEC and the SDK notes; QUICK-ARCHITECTURE-REFERENCE marked
historical; the broken relative links (VOLUMES-SPEC, CHANGELOG and others) fixed.

**The Editor is full width too (Josh's call).** Package B lifted the 1600 px cap for the
Library and the Timeline only, so switching to the Editor pulled the frame in on a wide
monitor. The cap is gone everywhere: `.app` has no max width and no `wide` class. The
canvas follows its pane through the existing `ResizeObserver` (zoom and view kept, as
when the left panel toggles); the canvas toolbar keeps its scroll-inside-the-pane
behaviour from B, so a wider pane only shows more of it.

**Repository tidy-up (Josh's call).** `.github/workflows/deploy.yml` is gone: it published a
GitHub Pages web build on every push to `main`, and the app cannot run outside Electron (storage
is IPC). Deleting the workflow does not take down a Pages site that was already published; turn
Pages off in the repository settings for that. The repo-root `debug-logs/` (Dec 2025 offline-import
notes) moved to `docs/Archive/2025-12-offline-import-debug-logs/`, and `editor_import_spec.md`, the
handwriting editor's import formats that the JSON / Markdown exports follow, is now
`docs/EDITOR-IMPORT-SPEC.md`.

**Rejected / deferred**
- *Renaming `productName` / `appId` / the package name to smartpen-bridge.* Electron
  derives the profile folder from the app name, so an installed app would come up
  with no settings (no data folder) after the update. Needs a migration; left as is.
- *Wiring the Pen menu instead of removing it.* Web Bluetooth pairing needs a user
  gesture in the page, so a menu-triggered Connect would fail.
- *Removing test-only helpers* (LogSeq-era `stroke-storage.js` functions,
  `filterDecorativeStrokes`, `eachDay`, `openTranscriptReview`): kept with their tests.

**Limitations**
- An Editor save rescans the whole folder (metadata only, about a second on 306
  pages); a scan already running is waited for, up to 5 s.
- A thumbnail read in flight while its page is saved can still store the old ink
  until the next save or Rescan.
- Checked on hardware by Josh (2026-10-20): loading saved notes from the pen, MyScript
  transcription, live capture and saving. Not yet on hardware: a rotated page with the
  pen or MyScript, and offline import into a second volume. The menu-accelerator removal
  was checked by reading the menu template.

### E. Library home + global search (October 2026)

**The Library opens on your notebooks, not a list of names.** The home was an
accordion of book names (collapsed, so nothing showed until you expanded one, and
expanding read every page in it). It is now one **card per notebook**
(`NotebookCard`): a fan of its three most recently written pages, the name, a
**Vol 2** badge on a volume, page count, "last written 3 days ago", the first–last
written range and a **transcribed** bar. Every number comes from what is already in
memory (`lib/library-home.js`): page count and the `transcribed` flag from the
metadata-only scan, dates from the capture-date index (stroke `startTime`, local
days; never `metadata.lastUpdated`). No page is read for a number. **Sort chips**:
Recently written (notebooks with no dated ink last), Name (numeric-aware, so "Notes
9" before "Notes 10"), Most pages; the choice is a per-viewer convenience in
localStorage (`smartpen-library-sort`, every access in try/catch, anything unknown
means Recently written). A **Recent pages** row shows the pages last opened in the
reader (`recentViews`, which already existed) when there are any. The empty,
scanning and no-data-folder states talk about reading ("No notebooks to read yet",
"Choose the folder your pages are saved in…").

**A notebook opens to its pages** (`NotebookPages`): a thumbnail per page with its
first written day ("Feb 4", "+1" when written on more days) and ✓ when transcribed,
in scan order, so P151b and P151c follow P151 and P152b stands in for a missing
P152. A volume ("390v2", Study Notes 3) is its own notebook with its own pages.
**Go to page** is the pane toolbar's field, as in the reader (`resolveGoToPage`
against that notebook's records). The breadcrumb's **notebook crumb is now a link**
to this grid (left over from C and D); "Library" goes back to the cards. Which
notebook is open is the session store `libraryNotebook`, not persisted.

**Thumbnails without disturbing the reader.** The old home rendered thumbnails
through the reader's 6-entry page cache, so expanding a notebook read every page in
it and pushed the spread you had just left out of the cache. Thumbnails now go
through `lib/viewer/thumbs.js`: a doc the page cache already holds is used without
being bumped (`peekCachedPage`); otherwise the page is read directly, the small SVG
is built and the doc dropped at once; only SVG strings are kept (LRU, 150); at
most two reads run at a time. `PageThumb` asks only when it scrolls into view
(IntersectionObserver, 150 px margin). Measured on the scratch copy (getPage IPC
calls counted in the main process): the home reads **19 pages**, the fans of the 7
cards, and nothing else; opening Study Notes 1 (111 pages) reads **30** (was **111**
at once, through the page cache), 55 after jumping to the end of the grid.

**Global search in the header** (`SearchField`, `SearchResults`). The "Search
notes…" button that opened Transcripts → Search is now a field, and **Ctrl K**
focuses it from any destination. A query can hold:
- *words*, matched exactly as Transcripts → Search matches them (each query word
  as part of any word on the page, ranked by how many match), then whole-word
  matches, then the most recently written;
- *dates*: "Oct 14", "October 14th", "14 Oct 2025", "2026-10-14", "10/14",
  "10/14/26", "today", "yesterday" (`lib/search-query.js`). Numbers are month
  first, as Josh writes them; a date with no year is its latest occurrence on or
  before today; a month alone ("may") or a bare number stays a word;
- *notebook names or keys*: every word found in the name, or "390" / "B390" /
  "390v2" exactly.

Results are grouped **Pages / Notebooks / Days** with the group the query is most
clearly about first (Days for a date alone, Notebooks for an exact name, else
Pages). A page row has a lazy thumbnail, notebook and page, when it was written, and
its best-matching line with the words marked. A date alone lists every page written
that day, transcribed or not; a date with words keeps only that day's pages.
↑ / ↓ choose; **Enter** opens; **Shift+Enter** loads a page into the Editor;
**Esc** closes; the footer still opens Transcripts → Search for browsing.

**Where each result goes, through the existing routes.**
- *Page*, Enter: `openPageInLibrary`, so the discard prompt is asked as for every
  other route. On a page whose links are trustworthy (`isTrustworthyTranscript`)
  the reader lights the matching line's ink, the rest grey, through the same
  highlight path as the Ink + text hover, and in Transcript or Ink + text marks
  the line and scrolls it into view (`readerFocus` in `stores/viewer.js`,
  `matchingLineId` against the doc the reader has loaded anyway). On older pages
  the page just opens. Esc or turning the page clears it.
- *Page*, Shift+Enter: `lib/viewer/load-into-editor.js`, the guarded load the
  reader's page header already used, moved out of `BookViewer` so both share it
  (it also reuses a cached doc without bumping the cache).
- *Notebook*: `openNotebookInLibrary`, its page grid.
- *Day*: `navigateTo('timeline')` → `setTimelineRange(day, day)` →
  `setActiveTab('dates')`, the written-on chip's passive route, so a collapsed panel
  stays collapsed.

**Ctrl K's rule** (`isSearchShortcut`, built on `isTypingTarget`): Ctrl or Cmd + K,
never with Alt or Shift, never in a text field (Go to page, the transcript editor's
inputs, another search), never mid-IME, never when already handled, and never while
a Library transcript is in edit mode (`transcriptEditing`, set by `BookViewer`).
**Ctrl+F** (find a page on the canvas) and **Ctrl+Shift+F** (Transcripts → Search)
are the Editor canvas's own keys and are unchanged. The View ▾ menu's Escape is now
marked handled, so closing it does not also clear a search highlight.

**Search cost.** `searchPages` re-tokenized every transcript on every query. The
header search uses an index built once per scan (`buildSearchIndex`, a derived store
on `savedPages`, so a saved transcript edit updates it), and a keystroke only scans
prepared strings. Over the full corpus (306 pages, 117 transcribed), typing
"concrete beam" one letter at a time: **7–9 ms per keystroke before, 0.3–1.9 ms
after**; building the index takes 17 ms per scan; a date query 0.1 ms. In the app,
last keystroke → results painted: 146–188 ms before (Transcripts → Search, 200 ms
debounce), 57–130 ms after (120 ms debounce). While typing "Rich update" only the 7
visible result thumbnails were read.

**Smaller fixes.** The Contents list highlights **both pages** of a spread
(`readerPages`, set by `BookViewer`), not only the left (left over from D). The
transcript-to-record reflection moved from `BookViewer` to `saved-pages.js`
`applyTranscriptToRecord`, which keeps `BookViewer` at ~300 lines.

**Verified on the real app** (scratch copy of the data, isolated profile, 1600×950,
1280×760, 1920×1080, 1200×800): card numbers match the raw stroke times (Study Notes
3 "Oct 14 – Oct 16, 2026", JPI Ruled "Dec 16, 2025 – Oct 1, 2026", JPI Dotted "Dec 9,
2025 – Oct 19, 2026") and the Timeline (Oct 14 lists Study Notes 3 P1 and JPI
Dotted P170); each chip sorts and is remembered; a card and the breadcrumb crumb
open the grid; Go to page `151b`, `152` (→ P152b) and `999` (marked, stays) in
Study Notes 1, `5` in Study Notes 3; "Rich update" → Enter opens JPI Dotted P170
with that line's ink lit (Strokes) and the line marked and in view (Ink + text),
Esc clears; "obsolete" → P101 (Jun 2026) opens with nothing lit; Shift+Enter
loads P101 into the Editor; "Oct 14" → Day → the Timeline on Oct 14 with Dates
selected; "Study Notes 3" → Notebook first → its grid; "B390" → Study Notes 1;
Ctrl K focuses the field from the Library and the Editor, and does nothing in Go to
page or with a transcript in edit mode; Ctrl+F and Ctrl+Shift+F still focus the
canvas find and Transcripts → Search; with an edited transcript, Enter on another
page's result, Shift+Enter and a Day result each ask once (Cancel stays with the
edit, OK leaves and clears Unsaved). `scrollWidth == innerWidth` on the home, a grid
and with results open at 1280 and 1200, panel expanded and collapsed; the results
list ends at x = 1001 at every size. Regression: Contents → P26, ← / →, the page
header's Load into Editor (no extra read), the Timeline feed.

**Rejected / deferred**
- *A modal command palette.* The field is where people look for search, and the
  results drop under it; a modal would hide the page you are searching from.
- *Reading pages to fill the cards* (a real first line, word counts). The scan and
  the capture-date index already answer everything a card shows.
- *Thumbnails through the page cache with a bigger cache.* It would still evict the
  spread on a large notebook, and keep whole docs resident for a 240 px picture.
- *The Timeline's book filter on the cards.* Leaving a notebook out of the Timeline
  should not blank its Library card, so cards read the unfiltered index; Day results
  read the filtered one so they agree with the Timeline they open.
- *Matching the reader's line by yBounds.* Same reason as D: no stored batch
  origin; the stored `lineId`s on trusted pages are the answer.
- *Searching untranscribed pages' ink.* There is no text to search; dates reach them.
- *A separate "Go to page" in the grid.* The pane toolbar's field is where it is in
  the reader.

**Limitations**
- Only transcribed text is searched; an untranscribed page is found by date or by
  opening its notebook.
- "10/19" in a query is read as a date, so the words around it search that day's
  pages only, not text containing "10/19".
- Even on trusted pages a line's link is per stroke (as in D), so a lit line can
  include part of a neighbour's ink.
- The search field keeps its last query after a result opens (Ctrl K selects it).
- Thumbnails are blank until read, ignore Paper, and a notebook's first visit reads
  pages as you scroll (later visits use the SVG cache, 150 entries).
- The Recent pages row lists only pages opened in the reader (`recentViews`, 8).
- `BookViewer` is at 301 lines.
- Live pen, MyScript and offline import not exercised (no hardware or keys).

### Copy one part of a transcript (October 2026)

**Copy a node and what's under it, not only the whole page.** Josh's pages often
end with a meeting's notes under their own heading line; copying them meant
copying the page and deleting the rest in LogSeq. The Library transcript's
toolbar button is now **Copy all** (same output as before), and every top- and
second-level line has its own copy icon, shown on hover just after its text, which
copies that line and every deeper line after it (`subtreeLines()` in
`transcript-markdown.js`). The branch is re-based so it pastes as a top-level
bullet with its children under it; TODO/DONE markers, tab indents and property
stripping are the same as Copy all. Blank and property lines inside a branch don't
end it. Verified on P170: the "10:00 5444-006 Rich update" icon copied that line
and its four children; "Plan to demo…" (second level) copied itself and its two
children at levels 0 and 1.

**Rejected:** buttons on every level (deeper lines rarely stand alone and the icons
crowd the list); icons always visible (they read as noise down a long transcript).

**Limitations:** a branch is what the transcript's indentation says. Where a date
line and the meeting under it were recognised as siblings (P170's "10/19/26" and
"10:00 …"), copying the date copies only the date; Edit → indent fixes the
structure. Per-node copy is in the read view only, not while editing, and not in
the Editor's transcript views.

### D. Page reader: shared toolbar, position and jump, written-on ribbon, Ink + text (October 2026)

**One toolbar over the spread instead of one per page.** Each page carried its own
zoom, Fit, orientation and Load into Editor, which at 1200 wide clipped "Load into
Editor" (on `main` too). Now the pane toolbar holds the reader's shared controls
(`SpreadToolbar`, in `PaneToolbar`'s slot between the breadcrumb and View ▾):
**Go to page…** and **− % + Fit**, which act on both pages. Zoom stays per page
underneath (each page fits its own paper or ink, so a spread's zooms can differ: the
readout says "62% · 58%" then); the shared buttons call each page's `zoomBy()` /
`fit()`. Wheel zoom and drag-to-pan stay per page. A page now **refits when its pane
changes size** (window, panel toggle, header wrapping) until you zoom or pan it by
hand; before, a resize left the old zoom, which is what overflowed the left page at
1200. Each page has a **header** (`PageHeader`): title, stroke count, when it was
written, and **Load into Editor** as a quiet pencil icon, once per page.
**Rotation** moved to a small control on the page's own corner (`OrientationControl
compact`, faint until the page is hovered); still display-only and still one SVG
`<g transform>` per page.

**Where you are, and moving.** The breadcrumb's page crumb reads "P26–P27 of 13"
(`pagePosition`, paired exactly as BookViewer pairs a spread: the open page plus
the next record, not odd/even). **Go to page…** takes "42", "P42", "151b", "p 151B"
(`resolveGoToPage`): an exact id wins; a bare number whose page exists only as
suffixed variants (P152b with no P152) opens the first of them; an unknown
suffix is not found rather than silently falling back. It works inside the open
book key, so a volume (Study Notes 3 = `390v2`) counts its own pages. **← / →** turn
pages (`pageTurnKey`): never in a text field (`isTypingTarget`, so Go to page and
the transcript editor keep their arrows), never with Ctrl / Alt / Meta / Shift,
never mid-IME, never while a transcript is being edited. Every page change still
goes through BookViewer's `guardNav`.

**Written on.** One day shows as a single date chip in the header; several show
the range ("Feb 5 – Jun 25, 2026") and a chip per day (`writtenLabel`,
`writtenChips`). Hovering a chip draws that day's ink black and the rest grey (the
same path as the hover-to-reveal times: one class on the `<svg>` and `SittingInk`
redrawing only that day's strokes); clicking opens that day in the Timeline through
`navigateTo('timeline')` → `setTimelineRange` → `setActiveTab('dates')`, the passive
route, so a collapsed panel stays collapsed. The days are `pageDayGroups()`, now
built **once per page** in `PageSpreadView` and passed to both the ribbon and
`SittingHover` (which used to build them itself), so chip, highlight and Timeline
day agree.

**Ink + text, the third content mode** (`'inktext'`; `'strokes'` and
`'transcript'` keep their ids). View ▾ → Show offers Strokes | Transcript | Ink +
text, and Times stays offered (`viewOptionsFor`: Times whenever ink is shown). A
single page shows ink left and text right; a spread shows the text under each page.
Hovering a line lights its ink, **only on pages whose links can be trusted**
(`ink-text.js`):
- *The link is the stored `lineId`, not a fresh yBounds match.* The spec asked for
  `yBoundsToNcode` with the stored origin, but no origin is stored: `originNcodeY`
  lives only in the in-memory transcription entry, and a page topped up in several
  batches has several. The `lineId`s are what that exact conversion (real origin,
  `LINE_MATCH_TOLERANCE_NCODE`, most-overlap wins) produced at save time, so on a
  page matched by the fixed code they are the answer.
- *Trustworthy = transcribed in or after Aug 2026, has links, and its links don't
  carry the pre-fix signature.* Before the fix the save compared raw millimetre
  yBounds with Ncode Y ± 5, so on those pages **every** linked stroke overlaps its
  line's raw yBounds ± 5. Measured on the Oct 2026 corpus: exactly 100% on all 56
  older pages with links, 4–67% on the 25 newer ones. A date alone is wrong both ways:
  the fix reached the data on 2026-08-26 (P134/P135 that morning are old-style,
  P136 is fixed), and a transcript edited in Book View gets a fresh
  `lastTranscribed` while keeping its old links. The threshold is 90%; a wrong "no"
  only loses the hover.
- Older pages sit side by side with no linking and a one-line note saying why.

While a transcript is edited in Ink + text the layout is not pinned (the page's ink
is already beside its text); in Strokes and Transcript the `editingSide` /
`slotA` / `slotB` pinning is unchanged. Changing mode still remounts the
transcript pane through `setContentMode` → `guardNav`, as before. Page turns are
off while editing in every mode.

**Transcript empty state.** With MyScript keys: **Transcribe in Editor** (loads the
page into the Editor through the guarded `loadRecordIntoEditor`; Transcribe in the
capture bar does the rest) and **Type one**. Without keys it says where to add them
(Settings → MyScript Configuration) and offers Type one. The button does not start
the transcription itself: `ActionBar` transcribes the canvas's untranscribed strokes
or the selection, which may include other pages already on the canvas, and a run
spends quota.

**Smaller components.** `BookViewer` 505 → 294 lines (home grid out to
`LibraryHome`), `PageSpreadView` 405 → 220 (ink surface out to `PageInk`, header to
`PageHeader`, edge arrows to `PageTurnButtons`), `TranscriptPane` 435 → 395 (display
list and empty state out to `transcription/TranscriptLines`). The arrows now sit
over the ink, so in the stacked Ink + text layout they never cover the transcript's
Edit / Copy.

**Verified on the real app** (scratch copy of the data, isolated profile; 49/49 walk
steps): shared + / Fit on both pages; rotating one page turns only its group and the
hover still hits its ink; ← / → (spread steps two, single one), Alt / Shift + →, →
in Go to page do nothing; Go to 29, 999 (marked, stays), `p151B`, 152 → P152b, and in
the volume book; chip hover lights 176 of 602 paths on P27, click lands on that day
in the Timeline with Dates selected and a collapsed panel still collapsed; Ink + text
on P170 (Oct 2026) lights each hovered line's ink, P101 (Jun 2026) shows the note
and no linking; with a transcript edit open, ← / → and the edge arrows do nothing,
while Go to page, header Timeline, page-header Load into Editor, a ribbon chip and
the breadcrumb each ask once (Cancel stays with the edit, OK leaves and clears it);
Paper toggle. `scrollWidth == innerWidth` at 1600, 1280, 1920 and 1200 in every
mode, panel expanded and collapsed. **Performance** on Study Notes 2 P43 (2,364
strokes): `pageDayGroups` + `buildHitIndex` 3 + 11–14 ms, built once per page in
both versions; page open (click → paths settled, warm) median 137–145 ms before,
128–142 ms after; hover response ~2 frames either way.

**Rejected / deferred**
- *A shared zoom factor for both pages.* Pages fit different boxes (paper vs ink),
  so one number would leave one page mis-fitted; the buttons scale each page instead.
- *Moving ‹ › into the toolbar.* The edge strips are the larger target and were
  already there; the toolbar has Go to page and the keys.
- *A separate toolbar row under the pane toolbar.* About 35 px of reading height for
  controls that fit beside the breadcrumb.
- *A slider for position.* Go to page also reaches suffixed pages by name.
- *Ink → line (hover ink, highlight its line).* Ink hover already means "when was
  this written"; one meaning per gesture.
- *Starting MyScript from the empty state.* See above.
- *Linking older pages by re-deriving the origin from their lines.* 37 of 97 pages
  show several batches, and the old links are the wrong strokes anyway.

**Limitations**
- Even on trusted pages a link is per stroke: a tall stroke belongs to the line it
  overlaps most, so hovering a line can light part of a neighbour's ink and miss
  some of its own (visible on P170). That is the saved data, unchanged here.
- In a spread at 1200 wide with the panel open, a page header with a date range
  wraps to two rows, so the two pages' ink starts at different heights.
- ← / → while a transcript is edited do nothing (no prompt): the spec says the keys
  must not fire while editing, and the edge arrows were already hidden then.
- The contents list still highlights only the left page of a spread. *(Fixed in E.)*
- Live pen, MyScript and offline import not exercised (no hardware or keys); the
  "Transcribe in Editor" button was checked only in its no-keys form.

### C. Navigation spine, View menu, Timeline consolidation, contextual left panel (October 2026)

**Three destinations instead of three tiers of modes.** The header switch is now
**Library | Timeline | Editor**. They are a view over the existing `viewerMode` and
`bookViewMode` (`lib/navigation.js`); no store field was renamed and nothing new is
persisted (neither field ever was). The Editor leaves `bookViewMode` alone, so coming
back from it returns to the last reading view.

**One guarded `navigateTo()`.** `switchView` and `switchBookMode` each had their own
copy of the "Discard transcript edits?" confirm. Every route between destinations now
calls `navigateTo(dest)` (`stores/viewer.js`), whose rule is the old pair merged: ask
when `viewerDirty` and the destination is not the Library. Unsaved strokes never
prompt, as before. Routing everything through it fixed two routes that were wrong:
the Book View ink click (open that day in the Timeline) left without asking, and
while you edit a transcript the strokes slot beside it is clickable, so it could drop
the edit; and a search result's Open set `viewerMode` but not `bookViewMode`, so from
the Timeline it left the feed showing instead of the page. `openPageInLibrary()` is the
one way to open a particular page (feed Open page, search results, the contents list)
and asks before replacing a page with unsaved edits. Verified on the real app: header
(both), breadcrumb, View ▾ (Single, Strokes), Contents and ink click each ask once;
Cancel keeps the page and the edit, OK leaves and clears the marker.

**Pane toolbar: where you are, and View ▾.** The row of toggles over Book View
(Books | Timeline, Paper, Home, Strokes | Transcript, Spread, Times, Newest first) is
now a breadcrumb (Library › notebook › P12–P13; "Library" is the old Home button) and
one **View ▾** popover offering only what applies (`viewOptionsFor`): Strokes |
Transcript, Spread | Single and Times for an open page, Paper wherever a book has
paper, Newest | Oldest in the Timeline. Each drives the same store or `BookViewer`
method as its old button. The Editor has no pane toolbar: nothing in the menu applies
to it.

**Timeline: the range set in the feed, the summary said once.** `TimelineHead`
(extracted from `TimelineFeed`) holds ‹ **Range ▾** › (From / To and Latest day, 1, 7,
30 days, shared with the Dates tab via `lib/timeline-range.js`), the summary, the book
filter and one quiet **Load range into Editor**. Under it, an **activity strip** draws
every day from the first to the last ink (gaps included, bucketed to stay ≥ 4 px a
column) with the range as a window: drag it to slide (length kept), drag an edge to
resize, drag across the strip to pick; ←/→ on the focused window slide a day. The
range is set once, on release, so the feed is not rebuilt for every pixel. A red
marker shows the scroll-spy day. "Change range" (which only opened the Dates tab, via
`revealLeftPanel('dates')`) is gone. Cards show **Open page** and ⋯ (Whole page / Show
only this sitting, Load sitting into Editor); a day's Load moved into a ⋯ on its sticky
header; so "Load into Editor" appears once per level (range, day, card) and never as a
primary button. Day headers were already sticky. Verified that the loads agree with
what the feed shows: a day's ⋯ loaded 1,147 strokes (its heading), a card's 534 (its
meta), the range 5,380 (the summary); jumping from the Dates list put that day at the
top and marked it In view.

**Left panel follows the destination** (`CONTEXT_TABS`, `panelTab`): Library →
**Contents** · Transcripts; Timeline → Dates · Transcripts; Editor → Strokes ·
Transcripts · Pages · Dates. **Contents** (`LibraryContents`) lists notebooks and
their pages from the scan records alone (`buildContents`): a dot per transcribed page,
the open page highlighted, its notebook opened when the page changes; which notebooks
are open is a session store, since the tab is unmounted when collapsed. In the
Timeline the Dates tab keeps From / To, presets and the day list, and drops its heat
grid (Josh's call: the strip replaces it there), tally, book filter and Load (said
once in the feed head). In the Editor, which has no strip, the Dates tab is unchanged,
grid included. The Books tab
moved unchanged to **Settings → Notebooks** (rename and volume routing verified there).
`setActiveTab` ids are unchanged plus `'contents'`; an id outside the current set
(including `'books'`) shows the set's first tab rather than being rewritten, so the
ink click's `setActiveTab('dates')` still lands on Dates once the Timeline is up.

**Rejected / deferred**
- *Persisting a `destination` key.* It would be a second source of truth for
  `viewerMode` / `bookViewMode`; derived is enough.
- *Pages tab removed outright, replaced by Contents everywhere.* Its cards carry
  Import / Import all, Export to graph, Edit structure and Reset transcript, which
  have no other home yet. It stays with the Editor (loading onto the canvas is an
  editing act), Contents takes its place beside the Library.
- *Heat grid in the Timeline's panel as well as the strip.* The spec's open question;
  built first with both, then Josh chose strip only. The grid stays in the Editor's
  Dates tab, where there is no strip.
- *View options for the Editor.* None of them apply (it never draws paper).
- *Setting the range on every pointer move while dragging the strip.* Each change
  rebuilds the feed skeleton and resets its scroll.
- *An absolutely placed ⋯ list.* Cards clip their overflow for the rounded corners;
  the list is `position: fixed` and closes on any scroll.
- *Dates in the Library's panel.* The Library is by notebook; Dates is one click away
  in the Timeline.

**Limitations**
- In the Timeline the range can still be typed in two places: the panel's From / To and
  presets, and Range ▾.
- The breadcrumb's notebook crumb is not a link yet (the per-notebook page grid is
  package E). The contents list highlights the left page of a spread only. *(Both fixed in E.)*
- At 1200 wide the per-page toolbar in a spread clips its "Load into Editor" button,
  as on `main`; the shared spread toolbar is package D. *(Fixed in D.)*
- `openTranscriptReview()` still has no UI caller.
- Not exercised: live pen, MyScript and offline import (no hardware or keys).

### B. Collapsible left panel, width cap, Editor overflow (October 2026)

**The left panel folds to a 48 px rail, so reading can have the whole width.** A chevron
(end of the tab row) or the `[` key collapses it; the state is a per-viewer convenience in
localStorage (`smartpen-left-panel-collapsed`), and a missing, corrupt or blocked value
means expanded, so the panel cannot be stranded hidden. The rail keeps what a hidden panel
would lose: an expand chevron, one icon per tab (click = expand and select) and the
Transcripts count badge. Tab ids are unchanged. Measured on the real app: at 1600 wide the
Timeline / spread pane goes from 1090 to 1492 px with the panel collapsed.

**Nothing opens into a hidden panel.** `revealLeftPanel(tabId?)` (`stores/ui.js`) expands
the panel and optionally selects a tab. The callers where the user *asked* to see the
panel use it: `openTranscriptSearch()` (header search button, canvas Ctrl+Shift+F),
`openTranscriptReview()` and the Timeline's "Change range". The passive ones keep
`setActiveTab()`, so a panel the user collapsed stays collapsed: the Book View ink click
(which also sets the range and opens the Timeline day) and the post-transcription switch to
Transcripts (the rail badge covers it). `openTranscriptSearch()` is now async: tab content
is unmounted while collapsed, and `TranscriptsPanel` takes the focus token's value at mount
as its baseline, so the token is bumped one `tick()` *after* the panel is expanded.
Bumping it at once would be swallowed, and the search input would not be focused.

**Width cap.** `.app` gets a `wide` class in Book View (Books and Timeline) that lifts the
1600 px cap, driven by `$viewerMode`, not a media query. *(Pre-release: the cap is gone in the Editor too.)* The Editor keeps 1600: its canvas is
sized from ink bounds and a stretched toolbar is worse. At 1920 the Book View pane is
1410 px (was 1090).

**Editor overflow at narrow widths, fixed at the cause.** The document scrolled sideways at
1280 and 1200 (scrollWidth 1381) with the Editor open. Measured: hiding the canvas toolbar's
scroll container dropped the `1fr` column from 962 to 840 px. A grid item's minimum width is
its content's min-content, and a nowrap flex row counts a scrolling child at its full
length even with `min-width: 0` on that child, so the toolbar held the column wide and
pushed the page. `.canvas-section { min-width: 0 }` lets the column shrink, and the
toolbar scrolls inside the pane as `StrokeCanvas` always intended (verified `scrollWidth
== innerWidth` at 1280 and 1200, panel expanded and collapsed). Its scrollbar is now dark
instead of the default white bar, which read as a stray control once it appeared.
Collapsing the panel would only have hidden the problem.

**Canvas on toggle.** The existing `ResizeObserver` handles it: toggling resizes the
canvas bitmap to the pane (1048 → 1450 px wide at 1600) with zoom (291%) and the view kept.

**Rejected / deferred**
- *Reusing `sidebarCollapsed` in `ui.js`.* Unused and left over from an earlier layout;
  a new `leftPanelCollapsed` store keeps the persistence and tests in one place.
- *Hiding the panel with `display: none` and keeping its tabs mounted.* A hidden mount
  measures widths as 0 (the heat grid scrolls to "now" on mount, for one), and the focus
  race above disappears only by luck. Unmounting is simple, and state such as the Dates
  range is in stores, not the component.
- *Narrowing the Editor problem by collapsing the panel on small windows.* Hides the
  overflow for one layout and leaves it for the other.
- *A transition on collapse.* The canvas would redraw at every intermediate width.
- *Lifting the cap in the Editor too.* (Reversed before 3.0.0, Josh's call: see the pre-release entry.)

**Limitations**
- The Timeline feed has its own inner max width, so collapsing at wide sizes adds margin
  around the cards rather than larger cards; the spread pages use the extra width.
- `openTranscriptReview()` has no UI caller yet; it is covered by the unit test only.
- The tab row's chevron wraps onto the second row at 1400 and below (the tabs already
  wrap there). Tab padding went from 16 to 11 px so the chevron fits on the first row of
  the 450 px panel.
- Not exercised: live pen, MyScript and offline import (no hardware or keys).
- The `≤1000 px` media query is untouched but unreachable (window minimum is 1200).

### A. Slim header, capture bar on demand, colour roles (October 2026)

**The header is one 44 px row and the capture controls appear only when there is
capture work.** At 1280×760 the old header was 169 px (three rows of mostly disabled
icon buttons); it is now 45 px, which returns about 130 px of reading height there and
about 75 px at 1600×950 (measured on the real app). The row holds the name
("smartpen-bridge"), the Editor | Book View switch, a search entry, an **Unsaved** marker,
the pen chip and a gear. Folder status text is gone from the header: Settings → Data
Folder already showed it, and the gear gets a warning dot only when the data folder is
not ready.

**Capture bar condition** (`lib/capture-bar.js`, `shouldShowCaptureBar`): Editor
showing, pen connected, anything unsaved (`unsavedChanges || viewerDirty`), or a
transcription / offline transfer running. The last clause is not in the spec: the
progress popups hang off the bar, so hiding it mid-job would hide the job.

**Only the rendering moved.** `ActionBar` owns `SaveConfirmDialog`, the transcribe and
transfer popups and the in-flight save / transcribe / fetch handlers, so wrapping it in
`{#if}` would unmount them mid-operation. It stays mounted and takes one `visible` prop
that toggles its button row's `display`; none of its save, transcribe, delete or undo
logic changed. Connect / Disconnect left it for `PenChip.svelte` (same `connectPen` /
`disconnectPen` calls). The unsaved marker lives in `Header`, not the bar, so it shows
from every view with the bar hidden; the `viewerDirty` discard prompt (`switchView`
stays in `App.svelte`, passed to the header through a `nav` slot) and the main-process
close dialog are untouched. Live pen ink still goes through `showEditorForLiveInk()`,
and a connected pen keeps the bar visible anyway.

**Colour roles.** Selected / "on" is a neutral raised fill with a blue underline
(`--selected-*`) on `.view-switch-btn`, `.vg-btn.active`, `.vg-segment .active` and
`.panel-tab`; the bright accent is left for the one primary action (Connect, Transcribe,
Load); dark red (`--destructive`) is for Delete only. Save went from the light green
(white text on `#4ade80`, poor contrast) to `--ok-solid`.

**Copy.** `plural()` (`lib/plural.js`) fixes "1 days" and the other count labels in the
Dates tab and heat-grid tooltips. In Book View the Strokes and Transcripts tabs'
empty states now point at loading pages / reading instead of "Connect pen and write".
The heat grid gained Mon / Wed / Fri labels and dark scrollbars (the grid's and the Dates
tab's), and labels in the Dates tab, heat grid and panel tab badge are at least 0.75 rem.

**Rejected / deferred**
- *Library | Timeline | Editor in the header.* That is package C's navigation spine;
  A moves the existing Editor | Book View switch and leaves Books | Timeline and the other
  per-view toggles in the pane bar (the bar is dropped in the Editor, which has its own
  toolbar).
- *Ctrl K and a real search field.* The search entry is a button into the existing
  Transcripts → Search (what Ctrl+Shift+F does); the field and shortcut are package E.
- *Hiding ActionBar with `{#if}` or `display: none` on a wrapper:* both drop the save
  dialog or its handlers, as above.
- *Fixing `max-height: calc(100vh - 120px)` on the left panel with a new constant:* the
  header's height now varies with the capture bar, so the main grid row is pinned to
  `minmax(0, 1fr)` and the panel fills it.

**Limitations**
- Pen battery shows in the chip but the pen-memory percentage no longer does (Settings →
  Pen Memory still manages it).
- Only reading surfaces got the 0.75 rem floor; Books tab, Settings and the Editor still
  have smaller labels. Other `.active` accents (Transcripts Review | Search, timeline
  feed buttons) still use the red accent.
- Not exercised: live pen ink and Fetch Notes (no hardware), MyScript transcription (no
  keys). The capture bar's pen condition is covered by the unit test only.
- The Editor still overflows horizontally at 1280 wide, as before (fixed in B).

## v2.10.0 — Book View hover times and page rotation (October 2026)

### Hover-to-reveal capture time in Book View (October 2026)

**Hovering ink on a page shows the day it was written; clicking opens that day.** The
stroke under the pointer picks its day; that day's ink draws black, the rest of the
page in the Timeline's context grey, and a label just outside the top-right of that
ink gives the date and first-to-last time ("Wed Sep 30, 2026 · 12:45–12:48 PM ·
Timeline ›"). Clicking the ink sets the Dates range to that one day and switches to
Book View → Timeline. A **Times** toggle in the Book View bar turns it off
(localStorage, default on). Read-only: nothing is written.

**Days, not sittings.** The first version grouped by the Timeline's 20-minute sitting
rule (`daySessions()`'s chaining, factored into `strokeSpan()` + `continuesSitting()`
in `timeline-feed.js`, which the Timeline still uses). Josh tried it and asked for one
group per day: reading a page the question is which day, and the click lands on a
Timeline day. Groups are local calendar days of stroke `startTime` (`dayKey`, the day
the Timeline files the stroke under), cut to this page.

**Click vs pan.** A press used to start a pan at once, which also suspended the hover,
so a click never saw a highlighted group. The page now pans only after the pointer
moves 4 px, and `SittingHover` treats a press that moved ≤ 4 px as a click, hit-testing
the click point itself rather than trusting the hover state. The rejected option,
jumping within the current Dates range when the day is already in it: the feed
ignores a jump request made before it mounts (switching from the page view mounts
it), so a one-day range is the reliable way to land on the day.

**Cheap on dense pages.** Groups, their ink boxes and a uniform grid of stroke
segments (4 Ncode units a cell) are built once per page load; pointer moves are
coalesced to one hit-test per animation frame; and a hover never re-renders the
page's paths. A class on the `<svg>` greys them by CSS and `SittingInk` redraws just
the hovered group on top. Considered: per-group `<g>` wrappers with a class toggle,
rejected because it restructures the page's stroke loop (the rotation work was
changing the same markup at the same time). Pointer → Ncode uses `getScreenCTM()` of
the page's rotated content group (`frameEl`; pointer events stay on the `<svg>` so
blank paper still clears the hover), so zoom, pan and page rotation are handled
without knowing about them, and `SittingInk` sits inside that group so the highlight
turns with the page. Overlapping groups: the nearest stroke wins; hover reach is 6 px
on screen, capped at 3 Ncode units when zoomed out. Ink with no `startTime` belongs to
no group and can't be picked. The highlight is suppressed while dragging to pan.

### Page rotation: pages written sideways are shown upright

**A page can be marked Portrait, Landscape ↻ (90°), Landscape ↺ (270°) or Upside
down (180°)**, and every view shows it upright: Book View (page, spread and home
thumbnails), the Timeline cards and the Editor canvas. The control (↺, a picker, ↻)
sits in each Book View page toolbar and on the Editor's canvas toolbar, where it acts
on the selection's page, or on the only page shown. A turn takes effect at once and
is written straight to disk, so it is not an unsaved edit.

**Display-only, stored in a sidecar.** `pages/_orientation.json` holds
`{ version: 1, pages: { "<bookKey>/<pageId>": 90 | 180 | 270 } }`, portrait by
absence, read and written through IPC like `_aliases.json` (atomic write, book key and
page id validated by `requireBookKey`/`requirePageId` so the key can't be path-like or
non-canonical). Storing it in the PageDoc was rejected: a rotation isn't a stroke
edit, and putting it there would route a display preference through the append-only
save path, `validatePageDoc()` and the SaveConfirmDialog diff for no gain. Stroke
points are never rewritten. A missing or corrupt sidecar means every page is portrait.
Volume books (`388v2/…`) and suffixed pages (`…/151b`) are separate entries.

**One transform per page.** The maths is pure (`lib/page-orientation.js`): a page
turns within a FRAME, its paper (the Neo background's frame, or a nominal sheet), and
the turned frame keeps the same top-left with width and height swapped. The frame is
paper rather than the ink box because the translation part of a turn depends on the
frame: an ink-derived frame would shift every existing stroke whenever new ink grew
the box. Book View and the Timeline wrap paper and ink in one SVG `<g transform>`;
the Editor folds the turn into the per-page affine that every Ncode→screen projection
already goes through (`canvas-renderer.js` `pageProjection()`, resolved once per
stroke rather than per dot, which also made unrotated projection cheaper). Because
selection, lasso, hit-testing, point handles, culling, `centerOnPoint`, Fit and live
pen ink all project through that one function, they all follow the turn; the formula
for an unrotated page is unchanged. `screenToNcode()` is its inverse. The Timeline's
strips are cut in the turned frame, so a strip is a horizontal slice of the upright
page (`indexPageStrokes()` now records each stroke's x extent too, so a turned box
costs four numbers rather than a pass over its points).

**Transcription is sent upright.** Sideways ink sent as-is recognises as vertical
scribble. `ActionBar` sends turned copies of the strokes, so the batch origin
(`batchOriginY`) and the returned yBounds are in the upright frame; the rotation rides
on the in-memory transcription, and `save-page.js` (`strokesInTranscriptionFrame()`)
turns a matching-only copy of the stored points the same way before the yBounds →
stroke match. `TranscriptStrokePreview` draws the page upright so its line band lines
up. Persisted results (stroke `lineId`s) don't depend on the frame.

**A race found in the running app.** Two quick rotations each read the sidecar
before the other wrote it, so the first was lost. Writes in `main.cjs` now go through
one promise chain, the store keeps its own optimistic state rather than adopting each
write's reply (an earlier reply would briefly undo a later click), and the ↺/↻ buttons
step from the store rather than from a `$:` value that updates only at the next flush.

**Limitations.**
- Changing a page's rotation after it was transcribed leaves the transcript
  preview's Y band out of line for those lines (stored `lineId`s are unaffected);
  re-transcribing realigns it.
- On the Editor canvas a letter-suffixed page (P151b) uses its integer page's
  rotation, because the canvas has already merged it onto that page.
- Duplicated/pasted strokes, SVG export and "Export to graph" stay in page
  coordinates (unturned).
- Live pen ink on a rotated page and transcription were verified by unit tests only
  (no pen or MyScript key in the test run).

## Startup on the Timeline and Dates (October 2026)

**The app opens on what you last wrote, not an empty canvas.** The right pane starts
in Book View → Timeline and the left panel on Dates; `loadTimeline()` already
defaulted an unset range to the last day with ink, so the feed opens on that day and
the Dates activity grid is scrolled to its newest week (pinned there as it grows,
unless you've scrolled back). Books ⇄ Timeline is no longer persisted: a saved
"Books" would have overridden the new default on every launch. Feed order still is.

**Live pen ink brings the Editor up** (`showEditorForLiveInk()`, called by
`pen-sdk.js` on the first real dot of each stroke, never per dot). Unsaved
transcript edits in Book View win: switching would unmount them, so the pane stays,
the strokes are still captured, and the log warns once. Offline import is untouched;
it already switches on load.

**Boot ordering.** The feed now mounts before the async data-folder check finishes,
so `TimelineFeed` loads the index reactively once `dataFolderReady` flips (guarded on
`timelineError` so a failure can't retry in a loop), not only in `onMount`.

**A Svelte 4 trap that froze the window.** The grid's first version scrolled with
`scrollEl.scrollLeft = scrollEl.scrollWidth` inside a function called from
`$: if (scrollEl && …)`. Svelte compiles a member assignment as an assignment to
`scrollEl` itself (`$$invalidate(scrollEl)`), so the `$:` re-ran, scrolled again,
and so on: an endless microtask loop that never yielded to the event loop, so no
clicks, no resizing, and DevTools couldn't attach. Unit tests don't render components,
so it surfaced only in `npm run dev`. The fix is `scrollEl.scrollTo({ left })`, a method
call, which Svelte doesn't track. Found by bisecting a second Electron instance
(`--user-data-dir` sidesteps the single-instance lock) against the real data folder.

## Neo page backgrounds in Book View and the Timeline — spike, released in 2.8.0 (September 2026)

**Neo's printed pages are drawn behind the strokes in the two read-only views, and
deliberately not in the Editor.** A planner/notebook page is mostly its printed
structure (ruled lines, dot grid, calendar cells); strokes alone lose it. The
Editor sizes a page from its ink, so a fixed paper frame there would have touched
layout, Fit, the page filter and dragged positions — Book View and the Timeline
fit a page to a pane and lose nothing by using the paper. Josh's call: show
backgrounds where things are *read*, not where they are *edited*.

**Where the images come from.** Neo hosts, per notebook, an `.nproj` (XML: each
page's rectangle and `crop_margin`, in 72-dpi points) and a zip of one JPG per
page, in the same public Firebase bucket `web_pen_sdk` uses (`NoteServer.ts`
`getNoteImage`/`extractMarginInfo` — unused by the app until now). No scanning and
no calibration: Ncode unit = 8×7/600 in = 6.72 pt, the JPG covers the rectangle
inset by `crop_margin`, and the result registers with real ink to the pixel
(verified by overlaying stored strokes on books 387, 388, 390 and 3017). Every
image comes out at ~14 px per Ncode unit (150 dpi).

**Storage.** `scripts/fetch-neo-backgrounds.mjs <data-root> 3_27_388 3_1012_3017`
caches them at `<dataRoot>/pages/_backgrounds/<ncodeBook>/{manifest.json,P<n>.jpg}`
(~21 MB for 388's 144 pages, ~23 MB for 3017's 192). The folder is keyed by **NCode
book number, not book key** — volume 2 is another copy of the same paper — and a
letter-suffixed page (`P151b`) uses its integer page's paper. The `_` prefix keeps
it out of `walkPageFiles`. The script refuses a book whose pages are not all one
frame size or are rotated (all four inspected are uniform). The images are Neo's:
cached for personal display, not for committing or redistributing.

**Rendering.** `stores/backgrounds.js` `resolvePageBackground(book, pageId)` →
`{frame, url}` or null (**never throws** — any failure reads as "no background",
which is how every view behaved before). Manifest per book and object URL per page
are cached for the session and cleared by `refreshBackgrounds()`. `PageSpreadView`
substitutes the printed frame for the ink bounds (`frameToBounds`) so the existing
fit/zoom/pan and `strokeToPathD(stroke, bounds)` projection work unchanged, and
draws the `<image>` first. `FeedPart` does the same through a `frame` (the printed
page, else `{0,0,page.width,page.height}` — identical to the old behaviour), so a
strip is a slice of the sheet and the collapsed/expanded modes both show paper.
A **Paper** toggle in the Book View bar (`backgroundsEnabled`, localStorage) only
appears once any book has backgrounds.

**Side effects to expect.** The printed share/mail/bookmark icons are visible, and
a pen tap on them is recorded as a stray stroke there. Paper width changes how big
handwriting is on a card (388's paper is wider than `PAGE_MIN_WIDTH`, 3017's
narrower). The image resolves asynchronously, so a card paints strokes first and the
paper a beat later.

**What Neo's bucket offers (useful beyond this feature).** The `nproj/` prefix is
publicly *listable* (1,016 notebooks, Sep 2026) and a ranged read of a file's first
2 KB gives its `<title>`, so a notebook's id can be found by name without guessing.
The 2026 planner is `3_1012_3207` ("NEO SMART PLANNER 2026 Pro", 192 pp, A5,
uniform, images present) — found, **deliberately not imported**. Its `.nproj` also
defines 5,089 rectangle symbols whose `param` encodes what they are: `ws_YYYYMMDDHH`
(3,710 hourly writing slots, 08–21h, 2025-12-29→2027-01-01), `ms_YYYYMMDD` (monthly
day cells), `crop`/`share` and `bookmark` icons. A stroke's date and hour is therefore
a rectangle lookup, which is the geometry half of a calendar sync. Not built; see
"Open items" in CLAUDE.md.

**Not done:** Home-grid thumbnails and the Timeline's location glyph don't show
paper; no opacity control; SVG export and the LogSeq graph export are unchanged
(no paper); pages with no Neo image (and books other than 388/3017 until fetched)
render as before; nothing downloads from inside the app — it's the script only;
`FeedDay` heights aren't pre-sized for the paper aspect, so a day can shift a little
as its images arrive.

## v2.9 — Book View Timeline: the Dates range as a scrolling feed (September 2026)

**Book View's second mode shows the Dates range as one scrolling column of ink, a
card per sitting, newest first.** The v2.8 date view could only put a range on the
canvas — right for editing, wrong for reading back through a week. Josh's calls
(from an approved mockup): cards are strips that expand to the whole page, newest
first, and **no transcripts on cards** — stored `lineId`s on pages transcribed
before the August stroke→line fix mostly point at the wrong lines.

**A card is a sitting, not a page.** `daySessions()` chains the day's strokes across
all its pages while each starts within 20 min of the previous one's end. It first
also cut on page changes; that doubled the corpus's card count (738 vs 367) purely
from page turns mid-meeting, so a card now shows a **part** (strip) per page
instead. With the final rule: median 2 cards a day, median sitting 21 min (95th pct
83), 160 of 367 cards span several pages. A part's ink covers a median quarter of
the page height — hence strips, not pages.

**Strips cut out blank paper.** Ticking a TODO at the top of a page and another at the
bottom, seconds apart, made a two-stroke card a page tall. `sessionBands()` drops
any blank stretch over `BAND_MERGE_GAP` (≈3 lines), drawn as a dashed cut.

**Browsing follows the range live; loading is explicit** — a card
(`importSessionFromFolder`, a time window over its pages), a day, or the range. All
three switch to the Editor.

**Endless scroll grows the Dates range itself** (`extendFeedRange()`, next 3 days
with ink), not a feed-private extension, so the grid, tallies and Load range always
match the feed. The feed resets to the top only when its *near* end, order or book
filter changes, and the footer has `overflow-anchor: none` so growth never jumps
the view. It fires only on a user scroll or wheel, so opening the feed never widens
a range you picked.

**Lazy loading.** The outline comes from `_timeline.json`. A `FeedDay` within 1.5
screens reads its pages — a whole day at once, because its cards interleave across
pages — and beyond 4 screens releases them, keeping its measured height. Pages go
through the ref-counted `createFeedPageLoader()`, not the Books LRU. Verified over
30 days of the corpus.

**Also fixed — Fit with dragged pages.** `fitToContent()` centred content as if world
space began at 0, but `applyCustomPositions()` leaves bounds at the dragged offsets,
so any page with a saved position fitted off-screen (383px on one real page).

**Not done:** transcripts on cards; an adjustable pause threshold (`SESSION_GAP_MS`
is a constant); `pageScales` in the feed (cards show paper, not canvas layout).

**Testing note:** over CDP with the window covered, `visibilityState` is `hidden`,
which pauses rAF and IntersectionObserver — the feed looks broken when it isn't.
Launch Electron with `--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding`.

## v2.8 — load the canvas by capture date (September 2026)

**A `Dates` tab that loads a span of days' ink onto the canvas, ordered by day.**
The organising unit everywhere else is the notebook; this cuts across it.

**Capture date needed an index of its own.** Every stroke carries `startTime`,
but nothing at page level records when ink was made. `metadata.lastUpdated` is a
file-write time: across the reference corpus it differs from the page's last
stroke by more than a day on **173 of 289 pages**, worst case 163 days, so it
cannot stand in. The only real source is the strokes, i.e. 162MB of files.

`buildTimeline()` in `electron/main.cjs` caches the answer at
`<dataRoot>/pages/_timeline.json`: one `{day: strokeCount}` histogram per page,
plus mtime+size so a refresh re-reads only what changed. Measured on the real
corpus — **cold 917ms, warm 35ms, 60.5KB on disk**, 307,500 strokes across 179
days. Counts are read by regex off the raw text rather than `JSON.parse`, the
same reason `extractPageMeta` slices the strokes array off. `walkPageFiles()` was
extracted so `listAllPages` and the timeline agree on which files are pages.

**Day keys are LOCAL calendar days**, in main (`dayKeyLocal`), in the renderer
(`timeline.js dayKey`) and in `canvas-renderer.captureDayKey` — all three have to
agree or a canvas row would break on a different boundary than the panel
selected. The user picks "17 Aug" meaning the evening they were writing; UTC
would move that to the 18th.

**Filtering is at stroke level, because date does not line up with pages.**
154 of 289 pages hold ink from more than one day, and **74% of day/page pairs sit
on such a page** — so a page-level date filter would drag in mostly-unrelated
writing. `importDateRangeFromFolder()` splits each touched page on `startTime`.

**The rest of the page comes along as context ink** (`stores/context-ink.js`),
drawn halftoned by `drawContextStroke()`. Without it a day's writing floats with
no page around it and is much harder to read. It is deliberately NOT in the
`strokes` store: the index-keyed stores (`selectedIndices`, `deletedIndices`,
point-edit keys) hold positions into `strokes` alone, and it must never be
selectable, savable, exportable or transcribable. It IS passed to
`calculateBounds()` as a second argument so it counts toward a page's **bounds**
(the tile keeps its real size) but never toward its **capture date**, which is
what orders pages — context ink is out of range by definition, so letting it set
a page's date would file the page under writing the user did not ask to see.

**A partial page is safe to save from**, and that is a property of append-only
rather than anything new: saves are keyed by `s{startTime}`, deletions are
explicit, and the one geometry rewrite is gated on `pointsEdited`. The loader
still primes `noteOnDiskStrokeIds` from the page's **full** stored stroke list,
so the strokes left behind are not reported as pending anything. **Transcription
is the exception** — MyScript only sees what is loaded, so `ActionBar` warns when
a page being transcribed carries context ink.

**Page order became pluggable.** `setPageOrder('date')` sorts pages by the
earliest `startTime` among their *loaded* strokes, and rows break on a change of
day as well as at `pageColumns`, so a range reads as one row per day. The page
label gains the date in that mode — rows group the pages but don't name the day.

**Loading merges, never replaces** — the same rule as "Import Strokes", so a
date load cannot discard unsaved work. Above 12,000 strokes the button asks a
second time (median day ~1,500, median week ~7,900, a busy month ~50,000).

**Phase 1 scope — one tile per page.** A page spanning two selected days appears
once, filed under its first day in range. Splitting it into a tile per day needs
a display-only page key threaded through the renderer without touching
`pageInfo`, which save routing, the page filter and stored page positions all
key on; deferred until this has been used.

## Stroke→line matching — two coordinate spaces, compared as one (August 2026)

**`strokesIntersectingLine()` in `save-page.js` compared a transcript line's
`yBounds` directly against stroke point Y values, which are not in the same
space.** Stroke points are raw Ncode (~2.4mm per unit); `line.yBounds` are
MyScript JIIX **millimetres**, measured from wherever `convertStrokesToMyScript`
put the top of the batch it sent. Across the saved corpus the raw millimetre
values fall outside the page's own stroke bounds on 84 of the 96 transcribed
pages, so the `lineId` written onto each stroke recorded whichever line happened
to collide numerically.

**The fix** converts through `yBoundsToNcode()` (`myscript-api.js`, added for the
transcript editor's stroke preview) before matching. Two things it needed:

- **The origin is the batch's, not the page's.** `yBoundsToNcode` anchors on the
  min Y of the strokes actually *sent* for recognition. The ActionBar sends
  untranscribed strokes only, so a page being topped up has a batch that starts
  partway down and the page's own bounds are the wrong anchor — off by the
  distance between them. **`batchOriginY()` in `myscript-api.js` is the single
  definition of that anchor**: `convertStrokesToMyScript` uses it to build the
  request, and `setPageTranscription` calls it on the strokes it was handed and
  stores the result as `originNcodeY`, so the value is measured once, where it is
  known exactly. `transcriptionOriginY()` prefers that; it re-derives from
  `transcribedStrokeIds` for entries predating the field, and falls back to the
  whole page when there is neither. Measuring at recognition time rather than at
  save time matters because the strokes can change in between — delete or
  point-edit the topmost one and a re-derived anchor slides up the page, taking
  every line's position with it.
- **Ties needed a rule.** With the coordinates right, 56% of matched strokes
  touch more than one line — ascenders, descenders, anything tall. The old code
  let the last line considered win, which on the corpus disagrees with
  "most-overlapping line" 64% of the time. Matching now returns the overlap and
  the largest wins; the value goes negative for a tolerance-only match, so the
  same comparison also means "else nearest".

**Tolerance is `LINE_MATCH_TOLERANCE_NCODE = 1`**, replacing a `tol = 5`
documented as "pen-unit" that was never in any real unit. 5 Ncode units is
~12mm — two lines' worth on either side, on pages whose recognised lines are
2.4–5 units tall. 1 unit matches `TranscriptStrokePreview`'s `Y_TOLERANCE`
deliberately: the preview and the saved link answer the same question and must
not disagree.

**`mergeTranscript`'s duplicate test was left as it stands.** It compares
yBounds to yBounds, so both sides are millimetres and its `3` really is 3mm —
under half a line height, the right order for "the same line, recognised again".
Its blind spot is documented rather than fixed: two batches with different
origins put the same physical line at different millimetre values, so a re-run
over a shifted batch can slip a duplicate past the Y test. Exact text still has
to match, which is what keeps that rare.

**Existing files are left alone — Josh's call, 2026-08-26.** 81% of the 108k
stroke `lineId`s on disk would change under the corrected mapping, but a repair
can only re-derive them where the batch origin is recoverable: 37 of 97 pages
visibly show multiple batches (their line yBounds restart partway down the
list), and pages written before the v2.2 merge-ordering fix had their lines
re-sorted by Y, which *hides* that signal on the other 60. Nothing is at risk in
the meantime — no save path rewrites geometry off a lineId,
`getUntranscribedStrokes()` only checks whether a link *exists*, and LogSeq
export clears them. **Known limitation:** on pages transcribed before this fix,
`TranscriptStrokePreview` highlights the wrong strokes for a line, because it
prefers the stored link over its own (now correct) Y-overlap fallback.
Re-transcribing a page fixes that page.

**The confirming modal's preview uses the real origin** (`TranscriptStrokePreview`
gained a `batchOriginY` prop, threaded through `TranscriptionEditorModal` from the
`pageTranscriptions` entry). It has to be chosen **per line**, not per page: the
editor shows a mix of lines from disk and lines from the batch being confirmed,
and only the latter were measured against it. The flag for that is `fromBatch`,
set in `TranscriptionView.mergeExistingAndNewLines` — deliberately **not**
`syncStatus === 'new'`, which `splitLine` also sets on the second half of a split
whose yBounds it inherited from a disk line. `mergeLines` carries `fromBatch` only
when every merged part had it, since a combined yBounds spanning both sources
belongs to neither origin. A line without it still gets the whole-page guess,
which is all that is available for a saved transcript.

## v2.7 — UI reorganisation: panels, not toolbars (August 2026)

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

## Volumes — telling apart notebooks that share an NCode book id (August 2026)

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

**See:** [docs/VOLUMES-SPEC.md](VOLUMES-SPEC.md) — full design, plus the
rejected alternatives (arithmetic remap, decimal book ids, volume on the page
suffix) and why each fails.

## Point editing — delete a single stray point from a stroke (August 2026)

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

## Pending-changes `modifications` — flag-only edits are reported (August 2026)

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

## Sketch strokes — pressure-varying line thickness (August 2026)

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

## Copy transcript from the canvas (July 2026)

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

## Clear-canvas fixes (July 2026)

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

## v2.3.0 — Export to LogSeq: manual, selective, additive (July 2026)

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

**Supersedes** the June 2026 "Publish to graph" entry below — the asset/index
file format and the plugin contract are unchanged; only *when* and *what* the
bridge writes changed.

## v2.2.0 — Book View transcript editor: ordering fix + editing UX (July 2026)

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

## Publish to graph — close the loop with the JPI Tools plugin (June 2026) — SUPERSEDED by v2.3.0

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

## v2.1 / v2.0.2 — Book View + Editor handoff (June 2026)

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

## v2.0.0 — LogSeq → Local Folder Pivot (May 2026)

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

**See:** [docs/LOCAL-STORAGE-PIVOT-SPEC.md](LOCAL-STORAGE-PIVOT-SPEC.md) for the full design and phasing.

## Before v2.0 (LogSeq era, through April 2026)

Kept because the offline-import and live-capture fixes still describe how
`src/lib/pen-sdk.js` and `canvas-renderer.js` work. References to LogSeq modules
(`logseq-api.js`, `transcript-updater.js`, the LogSeq DB tab) are historical.

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
