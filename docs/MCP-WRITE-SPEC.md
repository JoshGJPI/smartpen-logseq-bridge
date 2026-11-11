# MCP transcript edits through the app (option C) — spec

Status: **built in v3.18.0** (Josh, 2026-11-11). Answers to the open questions: opt-in in both places, a toast plus
the Activity Log line, a 30 s timeout. Beyond the spec: Claude's edits are refused while a transcript editor is open
on the page at all, not only when it is dirty (an open, clean Edit would save its old lines back).

## Goal

Let Claude apply the corrections the check-transcription skill finds (text, indent, order, missing lines) to a
page's saved transcript, without Josh retyping them in Edit Transcription, and without weakening the app's
guarantees. The MCP never writes a file itself: it asks the **running app** to make the edit, and the app makes it
through its existing Library-edit save path.

Why this option (A: MCP writes files, B: proposal sidecar the app applies, C: app endpoint) is in the v3.17.0
discussion; the short version:

- A is a second writer. The app holds copies of pages (scan records, reader page cache, thumbnails, the open
  reader's `doc`) that would go stale, and a Library Edit draft open on the page saves every line verbatim and would
  silently revert the edit. A would also have to reimplement task-state rules, `parentId`, `lineId` scrubbing and the
  atomic write.
- B was rejected in v3.16.0 (a second write path plus a review queue in the app).
- C keeps **one write path** (`local-store.js` `savePage()` via main), lets the app refuse edits on pages it is
  editing, and refreshes the app's views. Its cost: the app must be running.

## Scope

In: text edits to existing lines, indent, reorder, insert a line, delete a line, on one page per call; a dry run;
an undo of the last MCP edit on a page; the skill's new "apply" step.

Out (stays in the app): anything about ink. MCP edits never create or change stroke `lineId`s except the scrub a
delete already does. No task-state changes (tick, WAITING, CANCELLED, Not a task): those stay in
`setTaskState()` and the UI. No tags (they have their own path), no MyScript calls, no strokes.

## Architecture

```
Claude ─ MCP tool edit_transcript ─► mcp/core/app-client.js ─ HTTP 127.0.0.1:<port>, bearer token ─►
  electron/mcp-endpoint.cjs (main) ─ webContents.send('mcp:edit', {reqId, ...}) ─►
  renderer: stores/mcp-edits.js  (guards, lib/mcp-edits.js apply, saveTranscriptLines, refresh)
  ─ ipcRenderer 'mcp:edit-result' {reqId, ...} ─► main ─► HTTP response ─► MCP reply
```

- **Main (`electron/mcp-endpoint.cjs`, required from `main.cjs`)**: an `http` server on `127.0.0.1`, port 0 (OS
  picks), started after the window loads, closed on quit. It writes `{ port, token, pid, version }` to
  `<userData>/mcp-endpoint.json` (owner-only where possible) and deletes it on quit. Every request needs
  `Authorization: Bearer <token>` (32 random bytes, new each launch); anything else is 401. One route:
  `POST /transcript-edit` with a JSON body ≤ 256 KB. Main does no PageDoc logic: it validates the shape
  (`requireBookKey` / `requirePageId`), forwards to the renderer with a request id, waits up to 15 s for the reply,
  and returns it. A renderer that isn't ready → 503 "app is starting".
- **Renderer (`stores/mcp-edits.js`)**: registers the `mcp:edit` listener through `preload.cjs`
  (`window.storageAPI.onMcpEdit(handler)` + `replyMcpEdit(result)`). Runs the guards, reads the page with `getPage`,
  applies the operations with the pure `lib/mcp-edits.js`, and (unless dry run) saves with
  `saveTranscriptLines(book, page, lines, { base })` — the same function Library Edit uses, so `parentId`,
  `keepDiskTaskState`, typed-box parsing and `lineId` scrubbing are already right. Then `refreshAfterSave([{book,
  page}])` and a `log()` line ("Claude edited B3017/P180: 4 lines"). Check that `refreshAfterSave` also refreshes an
  open reader page (`PageSpreadView`'s own `doc`); if it doesn't, add that, since Library Edit relies on `onSaved`.
- **MCP (`mcp/core/app-client.js`)**: finds the endpoint file (env `SMARTPEN_APP_ENDPOINT`, else
  `%APPDATA%/Smartpen LogSeq Bridge/mcp-endpoint.json`; check the real `app.getPath('userData')` for both the
  installed and the dev build), checks the pid is alive, posts, and turns errors into plain tool errors ("The
  smartpen-bridge app isn't running; open it and try again").
- **Opt-in.** The write tools are registered only when the MCP server is started with `SMARTPEN_MCP_WRITES=1`, and
  the app only starts the endpoint when Settings → Data Folder → "Allow Claude to edit transcripts" is on (default
  off, localStorage). Off in either place = today's read-only server. Write tools get annotations
  `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }`.

## The tool: `edit_transcript`

```jsonc
{
  "book": "3017", "page": "180",
  "revision": "2026-11-11T18:35:15.510Z",   // metadata.lastUpdated from the dry run (required to apply)
  "dry_run": true,                           // default true
  "edits": [
    { "op": "set_text",   "line": 4,  "expect": "Brad Russell, AlA, P.E., S.E.", "text": "Brad Russell, AIA, P.E., S.E." },
    { "op": "set_indent", "line": 21, "expect": "Is certification required for storm shelters?", "level": 3, "with_children": true },
    { "op": "move",       "lines": [27, 28, 29, 30], "expect_first": "11/6/26", "to": "top" },     // or "bottom", or { "after": n }
    { "op": "insert",     "after": 8, "expect": "10:00 Prototyping Concrete Masonry Storm Shelters", "level": 2, "text": "Jason Thompson" },
    { "op": "delete",     "line": 11, "expect": "Typical, A-Block, H-Block" }
  ]
}
```

- **Lines are addressed by stored line number (`#n`, 1-based, as `check_transcript` prints them) plus the text
  expected there.** Numbers are what Claude has in hand from the diff; the `expect` text (exact match) catches a
  transcript that changed since. All numbers refer to the transcript **before** the call: the client resolves every
  `#n` to a line id first, then applies the ops in order by id. Line ids are never shown to Claude.
- **`revision`**: the page's `metadata.lastUpdated` when the dry run read it. Applying with a stale revision is
  refused ("the page changed since the dry run; run it again").
- **Dry run** (default) returns the transcript after the edits as the same bullets `get_transcript` prints, each
  changed line marked (`~` changed, `+` inserted, `-` deleted, `↕` moved), plus the revision to apply with. Nothing
  is saved, no guard that only matters for saving is skipped (so a refusal shows up in the dry run too).
- **Apply** returns the same listing and "saved; undo with undo_transcript_edit".
- Op rules (all in `lib/mcp-edits.js`, pure, tested):
  - `set_text`: new text, trimmed, one line (newlines → spaces), non-empty (use `delete`). A leading task box in the
    text makes a **plain** line a task on save (`parseTypedTasks`), as in Library Edit; on a task it stays text,
    never changing the state. Reject `WAITING` / `CANCELLED` / `DOING` / `NOW` / `LATER` as a leading word so Claude
    can't imply a state.
  - `set_indent`: level 0–8, at most one deeper than the line above after all edits (as Library Edit's Tab).
    `with_children` (default true) shifts the line's subtree by the same amount.
  - `move`: the lines in the order given keep that order (`move-lines.js` semantics for Top / Bottom; `{after: n}`
    puts them after line `n`, which must not be one of them). Indent unchanged; parents are recomputed on save.
  - `insert`: a new line (new id, `checked: null` unless a typed box, `yBounds: null`, no ink) after line `n`
    (`after: 0` = first). No ink is linked; the reply says so.
  - `delete`: removes the line; its children are kept and outdented one level (never deleted with it). Strokes
    linked to it are unlinked by the save's scrub. A task line can be deleted only with `"task_ok": true`, so a TODO
    isn't lost by accident.
  - At most 60 ops per call; a call is all-or-nothing.

## Guards (renderer, before any save; refused with a reason, never partially applied)

1. The data folder is set and is the one the MCP reads (compare normalised paths; the MCP passes its root).
2. The page exists and has a transcript.
3. **No Library Edit draft on the page** (`isViewerPageDirty`).
4. **Not on the Editor canvas with transcript state pending**: no `pageTranscriptions` entry for the page, not
   reset for re-transcription (`isPageReset`). (Plain loaded strokes are fine: a later canvas save starts from disk
   and only appends.)
5. `revision` matches on apply; every `expect` matches.
6. Result passes `validatePageDoc()` and keeps every untouched line byte-identical (id, text, indent, task fields,
   yBounds), so a bug in an op can't spread.

## Undo

Before each applied edit the renderer asks main to append the page's previous `transcript` (and the stroke
`lineId`s the save will scrub) to `<userData>/mcp-edits/<bookKey>-<pageId>.jsonl`, with the time and the ops.
Never in the data folder. `undo_transcript_edit {book, page}` restores the last entry through the same path, only
if the page's revision is still the one that edit wrote (else refuse: "edited since"). Keep the last 20 entries
per page. The app also gets a small "Claude edits" list (Settings → Data Folder) with Undo per entry; optional for
the first cut.

## Skill changes (check-transcription)

New step 8, **Apply** (only when Josh says so, per page): build the edits from the corrections list (never from
"for Josh to decide" items unless he picked an answer; never "looks like your edit" lines), run `edit_transcript`
as a dry run, show Josh the marked listing, apply on his yes, then re-run step 5. Re-transcribe (step 7) still comes
first, in the app: edits applied before a re-transcription are replaced by it.

## Tests

- `lib/mcp-edits.js`: each op, ordering by original numbers, `expect` mismatch, indent limits, delete keeps
  children, task-line delete needs `task_ok`, untouched lines identical, 60-op limit, all-or-nothing.
- Renderer guard function (pure, store values passed in): each refusal.
- `electron/mcp-endpoint.cjs`: token required, body limit, unknown route, timeout, renderer-not-ready (test the
  request handler with a fake forwarder, without Electron, like the other `electron/*.cjs` modules).
- MCP: tools absent without `SMARTPEN_MCP_WRITES`; app not running; dry run then apply against a fake endpoint;
  stale revision.
- Manual: real app + scratch data folder (copy two pages; separate `--user-data-dir`, CDP as in v3.17.0), apply the
  3017/180 and 181 corrections from the v3.17.0 session, check the open reader page and the Library grid update
  without Rescan, undo.

## Open questions for Josh

- Opt-in in both places (env + app setting), or the app setting only?
- Should the app show a toast for each Claude edit, or only the Activity log line?
- Is the 15 s timeout right when the window is minimised (renderer throttling)?

## Later (not in this spec)

- Linking inserted lines to ink by row geometry (agreed with MyScript's links 87–95% in the v3.16.0 test).
- Task-state edits through `setTaskState()`.
- Multi-page batches.
