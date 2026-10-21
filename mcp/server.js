#!/usr/bin/env node
/**
 * smartpen-bridge read-only MCP server (stdio).
 *
 *   SMARTPEN_DATA_ROOT=<dir> node mcp/server.js     (or --data-root <dir>)
 *
 * Reads <root>/pages/B*\/P*.json directly; works with the Electron app closed.
 * Never writes. Logs go to stderr only (stdout is the protocol).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveDataRoot } from './core/paths.js';
import { createTools } from './core/tools.js';

const root = resolveDataRoot();
const tools = createTools(root);
const server = new McpServer({ name: 'smartpen-bridge', version: '0.1.0' });

const RO = { readOnlyHint: true, openWorldHint: false };
const book = z.string().describe('Book key: "388", or "388v2" for volume 2');
const page = z.string().describe('Page id: "42", or "151b" for a letter-suffixed page');
const day = z.string().describe('Local calendar day, YYYY-MM-DD');
const width = z.number().int().optional().describe('PNG width in px (default 1000, max 2000)');
const format = z.enum(['png', 'svg']).optional().describe('png (image, default) or svg (text)');

function reg(name, description, inputSchema, title) {
  server.registerTool(name, { title, description, inputSchema, annotations: RO }, async (args) => tools[name](args));
}

reg('list_notebooks',
  'List the handwriting notebooks (book keys like "388", "388v2"): names, page counts, stroke counts, first and last day written.',
  {}, 'List notebooks');
reg('list_pages',
  'List the pages of one notebook with stroke counts, the days written on, tags and whether transcribed. Optional tag and date filters.',
  { book, tag: z.string().optional(), from: day.optional(), to: day.optional(), limit: z.number().int().optional(), offset: z.number().int().optional() },
  'List pages');
reg('get_transcript',
  'Handwriting-recognition transcript of one page (text, indentation, TODO/DONE). Cheap; prefer this over an image when the text is enough.',
  { book, page }, 'Get transcript');
reg('render_page',
  'See a page: its ink rendered in the stored orientation as a PNG image (or SVG text). Use when layout, sketches or crossed-out text matter.',
  { book, page, format, width, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional().describe('Override the stored rotation') },
  'Render page');
reg('days_summary',
  'What was written on a day or range (local days): per-day stroke counts and the pages touched. Cheap; call before render_days.',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional() }, 'Summarize days');
reg('render_days',
  'See what was written on a day or range: the strokes written in range are drawn dark on their page, the rest of each page greyed as context. One image per page (mode "pages", paged by limit/offset) or one contact sheet (mode "composite").',
  { from: day, to: day.optional(), book: book.optional(), tag: z.string().optional(),
    mode: z.enum(['pages', 'composite']).optional(), format, width,
    context: z.boolean().optional().describe('Draw the page\'s other strokes greyed (default true)'),
    transcript: z.boolean().optional().describe('Include each page\'s whole-page transcript text'),
    limit: z.number().int().optional().describe('Max images (default 8)'), offset: z.number().int().optional() },
  'Render days');
reg('search',
  'Find pages whose transcript, tags or notebook name contain all the given words. Returns page keys, days and a snippet.',
  { query: z.string(), limit: z.number().int().optional() }, 'Search pages');

await server.connect(new StdioServerTransport());
console.error(`smartpen-bridge MCP: reading ${root}`);
