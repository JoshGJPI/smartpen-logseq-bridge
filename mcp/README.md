# smartpen-bridge MCP server

Stdio MCP server over the data folder (`<root>/pages/B*/P*.json`). Works with the app closed (PageDocs are
written atomically, so reading while the app runs is safe too). It never writes a file, opens no port and never calls
MyScript. Design: [docs/MCP-SERVER-SPEC.md](../docs/MCP-SERVER-SPEC.md). Opt-in, it can also ask the **running app**
to correct a transcript (see "Editing a transcript through the app"; [docs/MCP-WRITE-SPEC.md](../docs/MCP-WRITE-SPEC.md)).

## Run

Needs this checkout's dev dependencies (`npm install`): `@modelcontextprotocol/sdk`, `zod`, `@resvg/resvg-wasm`.

```bash
SMARTPEN_DATA_ROOT=<data folder> node mcp/server.js            # or: node mcp/server.js --data-root <dir>
SMARTPEN_DATA_ROOT=<data folder> npm run --silent mcp          # --silent: npm's banner would corrupt stdout
SMARTPEN_DATA_ROOT=<data folder> node mcp/drive.mjs            # list tools through a real stdio client
SMARTPEN_DATA_ROOT=<data folder> node mcp/drive.mjs render_days '{"from":"2026-10-19"}' ./out   # call one; PNGs to ./out
```

The server exits with a message on stderr when the folder is missing or has no `pages/`. On start it logs one line to
stderr (never stdout, which carries the protocol): its version, the git commit it runs (`unknown` without git), the
data folder and the newest page file's write time. Claude Code shows it in its MCP logs.

## Register

Point the client at `node` and this checkout's `mcp/server.js` directly (not `npm run mcp`, whose banner goes to
stdout), with absolute paths. The server loads its code once at start: restart Claude Code (or Claude Desktop) after a
branch switch or pull to run the new code. `npm install` works while it runs (the renderer is WebAssembly, with no
native file for Windows to lock).

**The data folder is set here, not by the app.** `SMARTPEN_DATA_ROOT` is fixed at registration; the app keeps its
folder in localStorage, which the server cannot read. If the folder is changed in the app (Settings → Data Folder),
change it in the registration too, or the server keeps reading the old one. The startup line names the folder it reads.

**Claude Code** (all projects; drop `--scope user` for this project only):

```bash
claude mcp add smartpen-bridge --scope user -e SMARTPEN_DATA_ROOT="C:\Users\joshg\Documents\stroke-data" -- node "C:\Users\joshg\Documents\Claude Access\smartpen-logseq-bridge\mcp\server.js"
```

**Claude Desktop**: add to `%APPDATA%\Claude\claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "smartpen-bridge": {
      "command": "node",
      "args": ["C:\\Users\\joshg\\Documents\\Claude Access\\smartpen-logseq-bridge\\mcp\\server.js"],
      "env": { "SMARTPEN_DATA_ROOT": "C:\\Users\\joshg\\Documents\\stroke-data" }
    }
  }
}
```

New pages show up without a restart: each call re-stats the folder and re-reads only changed files.

## Tools

| Tool | Returns | Cost |
|---|---|---|
| `list_notebooks` | Book keys, names, page / stroke / transcribed / open-task counts, first and last day, active volume, paper known | text |
| `list_pages` | One notebook's pages: strokes, days, tags, transcribed, open tasks, rotation. Tag / date filters, paged | text |
| `list_tags` | Tags with page, notebook and open-task counts, untagged count; with `tag`, that tag's pages | text |
| `list_tasks` | Task lines (TODO / DONE / WAITING / CANCELLED): the app's Tasks view rows, filtered by state, project, tags, notebook, days, text; grouped; paged | text, ~350 chars a row |
| `check_transcript` | Without `reference`: the page's written rows from the ink (height, left margin, indent column, possible wraps), no transcript text. With `reference` (Claude's reading as markdown bullets): the stored transcript diffed against it (wording, indent, task state, missing lines, strokes per line). See "Checking a transcription" | text |
| `get_transcript` | One page's lines, numbered `#n` (the stored line number `edit_transcript` takes), with indent and TODO / DONE / WAITING / CANCELLED; flags pages whose stroke-to-line links are unreliable | text, few KB |
| `search` | The app's header search: words, dates, notebook names / keys, tags (same code, same limits) | text |
| `days_summary` | Per local day: strokes and pages touched | text |
| `render_page` | One page as a PNG, stored rotation, on the printed page (`fit: "ink"` crops to the ink). `color_by_line` / `show_decorative` for checking a transcription (see "Checking a transcription") | ~1,700 visual tokens at 1000 px |
| `render_days` | One PNG per page written on in the range: that range's ink dark, the rest of the page grey; `transcript: true` adds each page's text | 4 images, ~3,500 visual tokens at 700 px |

