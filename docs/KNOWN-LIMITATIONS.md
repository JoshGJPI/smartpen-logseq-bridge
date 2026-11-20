# Known limitations and open items

Moved out of CLAUDE.md (2026-11-03) to keep it to rules. CLAUDE.md keeps the few items that change how you work.
Reasons and history for each feature are in [CHANGELOG.md](CHANGELOG.md).

- **Page rotation** (v2.10.0): live pen ink and transcription on a rotated page are verified by unit tests only (no
  pen or MyScript key in the Oct 2026 app check). Changing a rotation after transcribing misaligns the transcript
  preview's Y band until re-transcribed; a suffixed page on the canvas uses its integer page's rotation; pasted
  strokes, SVG export and Export to graph stay unturned.
- **Offline import with volumes is unverified on hardware** (live capture, volume definition and reassignment were
  verified 2026-08-07). Check: multi-book batch imports completely, strokes land in the active volume, reassignment
  works on imported strokes. See [docs/VOLUMES-SPEC.md](VOLUMES-SPEC.md) §11.
- Writing in physical volume 1 while volume 2 is active cannot be detected; reassignment is the remedy.
- LogSeq export: volume 2+ is refused (`requireGraphBook`); a stroke already exported keeps its pre-edit geometry
  (`mergeGraphStrokes()` lets the published copy win); the JPI Tools plugin's SVG generator needs matching
  pressure/sketch support.
- `openTranscriptReview()` has no UI caller (kept: it reveals the panel, and is tested).
- In the Timeline the range can be set in two places (Range ▾ and the Dates panel's From / To).
- Some `.active` accents outside the reading surfaces (Transcripts Review | Search) still use the red accent.
- Several components are over the ~300-line guideline (StrokeCanvas, ActionBar, TranscriptionEditorModal,
  SaveConfirmDialog, TranscriptPane, …); don't grow them, split when touching.
- Global search covers transcribed text only; untranscribed pages are found by date or notebook (or by tag).
- **Page tags (v3.1.0).** Suggestions are pattern-only: no check that a number is a real project, and letters read
  for digits (`P2O26-141`) are missed. Tags don't follow a *partial* volume move (they stay on the source page).
  Project names aren't shown on chips; no tags on Timeline cards; tags aren't exported to LogSeq. The Editor
  (v3.19.0) tags pages from the toolbar's 🏷 Tags (at most six pages listed at once) and the Pages tab cards of pages on
  the canvas.
  Tags on a page that is later deleted stay in `_tags.json` (hidden everywhere except the Manage Tags counts).
  "Recently written" in tag grouping uses the newest capture date under the tag (no tag timestamps are stored).
- **Tag types (v3.22.0).** A project's chip shows its number, never its name (the name is in Details and `list_tags`).
  A type or details set on a tag that is later removed from every page by hand (not Delete) stay in `_tags.json`
  (`info`), so re-adding the tag brings them back; Manage tags lists them with 0 pages, and Delete there drops them. A
  merge keeps the target's fields: the source's company, client or note are dropped (its names become aliases).
  Search facets look at page tags only. Name sort in Manage tags and the tag lists is by the stored key, not the
  label. No MCP tool sets a type (read-only by design).
- **Block scope and people (v3.23.0).** **Deep nesting:** a task's `heads` keep its nearest 3 ancestors (and 80
  characters of each), so a task 4 or more levels under the line that names a person gets no `people` on a page with no
  hand corrections: Tasks → Group by Person and `person:` miss it (so do the Person page's Open items and MCP
  `list_tasks person`), though it is inside that person's block in the Blocks list and the reader's bar. A name past
  the 80th character of a heading misses the same way. Pages with hand corrections are read and exact. Matching is case-sensitive and whole-word: "RICH" or a misread "Rlch" is not Rich (add an alias, or Tag this
  block…). A person with no display name answers to its key capitalised ("isaiah" → "Isaiah"); one with a two-part
  key (`tom-b` → "Tom B") likely needs a display name. A hand correction names a line id: a line Relink or Library Edit
  keeps keeps its correction, but a re-transcribe Reset (new ids) drops it silently (ignored, left in `_tags.json`).
  Removing the tag from the page (chip ×, bulk remove) drops its corrections there in the same write; re-adding the
  tag does not bring them back (Undo in Manage tags does, until the next tag change). The
  first open of a tag page or the Tasks view after loading reads each corrected page once; until then those pages use
  the text alone. "Mentioned, not tagged" lists every page naming the person, including pages where the name is a
  different person (Not this person is per page, after tagging). The reader's scope bar shows only in the Library
  reader, not in the Editor. Copy agenda is clipboard only (no LogSeq write, by design).
