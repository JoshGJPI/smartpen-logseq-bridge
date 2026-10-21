# smartpen-bridge MCP server (proof of concept)

Read-only stdio MCP server over the data folder (`<root>/pages/B*/P*.json`). Works with the app closed. Design:
[docs/MCP-SERVER-SPEC.md](../docs/MCP-SERVER-SPEC.md). It never writes, opens no network port and never calls MyScript.

```bash
SMARTPEN_DATA_ROOT=<data folder> npm run mcp        # or: node mcp/server.js --data-root <dir>
SMARTPEN_DATA_ROOT=<data folder> node mcp/drive.mjs render_days '{"from":"2026-10-19"}' ./out   # dev driver
```

Claude Code registration (adjust the paths):

```bash
claude mcp add smartpen-bridge -e SMARTPEN_DATA_ROOT="C:\path\to\data" -- node "C:\path\to\repo\mcp\server.js"
```

Tools: `list_notebooks`, `list_pages`, `get_transcript`, `render_page`, `days_summary`, `render_days` (modes `pages`,
`composite`), `search` (transcript / tag / notebook-name words). Not built yet: `get_strokes`, `list_tags`, `by_day`
mode, Neo backgrounds, parity with the app's global search.

Layout: `core/paths.js` (root + path guard), `core/sidecars.js`, `core/store.js` (Node scan; in-memory capture-day
index, `_timeline.json` is never read or written), `core/render.js` (full-page SVG, PNG via `@resvg/resvg-js`),
`core/tools.js` (transport-free handlers), `server.js`. Reuses `src/lib` (volumes, timeline, page-sittings,
page-orientation, page-svg path helpers, tags); `page-svg.js` itself is unchanged. Tests: `mcp/__tests__/`, synthetic
data built in a temp folder.
