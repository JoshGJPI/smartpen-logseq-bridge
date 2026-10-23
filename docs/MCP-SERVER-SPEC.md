# Read-only MCP server (plan)

**Status:** built (branch `mcp-server-v2`, on the proof of concept): every tool below, with the caps and choices
in [mcp/README.md](../mcp/README.md). Differences from this plan: renders lay pages out on Neo's printed frame (manifest
geometry only) rather than the ink box, and search needed no extraction (`global-search.js` / `search-query.js` already
import under plain Node). **Trimmed in v3.6.2** after a review found the server over-built around cost and deployment
(reasons in [CHANGELOG.md](CHANGELOG.md)): nine tools, PNG only, images capped by pixels (at most 4 per call, each within
a 1,500 px long edge and 2,000 visual tokens) instead of bytes, `@resvg/resvg-wasm` instead of the native renderer, and
the server runs from the development checkout. Gone: `get_strokes`, `format: "svg"`, the `composite` / `by_day` sheets,
the `rotation` override, `context: false`, `maxBytes` and the custom PNG encoder. The plan below is kept as written,
marked where it no longer holds. Decided 2026-10-21 (Josh): an MCP server over the data folder, not
an HTTP port inside the app and not a Claude Code skill.

## Goal

Let Claude read the notebooks the way it reads LogSeq: list notebooks and pages, fetch a page's transcript, search,
and **see the ink** as an image. Read-only. Works with the Electron app closed.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Wrapper | Standalone stdio MCP server | Typed tools, native image results, works on every Claude surface, matches the LogSeq setup |
| Reads from | The data folder directly (`<dataRoot>/pages/...`) | PageDocs are written atomically (`.tmp` + rename), so reading while the app runs is safe. No HTTP port, no auth surface |
| Not an HTTP port in Electron | Rejected | Needs the app running and a token / Host check; adds a network surface for sensitive handwriting |
| Not a skill + script | Rejected | Images go through files and a Read, no cold-start cache, Claude Code only. Guidance text can live in tool descriptions |
| Code location | `mcp/` in this repo, importing `src/lib/*` directly | One copy of rotation, pressure-width and search logic. The project is `"type": "module"` and these files are pure ESM |
| PNG | `@resvg/resvg-wasm` on the SVG (v3.6.2; was the native `@resvg/resvg-js`) | No browser needed, and no native file for Windows to lock while the server runs. Same pixels. JPG is skipped: line art gains nothing |

## Data root

The app keeps the data folder in localStorage, which the server cannot read. The server takes it from
`SMARTPEN_DATA_ROOT` (or `--data-root`) and refuses to start if `<root>/pages` is missing. Registered in the Claude
config with that env var.

## Tools (all read-only, all annotated `readOnlyHint: true`)

| Tool | Returns |
|---|---|
| `list_notebooks` | Book keys (`388`, `388v2`), alias names, page counts, date range, active volume |
| `list_pages` | Pages of one notebook: page id, stroke count, capture day(s), tags, transcribed y/n. Optional tag / date-range filter |
| `get_transcript` | Transcript lines (text, indent, DONE/TODO state) for one page; plain text or markdown. Notes whether the page predates the line-matching fix |
| `render_page` | PNG as an MCP image, in the stored orientation. Options: `width` (default 1000px, capped), `fit`. (Built without `format: "svg"`, a `rotation` override or `background`, v3.6.2) |
| `search` | Same semantics as the app's global search: words, dates, notebook names, tags. Returns page keys, snippets, dates |
| `list_tags` | Tags with page counts (and open tasks); optionally the pages under one tag |
| `list_tasks` | Task lines (TODO / DONE / WAITING / CANCELLED) as the app's Tasks view rows them: `state` (`open` = TODO + WAITING, default), `project` (the page tag nearest the task in the transcript, else the first project tag; or `untagged`), `tag` (any page tag, several = all), `book`, `from` / `to`, `text`, `group_by`, `limit` / `offset`. Counts per state for the scope. See "Tasks" |
| `days_summary` | For a day or range: per-day stroke counts and the pages touched (page, strokes that day, strokes on the page in total, notebook name). Cheap; call it before rendering |
| `render_days` | The strokes written on the given day(s), rendered. See "Date-based strokes" |

