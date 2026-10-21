# smartpen-bridge MCP server

Read-only stdio MCP server over the data folder (`<root>/pages/B*/P*.json`). Works with the app closed (PageDocs are
written atomically, so reading while the app runs is safe too). It never writes, opens no network port and never calls
MyScript. Design: [docs/MCP-SERVER-SPEC.md](../docs/MCP-SERVER-SPEC.md).

## Run

Needs this checkout's dev dependencies (`npm install`): `@modelcontextprotocol/sdk`, `zod`, `@resvg/resvg-js`.

```bash
SMARTPEN_DATA_ROOT=<data folder> node mcp/server.js            # or: node mcp/server.js --data-root <dir>
SMARTPEN_DATA_ROOT=<data folder> npm run --silent mcp          # --silent: npm's banner would corrupt stdout
SMARTPEN_DATA_ROOT=<data folder> node mcp/drive.mjs            # list tools through a real stdio client
SMARTPEN_DATA_ROOT=<data folder> node mcp/drive.mjs render_days '{"from":"2026-10-19"}' ./out   # call one; PNGs to ./out
```

The server exits with a message on stderr when the folder is missing or has no `pages/`.

## Register

Point the client at `node` and `server.js` directly (not `npm run mcp`, whose banner goes to stdout). Use absolute paths.

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
| `list_notebooks` | Book keys, names, page / stroke / transcribed counts, first and last day, active volume, paper known | text |
| `list_pages` | One notebook's pages: strokes, days, tags, transcribed, rotation. Tag / date filters, paged | text |
| `list_tags` | Tags with page and notebook counts, untagged count; with `tag`, that tag's pages | text |
| `get_transcript` | One page's lines with indent and TODO/DONE; flags pages whose stroke-to-line links are unreliable | text, few KB |
| `search` | The app's header search: words, dates, notebook names / keys, tags (same code, same limits) | text |
| `days_summary` | Per local day: strokes and pages touched | text |
| `render_page` | One page, grayscale PNG (or SVG), stored rotation, on the printed page | ~50–100 KB at 1000 px |
| `render_days` | `pages`: one image per page (day's ink dark, rest grey); `composite`: one contact sheet; `by_day`: one sheet per day | see below |
| `get_strokes` | Raw stroke geometry (start/end ms, flat xy in Ncode units, optional force) for a day range or one page | text, capped |

Caps, all overridable within limits (`LIMITS` in `core/tools.js`):

| | Default | Max |
|---|---|---|
| `render_page` width | 1000 px | 2000 |
| `render_days` pages | 4 images at 700 px | 12 images, 1400 px |
| `render_days` composite | 12 pages, 1200 px | 24 pages, 2000 px |
| `render_days` by_day | 4 days (12 pages each), 1200 px | 8 days, 2000 px |
| `maxBytes` per call (PNG bytes or SVG text) | 1 MB | 4 MB |
| `get_strokes` | 300 strokes / 2,000 points (~25K chars) | 3,000 / 60,000 |

Anything left out is named in the reply with the `offset` to ask for next. The first image of a call shrinks to fit
`maxBytes` rather than coming back empty; later ones wait for the next call.

## Rendering

- **Layout:** pages are laid out on Neo's printed frame (`_backgrounds/<book>/manifest.json`, geometry only; the JPGs are
  never read), so every page of a notebook shares one scale and a stray stroke off the paper is clipped and reported,
  not allowed to shrink the page. Books without a manifest use the ink box with outlying strokes trimmed (2nd / 98th
  percentile of stroke boxes). `fit: "ink"` crops to the ink (or the day's ink) to zoom in.
- **Rotation:** the stored `_orientation.json` turn, one transform within the frame; `rotation` overrides. Points are
  never rewritten; `get_strokes` returns unrotated coordinates plus the rotation.
- **PNG:** 4-bit grayscale (`core/png.js`): line art keeps its antialiasing and context grey, at roughly a quarter of
  resvg's RGBA bytes. Fonts load only for sheets with captions.
- **Days:** a stroke belongs to the local day of its `startTime`; ranges are half-open (`rangeBoundsMs`), the same
  `dayKey` the app uses. `metadata.lastUpdated` is never used.

## Layout

`core/paths.js` (root + path guard), `core/sidecars.js` (aliases, volumes, orientation, tags, paper frame),
`core/store.js` (Node scan, app-shaped records, in-memory capture-day index; `_timeline.json` is never read or written),
`core/bounds.js` (paper / robust ink view box), `core/render.js` (SVG, PNG via `@resvg/resvg-js`, contact sheets),
`core/png.js`, `core/search.js` (wires the app's `parseSearchQuery` / `runSearch`), `core/tools.js` (transport-free
handlers), `server.js`. Reuses `src/lib` unchanged: volumes, timeline, page-sittings, page-orientation, page-svg path
helpers, tags, global-search, search-query, neo-backgrounds, ink-text, `utils/formatting` (book names).

Tests (`mcp/__tests__/`, synthetic data built in a temp folder): `mcp.test.js` (guard, sidecars, scan, bounds and
outliers, PNG decode, size caps, stored rotation, every tool), `search-parity.test.js` (MCP search vs the app's search
pipeline, with main.cjs's own metadata functions), `dst.test.js` (fall-back / spring-forward days, local midnight).

## Not done

- Neo page backgrounds in renders (off by design; only the frame geometry is used).
- Search covers transcribed text only, like the app; untranscribed pages are found by date, notebook or tag.
- No stroke-count downscale: pages here top out near 1,600 strokes and render in well under a second.