Text tools are cheap; the tool descriptions point Claude at them first (`get_transcript` before `render_page`,
`days_summary` before `render_days`).

**Images are budgeted by pixels, not bytes.** Claude reads an image as ceil(w/28) × ceil(h/28) visual tokens whatever
its file size, and Claude Code warns above 10,000 tokens per tool result (hard cap 25,000, images included). Fixed rule
(`render.js` `fitWidth`, `LIMITS` in `core/tools.js`):

| | Default | Cap |
|---|---|---|
| Images per call | 1 (`render_page`), 4 (`render_days`) | 4 |
| Width | 1000 px (`render_page`), 700 px (`render_days`) | long edge 1,500 px and 2,000 visual tokens per image |
| `list_tasks` rows | 50 | 200 |

A caller may raise `width` up to the cap; past it the width is lowered, never refused. Worst case 4 × 2,000 = 8,000
visual tokens plus the text block, under the warning. Pages left out are named in the reply with the `offset` to ask
for next. Each image's note gives its size and token estimate.

## Tasks

`list_tasks` returns the rows the app's Tasks view shows (Library › Tasks), built by the same code: each page's
`buildTaskSummary()` is kept in the scan cache, rows come from `buildTaskRows()` with the page tags and the capture-day
index, and `filterTaskRows()` / `groupTaskRows()` / `compareTaskRows()` order them (`core/tasks.js`). Read-only: ticking or
changing a task is done in the app.

- `state`: `open` (default) = TODO + WAITING, `todo`, `waiting`, `done`, `cancelled`, `all`. The app's **Open** chip is
  TODO only; here that is `todo`. The reply's counts cover every state in the filtered scope.
- `project`: the page's **first** project tag, as the app groups (`P2026-141`, `2327-018`, normalized by `normalizeTag`);
  `untagged` = pages with no project tag. `tag` (one or several, all must match) checks every tag on the page.
- `book`, `from` / `to` (pages with ink on a local day in range), `text` (task or parent line, case-insensitive),
  `group_by` (`project` | `date` | `book`), `limit` / `offset`.
- A row: `state`, `text`, `parent`, `notebook`, `book`, `page`, `project`, `tags`, `written`, `line` (empty fields left
  out). Follow up with `get_transcript` / `render_page` on `book` + `page`; no per-line ink crops (stored `lineId`s are
  unreliable before Aug 2026).
- Only lines whose state is stored are tasks. Pages transcribed before v3.3.0 that still have ☐ / ☑ in their text are
  counted in the reply ("not tasks yet"): run Convert task boxes… in the app.

## Checking a transcription

`check_transcript` and two `render_page` options compare a page's transcript with its ink. The server still never
calls MyScript or writes anything. Transcribe in the app (Editor: load the pages by page, Select All → Deselect
Decorative → Transcribe, save), then check here, and fix lines in the app's Edit Transcription. The whole process,
including how Claude writes its blind reading, is the project skill
[`.claude/skills/check-transcription/SKILL.md`](../.claude/skills/check-transcription/SKILL.md).

- **`check_transcript` without `reference`:** the written rows, measured from letter-sized strokes (boxes, long lines
  and sketches don't set a margin): height, left margin, right end, stroke count, and an indent **column** (one step
  = `COLUMN_MM`, 4.6 mm, measured on JPI Dotted). `wrap?` marks a row that starts deeper under a row that reached the
  right edge: a wrapped sentence or a sub-item, which only the text can tell. Rows written on other days are dated.
  No transcript text is returned, so it can be read before a blind reading. On a transcribed page whose links can be
  trusted, rows with no stroke in any line are marked `not transcribed`, and a `PARTLY TRANSCRIBED?` line warns when
  under 75% of the page's strokes are in a line (3017/186: 84% in none). `list_pages` shows such a page as `partly`.
  Ink left out of transcripts on purpose (`textless: true`, "Not text", v3.20.0: a deleted scribble's ink, or strokes
  Josh left out in the Editor) is not ink in no line: the reply says "N strokes (M left out as Not text)", its rows are
  never `not transcribed`, and it is left out of the 75% and of `partly`.