Page references are always `{ book: "388v2", page: "151b" }` strings, validated with `lib/volumes.js` helpers
(`BOOK_KEY_FRAGMENT`, `compareBookKeys`) and a path guard equivalent to `requireBookKey()` / `requirePageId()`, so
nothing resolves outside `<root>/pages`.

## Date-based strokes

Date does not line up with pages (the app's own corpus: about half of all pages hold ink from more than one day), so
this filters at **stroke** level on `startTime`, exactly like `storage/load-range.js`, and never by whole page.

- **Input:** `from`, `to` as local calendar days (`YYYY-MM-DD`; `to` optional = single day), optional `book` /
  `tag` filter, `fit`, `transcript`, `limit` / `offset`, `width`. (Planned `mode` and `format` were dropped in v3.6.2.)
- **Day rule:** a stroke belongs to the local day of its `startTime`. Ranges are half-open `[startMs, endMs)` via
  `rangeBoundsMs()`; `dayKey` is the same local-day function the app uses (it must agree with `main.cjs`
  `dayKeyLocal` and `canvas-renderer` `captureDayKey`). Do not use `metadata.lastUpdated`.
- **Finding pages:** use `_timeline.json` (per-page capture-day histograms) via `pagesInRange()` when valid, else
  scan strokes. It is a cache, safe to be missing: the Node scan rebuilds it in memory.
- **Modes:**
  - `pages` (default): one image per touched page, in notebook then page order. The day's strokes are drawn in full
    ink; the page's other strokes are drawn halftoned as context (same idea as the app's `contextInk`), so partial
    pages stay readable in place. This is the only mode.
  - `composite` (contact sheet) and `by_day` (one sheet per day) were built and removed in v3.6.2: a sheet shrinks every
    page to a thumbnail, so it cost as many tokens as the pages it replaced while being harder to read.
- **Output:** images as MCP image content plus a text block listing day, notebook, page, stroke count and sitting
  times (`formatSittingLabel`). At most 4 images per call, with `offset` paging; the reply says what was left out so
  Claude can ask for the next set.
- **Rotation / background:** same as `render_page`: stored orientation per page, no backgrounds.
- **Transcript tie-in:** the text block can include the page's transcript lines, flagged as whole-page (stroke
  `lineId`s are unreliable on older pages, so lines are not claimed to belong to the day's strokes).
- **Sizes to expect** (app's reference corpus): a median week is about 7,900 strokes and a busy month about 50,000, so
  a day or week renders fine, and a month must page or downscale rather than return one image.

## Tasks (added after v2)

Josh wants to ask Claude for outstanding tasks by project or tag. A task is a transcript line with `checked` set; its
state comes from `taskStateOf()` (`marker` only beside the right `checked` value). The server must give the same rows
as the app's Tasks view, so nothing is ported: the scan cache keeps each page's `buildTaskSummary()` (normalized as
`metaToRecord()` does), and rows are `buildTaskRows(pages, { tags, dates: pageDates(index) })`, filtered and grouped by
`filterTaskRows()` / `groupTaskRows()`. One deliberate difference: `open` is TODO + WAITING (still to do); the app's
Open chip, TODO only, is `state: "todo"`. Parity is tested against the app's own pipeline (main.cjs metadata →
`metaToRecord` → `buildTaskRows`) for every chip and grouping.

Read-only like everything else: no tool changes a task (the description says to tick tasks in the app). Rows carry
`book` + `page` for a follow-up `get_transcript` / `render_page`; per-line ink crops are not offered (stored `lineId`s
are unreliable before Aug 2026). Pages whose text still has ☐ / ☑ (transcribed before v3.3.0, not yet converted) are
counted in the reply, since their boxes are not tasks until the app's Convert task boxes… step runs.

## Reuse and the extraction work

- **Date logic:** `lib/timeline.js` (`dayKey`, `rangeBoundsMs`, `pagesInRange`, `pagesOnDay`) and
  `viewer/page-sittings.js` (`pageDayGroups`, `formatSittingLabel`) are pure. A stroke-subset render needs
  `page-svg.js` to draw two stroke sets (full ink + halftone) in one SVG, which today's thumbnail generator does not
  do; add that as a small extension and keep the Library's output unchanged.
- **Render:** `src/lib/viewer/page-svg.js` is already pure (imports `sketch-width.js`, `page-orientation.js`). Need to
  confirm it can build a full-page SVG (not just a thumbnail) for a given rotation and size, and add a thin
  `renderPageSvg(doc, { rotation, width })` if only the thumbnail path exists.
