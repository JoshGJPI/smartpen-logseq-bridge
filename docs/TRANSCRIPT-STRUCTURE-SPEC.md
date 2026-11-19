# Transcript structure: delete lines, relink, tag types, people, sketches — spec

Status: **decisions settled** (Josh, 2026-11-19); nothing built. Phase E waits for a mockup Josh approves. Five phases, each a release that leaves the app working and
tested. Background and mockups: the "Tag Types and Transcription" deep dive (17 Nov 2026), whose numbers are repeated
here where they matter.

## Goal

Make a page's transcript carry more of what is on the page, and make it easier to repair:

1. **Delete lines** in the Editor's Edit Transcription dialog, instead of merging them away, and say what happens
   to their ink.
2. **Relink** the 100 pages transcribed before the ink was tracked, keeping their text and task state.
3. **Tag types**: every tag is a Project, Person or Topic, with a few details.
4. **People**: a Person tag added by hand to a page covers the block that names the person and its children, the way
   a project number heads a meeting block, so each person gets a running list of items, like a standing meeting.
5. **Sketches**: drawn ink becomes a placeholder line in the transcript, so a transcript shows that a sketch is
   there, and sketches can be searched by project or person.

## Phase overview

| Phase | Release (tentative) | Contents | Depends on |
|---|---|---|---|
| A | 3.20 | Delete lines in Edit Transcription; "Not text" ink flag | none |
| B | 3.21 | Relink old pages | none (uses A's flag if present) |
| C | 3.22 | Tag types and details | none |
| D | 3.23 | Block scope; Person pages; people on tasks | C |
| E | 3.24 | Sketch lines; sketch search | D for "sketches of a person" (project search works without D); **a mockup Josh approves first** |

A and B are repairs and can ship in either order. C → D → E build on each other. `PAGE_DOC_VERSION` stays `"2.0"`
throughout: every PageDoc change below is an optional field that older builds ignore.

## Decisions (settled by Josh, 2026-11-19)

1. Deleting a line whose ink was linked: the ink defaults to **"Not text"** (never sent again), with "Transcribe
   again later" one click away. Most deleted lines are a scribble, an underline or a box read as words.
2. Relink word differences (MyScript reads "boring" where the text says "boing") are **offered as optional fixes,
   default keep**.
3. **Three tag types: Project, Person, Topic.** Project covers jobs and proposals (the number's pattern still tells
   them apart). No Company or Personal type.
4. Person matching is **case-sensitive on the display name and aliases**, so "Rich update" matches Rich but "rich mix"
   does not.
5. Name suggestions **only for people who already have a Person tag**. No global name discovery; nothing is tagged
   without a click.
6. A sketch's default label is **"Sketch"**. "Make sketch" has an *Also draw with pen pressure* checkbox (sets
   `sketch: true`), **off by default**, and the pressure flag's UI label becomes **Pressure ink** (E.9).
   **Before Phase E starts, Josh sees a sample mockup** of making, showing and searching sketches, and approves it.

---

## Phase A — Delete lines in Edit Transcription (3.20)

### A.1 Today

- **Library Edit** (`TranscriptPane`, `lib/viewer/transcript-draft.js`) has Delete (toolbar, and Backspace on an
  empty line) for the active line only.
- **The Editor's Edit Transcription dialog** (`TranscriptionEditorModal`, `lib/editor-lines.js`) has merge, split,
  indent and move, but no delete. Emptying a line's text deletes it on save (`applyEditorLines`: "emptied in the
  dialog: removed"), which nobody would guess. Merging into a neighbour is the workaround Josh uses.
- Either way, a deleted line's strokes lose their link (dangling `lineId`s are scrubbed on save), so the next
  Transcribe of that page sends the same ink again and the deleted line comes back.

### A.2 Behaviour

- **Delete** in the dialog's toolbar (and `Ctrl+Shift+K`, and Backspace on an empty line, like Library Edit). It acts
  on the ticked lines, else the focused one. Undo / Redo cover it (`addToHistory()`).
- **Delete line** vs **Delete block**: a line with children asks which. *Delete line* moves its children up one
  level; *Delete block* removes them too. With ticked lines, each ticked line is deleted alone.