- **`check_transcript` with `reference`:** the reference (markdown bullets, one tab or one space-unit per level,
  `TODO` / `DONE` / `WAITING` / `CANCELLED` in front of tasks) is aligned with the stored lines in order (dynamic
  programming over line similarity, so a missing or extra line doesn't shift the rest). Each stored line is reported
  as exact, case/punctuation/spacing only (`IBC 2024` / `IBC2024` is not a wording change), or worded differently,
  with indent and task-state differences, its stroke count and `NO INK LINKED`. A line left unmatched on both sides
  that is the same line (similarity ≥ 0.75) is paired and marked `MOVED`, with the reference line it follows: stored
  out of order, usually ink transcribed later and appended (3017/180). Other unmatched lines are listed. Tested on raw MyScript output (3017/180–181):
  indents all agreed, ~6% of words differed, and it found a heading's name whose text MyScript dropped.
  `LINKS BROKEN?` marks a line holding more than 4× the median line's strokes (and at least 150): ink from other rows
  is linked to it, usually because a drawing was in the MyScript batch (3017/182: 479 strokes on one line, none on
  the five after it). On the 33 JPI Dotted pages with trustworthy links it fires on 4.
  The summary's "N stroke(s) linked to no line" doesn't count textless ink and names it: "(not counting M left out as
  Not text)".

- **`color_by_line`:** each stroke in the colour of the transcript line it is linked to (`lineId`), from an 8-colour
  cycle in transcript order, so neighbouring lines always differ. The reply lists every line: number, colour, stroke
  count (or `NO INK LINKED`), task state and text, plus how many strokes are linked to no line (drawn dark; how many of
  them are left out as Not text on purpose, v3.20.0). resvg has
  no fonts here, so the image carries no labels; the colour names in the key are the link. Only where
  `isTrustworthyTranscript()` says the links are good (transcribed by the fixed matcher); otherwise the ink is plain and
  the reply says why. Ink of one line drawn in another line's colour, or a line with no ink, is a mislink.
- **`show_decorative`:** strokes the app's Deselect Decorative would take drawn red (wins over a line colour), with
  counts of boxes, underlines and circles. Same detector (`detectDecorativeIndices`) on every stroke of the page in raw
  Ncode, as the Editor runs it. A red task box (☐ / ☑) would be left out of the transcription and lose its TODO / DONE.

## Editing a transcript through the app (v3.18.0)

