---
name: check-transcription
description: Check smartpen notebook transcriptions against the handwriting and give Josh a correction list. Use when Josh asks to transcribe, check, proofread or tag smartpen / notebook pages (JPI Dotted and other books in the smartpen-bridge data folder), to review "the pages from yesterday", to compare a MyScript transcript with the ink, or to work through untranscribed pages. Uses the read-only smartpen-bridge MCP; the transcription itself is done in the app with MyScript so lines keep their links to the ink.
---

# Check a smartpen transcription

MyScript, run in the smartpen-bridge app, makes the transcript **and** links each line to its strokes (Ink + text,
`color_by_line`). Its text is about 94% right and its indentation is usually right, but it misreads characters
(`AlA`, `IOP II`, `2,500ps:`), occasionally drops a line's text while keeping its ink (a name under a heading),
links sketch ink to text lines, and skips ink that wasn't in the batch. This skill catches those: read the page
yourself, blind, then diff and look at the links.

Steps 1–7 are read-only. Step 8 can apply the corrections, but only through the running app (`edit_transcript`),
only when Josh says so, and only after he has seen the dry run. Never edit files in the data folder.

## Tools (smartpen-bridge MCP)

| Tool | Use |
|---|---|
| `days_summary {from, to?}` / `list_pages {book}` | Find the pages: written on a day, or untranscribed in a notebook |
| `render_page {book, page, show_decorative}` | Before transcribing: red = what Deselect Decorative will leave out |
| `check_transcript {book, page}` | Written rows from the ink: height, left margin, indent **column**, `wrap?`. No transcript text, so it is safe before the blind read |
| `render_page {book, page}` | The ink, plain (~1,800 image tokens per page) |
| `check_transcript {book, page, reference}` | Your reading vs the stored transcript: wording, indent, task state, missing lines, stroke counts |
| `render_page {book, page, color_by_line}` | Each line's ink in its colour, with a key: mislinks, lines with no ink, ink in no line |
| `edit_transcript {book, page, edits, dry_run}` | Step 8 only: apply corrections through the running app (dry run first) |
| `undo_transcript_edit {book, page}` | Undo the last applied edit on a page |

If the tools are missing, the MCP is not registered or Claude Code needs a restart (`mcp/README.md`). The two write
tools appear only when the server is registered with `SMARTPEN_MCP_WRITES=1`; without them, step 8 is Josh's to type.

## Process