- **Tasks**: deleting a task line (TODO, DONE, WAITING, CANCELLED) needs a confirm naming the task ("Delete the task
  'schedule coord. meeting w/ Tom'?"), because its state goes with it. Same rule as Claude's `task_ok`.
- **The ink**: a small choice in the dialog's footer while any deleted line had ink:
  *Ink of deleted lines:* (•) Not text, never transcribe it ( ) Transcribe it again next time. The choice applies to
  every deleted line in that save. Lines from a run not yet saved have ink too (their strokes were sent).
- **Library Edit** gets the same three things: Delete block, the task confirm and the ink choice. Its single-line
  delete stays.

### A.3 The "Not text" flag

A new optional stroke field, **`textless: true`** (omitted when false, like `sketch`).

- Set by the delete choice above, and from the Editor's selection: **Leave out of transcripts** / **Include in
  transcripts** (context menu and the selection toolbar's ⋯).
- `groupStrokesForTranscription()` (`lib/canvas-save-plan.js`) skips textless strokes, so Transcribe never sends them.
  Deselect Decorative leaves them alone (already out). Relink (Phase B) skips them.
- A textless stroke has `lineId: null`. Library Ink + text draws it like other unlinked ink. `check_transcript` stops
  counting it as "ink in no line" (it was left out on purpose).
- **Storage**: `strokeToStored()` adds `textless` to its fixed key list. The flag is a flag-only change like
  `sketch`, so it lands in the **modifications** bucket of `pendingChanges` and in `computePageChangesFolder()`'s
  modifications (both, per the invariant). `save-page.js` already treats `lineId` and `sketch` as annotations the
  user changes later; `textless` joins them.
- In the Editor dialog's save, the deleted lines' stroke ids get `textless: true` and `lineId: null` in the same
  write as the transcript (`planTranscript` returns a `textlessIds` set; the save applies it beside
  `lineIdAssignments`).

### A.4 Tests

`editor-lines.test.js`: delete line (children outdent), delete block, delete of a not-yet-saved line, undo / redo.
`save-page.test.js`: deleted saved line removed, its strokes unlinked; with Not text, strokes flagged; with Transcribe
again, strokes unlinked and not flagged. `canvas-save-plan.test.js`: textless strokes never in a transcription group.
`page-changes.test.js` + `pending-changes.test.js`: a textless toggle is a modification in both.

---

## Phase B — Relink old pages (3.21)

### B.1 The problem, measured

100 transcribed pages fail `isTrustworthyTranscript()` (85 in JPI Dotted, P42 to P187; 8 JPI Ruled; 4 Study Notes 1;
2 Study Notes 3; 1 Printed Grid). They hold 72 tasks and much hand-corrected text. The 3.17 Reset fixes a page by
re-transcribing it and **replacing** its transcript, which throws away the corrections and carries task state by
text match only.

### B.2 What Relink does

For one page:

1. **Send**: the page's strokes, minus textless strokes and minus strokes linked to sketch lines (Phase E), go to
   MyScript once, turned upright as Transcribe does (`rotateCanvasStrokes`). Read from disk; no canvas needed.
2. **Align**: MyScript's lines against the stored text lines (sketch lines excluded), in order, with gaps: dynamic
   programming over normalized edit distance. This is `alignLines()` from `mcp/core/transcript-check.js`, moved to
   `src/lib/line-align.js` so both the MCP and the app import it (the MCP already imports `src/lib` unchanged).
   Text is compared marker-stripped (`parseTaskMarker`), so a ☑ in MyScript's reading matches a DONE line.
3. **Classify** each stored line: *matched* (similarity ≥ 0.85), *confirm* (0.60–0.85), *no ink* (below, or no
   partner). Each MyScript line with no partner is *ink left over*.
4. **Link**: for matched and confirmed pairs, the stored line takes MyScript's `yBounds`, and every stroke MyScript's
   line covers (`strokesIntersectingLine` with the batch origin, the fixed matching code) gets that stored line's id.
   Strokes in no pair end with `lineId: null`.
5. **Write** (after review, or at once in bulk when nothing needs confirming): one `savePage()`.

### B.3 What is written, exactly

- Per linked line: `yBounds`. Per stroke: `lineId`.
- `transcript.lastTranscribed` = now (the links come from the fixed matching code, and `isTrustworthyTranscript()`
  reads this date). `metadata.lastUpdated` = now.
- **Never**: line ids, text, order, indent, `parentId`, `checked`, `marker`, sketch lines, strokes' points or flags.
  So no task state needs carrying.
- Implemented as a new plan kind in `save-page.js`, `planTranscript(..., { relink })`, returning
  `{ lines (same ids, new yBounds), lineIdAssignments }` and saved through `savePageToFolder()`, then
  `refreshAfterSave()`. Not a new write path.

### B.4 Review

A Relink dialog per page (mockup R1 in the deep dive): stored text on the left (kept), MyScript's reading beside it
in grey, a match column. Counts on top: matched, to confirm, no ink (kept), ink left over, tasks unchanged.

- *Confirm* rows: Link / Don't link.
- *Ink left over*: Add as new line (text from MyScript, a new id, placed by y), Make sketch (Phase E, when built),
  Not text (A.3), or Leave unlinked (default).
- **Word fixes** (decision 2): where a matched pair differs in a word, the row shows MyScript's word in amber and a
  "Use" button. Nothing changes unless clicked. Taken fixes save as text edits in the same write (still keeping ids
  and task state).

### B.5 Bulk run

Settings → Maintenance → **Relink old transcripts…** (like Convert task boxes: preview first). Lists the unreliable
pages per notebook with line and task counts. *Run* sends pages one by one (about 100 requests; the 2,000 a month
free tier allows it) and:

- saves at once pages where every stored line matched and no ink is left over,
- queues the rest for the per-page review, newest first.

A MyScript result is cached in `<userData>/relink-cache/<bookKey>/<pageId>.json` (with the page's
`metadata.lastUpdated`) so closing the app doesn't pay for it twice; a page changed since is sent again. Never in the
data folder.

### B.6 Guards (refused with a reason, page skipped in bulk)

The same set as Claude's edits (`editRefusal`): a Library draft on the page, any transcript editor open on it
(`transcriptEditorHold()`), a pending Editor transcription, a re-transcribe reset. Also: the page is already
trustworthy (nothing to do), or has no text lines. The disk revision (`metadata.lastUpdated`) is checked again at
save; a page changed since its MyScript call is sent again.

### B.7 Tests

`line-align.test.js` (moved from the MCP's tests, plus marker-stripped matching). `save-page.test.js`: relink keeps
every line field but `yBounds`, sets `lastTranscribed`, links strokes, leaves sketch-line and textless strokes alone.
A fixture built like 3017/123 (28 lines, 5 tasks, one CANCELLED): after relink `isTrustworthyTranscript()` is true and
every task is unchanged.

---

## Phase C — Tag types and details (3.22)

### C.1 Types

| Type | Set by | Details |
|---|---|---|
| Project | the pattern: job `####-###` or proposal `P####-###` (never stored) | name, client, active; a proposal can name the job it became |
| Person | Josh, on a keyword | display name, aliases, company (free text) |
| Topic | default for every other keyword | aliases |

A keyword with no stored type reads as Topic, so the four existing keywords (sketch, poem, dream, pen-refill) stay
Topics. A project number can't be retyped; a keyword can't become a Project. Job vs proposal is not a type, but the
UI and search still tell them apart by the pattern (`is:job`, `is:proposal`).

### C.2 Storage: `_tags.json` gains `info`

```jsonc
{
  "version": 1,
  "pages": { ... }, "dismissed": { ... },
  "info": {
    "tom":      { "type": "person", "label": "Tom", "aliases": ["Tom"], "company": "Burnell" },
    "framing":  { "aliases": ["framing", "framed"] },
    "5444-006": { "name": "…", "client": "…", "active": true }
  }
}
```

- Same file and lock as page tags, so rename, merge and delete move or drop a tag's `info` in the same write
  (`renameTagInMap` and friends get an `info` sibling). A merge keeps the target's info and adds the source's
  aliases.
- `tags-sidecar.cjs` already keeps unknown top-level fields, so a 3.21 build writing tags won't drop `info`. The
  version stays 1.
- Patches: `storage:patchTags` gains `info: { tag: record | null }`, applied inside the same lock.
- `lib/tags.js` owns the format: `normalizeTagInfo()`, `tagTypeOf(tag, info)`, `tagLabel(tag, info)`. Keys stay
  normalized tags (`tom`); capitals live only in `label` and `aliases`.

### C.3 UI

- **Manage tags → a tag**: a Details panel (type, display name, aliases, company or client, note). A Project shows
  its type as fixed; a keyword switches between Person and Topic.
- **Tag chips** everywhere show the label and take the type's colour.
- **Tag home**: three folding groups, Projects, People, Topics. Today's "Projects" and "Keywords" groups become
  Projects and Topics, with People split out; `collapsedTagGroups` is keyed by type, and an old "keywords" entry
  reads as Topics.
- **Tag input**: typing a new keyword offers "Add as Topic" (Enter) and "Add as Person".

### C.4 Search

`lib/search-query.js` learns facets: `person:tom`, `topic:framing`, `project:5444-006`, `type:person`,
`type:project`, `type:topic`, and the pattern subsets `is:job`, `is:proposal`. A value matches a tag's key, label or alias. A bare word that equals a tag's label or alias
still finds the tag, as bare tags do today.

### C.5 MCP

`list_tags` returns `type` and `label` per tag, and takes `type`. Read-only; no MCP tool sets types.

### C.6 Tests

`tags.test.js`: info normalization, type derivation, rename / merge / delete carrying info, rollback of an info
patch. `tags-sidecar.test.js`: info applied under the lock, unknown fields kept. `search-query.test.js`: every facet.

---

## Phase D — Block scope and People (3.23)

### D.1 Block scope

A tag on a page covers **blocks**, not the whole page, when its name is written there. One pure module,
`lib/tag-scope.js`, used for projects and people alike:

- **Roots**: every line whose text names the tag. A project tag: `findProjectNumbers()` on the line equals the tag.
  A person: the label or an alias as a whole word, case-sensitive, possessive allowed ("Tom's"). Topics have no
  block scope; they stay page tags.
- **Block**: a root plus every following line with a deeper indent, up to the next line at the root's indent or
  shallower. A root that is itself a child ("TODO schedule coord. meeting w/ Tom") covers only itself and its own
  children, not its siblings.
- **Hand corrections**, per page and tag, in `_tags.json`:
  `"blocks": { "3017/170": { "rich": { "add": ["<lineId>"], "remove": ["<lineId>"] } } }`. *Add* makes a line a root
  when the name isn't written there; *remove* drops a root that matched by accident (a different Tom). Lines that no
  longer exist are ignored.
- **No match and no added root**: the tag covers the whole page, shown as "named nowhere on this page".
- Scope is only computed for tags **on the page** (added by hand). Text alone never puts a page under a person.

The text needed is already in each scan record (`transcriptionText`, indented by two spaces per level), so scope
for the lists below needs no page reads. Line ids (for ticking and the hand corrections) come from `getPage()` when
a block is opened.

### D.2 Person page

The tag's page in the Library, when the tag is a Person (mockup T1 in the deep dive, extended):

- **Open items**: open tasks inside the person's blocks on any page, plus WAITING tasks whose text names the person
  ("WAITING Loren will reach out to Brady…"). Ticked in place through `changeTask()`.
- **Blocks**, newest first: the block's root line, its children, the page and the days written. Like a meeting
  history. Click opens the page in the reader at that line.
- **Copy agenda**: the open items as indented markdown (`TODO` / `WAITING`), for a meeting or a LogSeq page. Copy
  only; the app writes nothing to LogSeq.
- **Pages** grid and **Print** as for any tag.
- **Mentioned, not tagged**: pages whose text names the person (label or alias) but don't carry the tag, each with
  *Tag page*. Nothing is added without the click (decision 5).

Project tags get the same Blocks section on their tag page.

### D.3 Tasks and people

- `buildTaskSummary()` (and its mirror `electron/task-summary.cjs`, changed together per the invariant) adds `heads`:
  the ids and texts of the task's ancestor lines, at most 3, each text at most 80 characters. Scalar-small.
- `buildTaskRows()` gains `people`: Person tags on the page whose scope contains the task (by its own text, a head's
  text, or a hand-added root among its heads).
- Tasks view: **Group by → Person**, and `person:tom` in its search. MCP `list_tasks` takes `person`.
- Task `project` is unchanged (`projectHint` rules, v3.6.1).

### D.4 Reader

In Ink + text and the plain transcript, a line's ⋯ menu gains **Tag this block…** (adds the tag to the page if
missing, and an *add* root) and, on a root, **Not this person** (a *remove*). Scope is shown as a faint tag-coloured
bar beside the lines a tag covers, when that tag is selected in the page's tag strip.

### D.5 Tests

`tag-scope.test.js`: roots for projects and people, case and possessives, nested roots, block ends, hand add / remove,
the whole-page fallback, scope from `transcriptionText` equal to scope from lines. `task-summary.test.js`: `heads`
from both implementations over one fixture. `tasks.test.js`: `people`, grouping, the filter.

---

## Phase E — Sketch lines (3.24)

### E.1 Today

Drawings are left out of transcription (Deselect Decorative, by design) and end up as unlinked ink: on the 41
trustworthy JPI Dotted pages, 4,147 of 47,136 strokes are in no line. A transcript gives no sign that a page has a
sketch, and nothing finds "the stair sketch for 5444-006". The stroke flag `sketch: true` is unrelated: it only
changes rendering (pressure width) and is used on two pages of Poem Sketch.

### E.2 Format: a line with `kind: "sketch"`

```jsonc
{ "id": "…", "kind": "sketch", "text": "stair section", "indentLevel": 1, "parentId": "…",
  "checked": null, "yBounds": null,
  "bounds": { "minX": 12.1, "maxX": 48.7, "minY": 60.2, "maxY": 91.0 } }
```

- `text` is the label ("Sketch" when none is given). An older build shows the line as plain text with that label,
  which is a fair reading.
- `bounds` is the Ncode box of its strokes, recomputed whenever its strokes change; `yBounds` stays null (sketch lines
  never take part in MyScript matching).
- Never a task: `checked` is always null, no `marker`.
- Its strokes link to it by `lineId`, like text. Being linked, they are never sent to MyScript.
- Order and indent are where Josh puts it; on creation it goes under the nearest text line above it on the page
  (by its linked ink when the page is trustworthy, else at the end), at that line's indent + 1.

### E.3 Making a sketch

- **Editor**: select strokes → **Make sketch…** (selection toolbar and context menu): a label, the page's tags as
  suggestions for the label, and *Also draw with pen pressure* (sets `sketch: true`, off by default). Strokes must be
  saved already; unsaved ones say "Save first". Strokes from several pages make one sketch per page.
- **Library reader** (Ink + text): **Mark sketch** then drag a box; strokes wholly inside that are not in a text line
  are taken. Strokes in a text line are offered with a warning ("3 strokes are in line #12").
- **Relink review** (B.4) and `check_transcript`'s "ink in no line": *Make sketch*.

The write is immediate, like a task tick, through one function, `lib/viewer/sketch-lines.js` `saveSketchLine()`:
read the page, add or change the line, set `lineId` on the given stroke ids (by `strokeDiskId()`), `savePage()`,
then refresh the scan record, page cache and open reader (`refreshAfterSave()`), and in the Editor update the loaded
strokes' `blockUuid` so Transcribe skips them. Refused under the same guards as B.6.

**Edit / remove**: in any transcript view a sketch line's ⋯ menu has Rename, Add strokes, Remove strokes and
**Remove sketch** (the line goes; its strokes are unlinked, never deleted). In Library Edit and the Edit
Transcription dialog a sketch row shows its thumbnail; its label is editable, it can be moved and indented, and
deleting it asks first.

### E.4 Existing paths that must keep sketch lines

- **Transcript merge** (`mergeTranscript`): sketch lines are existing lines; kept in place like any other.
- **Edit Transcription dialog** (`applyEditorLines`): sketch rows go into the dialog's lines with their ids, so a
  confirmed result keeps them; a sketch line is never "emptied" by clearing a label (the label falls back to
  "Sketch").
- **Re-transcribe Reset** (v3.17, `transcript-reset.js`): unlinks only strokes in text lines; the replacing transcript
  keeps sketch lines, re-placed by y. Today it would drop them.
- **Relink**: excludes sketch lines and their strokes (B.2).
- **Claude's edits** (`lib/mcp-edits.js`): may rename a sketch line and move it; may not delete or insert one (ink).
  `get_transcript` shows it as `#7 [sketch] stair section (212 strokes)`.
- **Task summary**: skips sketch lines. **Tags**: a sketch's projects and people come from block scope (D.1), else
  the page's project tags (like tasks).
- **Exports**: markdown and copy write `[sketch: stair section]`; JSON keeps the fields; print shows the label in the
  transcript column.

### E.5 Scan record and search

- Main's scan adds `sketches: [{ id, label, lineIndex }]` per page (scalar-small, at most 20 kept) next to `tasks`;
  `transcriptionText` writes a sketch line as `[sketch] stair section` so word search finds labels.
- Search: `has:sketch` (pages with one), and with other terms the results group **Sketches** first: each a crop
  thumbnail of its `bounds` (drawn by `viewer/thumbs.js`, keyed by page + line id), label, page, tags.
  `has:sketch 5444-006`, `has:sketch person:tom`, `has:sketch stair` all work.
- Tag pages get a **Sketches** strip.
- MCP: `list_sketches {project?, tag?, person?, book?, from?, to?}` and `render_page {line}` to crop to one sketch.

### E.6 Tests

`save-page.test.js`: a sketch line survives merge, editor save, Reset + replace; its strokes stay linked.
`sketch-lines.test.js`: create, rename, add / remove strokes, remove (strokes unlinked, never deleted), bounds,
placement by y. `mcp-edits.test.js`: rename allowed, delete and insert refused. `search-query.test.js`: `has:sketch`
with tags. Scan: `sketches` from main over a fixture.

### E.7 Line kinds, in general

`kind` is optional and today only `"sketch"`. Code that reads lines treats an unknown `kind` as a text line it must
not edit as text: shown, kept, never matched to MyScript. That leaves room for other kinds (a table, a photo) without
another format change.

### E.8 Not in this phase

Recognising sketches automatically (a cluster of long strokes with no text), sketch-to-image export, and sketches in
the LogSeq export.

### E.9 Naming

Two features will share the word. Proposed wording: the transcript feature is **Sketch**; the stroke rendering flag's
UI label becomes **Pressure ink**, while its stored name (`sketch: true`) stays, since renaming a stored field would
break old files.

---

## Invariants touched (check each before merging its phase)

| Invariant | Phase | How it is kept |
|---|---|---|
| Append-only saves, explicit deletions only | A, B, E | No stroke is deleted by any phase; deletes and removes unlink. |
| One write path | all | Every write is `savePage()` via `savePageToFolder()` or the task / sketch one-shot writer. |
| In-memory markers never reach disk | A | `textless` is a stored field added to `strokeToStored()`'s key list on purpose. |
| `pendingChanges` and `computePageChangesFolder()` agree | A | `textless` toggles are modifications in both. |
| Transcript merge rules | A, B, E | Relink is a separate plan kind; sketch lines are kept by merge, editor save and Reset. |
| Task state only via `setTaskState()` | A, B, D | Deletes confirm; Relink never touches task fields; D ticks through `changeTask()`. |
| Tags never in a PageDoc | C, D | `info` and `blocks` live in `_tags.json`. |
| Task summary mirrored in main | D | `heads` added to both, tested over one fixture. |
| Scans are metadata-only | D, E | Scope from `transcriptionText`; `sketches` capped and scalar. |
| Reading views hold copies | B, E | `refreshAfterSave()` after each write. |
| Claude never edits ink or task state | E | Sketch lines can be renamed and moved, never created or deleted, by the MCP. |

## Docs at each release

CHANGELOG entry, CLAUDE.md (Data formats: `textless`, `kind`, `bounds`, `_tags.json` `info` / `blocks`; the
invariants above), ARCHITECTURE "Key Libraries" (`line-align`, `tag-scope`, `sketch-lines`), TESTING inventory,
KNOWN-LIMITATIONS, mcp/README for new tool parameters, and the check-transcription skill (Relink and Make sketch as
answers to "ink in no line").
