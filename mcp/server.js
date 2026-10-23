#!/usr/bin/env node
/**
 * smartpen-bridge read-only MCP server (stdio).
 *
 *   SMARTPEN_DATA_ROOT=<dir> node mcp/server.js     (or --data-root <dir>, or npm run mcp)
 *
 * Reads <root>/pages/B*\/P*.json directly; works with the Electron app closed.
 * Never writes. Logs go to stderr only (stdout is the protocol).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataRoot } from './core/paths.js';
import { Store } from './core/store.js';
import { createTools, LIMITS } from './core/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

let root;
try {
  root = resolveDataRoot();
} catch (e) {
  console.error(`smartpen-bridge MCP: ${e.message}`);
  process.exit(1);
}
const tools = createTools(root);
const server = new McpServer({ name: 'smartpen-bridge', version });

const RO = { readOnlyHint: true, openWorldHint: false };
const book = z.string().describe('Book key: "388", or "388v2" for volume 2');
const page = z.string().describe('Page id: "42", or "151b" for a letter-suffixed page');
const day = z.string().describe('Local calendar day, YYYY-MM-DD');
const width = (dflt) => z.number().int().optional().describe(`PNG width in px (default ${dflt}; long edge capped at ${LIMITS.maxEdge})`);
const fit = z.enum(['paper', 'ink']).optional()
  .describe('paper (default): the printed page, same scale on every page; ink: crop to the ink (or the day\'s ink) to zoom in');
const offset = z.number().int().optional();

function reg(name, description, inputSchema, title) {
  server.registerTool(name, { title, description, inputSchema, annotations: RO }, async (args) => tools[name](args));
}

reg('list_notebooks',
  'List the handwriting notebooks (book keys like "388", "388v2"): names, page counts, stroke counts, transcribed pages, first and last day written.',
  {}, 'List notebooks');
reg('list_pages',
  'List the pages of one notebook with stroke counts, the days written on, tags and whether transcribed. Optional tag and date filters.',
  { book, tag: z.string().optional(), from: day.optional(), to: day.optional(), limit: z.number().int().optional(), offset },
  'List pages');
reg('list_tags',
  'Page tags (project numbers like P2026-141 and free tags) with page counts, or with `tag` the pages under that tag.',
  { tag: z.string().optional() }, 'List tags');
reg('get_transcript',
  'Handwriting-recognition transcript of one page (text, indentation, TODO/DONE/WAITING/CANCELLED). Cheap; prefer this over an image when the text is enough. Many pages are untranscribed: use render_page for those.',
  { book, page }, 'Get transcript');
reg('render_page',
  `See a page: its ink as a PNG, in the stored orientation, laid out on the printed page. Default ${LIMITS.page.width}px wide. `
  + 'Costs image tokens: try get_transcript first when the page is transcribed.',
  { book, page, width: width(LIMITS.page.width), fit }, 'Render page');
reg('days_summary',
  'What was written on a day or range (local days): per-day stroke counts and the pages touched. Cheap; call before render_days.',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional() }, 'Summarize days');
reg('render_days',
  'See what was written on a day or range: one PNG per page, strokes written in range dark, the rest of the page grey. '
  + `${LIMITS.images} images per call at ${LIMITS.pages.width}px; page through the rest with offset (the reply says what is left). `
  + 'Call days_summary first to see which pages were touched.',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional(), fit,
    transcript: z.boolean().optional().describe('Include each page\'s whole-page transcript text'),
    limit: z.number().int().optional().describe(`Images per call (at most ${LIMITS.images})`), offset,
    width: width(LIMITS.pages.width) },
  'Render days');
reg('list_tasks',
  'Tasks written in the notebooks (transcript lines with a box: TODO, DONE, WAITING, CANCELLED), the same rows as the app\'s Tasks view. '
  + 'Default: open tasks (TODO + WAITING), newest page first. Filter by project (the page tag nearest the task in the transcript, else the page\'s first project tag; "untagged" for none), '
  + 'any page tags (all must match), notebook, days written (pages with ink in from..to) and text; group by project, date or book. '
  + `Each row has book + page for get_transcript / render_page. ${LIMITS.tasks.limit} rows per call (max ${LIMITS.tasks.maxLimit}); page with offset. `
  + 'Read-only: ticking or changing a task is done in the app. Untranscribed pages have no tasks.',
  { state: z.enum(['open', 'todo', 'waiting', 'done', 'cancelled', 'all']).optional()
      .describe('open (default) = TODO + WAITING; todo = TODO only; all = every state'),
    project: z.string().optional().describe('Project tag, e.g. P2026-141 or 2327-018 (normalized like the app); "untagged" = pages with no project tag'),
    tag: z.union([z.string(), z.array(z.string())]).optional().describe('Page tag(s), any of the page\'s tags; several = all must be on the page'),
    book: book.optional(), from: day.optional(), to: day.optional(),
    text: z.string().optional().describe('Case-insensitive substring of the task or its parent line'),
    group_by: z.enum(['project', 'date', 'book', 'none']).optional(),
    limit: z.number().int().optional(), offset },
  'List tasks');
reg('search',
  'The app\'s global search: words in transcripts, dates ("Oct 14", "10/14", "2026-10-14", "yesterday"), notebook names or keys ("Study Notes", "390v2") and tags ("P2026-141"). '
  + 'Returns pages with snippets plus matching notebooks, days and tags. Transcribed text only.',
  { query: z.string() }, 'Search');

await server.connect(new StdioServerTransport());

// Startup line on stderr (stdout carries the protocol): which folder, which code, how fresh the data is.
// SMARTPEN_DATA_ROOT is set at registration and does not follow the app's folder setting.
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
}
function newestPage() {
  let newest = 0;
  for (const f of new Store(root).walk()) {
    try { newest = Math.max(newest, fs.statSync(f.path).mtimeMs); } catch { /* gone since the walk */ }
  }
  return newest ? new Date(newest).toISOString() : 'none';
}
console.error(`smartpen-bridge MCP ${version} (commit ${gitCommit()}): reading ${root}; newest page written ${newestPage()}`);