### 1. Find the pages
`days_summary` for a day ("yesterday" = the day before today's date), or `list_pages {book}` and pick
`transcribed: false`. Note pages whose ink spans several days (`strokesThatDay` < `strokesOnPage`).

### 2. Before Josh transcribes (untranscribed pages only, optional)
`render_page {show_decorative: true}`. Report any **task box (☐ / ☑) in red**: left out, its line loses TODO / DONE,
so Josh must reselect it. Boxes round project numbers, circled dates, heading underlines and sketch lines are fine
red. A strike-through stays dark (kept for MyScript); if a red line seems to cross text, say it may be a second line
along the baseline and that you can't zoom, rather than calling it a bug.

**Drawings:** Deselect Decorative does not take sketches. A drawing in the batch can break the line links for every
line after it (3017/182: one line's box stretched over the drawing, it got 479 strokes and the five lines below it
none). For any page with a drawing *between* lines of text, tell Josh to also deselect the drawing and its labels
before Transcribe. A drawing at the very bottom only clutters the last line's ink.

### 3. Josh transcribes in the app
Editor: load the pages **by page, not by date** (a by-date load leaves out ink written on other days, as on
3017/180), Select All → Deselect Decorative → Transcribe → save. Wait for him to say it's done.

### 4. Read each page blind
Do not call `get_transcript` or `color_by_line` on the page yet, and don't look at an earlier render with colours.

1. `check_transcript {book, page}` for the rows.
2. `render_page {book, page}` (plain).
3. Write the reference as markdown bullets, one tab per level, following these rules:
   - **One bullet per item, not per written row.** A row marked `wrap?` is either a wrapped sentence (join it to the
     line above) or a sub-item (its own bullet one level in); decide from the text (a sentence that runs on, a
     lowercase start → wrap).
   - **Level from the column**, compressed so a line is at most one level deeper than its parent (a page whose first
     items start two columns in still nests them one level under the header). Same column = same level, whatever
     the words suggest.
   - **Tasks:** a box in front of the line → `TODO` (empty) or `DONE` (ticked) before the text. Markers are TODO,
     DONE, WAITING, CANCELLED only. WAITING / CANCELLED are never read from ink: they are set in the app.
   - **Write what is on the page.** Keep Josh's abbreviations and spellings (`TxDO`, `pizzaz`) and his symbols
     (`≈`, `&`, `'`, `"`); don't expand or correct. Mark a word you can't read with `[?]`. Subscripts are written
     flat (`VT`, `RoTC` for V<sub>T</sub>, K<sub>RoTC</sub>) and listed for Josh, since MyScript writes them as words
     (`Vt`, `Rotc`).
   - **Roman numerals and lookalikes** (`II` / `III`, `0` / `O`, `I` / `1` / `l`): count the strokes in the picture
     before writing them; these are where MyScript's misreads cluster (`IOP II`, `EFO`, `Risk Category III`).
   - **Struck-through text:** leave it out. Text written above a strike (a correction) goes in its place.
   - **Sketches:** MyScript usually turns sketch labels into a line (`Typical, A-Block, H-Block`). Don't include
     sketches; the diff will show such a line as stored-only, and that's expected.

### 5. Diff
`check_transcript {book, page, reference}`. Read every difference against the ink before reporting it: the reference
can be the one that's wrong.

Josh may already have edited a page before asking. A stored line that is *more* complete or tidier than the ink
(`OH` → `Ohio`, `Perf.` → `Perforation`) is his edit, not a misreading: MyScript never expands abbreviations. List
those under "looks like your edit", not as corrections.

A `LINKS BROKEN?` line in the reply (one line with several times the median strokes, usually followed by lines with
none) means the stroke links are wrong from there down. The text may still be fine. The fix is to re-transcribe, not
to edit lines: see step 7.

`MOVED` lines (and an `OUT OF ORDER` line in the summary) are stored somewhere other than where they are on the page,
usually ink transcribed later and appended at the end (3017/180's 11/6 meeting). Report them as one entry: which lines
and the line they belong after; Josh ticks them and uses Move (↑ / ↓ / Top / Bottom) in Library Edit or Edit
Transcription.

`PARTLY TRANSCRIBED?` (also in step 4's rows reply, which then marks rows `not transcribed`; `list_pages` shows the
page as `partly`) means most of the ink was never sent to MyScript (3017/186: 6 lines saved, 84% of the ink in none).
Ask Josh to transcribe the rest before checking the text; the diff would only list those lines as missing.

### 6. Look at the links
`render_page {book, page, color_by_line: true}`. Look for:
- `NO INK LINKED` lines, and their ink drawn in a neighbour's colour (MyScript gave it to the wrong line);
- one written row in two colours;
- dark text (ink in no batch: not transcribed at all, e.g. written on another day);
- sketch ink coloured as a text line (harmless for text, clutters Ink + text).

### 7. Report, per page
1. **Corrections**, by stored line number (`#n` from the diff), with the exact replacement text, ready to type into
   Edit Transcription. Missing lines: the text, its level and the line it goes under.
2. **For Josh to decide**: `[?]` readings, ambiguous characters, spelling he may want corrected.
3. **Ink**: untranscribed blocks (transcribe them on their own), lines out of order, and broken links. To
   re-transcribe a page: Editor, load the whole page (by page, not by date), Transcripts tab → "Re-transcribe a saved
   page" → ↺ Re-transcribe (unlinks its strokes so they are sent again), select the text strokes with any drawing
   deselected, Transcribe, Save. The new run replaces the saved transcript (task states carry over where the text
   matches; drawing ink left out ends up unlinked). Ask Josh to re-transcribe **before** applying text corrections,
   which the new transcription would replace, then run step 5 again.
4. **Tags**: the boxed project numbers on the page. Never invent one; if the logseq MCP is available, check it with
   `listActiveProjects` before suggesting it. Topic tags only as suggestions.

Keep cosmetic differences (case, a space around a dash) in one line per page, not one entry each (`X` / `x` in a
dimension, `F. SEI` / `F.SEI`). A difference that changes meaning gets its own entry even when the diff calls it
case-only (`EFO` / `EF0`, a capital that moved to the wrong word). After the corrections
are applied (by Josh, or in step 8), offer to run step 5 again.

### 8. Apply (only when Josh asks, one page at a time)
The app must be open with Settings → Data folder → "Allow Claude to edit transcripts" on. Re-transcribe (step 7)
comes first, in the app: a new transcription replaces edits applied before it.

1. Build the edits from the **Corrections** list only. Never from "for Josh to decide" items unless he picked an
   answer, never from "looks like your edit" lines, and nothing about task state (ticks, WAITING, CANCELLED are his,
   in the app) or ink.
   - Wording: `{ "op": "set_text", "line": n, "expect": "<text now on #n>", "text": "<new text>" }`
   - Indent: `{ "op": "set_indent", "line": n, "expect": …, "level": 0–8 }` (its sub-lines move with it)
   - Out of order: `{ "op": "move", "lines": [n, …], "expect_first": …, "to": "top" | "bottom" | { "after": n } }`
   - Missing line: `{ "op": "insert", "after": n, "expect": <text on #n>, "level": …, "text": … }` (no ink is linked)
   - Sketch label or junk line: `{ "op": "delete", "line": n, "expect": … }` (its sub-lines move up a level; a task
     line also needs `"task_ok": true`, and only if Josh said to delete it)

   `n` is the stored number from step 5's diff, and every number means the transcript as it was before the call.
   `expect` is the exact stored text (copy it from `get_transcript`), not your reading.
2. `edit_transcript` with `dry_run` left on. Show Josh the marked listing (`~` changed, `+` inserted, `↕` moved,
   deleted lines below) and wait for his yes.
3. On yes: the same call with `"dry_run": false` and the `revision` the dry run returned. "The page changed since the
   dry run" means Josh (or the app) wrote it meanwhile: dry-run again. A refusal naming an editor or a draft means
   the page is open for editing in the app: ask Josh to close it.
4. Run step 5 again on the page. If something came out wrong, `undo_transcript_edit` puts the page back as long as
   nothing else has written it since.

## Cost
Per page: one plain render and one coloured render (~1,800 image tokens each) plus a few hundred text tokens. Do
up to 3–4 pages per turn and report as you go.

## Known limits
- `check_transcript`'s column step (4.6 mm) is measured on JPI Dotted; check the columns look sensible on other paper.
- Row grouping can split a row with a big gap or merge a stroke from the row below; trust the picture over one row.
- No zoom: `render_page` shows the whole page (or `fit: "ink"`), so thin overlapping strokes can be hard to tell apart.
