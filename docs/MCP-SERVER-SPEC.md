# Read-only MCP server (plan)

**Status:** planned, nothing built. Decided 2026-10-21 (Josh): an MCP server over the data folder, not an HTTP port
inside the app and not a Claude Code skill.

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
| PNG | `@resvg/resvg-js` on the SVG | No browser needed. JPG is skipped: line art gains nothing, PNG is the default |

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
| `render_page` | SVG text, or PNG as an MCP image. Options: `format`, `width` (default ~1000px, capped), `rotation` (default: the stored orientation), `background` (default off) |
| `search` | Same semantics as the app's global search: words, dates, notebook names, tags. Returns page keys, snippets, dates |
| `list_tags` | Tags with page counts; optionally the pages under one tag |

Page references are always `{ book: "388v2", page: "151b" }` strings, validated with `lib/volumes.js` helpers
(`BOOK_KEY_FRAGMENT`, `compareBookKeys`) and a path guard equivalent to `requireBookKey()` / `requirePageId()`, so
nothing resolves outside `<root>/pages`.

## Reuse and the extraction work

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
- Cap output: max strokes / pixels per render, default downscale above ~2,000 strokes, search and list results paged.

## Build order

1. **Core module** (`mcp/core/`): path guard, sidecar readers, Node scan, `getPage`, tests under Vitest. Exit: lists
   notebooks and pages from a fixture folder with a `388v2` volume and a `151b` page.
2. **Transcript + list + tags tools**, stdio server with `@modelcontextprotocol/sdk`, data-root handling.
3. **`render_page`:** SVG first, verified against the Library reader's output for the same page (including a rotated
   one); then PNG via resvg with size caps.
4. **`search`:** extract or port the store-free search, verify results match the app's global search on the same data.
5. **Wire-up:** `npm run mcp` script, registration snippet for Claude Code / desktop (`SMARTPEN_DATA_ROOT`), a short
   README section, CLAUDE.md and ARCHITECTURE.md entries, TESTING.md rows.

## Tests

Vitest, fixtures under `mcp/__fixtures__/` (small synthetic PageDocs, no real handwriting, none of Neo's images):
path-guard rejects (`..`, absolute, `B388v2/../`), volume and suffix handling, missing / corrupt sidecars, search
parity, SVG snapshot, PNG decodes to the expected size, size caps. Manual: register against the real folder with the
app closed and ask Claude to read a known page and describe the ink.

## Risks and open questions

- Whether `page-svg.js` already supports a full-page render with rotation, or only thumbnails (check first; changes the
  size of step 3).
- Extracting search without dragging in Svelte-store imports may touch several files; keep the app's behavior and
  tests unchanged.
- resvg is a native-binary dependency: confirm it installs cleanly on Windows and does not bloat the Electron
  installer (keep it in `mcp/` dev/optional deps, excluded from `electron:build`).
- Handwriting is sensitive: the server is local stdio only, exposes no network port, and returns only what a tool
  call asks for.
- Planner / calendar ideas in CLAUDE.md are out of scope here.
