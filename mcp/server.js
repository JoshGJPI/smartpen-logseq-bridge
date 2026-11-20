#!/usr/bin/env node
/**
 * smartpen-bridge MCP server (stdio).
 *
 *   SMARTPEN_DATA_ROOT=<dir> node mcp/server.js     (or --data-root <dir>, or npm run mcp)
 *
 * Reads <root>/pages/B*\/P*.json directly; works with the Electron app closed.
 * Never writes a file. With SMARTPEN_MCP_WRITES=1 it also offers edit_transcript /
 * undo_transcript_edit, which ask the RUNNING app to make the edit (core/app-client.js).
 * Logs go to stderr only (stdout is the protocol).
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
import { createWriteTools } from './core/write-tools.js';
import { TASK_STATE_ARGS, TASK_GROUP_ARGS } from './core/tasks.js';
import { OPS, MAX_OPS, MAX_LEVEL } from '../src/lib/mcp-edits.js';

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
const offset = z.number().int().optional().describe('Rows to skip, for paging (default 0; the reply gives the next offset)');
const limit = (dflt, max) => z.number().int().optional().describe(`Rows per call (default ${dflt}, at most ${max})`);
const tag = z.string().optional().describe('Only pages with this tag');
const to = day.optional().describe('Last day of the range (default: from)');

function reg(name, description, inputSchema, title) {
  server.registerTool(name, { title, description, inputSchema, annotations: RO }, async (args) => tools[name](args));
}

reg('list_notebooks',
  'List the handwriting notebooks (book keys like "388", "388v2"): names, page counts, stroke counts, transcribed pages, first and last day written.',
  {}, 'List notebooks');
reg('list_pages',
  'List the pages of one notebook with stroke counts, the days written on, tags and whether transcribed (`partly` when most of a transcribed page\'s ink is in no line). Optional tag and date filters.',
  { book, tag, from: day.optional().describe('Only pages with ink in from..to (local days, YYYY-MM-DD)'), to,
    limit: limit(100, 300), offset },
  'List pages');
reg('list_tags',
  'Page tags with page counts, each with its type (project: job 2327-018 or proposal P2026-141, by pattern; person; topic: every other keyword) '
  + 'and label (display name), or with `tag` the pages under that tag and its details. Read-only: types and details are set in the app.',
  { tag: z.string().optional().describe('A tag (or its label or an alias): list its pages instead of all tags'),
    type: z.enum(['project', 'person', 'topic']).optional().describe('Only tags of this type') }, 'List tags');
reg('get_transcript',
  'Handwriting-recognition transcript of one page (text, indentation, TODO/DONE/WAITING/CANCELLED), each line numbered #n (the stored line number). '
  + 'A sketch line (a drawing Josh labelled in the app) reads `#17 [sketch] Floor plan (412 strokes)`; see it with render_page { line }. '
  + 'Cheap; prefer this over an image when the text is enough. Many pages are untranscribed: use render_page for those.',
  { book, page }, 'Get transcript');
reg('render_page',
  `See a page: its ink as a PNG, in the stored orientation, laid out on the printed page. Default ${LIMITS.page.width}px wide. `
  + 'Costs image tokens: try get_transcript first when the page is transcribed. '
  + 'To check a transcription against the ink, pass color_by_line (each line\'s ink in its own colour, with a text key of line, colour, stroke count and text) '
  + 'and/or show_decorative (strokes the app\'s Deselect Decorative would leave out, in red). '
  + 'With `line` (#n from get_transcript), only that line\'s ink, cropped to it: a sketch line\'s drawing.',
  { book, page, width: width(LIMITS.page.width), fit,
    line: z.union([z.number().int(), z.string()]).optional().describe('A stored line number (17 or "#17"): crop to that line\'s ink, e.g. a sketch'),
    color_by_line: z.boolean().optional().describe('Colour ink by transcript line; the reply lists each line\'s colour. Plain ink where the page\'s line links are unreliable'),
    show_decorative: z.boolean().optional().describe('Draw in red the strokes Deselect Decorative would take (boxes, underlines, circles)') },
  'Render page');
reg('check_transcript',
  'Check a page\'s transcript against its ink. Without `reference`: the page\'s written rows measured from the ink (height, left margin, '
  + 'indent column, rows that may be wrapped sentences, rows not transcribed), with NO transcript text, so it can be used before reading the page blind. '
  + 'With `reference` (your own reading of the page as markdown bullets, nested with tabs, TODO/DONE/WAITING/CANCELLED in front of tasks): '
  + 'the stored transcript aligned line by line with it, listing wording, indent and task-state differences, lines stored out of order, lines missing on either side, '
  + 'and lines with no ink linked. Read-only: corrections are made in the app.',
  { book, page,
    reference: z.string().optional().describe('Your transcript of the page: "- text" lines, one tab per indent level') },
  'Check transcript');
reg('days_summary',
  'What was written on a day or range (local days): per-day stroke counts and the pages touched. Cheap; call before render_days.',
  { from: day, to, book: book.optional(), tag }, 'Summarize days');
reg('render_days',
  'See what was written on a day or range: one PNG per page, strokes written in range dark, the rest of the page grey. '
  + `${LIMITS.images} images per call at ${LIMITS.pages.width}px; page through the rest with offset (the reply says what is left). `
  + 'Call days_summary first to see which pages were touched.',
  { from: day, to, book: book.optional(), tag, fit,
    transcript: z.boolean().optional().describe('Include each page\'s whole-page transcript text'),
    limit: z.number().int().optional().describe(`Images per call (default and at most ${LIMITS.images})`), offset,
    width: width(LIMITS.pages.width) },
  'Render days');
reg('list_tasks',
  'Tasks written in the notebooks (transcript lines with a box: TODO, DONE, WAITING, CANCELLED), the same rows as the app\'s Tasks view. '
  + 'Default: open tasks (TODO + WAITING), newest page first. Filter by project (the page tag nearest the task in the transcript, else the page\'s first project tag; "untagged" for none), '
  + 'any page tags (all must match), person (the Person tags whose blocks hold the task; each row lists its people), notebook, days written (pages with ink in from..to) and text; group by project, person, date or book. '
  + `Each row has book + page for get_transcript / render_page. ${LIMITS.tasks.limit} rows per call (max ${LIMITS.tasks.maxLimit}); page with offset. `
  + 'Read-only: ticking or changing a task is done in the app. Untranscribed pages have no tasks.',
  { state: z.enum(TASK_STATE_ARGS).optional()
      .describe('open (default) = TODO + WAITING; todo = TODO only; all = every state'),
    project: z.string().optional().describe('Project tag, e.g. P2026-141 or 2327-018 (normalized like the app); "untagged" = pages with no project tag'),
    person: z.string().optional().describe('A Person tag by key, display name or alias (case-insensitive): tasks in that person\'s blocks on pages carrying the tag (block scope, as the app\'s Group by → Person)'),
    tag: z.union([z.string(), z.array(z.string())]).optional().describe('Page tag(s), any of the page\'s tags; several = all must be on the page'),
    book: book.optional(), from: day.optional(), to: day.optional(),
    text: z.string().optional().describe('Case-insensitive substring of the task or its parent line'),
    group_by: z.enum([...TASK_GROUP_ARGS, 'none']).optional(),
    limit: limit(LIMITS.tasks.limit, LIMITS.tasks.maxLimit), offset },
  'List tasks');
reg('list_sketches',
  'Sketch lines: drawings Josh marked in the app and labelled ("Floor plan"), each with its page, line #n, label, stroke count, when written, '
  + 'and its tags: the page\'s Project and Person tags whose block holds the sketch (a tag named nowhere on the page covers all of it), and the page\'s topics. '
  + 'Filter by project, tag, person, notebook and days written. See one with render_page { book, page, line }. Read-only: sketches are made in the app.',
  { project: z.string().optional().describe('A project tag, e.g. 6226-001 or P2026-141: sketches in its blocks'),
    tag: z.string().optional().describe('Any tag: sketches carrying it'),
    person: z.string().optional().describe('A Person tag by key, display name or alias: sketches in that person\'s blocks'),
    book: book.optional(), from: day.optional(), to: day.optional(),
    limit: limit(LIMITS.sketches.limit, LIMITS.sketches.maxLimit), offset },
  'List sketches');
reg('search',
  'The app\'s global search: words in transcripts, dates ("Oct 14", "10/14", "2026-10-14", "yesterday"), notebook names or keys ("Study Notes", "390v2") and tags ("P2026-141"), with tag facets person:tom, topic:framing, project:5444-006, type:person|project|topic, is:job, is:proposal (pages carrying such a tag), '
  + 'and has:sketch (pages with a sketch line; with other words, the sketches whose label or tags answer to them). '
  + 'Returns sketches, pages with snippets, and matching notebooks, days and tags. Transcribed text only.',
  { query: z.string().describe('Words, a date, a notebook name or key, or a tag') }, 'Search');

// ===== Writes (v3.18.0): only with SMARTPEN_MCP_WRITES=1, and only through the running app =====
const writes = process.env.SMARTPEN_MCP_WRITES === '1';
if (writes) {
  const wt = createWriteTools(root);
  const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  const n = z.number().int();
  const edit = z.object({
    op: z.enum(OPS),
    line: n.optional().describe('set_text / set_indent / delete: the stored line number (#n, 1-based, as get_transcript and check_transcript print it)'),
    expect: z.string().optional().describe('The exact text now on that line (for insert: on line `after`); a task\'s own state label in front, as get_transcript prints it, is allowed. A mismatch refuses the call'),
    text: z.string().optional().describe('set_text / insert: the new text, one line (on a task, its own state label in front is dropped)'),
    level: n.optional().describe(`set_indent / insert: indent level 0–${MAX_LEVEL}, at most one deeper than the line above`),
    with_children: z.boolean().optional().describe('set_indent: shift the line\'s sub-lines too (default true)'),
    lines: z.array(n).optional().describe('move: the line numbers to move, in the order they should end up'),
    expect_first: z.string().optional().describe('move: the exact text now on the first of `lines`'),
    to: z.union([z.enum(['top', 'bottom']), z.object({ after: n, expect: z.string().optional() })]).optional()
      .describe('move: "top", "bottom" or { after: n, expect?: the text now on #n }'),
    after: n.optional().describe('insert: the line to insert after; 0 = before the first line'),
    task_ok: z.boolean().optional().describe('delete: required to delete a task line (TODO / DONE / WAITING / CANCELLED)'),
  });
  server.registerTool('edit_transcript', {
    title: 'Edit transcript',
    description: 'Correct one page\'s saved transcript through the running smartpen-bridge app (it must be open with '
      + 'Settings → Data folder → "Allow Claude to edit transcripts" on). Ops: set_text, set_indent, move, insert, delete. '
      + 'Address lines by the stored number (#n from check_transcript / get_transcript) plus `expect`, the exact text now on '
      + `that line; every number refers to the transcript BEFORE this call. All-or-nothing, at most ${MAX_OPS} ops. `
      + 'dry_run (default true) returns the result marked ~ changed, + inserted, ↕ moved, plus deleted lines, and the '
      + 'revision; apply with dry_run: false and that revision, only after Josh has seen the dry run and said yes. '
      + 'Never changes ink or task state: inserted lines get no ink; WAITING / CANCELLED / DOING / NOW / LATER can\'t '
      + 'start a line\'s text; a typed TODO / DONE box in front of a plain line makes it a task, as in the app. '
      + 'Refused while the page is open in an editor in the app. Undo with undo_transcript_edit.',
    inputSchema: {
      book, page,
      edits: z.array(edit).min(1).max(MAX_OPS),
      dry_run: z.boolean().optional().describe('Default true: show the result, save nothing'),
      revision: z.string().optional().describe('Required with dry_run: false: the revision the dry run returned'),
    },
    annotations: WRITE,
  }, async (args) => wt.edit_transcript(args));
  server.registerTool('undo_transcript_edit', {
    title: 'Undo transcript edit',
    description: 'Undo the last edit_transcript applied to a page, through the running app. Refused if the page was '
      + 'written since (a task tick, an edit in the app): undo it in the app instead. Restores the transcript exactly, '
      + 'and the ink links a delete removed.',
    inputSchema: { book, page },
    annotations: WRITE,
  }, async (args) => wt.undo_transcript_edit(args));
}

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
console.error(`smartpen-bridge MCP ${version} (commit ${gitCommit()}): reading ${root}; newest page written ${newestPage()}`
  + (writes ? '; transcript edits through the app ON (SMARTPEN_MCP_WRITES=1)' : ''));
