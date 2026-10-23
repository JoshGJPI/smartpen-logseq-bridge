/**
 * Tool handlers, independent of the MCP transport so tests can call them directly.
 * Every handler returns `{ content: [{type:'text',text} | {type:'image',data,mimeType}], isError? }`.
 * All are read-only.
 *
 * Images are budgeted by pixels, not bytes: Claude reads an image as
 * ceil(w/28) x ceil(h/28) visual tokens whatever its file size. Rule: at most
 * LIMITS.images (4) per call, each within MAX_EDGE px on its long edge and
 * MAX_IMAGE_TOKENS visual tokens (render.js fitWidth). Worst case 4 x 2,000 =
 * 8,000 tokens of images plus the text block, under Claude Code's 10,000-token
 * warning for one MCP result (its hard cap is 25,000, images included). Whatever
 * is left out is named in the reply with the offset to ask for next.
 */
import { Store, bookName } from './store.js';
import { renderPageSvg, svgToPng, fitWidth, visualTokens, MAX_EDGE } from './render.js';
import { viewBounds } from './bounds.js';
import { createSearch } from './search.js';
import { requireBookKey, requirePageId } from './paths.js';
import { parseBookKey } from '../../src/lib/volumes.js';
import { dayKey, dayStart, rangeBoundsMs, pagesInRange, pagesOnDay, eachDay, inRange } from '../../src/lib/timeline.js';
import { pageDayGroups, formatSittingLabel } from '../../src/lib/viewer/page-sittings.js';
import { rotationFor } from '../../src/lib/page-orientation.js';
import { isTrustworthyTranscript } from '../../src/lib/viewer/ink-text.js';
import { buildTagIndex, tagStats, normalizeTag } from '../../src/lib/tags.js';
import { taskStateOf, stateLabel, groupTaskRows } from '../../src/lib/tasks.js';
import {
  allTaskRows, rowsInState, countsOf, filterTasks, orderTasks, taskOut, openTasksByPage, unconvertedPages,
  TASK_GROUP_ARGS
} from './tasks.js';

/** Per-tool defaults and caps (px are PNG widths; a width above the long-edge cap is lowered to it). */
export const LIMITS = Object.freeze({
  page: { width: 1000 },
  pages: { width: 700 },
  images: 4,               // per call: render_days' default and maximum `limit`
  maxEdge: MAX_EDGE,
  tasks: { limit: 50, maxLimit: 200 },
  minWidth: 200
});

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ content: [text(`Error: ${msg}`)], isError: true });
const png = (buf) => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
const pageKey = (p) => `${p.book}/${p.pageId}`;
const label = (aliases, p) => `${bookName(aliases, p.book)} (${p.book}) p.${p.pageId}`;
const clampInt = (v, dflt, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : dflt)));
const widthFor = (args, lim) => clampInt(args.width, lim.width, LIMITS.minWidth, LIMITS.maxEdge);
const rangeText = (r) => `${r.from}${r.to !== r.from ? ` to ${r.to}` : ''}`;

function dayRange(from, to) {
  const end = to || from;
  // dayStart() lets Date roll "2026-13-45" over; a real day round-trips unchanged.
  for (const d of [from, end]) {
    const s = typeof d === 'string' ? dayStart(d) : null;
    if (!s || dayKey(s) !== d) throw new Error(`Invalid date "${d}": use YYYY-MM-DD`);
  }
  const [a, b] = from <= end ? [from, end] : [end, from];
  return { from: a, to: b, ...rangeBoundsMs(a, b) };
}

/** The index narrowed to a notebook and/or tag. */
function filterIndex(scan, { book, tag }) {
  if (!book && !tag) return scan.index;
  const b = book ? requireBookKey(book) : null;
  const t = tag ? normalizeTag(tag) || String(tag).toLowerCase() : null;
  const pages = {};
  for (const [k, p] of Object.entries(scan.index.pages)) {
    if (b && p.book !== b) continue;
    if (t && !(scan.tags[k] || []).includes(t)) continue;
    pages[k] = p;
  }
  return { version: 1, pages };
}