`edit_transcript` and `undo_transcript_edit` exist only when the server is started with `SMARTPEN_MCP_WRITES=1`, and
work only while the app is open with Settings → Data folder → "Allow Claude to edit transcripts" on (default off). Off
in either place = the read-only server. The server still writes nothing: it posts the edit to the app
(`core/app-client.js`), and the app checks it, saves it through its own write path (Library Edit's save) and refreshes
its views, so an open reader page shows the change at once. To turn it on, add `-e SMARTPEN_MCP_WRITES=1` to the
`claude mcp add` line above (or `"SMARTPEN_MCP_WRITES": "1"` to the Desktop `env`) and restart the client.

- **Finding the app:** `<userData>/mcp-endpoint.json` (`{ port, token, pid, version }`, written while the endpoint runs,
  owner-only, removed on quit or when the setting goes off). Looked up at `SMARTPEN_APP_ENDPOINT`, else
  `%APPDATA%\smartpen-logseq-bridge\` (the dev and the installed build share it), else `%APPDATA%\Smartpen LogSeq Bridge\`.
  A file whose pid is gone is ignored. The endpoint is `127.0.0.1` only, with a bearer token that is new each start.
- **Ops** (one page per call, ≤ 60, all-or-nothing): `set_text`, `set_indent` (sub-lines follow unless
  `with_children: false`), `move` (`top`, `bottom`, `{ after: n }`), `insert` (no ink linked), `delete` (sub-lines move
  up a level; a task needs `task_ok`). Lines are addressed by the stored number `#n` **plus `expect`**, the exact text
  on it (a task's own label in front, as `get_transcript` prints it, is allowed, and is dropped from a `set_text` on
  that task); numbers mean the transcript before the call. Indent: at most one deeper than the line above.
- **Dry run first** (the default): the result as `get_transcript` bullets, numbered as it will be stored, marked `~`
  changed, `+` inserted, `↕` moved, deleted lines listed after, plus the `revision` to apply with. Applying with
  another revision is refused ("the page changed since the dry run").
- **Refused** (dry runs too): the app's data folder isn't this server's; the page is open in a transcript editor in
  the app (Library Edit or the Pages tab dialog, changed or not) or has an unsaved Library draft; an unsaved Editor
  transcription or a re-transcribe reset on the page.
- **A deleted line's ink is only unlinked**, never flagged Not text (`textless`, v3.20.0): that is ink, so Josh's
  choice in the app. A deleted scribble's ink is sent again on the next Transcribe unless he deletes the line in the
  app with Not text, or leaves the strokes out in the Editor.
- **Never** ink or task state: no tick / WAITING / CANCELLED (a line can't start with `WAITING`, `CANCELLED`, `DOING`,
  `NOW`, `LATER`); a typed `TODO` / `DONE` / box in front of a plain line makes it a task, as Library Edit does.
- **Undo:** `undo_transcript_edit {book, page}` restores the page's transcript (and the ink links a delete removed)
  as it was before the last applied edit, only if nothing has written the page since. The log is
  `<userData>/mcp-edits/<book>-<page>.jsonl`, 20 per page, never in the data folder.
- **Timeout:** the app answers within 30 s, or the call fails saying an edit may still have landed (check with
  `get_transcript`).

## Rendering

- **Layout:** pages are laid out on Neo's printed frame (`_backgrounds/<book>/manifest.json`, geometry only; the JPGs are
  never read), so every page of a notebook shares one scale and a stray stroke off the paper is clipped and reported,
  not allowed to shrink the page. Books without a manifest use the ink box with outlying strokes trimmed (2nd / 98th
  percentile of stroke boxes). `fit: "ink"` crops to the ink (or the day's ink) to zoom in.
- **Rotation:** the stored `_orientation.json` turn, one transform within the frame (no override). Points are never
  rewritten.
- **PNG:** `@resvg/resvg-wasm`'s `asPng()`, initialised once per process from the package's `.wasm` file; no fonts
  (the SVGs are ink only). Pixel-identical to the native `@resvg/resvg-js` it replaced, at ~200–350 ms per dense page
  instead of ~75–105 ms.
- **Days:** a stroke belongs to the local day of its `startTime`; ranges are half-open (`rangeBoundsMs`), the same
  `dayKey` the app uses. `metadata.lastUpdated` is never used.

## Layout

`core/paths.js` (root + path guard), `core/sidecars.js` (aliases, volumes, orientation, tags, paper frame),
`core/store.js` (Node scan, app-shaped records, in-memory capture-day index; `_timeline.json` is never read or written),
`core/bounds.js` (paper / robust ink view box), `core/render.js` (SVG, PNG via `@resvg/resvg-wasm`, pixel caps),
`core/search.js` (wires the app's `parseSearchQuery` / `runSearch`), `core/tasks.js` (the Tasks view's
rows, filters and groups), `core/check-colors.js` (`color_by_line` / `show_decorative`), `core/transcript-check.js`
(`check_transcript`'s ink rows and diff; its line alignment and `movedPairs` are the app's `src/lib/line-align.js`
since v3.21.0, shared with Relink), `core/tools.js` (transport-free
handlers), `core/app-client.js` + `core/write-tools.js` (the opt-in edits through the app), `server.js`. Reuses `src/lib` unchanged: volumes, timeline, page-sittings, page-orientation, page-svg path
helpers, tags, tasks, convert-task-boxes (detection only), global-search, search-query, neo-backgrounds, ink-text, line-align,
`utils/formatting` (book names).

Tests (`mcp/__tests__/`, synthetic data built in a temp folder): `mcp.test.js` (guard, sidecars, scan, bounds and
outliers, PNG decode, pixel caps and paging, stored rotation, every tool), `search-parity.test.js` (MCP search vs the app's search
pipeline, with main.cjs's own metadata functions), `tasks.test.js` (`list_tasks` filters, groups, paging, and parity
with the app's Tasks view rows), `server.test.js` (stdio start-up, exactly the ten tools, all read-only), `write-tools.test.js` (the write tools only
with `SMARTPEN_MCP_WRITES=1`, their annotations, dry run / apply / stale revision / undo against a fake app behind the
real endpoint, "app not running"), `dst.test.js` (fall-back /
spring-forward days, local midnight). `__fixtures__/app-side.js` builds the synthetic folders and reads them back the
app's way.

## Not done

- Neo page backgrounds in renders (off by design; only the frame geometry is used).
- Search covers transcribed text only, like the app; untranscribed pages are found by date, notebook or tag.
- No stroke-count downscale: pages here top out near 1,600 strokes and render in well under a second.
- Removed in v3.6.2, on purpose (see [CHANGELOG](../docs/CHANGELOG.md)): a separate server checkout kept on `main` by
  git hooks, byte budgets (`maxBytes`) and the custom grayscale PNG encoder, contact-sheet modes (`composite`,
  `by_day`), `format: "svg"`, `get_strokes`, and the `rotation` / `context: false` options.
