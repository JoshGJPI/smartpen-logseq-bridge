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
import { resolveDataRoot } from './core/paths.js';
import { createTools, LIMITS } from './core/tools.js';

let root;
try {
  root = resolveDataRoot();
} catch (e) {
  console.error(`smartpen-bridge MCP: ${e.message}`);
  process.exit(1);
}
const tools = createTools(root);
const server = new McpServer({ name: 'smartpen-bridge', version: '0.3.0' });

const RO = { readOnlyHint: true, openWorldHint: false };
const book = z.string().describe('Book key: "388", or "388v2" for volume 2');
const page = z.string().describe('Page id: "42", or "151b" for a letter-suffixed page');
const day = z.string().describe('Local calendar day, YYYY-MM-DD');
const width = (lim) => z.number().int().optional().describe(`PNG width in px (default ${lim.width}, max ${lim.maxWidth})`);
const format = z.enum(['png', 'svg']).optional().describe('png (grayscale image, default) or svg (text)');
const maxBytes = z.number().int().optional()
  .describe(`Byte budget for this call's images (default ${LIMITS.bytes.default}, max ${LIMITS.bytes.max}); what does not fit is left for offset`);
const fit = z.enum(['paper', 'ink']).optional()
  .describe('paper (default): the printed page, same scale on every page; ink: crop to the ink (or the day\'s ink) to zoom in');
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe('Override the stored rotation');
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
  `See a page: its ink as a grayscale PNG (or SVG text), in the stored orientation, laid out on the printed page. Default ${LIMITS.page.width}px wide.`,
  { book, page, format, width: width(LIMITS.page), rotation, fit, maxBytes }, 'Render page');
reg('days_summary',
  'What was written on a day or range (local days): per-day stroke counts and the pages touched. Cheap; call before render_days.',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional() }, 'Summarize days');
reg('render_days',
  'See what was written on a day or range: strokes written in range are dark, the rest of each page grey. '
  + `mode "pages" (default): one image per page, ${LIMITS.pages.images} per call at ${LIMITS.pages.width}px; `
  + `"composite": one contact sheet of up to ${LIMITS.composite.pages} pages; "by_day": one sheet per day (${LIMITS.by_day.days} days per call). `
  + 'Page through the rest with offset; the reply says what is left.',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional(),
    mode: z.enum(['pages', 'composite', 'by_day']).optional(), format,
    width: z.number().int().optional().describe(`PNG width in px (pages ${LIMITS.pages.width}/max ${LIMITS.pages.maxWidth}; sheets ${LIMITS.composite.width}/max ${LIMITS.composite.maxWidth})`),
    fit, rotation, maxBytes,
    context: z.boolean().optional().describe('Draw the page\'s other strokes grey (default true)'),
    transcript: z.boolean().optional().describe('pages mode: include each page\'s whole-page transcript text'),
    limit: z.number().int().optional().describe('Images (pages), pages per sheet (composite) or days (by_day) per call'), offset },
  'Render days');
reg('get_strokes',
  'Raw stroke geometry when coordinates matter, not a picture: per page, each stroke\'s start/end time and flat xy points (Ncode units). '
  + `For a day range (from/to, optional book/tag) or one whole page (book + page). Capped (${LIMITS.strokes.limit} strokes / ${LIMITS.strokes.points} points by default); page with offset.`,
  { from: day.optional(), to: day.optional(), book: book.optional(), page: page.optional(), tag: z.string().optional(),
    limit: z.number().int().optional(), maxPoints: z.number().int().optional(), offset,
    decimals: z.number().int().optional().describe('Coordinate decimals (default 1, max 3)'),
    force: z.boolean().optional().describe('Include per-point pen force') },
  'Get strokes');
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
console.error(`smartpen-bridge MCP: reading ${root}`);