const inMs = (s, r) => {
  const t = Number(s && s.startTime);
  return Number.isFinite(t) && t >= r.startMs && t < r.endMs;
};

/** Rendered SVGs → PNG blocks plus one note each, every image within the pixel caps. */
function emitImages(items, { width, describe }) {
  const blocks = [];
  const notes = [];
  for (const it of items) {
    const out = svgToPng(it.svg, fitWidth(it.height / it.width, width));
    blocks.push(png(out.png));
    notes.push(`${describe(it)} [PNG ${out.width}x${out.height}, ~${visualTokens(out.width, out.height)} visual tokens]`);
  }
  return { blocks, notes };
}

export function createTools(root) {
  const store = new Store(root);
  const search = createSearch();

  function pageRef(args) {
    return { book: requireBookKey(args.book), page: requirePageId(args.page) };
  }

  /** One page's in-set strokes dark over the rest greyed, laid out on its paper. */
  function renderSubset(scan, args, h, doc, inSet) {
    const all = doc.strokes || [];
    const mine = [], other = [];
    for (const s of all) (inSet(s) ? mine : other).push(s);
    if (!mine.length) return null;
    const fit = args.fit === 'ink' ? 'ink' : 'paper';
    const view = viewBounds({ strokes: fit === 'ink' ? mine : all, frame: store.paperFrame(h.book, h.pageId), fit });
    if (!view) return null;
    const rotation = rotationFor(scan.orientations, h.book, h.pageId);
    const r = renderPageSvg(mine, { context: other, rotation, bounds: view.bounds });
    if (!r) return null;
    const sittings = pageDayGroups(mine).groups
      .map((g) => `${formatSittingLabel(g.startTime, g.endTime)} (${g.strokes.length})`).join('; ');
    return {
      ...r, mine: mine.length, total: all.length, sittings, view, doc, h,
      label: `${bookName(scan.aliases, h.book)} p.${h.pageId}`
    };
  }

  const transcriptNote = (doc) => {
    const lines = (doc.transcript && doc.transcript.lines) || [];
    return lines.length
      ? `  whole-page transcript (not limited to these days): ${lines.map((l) => l.text).join(' / ').slice(0, 1200)}`
      : '  (page not transcribed)';
  };

  const tools = {
    list_notebooks() {
      const scan = store.scan();
      const byBook = new Map();
      const open = openTasksByPage(scan);
      for (const p of scan.pages) {
        let b = byBook.get(p.book);
        if (!b) byBook.set(p.book, (b = { book: p.book, pages: 0, strokes: 0, transcribed: 0, openTasks: 0, first: null, last: null }));
        b.pages++; b.strokes += p.strokes; if (p.lineCount) b.transcribed++;
        b.openTasks += open.get(pageKey(p)) || 0;
        for (const d of Object.keys(p.days)) {
          if (!b.first || d < b.first) b.first = d;
          if (!b.last || d > b.last) b.last = d;
        }
      }
      const rows = [...byBook.values()].map((b) => {
        const parsed = parseBookKey(b.book);
        const activeVol = scan.volumes[String(parsed.ncodeBook)] || 1;
        return {
          book: b.book, name: bookName(scan.aliases, b.book), pages: b.pages, strokes: b.strokes,
          transcribedPages: b.transcribed, openTasks: b.openTasks, firstDay: b.first, lastDay: b.last,
          activeVolume: parsed.volume === activeVol,
          paper: !!store.paperFrame(b.book, 1)
        };
      });
      return { content: [text(JSON.stringify(rows, null, 1))] };
    },

    list_pages(args) {
      const book = requireBookKey(args.book);
      const scan = store.scan();
      const tag = args.tag ? normalizeTag(args.tag) || String(args.tag).toLowerCase() : null;
      const range = args.from ? dayRange(args.from, args.to) : null;
      let pages = scan.pages.filter((p) => p.book === book);
      if (tag) pages = pages.filter((p) => (scan.tags[pageKey(p)] || []).includes(tag));
      if (range) pages = pages.filter((p) => Object.keys(p.days).some((d) => inRange(d, range.from, range.to)));
      const limit = clampInt(args.limit, 100, 1, 300), offset = clampInt(args.offset, 0, 0, 1e9);
      const open = openTasksByPage(scan);
      const rows = pages.slice(offset, offset + limit).map((p) => ({
        page: p.pageId, strokes: p.strokes, days: Object.keys(p.days).sort(),
        tags: scan.tags[pageKey(p)] || [], transcribed: p.lineCount > 0,
        openTasks: open.get(pageKey(p)) || undefined,
        rotation: rotationFor(scan.orientations, p.book, p.pageId) || undefined
      }));
      const more = pages.length > offset + limit ? ` (showing ${rows.length} of ${pages.length}; pass offset=${offset + limit} for more)` : '';
      return { content: [text(`${bookName(scan.aliases, book)} (${book}): ${pages.length} pages${more}\n${JSON.stringify(rows)}`)] };
    },

    get_transcript(args) {
      const { book, page } = pageRef(args);
      const doc = store.getPage(book, page);
      if (!doc) return fail(`No page ${book}/${page}`);
      const lines = (doc.transcript && doc.transcript.lines) || [];
      if (!lines.length) return { content: [text(`Page ${book}/${page} has no transcript (${(doc.strokes || []).length} strokes).`)] };
      const when = doc.transcript.lastTranscribed || '';
      const body = lines.map((l) => {
        const state = taskStateOf(l);
        const mark = state ? `${stateLabel(state)} ` : '';
        return `${'  '.repeat(l.indentLevel || 0)}- ${mark}${l.text}`;
      }).join('\n');
      const note = isTrustworthyTranscript(doc) ? ''
        : '\n(Stroke-to-line links on this page are unreliable (transcribed before the line-matching fix); the text itself is fine.)';
      return { content: [text(`Transcript ${book}/${page}, transcribed ${when.slice(0, 10)}:\n${body}${note}`)] };
    },

    render_page(args) {
      const { book, page } = pageRef(args);
      const scan = store.scan();
      const doc = store.getPage(book, page);
      if (!doc) return fail(`No page ${book}/${page}`);
      const strokes = doc.strokes || [];
      const fit = args.fit === 'ink' ? 'ink' : 'paper';
      const view = viewBounds({ strokes, frame: store.paperFrame(book, page), fit });
      if (!view) return { content: [text(`Page ${book}/${page} has no ink.`)] };
      const rotation = rotationFor(scan.orientations, book, page);
      const r = renderPageSvg(strokes, { rotation, bounds: view.bounds });
      const meta = `${label(scan.aliases, { book, pageId: page })}: ${strokes.length} strokes, rotation ${rotation}, `
        + `laid out on ${view.source === 'paper' ? 'the printed page' : 'the ink'}`
        + (view.clipped ? `; ${view.clipped} stray stroke(s) off the page not drawn` : '');
      const { blocks, notes } = emitImages([r], { width: widthFor(args, LIMITS.page), describe: () => meta });
      return { content: [text(notes.join('\n')), ...blocks] };
    },

    days_summary(args) {
      let range;
      try { range = dayRange(args.from, args.to); } catch (e) { return fail(e.message); }
      const scan = store.scan();
      const index = filterIndex(scan, args);
      const perDay = [];
      for (const day of eachDay(range.from, range.to)) {
        const pages = pagesOnDay(index, day).map((e) => ({
          page: `${e.book}/${e.pageId}`, notebook: bookName(scan.aliases, e.book), strokesThatDay: e.strokes, strokesOnPage: e.totalStrokes
        }));
        if (pages.length) perDay.push({ day, strokes: pages.reduce((n, p) => n + p.strokesThatDay, 0), pages });
      }
      if (!perDay.length) return { content: [text(`No ink written ${rangeText(range)}.`)] };
      return { content: [text(JSON.stringify(perDay))] };
    },

    render_days(args) {
      let range;
      try { range = dayRange(args.from, args.to); } catch (e) { return fail(e.message); }
      const scan = store.scan();
      const index = filterIndex(scan, args);
      const offset = clampInt(args.offset, 0, 0, 1e9);
      const hits = pagesInRange(index, range.from, range.to);
      if (!hits.length) return { content: [text(`No ink written ${rangeText(range)}.`)] };
      const slice = hits.slice(offset, offset + clampInt(args.limit, LIMITS.images, 1, LIMITS.images));
      const rendered = [];
      for (const h of slice) {
        const doc = store.getPage(h.book, h.pageId);
        const r = doc && renderSubset(scan, args, h, doc, (s) => inMs(s, range));
        if (r) rendered.push(r);
      }
      const describe = (r) => `${label(scan.aliases, r.h)}: ${r.mine} of ${r.total} strokes in range. ${r.sittings}`
        + (r.view.clipped ? ` (${r.view.clipped} stray stroke(s) off the page not drawn)` : '');
      const { blocks, notes } = emitImages(rendered, { width: widthFor(args, LIMITS.pages), describe });
      const lines = args.transcript ? notes.flatMap((n, i) => [n, transcriptNote(rendered[i].doc)]) : notes;
      // Pages that rendered to nothing still count as shown.
      const left = hits.length - offset - slice.length;
      lines.unshift(`${rangeText(range)}: ${hits.length} page(s) with ink in range; showing ${slice.length} (offset ${offset})`
        + (left > 0 ? `; ${left} more, call again with offset=${offset + slice.length}` : '')
        + '. Dark ink = written in range, grey = the rest of the page.');
      return { content: [text(lines.join('\n')), ...blocks] };
    },

    list_tags(args) {
      const scan = store.scan();
      const exists = new Set(scan.pages.map(pageKey));
      // Tags on pages since deleted stay in the sidecar; count only pages that exist (as the Library shows them).
      const live = {};
      let orphans = 0;
      for (const [k, list] of Object.entries(scan.tags)) {
        if (exists.has(k)) live[k] = list; else orphans++;
      }
      const open = openTasksByPage(scan);
      if (!args.tag) {
        const index = buildTagIndex(live);
        const stats = tagStats(live).map((s) => {
          const n = (index.get(s.tag) || []).reduce((a, k) => a + (open.get(k) || 0), 0);
          return n ? { ...s, openTasks: n } : s;
        });
        const untagged = scan.pages.filter((p) => !(live[pageKey(p)] || []).length).length;
        return { content: [text(`${stats.length} tag(s); ${untagged} untagged page(s)`
          + (orphans ? `; ${orphans} tagged page(s) no longer exist (ignored)` : '') + `\n${JSON.stringify(stats)}`)] };
      }
      const tag = normalizeTag(args.tag) || String(args.tag).toLowerCase();
      const keys = buildTagIndex(live).get(tag) || [];
      if (!keys.length) return { content: [text(`No pages tagged "${tag}".`)] };
      const byKey = new Map(scan.pages.map((p) => [pageKey(p), p]));
      const rows = keys.map((k) => {
        const p = byKey.get(k);
        return { page: k, notebook: bookName(scan.aliases, p.book), strokes: p.strokes, days: Object.keys(p.days).sort(), transcribed: p.lineCount > 0, openTasks: open.get(k) || undefined, tags: live[k] };
      });
      return { content: [text(`"${tag}": ${rows.length} page(s)\n${JSON.stringify(rows)}`)] };
    },

    list_tasks(args) {
      const state = args.state == null || args.state === '' ? 'open' : String(args.state).toLowerCase();
      const groupBy = args.group_by == null || args.group_by === '' || args.group_by === 'none' ? null : String(args.group_by);
      if (groupBy && !TASK_GROUP_ARGS.includes(groupBy)) return fail(`Unknown group_by "${args.group_by}": use ${TASK_GROUP_ARGS.join(', ')} or none`);
      let range = null;
      if (args.from || args.to) {
        try { range = dayRange(args.from || args.to, args.to); } catch (e) { return fail(e.message); }
      }
      const scan = store.scan();
      const book = args.book ? requireBookKey(args.book) : null;
      const scoped = filterTasks(allTaskRows(scan), scan, {
        book, project: args.project, tags: args.tag, from: range && range.from, to: range && range.to, text: args.text
      });
      const counts = countsOf(scoped);
      const ordered = orderTasks(rowsInState(scoped, state), groupBy);
      const limit = clampInt(args.limit, LIMITS.tasks.limit, 1, LIMITS.tasks.maxLimit);
      const offset = clampInt(args.offset, 0, 0, 1e9);
      const slice = ordered.slice(offset, offset + limit);
      const out = (r) => taskOut(r, scan, bookName);
      let body;
      if (groupBy) {
        // Regroup the page of rows; group order and labels are the app's (groupTaskRows).
        body = groupTaskRows(slice, groupBy).map((g) => ({
          group: g.kind === 'book' ? `${bookName(scan.aliases, g.id)} (${g.id})` : g.label,
          tasks: g.rows.length, rows: g.rows.map(out)
        }));
      } else {
        body = slice.map(out);
      }
      const scope = [
        book && `book ${book}`, args.project && `project ${args.project}`,
        args.tag && `tag ${[].concat(args.tag).join(' + ')}`, range && rangeText(range), args.text && `text "${args.text}"`
      ].filter(Boolean).join(', ');
      const left = ordered.length - offset - slice.length;
      const unconverted = unconvertedPages(scan);
      const head = `${ordered.length} ${state} task(s)${scope ? ` (${scope})` : ''}; showing ${slice.length} from offset ${offset}`
        + (left > 0 ? `; ${left} more, call again with offset=${offset + slice.length}` : '')
        + `. Counts in this scope: ${JSON.stringify(counts)} (open = TODO + WAITING).`
        + ' Follow up with get_transcript or render_page using book + page. Read-only: tick or change tasks in the app.'
        + (unconverted ? ` ${unconverted} transcribed page(s) still have task boxes in their text that are not tasks yet (the app's Convert task boxes… step).` : '');
      return { content: [text(`${head}
${JSON.stringify(body)}`)] };
    },

    search(args) {
      const input = String(args.query || '').trim();
      if (!input) return fail('Empty query');
      const scan = store.scan();
      const { q, res, dates } = search(scan, input);
      const out = {
        query: { words: q.tokens, days: q.days, text: q.text },
        order: res.order,
        pages: res.pages.map((p) => {
          const d = dates.get(p.key);
          return {
            page: p.key, notebook: bookName(scan.aliases, p.record.book), score: p.score, snippet: p.snippet,
            written: d ? (d.first === d.last ? d.first : `${d.first} to ${d.last}`) : null,
            tags: scan.tags[p.key] || [], transcribed: !!p.record.transcriptionText
          };
        }),
        notebooks: res.notebooks.map((n) => ({ book: n.book, name: n.name, exact: n.exact })),
        days: res.days,
        tags: res.tags.map((t) => ({ tag: t.tag, pages: t.pages, exact: t.exact }))
      };
      const head = `${res.total} result(s): ${out.pages.length} page(s), ${out.notebooks.length} notebook(s), ${out.days.length} day(s), ${out.tags.length} tag(s)`
        + ' (app global-search semantics and limits; transcribed text only, so untranscribed pages are found by date, notebook or tag)';
      return { content: [text(`${head}\n${JSON.stringify(out)}`)] };
    }
  };

  // Wrap so a thrown validation error becomes a tool error, not a crash.
  return Object.fromEntries(Object.entries(tools).map(([name, fn]) => [name, (args = {}) => {
    try { return fn(args || {}); } catch (e) { return fail(e.message); }
  }]));
}