- **Sketch lines (v3.24.0).** Not in this phase (spec E.8): recognising sketches automatically (a cluster of long
  strokes with no text), sketch-to-image export, and sketches in the LogSeq export (the graph export still strips
  every transcript line). A sketch is placed under the nearest text line above its ink only where the page's links can
  be trusted; elsewhere it goes at the end (move it in Library Edit). Ink is matched to lines by Y only (Relink, above),
  so on a page transcribed with a drawing in the batch the drawing is already in one or two text lines: Make sketch
  takes it out of them (the box offers it with a warning naming the line; the Editor's selection takes it without
  asking). The scan keeps at most 20 sketches per page (search, tag strips and `list_sketches` miss the rest). A
  letter-suffixed page can't take a sketch while its page number is loaded in the Editor. Make sketch refuses strokes
  not saved yet (Save first), and under Relink's guards (a Library draft, a transcript editor open, a pending Editor
  transcription, a Reset). Deleting a sketch only unlinks its ink (never Not text), so the next Transcribe sends the
  drawing: mark it Not text if it shouldn't be. A sketch's tags come from block scope; a sketch whose label names a
  project is a root of that project (it covers only itself). The reader's Mark sketch / Add / Remove strokes work in
  Ink + text only. Search's word matching of tags inside `has:sketch` is a substring of the tag's key, label or alias
  ("has:sketch 6226" finds 6226-001's sketches).
- **Retime (v3.6.0).** Exported to LogSeq: `mergeGraphStrokes()` keeps the published copy by id, so re-exporting a
  retimed page adds the new-time copy beside the old one in the graph. Offline-import dropping is unit-tested only (no
  pen in the Oct 2026 check). Undo before save is the dialog's Reset or shifting back; no separate undo.
- **Delete lines and Not text (v3.20.0).** Library Edit keeps an emptied line as an empty line (only the Edit
  Transcription dialog treats it as a Delete). The Editor draws textless strokes like any other (by choice); only the
  ⋯ menu's counts tell. A line split off a saved
  line and then deleted has no ink to settle (its strokes stay with the first half). Claude's `delete` op only unlinks, and its edits don't update a page also loaded on the canvas (the
  Editor's save never writes a stale link back, but that page's Transcribe skips the unlinked ink until it is
  reloaded). A deleted line of an unsaved run whose batch is unknown (a result from before v3.20.0 in memory) only
  unlinks its ink. Unverified with a real
  MyScript run: deleting a line of a run not saved yet (unit-tested only).
- **Tasks (v3.4.0).** A task's date is its page's capture days (no per-line date; stored `lineId`s are unreliable
  before Aug 2026). Its project is the project number nearest it in the transcript (`projectHint`, v3.6.1: its own
  text, then the lines it sits under, then any earlier line) when the page is tagged with that number, else the page's
  first project tag; an untagged number never counts (OCR misreads digits). Only transcribed pages have tasks. A tick in
  the app doesn't change the ink. No ink snippet on hover, no LogSeq copy or sync of tasks.
- **Print (v3.8.0).** To a printer through the Windows print dialog (`print:toPrinter`, preset to the sheet; never
  silent: print-to-file drivers hang). Don't test it by opening print dialogs on Josh's desktop (it stalled his other
  Electron apps); Josh confirmed it on a real printer 2026-11-02. PDF: rendered in main by `printToPDF` from a hidden, script-less window, so the document's
  `@page` is the sheet; keep everything the document needs inline. Ink is a column-tall figure and text flows in CSS
  columns (see CHANGELOG, "Print to PDF"). The print list (header **Print**, or the dialog's notebook panel) is session-only and gathers pages
  from any notebook; one sheet layout per job, so a mixed Letter + A5 list prints 1 per sheet. 2 per sheet is side by side only; no sheet numbers.
  Preview (v3.9.0): the real PDF, rebuilt on every change from pages read once per dialog, so a redraw takes longer as
  the list grows (not measured past a handful of pages); a list with selected strokes is unchecked in the app. Line width is millimetres on the sheet (`lineWidthMm`), not a multiplier, so shrunk pages print
  as heavy as full-size ones.
  The Editor's selected strokes go into the print list (header Print, or the dialog's Selected strokes section) and print
  from memory (`lib/print/print-selection.js`), each on its page's full paper, as ink only (a transcript can't be matched
  to a selection); a floating pasted copy has no page and is skipped. An item is a copy taken when added: later canvas
  edits don't reach it, and the list is session-only like the rest.