- **Search:** `global-search.js` and `search-query.js` import from `left-panel.js` (`isTypingTarget`), `library-home.js`
  and `utils/formatting.js`, and `scan.js` uses `$lib` / `$stores` aliases and Svelte stores. Move the store-free pieces
  (index build, `runSearch`) so they import cleanly under plain Node, or add a Node-side scan that builds the same
  records. Do not let the server import anything that touches Svelte stores or `window`.
- **Scan:** a Node scan that reads PageDoc summaries (`metaToRecord` logic) and uses `_timeline.json` and `_tags.json`
  as caches where valid. The index is built once at startup and refreshed by directory mtime on each call, so the
  server never needs a restart after the pen saves new pages.
- **Sidecars:** read `_aliases.json`, `_volumes.json`, `_orientation.json`, `_tags.json` with the same
  missing-or-corrupt-means-empty rule the app uses (`tags-sidecar.cjs` parse is reusable).

## Rules the server must respect

These come from CLAUDE.md invariants; they apply even though the server never writes.

- Book keys are strings; sort with `compareBookKeys()`, never a hand-written `\d+`.
- Letter-suffixed pages (`P151b`) are real; the integer `pageInfo.page` is the NCode page.
- Capture date comes only from stroke `startTime`, as local calendar days (`dayKey`), never `metadata.lastUpdated`.
- Rotation is display-only: one transform per page within its paper frame; never rewrite points.
- Stroke `lineId`s on pages transcribed before Aug 2026 are unreliable: no per-line ink crops. Transcript text itself
  is fine.
- Neo page backgrounds are Neo's images: off by default, opt-in per call, never cached outside `_backgrounds/`.
- Never log or return MyScript keys (the server does not need them; it never calls MyScript).
- Cap output by pixels (Claude's cost is ceil(w/28) × ceil(h/28) tokens per image, whatever the bytes): at most 4
  images per call, 1,500 px long edge, 2,000 visual tokens each, so a call stays under Claude Code's 10,000-token
  warning. Search and list results paged.

## Build order

1. **Core module** (`mcp/core/`): path guard, sidecar readers, Node scan, `getPage`, tests under Vitest. Exit: lists
   notebooks and pages from a fixture folder with a `388v2` volume and a `151b` page.
2. **Transcript + list + tags tools**, stdio server with `@modelcontextprotocol/sdk`, data-root handling.
3. **`render_page`:** SVG first, verified against the Library reader's output for the same page (including a rotated
   one); then PNG via resvg with size caps.
4. **Date tools:** `days_summary`, then `render_days` in `pages` mode (`composite`, `by_day` and `get_strokes`
   followed and were removed in v3.6.2). Verify the day split against the app's Dates tab on the same data, including a page with ink from
   two days and a stroke written just after local midnight.
5. **`search`:** extract or port the store-free search, verify results match the app's global search on the same data.
6. **Wire-up:** `npm run mcp` script, registration snippet for Claude Code / desktop (`SMARTPEN_DATA_ROOT`), a short
   README section, CLAUDE.md and ARCHITECTURE.md entries, TESTING.md rows.

## Tests

Vitest, fixtures under `mcp/__fixtures__/` (small synthetic PageDocs, no real handwriting, none of Neo's images):
path-guard rejects (`..`, absolute, `B388v2/../`), volume and suffix handling, missing / corrupt sidecars, search
parity, day boundaries (23:59:59 / 00:00:00 local, a DST-change day), a multi-day page split correctly, context
halftone present / absent, image-count caps and paging, SVG snapshot, PNG decodes to the expected size, size caps. Manual: register against the real folder with the
app closed and ask Claude to read a known page and describe the ink.

## Risks and open questions

- Whether `page-svg.js` already supports a full-page render with rotation, or only thumbnails (check first; changes the
  size of step 3).
- Extracting search without dragging in Svelte-store imports may touch several files; keep the app's behavior and
  tests unchanged.
- resvg: the native build held its `.node` file open while the server ran, so `npm install` failed with EBUSY on
  Windows; v3.6.2 uses the WebAssembly build (dev dependency, not in the Electron installer).
- Handwriting is sensitive: the server is local stdio only, exposes no network port, and returns only what a tool
  call asks for.
- Planner / calendar ideas in CLAUDE.md are out of scope here.
