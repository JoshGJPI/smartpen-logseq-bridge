# Known limitations and open items

Moved out of CLAUDE.md (2026-11-03) to keep it to rules. CLAUDE.md keeps the few items that change how you work.
Reasons and history for each feature are in [CHANGELOG.md](CHANGELOG.md).

- **Page rotation** (v2.10.0): live pen ink and transcription on a rotated page are verified by unit tests only (no
  pen or MyScript key in the Oct 2026 app check). Changing a rotation after transcribing misaligns the transcript
  preview's Y band until re-transcribed; a suffixed page on the canvas uses its integer page's rotation; pasted
  strokes, SVG export and Export to graph stay unturned.
- **Offline import with volumes is unverified on hardware** (live capture, volume definition and reassignment were
  verified 2026-08-07). Check: multi-book batch imports completely, strokes land in the active volume, reassignment
  works on imported strokes. See [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) §11.
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
  Project names aren't shown on chips; no tags on Timeline cards or in the Editor; tags aren't exported to LogSeq.
  Tags on a page that is later deleted stay in `_tags.json` (hidden everywhere except the Manage Tags counts).
  "Recently written" in tag grouping uses the newest capture date under the tag (no tag timestamps are stored).
- **Retime (v3.6.0).** Exported to LogSeq: `mergeGraphStrokes()` keeps the published copy by id, so re-exporting a
  retimed page adds the new-time copy beside the old one in the graph. Offline-import dropping is unit-tested only (no
  pen in the Oct 2026 check). Undo before save is the dialog's Reset or shifting back; no separate undo.
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
  the list grows (not measured past a handful of pages); Print selection…'s preview is unchecked in the app. Line width is millimetres on the sheet (`lineWidthMm`), not a multiplier, so shrunk pages print
  as heavy as full-size ones.
  The Editor's Export ▾ → Print selection… prints only the selected strokes from memory (`lib/print/print-selection.js`,
  its own `selectionPrint` store), each on its page's full paper, Strokes only (a transcript can't be matched to a
  selection); a floating pasted copy has no page and is skipped.
- Main-process and renderer tracing is behind `lib/debug.js` (`localStorage['smartpen-debug'] = '1'`, or the dev
  server). Never log MyScript keys or the HMAC, not even fragments.
- Timeline: no transcripts on cards (stored `lineId`s are unreliable); `SESSION_GAP_MS` is a constant.
- The Editor's Dates tab day list shows one tile per page, filed under its first day in range.
- **Neo page backgrounds are a spike** (books 388 and 3017 fetched; see [docs/CHANGELOG.md](docs/CHANGELOG.md), "Neo page backgrounds"):
  no thumbnails, opacity control or export support; fetched by script only; images are Neo's, so keep
  `pages/_backgrounds/` and any real-handwriting screenshots out of commits.
- **Planner (to look into later, Josh 2026-09-30).** Considering the 2027 Neo Smart Planner (the 2026 Pro is book
  `3_1012_3207`, not imported). Its `.nproj` encodes each hourly slot as `ws_YYYYMMDDHH`, so a stroke → date/hour is a
  rectangle lookup. Calendar sync to Microsoft 365 would still need recognition (MyScript, batched), a confirm-before-create
  step, duplicate protection, and a write path. **Start with the `.ics` export** (no sign-in or IT approval) or a Power
  Automate flow; Microsoft Graph with in-app sign-in is the heavy option and may need JPI IT consent. Neo's own
  phone-app sync can't share the pen with this app.