- **Relink (v3.21.0).** Checked by unit tests with MyScript mocked; not yet run against real pages or in the running
  app (it needs MyScript requests, which wait for Josh's OK). A line stored out of place (3017/180) is offered as a
  "moved" confirm row and keeps its place when linked; reorder it by hand if wanted. A moved reading below 0.60
  stays no ink plus ink left over, where "Add as new line" would duplicate it. Confirm rows start on Link. One MyScript line covering
  two stored lines (the reverse of a line merged by hand) stays a confirm row for one of them; the other is no ink.
  Joins take at most 3 consecutive MyScript lines. Word fixes are offered for one word
  read as another only (not for added or missing words), and only when the two are plausibly the same word. The review queue is session-only; the MyScript runs behind it
  are cached in `<userData>/relink-cache/` (never pruned, one small file per page) and a second Run costs nothing.
  Make sketch on leftover ink (v3.24.0) makes ONE sketch line, labelled "Sketch", from every row marked so. **Ink is
  matched to a line by height (Y) only**, here and in Transcribe (`strokesIntersectingLine`): a sketch drawn beside or
  among text lines is sent with them, MyScript folds it into tall line boxes, and one or two lines take the whole
  drawing plus the notes written beside it (3017/124: lines 11-12 took 891 strokes, lines 13-32 none). Make the
  drawing a sketch line first (v3.24.0: Editor, select it → ⋯ → Make sketch…, or the reader's Mark sketch): its ink is
  then linked and never sent again; then Relink the page or Relink selection on the text. X-aware matching
  (MyScript's word boxes) is an open idea. A letter-suffixed page (P151b) is refused while its page number is
  loaded in the Editor (the canvas can't tell P151b from P151); Library Edit and the Pages tab's canvas sync have the
  same blind spot for suffixed pages. The spec counted 100 unreliable pages; the data folder has 99 now
  (84 in JPI Dotted). Decorative ink is held back by Deselect Decorative's detector as it stands: what it misses (a
  table's rules that aren't underlines or boxes) is still sent, and what it takes is held back as a whole (untick
  "Mark them Not text" to leave it unlinked; send a stroke anyway with Relink selection). Relink selection works on one
  page at a time, refuses a page with unsaved changes, holds nothing back and caches nothing (each pass is one
  request). On a page already linked, a line a pass doesn't link keeps its `yBounds` only while some kept ink still
  links to it.
- **Re-transcribe (v3.17.0).** Reset is refused while only part of a page is on the canvas; ink left out of the new
  run (a drawing) ends up unlinked.
- **Claude's transcript edits (v3.18.0).** Work only while the app is open with "Allow Claude to edit transcripts" on
  and the MCP has `SMARTPEN_MCP_WRITES=1`; refused while any transcript editor is open on the page. Text, indent, order
  and lines only, never ink or task state. A 504 after 30 s may still have landed (re-read before retrying). Undo keeps
  the last 20 edits per page and only while the page is still at the revision the edit wrote.
- **Duplicate stroke ids (v3.18.0).** Pages saved before the guard can still share ids; they are counted from the
  capture-date index and cleaned only from Settings → Maintenance (preview first), never silently.
- Main-process and renderer tracing is behind `lib/debug.js` (`localStorage['smartpen-debug'] = '1'`, or the dev
  server). Never log MyScript keys or the HMAC, not even fragments.
- Timeline: no transcripts on cards (stored `lineId`s are unreliable); `SESSION_GAP_MS` is a constant.
- The Dates tab day list shows one tile per page, filed under its first day in range.
- The Editor's Review copy (v3.10.0) copies the transcription run waiting there, not the page's saved
  transcript: after a partial re-transcribe it holds only the new lines (Edit Structure makes it the whole page).
- **Neo page backgrounds are a spike** (books 388 and 3017 fetched; see [docs/CHANGELOG.md](CHANGELOG.md), "Neo page backgrounds"):
  no thumbnails, opacity control or export support; fetched by script only; images are Neo's, so keep
  `pages/_backgrounds/` and any real-handwriting screenshots out of commits.
- **Planner (to look into later, Josh 2026-09-30).** Considering the 2027 Neo Smart Planner (the 2026 Pro is book
  `3_1012_3207`, not imported). Its `.nproj` encodes each hourly slot as `ws_YYYYMMDDHH`, so a stroke → date/hour is a
  rectangle lookup. Calendar sync to Microsoft 365 would still need recognition (MyScript, batched), a confirm-before-create
  step, duplicate protection, and a write path. **Start with the `.ics` export** (no sign-in or IT approval) or a Power
  Automate flow; Microsoft Graph with in-app sign-in is the heavy option and may need JPI IT consent. Neo's own
  phone-app sync can't share the pen with this app.
