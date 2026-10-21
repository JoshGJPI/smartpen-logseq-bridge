/**
 * Tool handlers, independent of the MCP transport so tests can call them directly.
 * Every handler returns `{ content: [{type:'text',text} | {type:'image',data,mimeType}], isError? }`.
 * All are read-only.
 *
 * Output cost is capped three ways: images per call (paged with `offset`), pixel
 * width per tool, and bytes per call (`maxBytes`, counting PNG bytes and SVG
 * text). Whatever is left out is named in the reply with the offset to ask for next.
 */
import { Store, bookName } from './store.js';
import { renderPageSvg, pngWithin, composeSheet } from './render.js';
import { viewBounds } from './bounds.js';
import { createSearch } from './search.js';
import { requireBookKey, requirePageId } from './paths.js';
import { parseBookKey } from '../../src/lib/volumes.js';
import { dayKey, dayStart, rangeBoundsMs, pagesInRange, pagesOnDay, eachDay, inRange } from '../../src/lib/timeline.js';
import { pageDayGroups, formatSittingLabel } from '../../src/lib/viewer/page-sittings.js';
import { rotationFor, normalizeRotation } from '../../src/lib/page-orientation.js';
import { isTrustworthyTranscript } from '../../src/lib/viewer/ink-text.js';
import { buildTagIndex, tagStats, normalizeTag } from '../../src/lib/tags.js';

/** Per-tool size defaults and caps (px are PNG widths). */
export const LIMITS = Object.freeze({
  page: { width: 1000, maxWidth: 2000 },
  pages: { width: 700, maxWidth: 1400, images: 4, maxImages: 12 },
  composite: { width: 1200, maxWidth: 2000, pages: 12, maxPages: 24 },
  by_day: { width: 1200, maxWidth: 2000, days: 4, maxDays: 8, pagesPerDay: 12 },
  bytes: { default: 1_000_000, min: 1_000, max: 4_000_000 },
  strokes: { limit: 300, maxLimit: 3000, points: 2_000, maxPoints: 60_000 },
  minWidth: 200
});

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ content: [text(`Error: ${msg}`)], isError: true });
const png = (buf) => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
const kb = (n) => `${Math.round(n / 1024)} KB`;
const pageKey = (p) => `${p.book}/${p.pageId}`;
const label = (aliases, p) => `${bookName(aliases, p.book)} (${p.book}) p.${p.pageId}`;
const clampInt = (v, dflt, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : dflt)));
const widthFor = (args, lim) => clampInt(args.width, lim.width, LIMITS.minWidth, lim.maxWidth);
const budgetFor = (args) => clampInt(args.maxBytes, LIMITS.bytes.default, LIMITS.bytes.min, LIMITS.bytes.max);
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

/**
 * Turn rendered SVGs into content blocks inside a byte budget. The first image
 * may shrink to fit; a later one that does not fit stops the run.
 * @returns {{blocks: Array, notes: string[], used: number, stoppedAt: number|null}}
 */
function emitImages(items, { format, width, budget, describe }) {
  const blocks = [];
  const notes = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const left = budget - used;
    if (format === 'svg') {
      if (it.svg.length > left && i > 0) return { blocks, notes, used, stoppedAt: i };
      blocks.push(text(it.svg));
      used += it.svg.length;
      notes.push(`${describe(it)} [SVG ${kb(it.svg.length)}]`);
      continue;
    }
    const out = i === 0 ? pngWithin(it.svg, width, left) : pngWithin(it.svg, width, Infinity);
    if (!out || (i > 0 && out.png.length > left)) {
      if (i === 0) notes.push(`${describe(it)}: too large for maxBytes=${budget} even at the smallest size; raise maxBytes or narrow the request.`);
      return { blocks, notes, used, stoppedAt: i };
    }
    blocks.push(png(out.png));
    used += out.png.length;
    notes.push(`${describe(it)} [PNG ${out.width}x${out.height}, ${kb(out.png.length)}${out.shrunk ? ', shrunk to fit maxBytes' : ''}]`);
  }
  return { blocks, notes, used, stoppedAt: null };
}

export function createTools(root) {
  const store = new Store(root);
  const search = createSearch();

  function pageRef(args) {
    return { book: requireBookKey(args.book), page: requirePageId(args.page) };
  }

  function rotationFrom(scan, args, book, pageId) {
    return args.rotation != null ? normalizeRotation(args.rotation) : rotationFor(scan.orientations, book, pageId);
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
    const rotation = rotationFrom(scan, args, h.book, h.pageId);
    const r = renderPageSvg(mine, { context: args.context === false ? [] : other, rotation, bounds: view.bounds });
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
      for (const p of scan.pages) {
        let b = byBook.get(p.book);
        if (!b) byBook.set(p.book, (b = { book: p.book, pages: 0, strokes: 0, transcribed: 0, first: null, last: null }));
        b.pages++; b.strokes += p.strokes; if (p.lineCount) b.transcribed++;
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
          transcribedPages: b.transcribed, firstDay: b.first, lastDay: b.last,
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
      const rows = pages.slice(offset, offset + limit).map((p) => ({
        page: p.pageId, strokes: p.strokes, days: Object.keys(p.days).sort(),
        tags: scan.tags[pageKey(p)] || [], transcribed: p.lineCount > 0,
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
        const mark = l.checked === true ? 'DONE ' : l.checked === false ? 'TODO ' : '';
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
      const rotation = rotationFrom(scan, args, book, page);
      const r = renderPageSvg(strokes, { rotation, bounds: view.bounds });
      const meta = `${label(scan.aliases, { book, pageId: page })}: ${strokes.length} strokes, rotation ${rotation}, `
        + `laid out on ${view.source === 'paper' ? 'the printed page' : 'the ink'}`
        + (view.clipped ? `; ${view.clipped} stray stroke(s) off the page not drawn` : '');
      const { blocks, notes } = emitImages([r], {
        format: args.format, width: widthFor(args, LIMITS.page), budget: budgetFor(args), describe: () => meta
      });
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
      const mode = ['composite', 'by_day'].includes(args.mode) ? args.mode : 'pages';
      const offset = clampInt(args.offset, 0, 0, 1e9);
      const budget = budgetFor(args);
      const ctxNote = args.context === false ? '.' : '. Dark ink = written in range, grey = the rest of the page.';

      if (mode === 'by_day') return renderByDay(scan, index, range, args, offset, budget, ctxNote);

      const hits = pagesInRange(index, range.from, range.to);
      if (!hits.length) return { content: [text(`No ink written ${rangeText(range)}.`)] };
      const lim = LIMITS[mode];
      const cap = mode === 'composite'
        ? clampInt(args.limit, lim.pages, 1, lim.maxPages)
        : clampInt(args.limit, lim.images, 1, lim.maxImages);
      const slice = hits.slice(offset, offset + cap);
      const rendered = [];
      for (const h of slice) {
        const doc = store.getPage(h.book, h.pageId);
        const r = doc && renderSubset(scan, args, h, doc, (s) => inMs(s, range));
        if (r) rendered.push(r);
      }
      const describe = (r) => `${label(scan.aliases, r.h)}: ${r.mine} of ${r.total} strokes in range. ${r.sittings}`
        + (r.view.clipped ? ` (${r.view.clipped} stray stroke(s) off the page not drawn)` : '');

      let shown, blocks, notes;
      if (mode === 'composite') {
        const sheet = composeSheet(rendered, { title: `${rangeText(range)}` });
        const em = emitImages([sheet], { format: args.format, width: widthFor(args, lim), budget, describe: () => 'composite' });
        blocks = em.blocks;
        notes = [...em.notes, ...rendered.map(describe)];
        shown = em.blocks.length ? slice.length : 0;
      } else {
        const em = emitImages(rendered, { format: args.format, width: widthFor(args, lim), budget, describe });
        blocks = em.blocks;
        notes = em.notes;
        if (args.transcript) {
          notes = notes.flatMap((n, i) => [n, transcriptNote(rendered[i].doc)]);
        }
        // Pages that rendered to nothing still count as shown; a byte stop does not.
        shown = em.stoppedAt === null ? slice.length : slice.indexOf(rendered[em.stoppedAt].h);
      }
      const left = hits.length - offset - shown;
      notes.unshift(`${rangeText(range)}: ${hits.length} page(s) with ink in range; showing ${shown} (offset ${offset})`
        + (left > 0 ? `; ${left} more, call again with offset=${offset + shown}` : '') + ctxNote);
      return { content: [text(notes.join('\n')), ...blocks] };
    },

    get_strokes(args) {
      const scan = store.scan();
      let range = null;
      if (args.from) {
        try { range = dayRange(args.from, args.to); } catch (e) { return fail(e.message); }
      } else if (!(args.book && args.page)) {
        return fail('Give from (and to) for a day range, or book + page for one whole page');
      }
      let targets;
      if (args.book && args.page) {
        const { book, page } = pageRef(args);
        targets = [{ book, pageId: page }];
      } else {
        targets = pagesInRange(filterIndex(scan, args), range.from, range.to);
      }
      const limit = clampInt(args.limit, LIMITS.strokes.limit, 1, LIMITS.strokes.maxLimit);
      const maxPoints = clampInt(args.maxPoints, LIMITS.strokes.points, 100, LIMITS.strokes.maxPoints);
      const offset = clampInt(args.offset, 0, 0, 1e9);
      const dp = clampInt(args.decimals, 1, 0, 3);
      const f = 10 ** dp;
      const r = (v) => Math.round(v * f) / f;

      // One flat, ordered stroke list across the target pages, so offset pages through it.
      let seen = 0, sent = 0, points = 0, more = 0, total = 0;
      const out = [];
      for (const t of targets) {
        const doc = store.getPage(t.book, t.pageId);
        if (!doc) continue;
        const list = (doc.strokes || []).filter((s) => !range || inMs(s, range));
        total += list.length;
        let page = null;
        for (const s of list) {
          if (seen++ < offset) continue;
          const pts = (s.points || []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (sent >= limit || points + pts.length > maxPoints) { more++; continue; }
          if (!page) {
            page = { page: `${t.book}/${t.pageId}`, rotation: rotationFor(scan.orientations, t.book, t.pageId), paper: store.paperFrame(t.book, t.pageId), strokes: [] };
            out.push(page);
          }
          const xy = [];
          for (const p of pts) xy.push(r(p[0]), r(p[1]));
          const row = { t0: s.startTime, t1: s.endTime, xy };
          if (s.sketch) row.sketch = true;
          if (args.force) row.f = pts.map((p) => (Number.isFinite(p[3]) ? p[3] : null));
          page.strokes.push(row);
          points += pts.length;
          sent++;
        }
      }
      const head = `${range ? rangeText(range) : `${args.book}/${args.page}`}: ${total} stroke(s); returning ${sent} from offset ${offset} (${points} points)`
        + (more ? `; ${more} more, call again with offset=${offset + sent}` : '')
        + `. Units: Ncode (~2.4 mm), unrotated page coordinates; xy is flat [x0,y0,x1,y1,...]; t0/t1 are Unix ms; \`paper\` is Neo's printed frame when known; \`rotation\` is display-only.`;
      return { content: [text(`${head}\n${JSON.stringify(out)}`)] };
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
      if (!args.tag) {
        const stats = tagStats(live);
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
        return { page: k, notebook: bookName(scan.aliases, p.book), strokes: p.strokes, days: Object.keys(p.days).sort(), transcribed: p.lineCount > 0, tags: live[k] };
      });
      return { content: [text(`"${tag}": ${rows.length} page(s)\n${JSON.stringify(rows)}`)] };
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

  /** by_day: one contact sheet per day with ink, that day's strokes dark (pageDayGroups split). */
  function renderByDay(scan, index, range, args, offset, budget, ctxNote) {
    const lim = LIMITS.by_day;
    const days = eachDay(range.from, range.to).filter((d) => pagesOnDay(index, d).length);
    if (!days.length) return { content: [text(`No ink written ${rangeText(range)}.`)] };
    const cap = clampInt(args.limit, lim.days, 1, lim.maxDays);
    const slice = days.slice(offset, offset + cap);
    const sheets = [];
    for (const day of slice) {
      const entries = pagesOnDay(index, day);
      const items = [];
      for (const e of entries.slice(0, lim.pagesPerDay)) {
        const doc = store.getPage(e.book, e.pageId);
        if (!doc) continue;
        const group = pageDayGroups(doc.strokes || []).groups.find((g) => g.day === day);
        if (!group) continue;
        const mineSet = new Set(group.strokes);
        const r = renderSubset(scan, args, e, doc, (s) => mineSet.has(s));
        if (r) items.push(r);
      }
      if (!items.length) continue;
      const sheet = composeSheet(items, { cols: items.length > 4 ? 3 : Math.min(items.length, 2), title: `${day}: ${items.length} page(s)` });
      sheet.day = day;
      sheet.lines = items.map((r) => `  ${label(scan.aliases, r.h)}: ${r.mine} of ${r.total} strokes. ${r.sittings}`);
      sheet.extra = Math.max(0, entries.length - lim.pagesPerDay);
      sheets.push(sheet);
    }
    const em = emitImages(sheets, {
      format: args.format, width: widthFor(args, lim), budget,
      describe: (s) => `${s.day}${s.extra ? ` (${s.extra} more page(s) that day not drawn; ask for them with mode "pages")` : ''}`
    });
    const notes = em.notes.flatMap((n, i) => [n, ...sheets[i].lines]);
    const shown = em.stoppedAt === null ? slice.length : slice.indexOf(sheets[em.stoppedAt].day);
    const left = days.length - offset - shown;
    notes.unshift(`${rangeText(range)}: ${days.length} day(s) with ink; showing ${shown} (offset ${offset})`
      + (left > 0 ? `; ${left} more, call again with offset=${offset + shown}` : '') + ctxNote);
    return { content: [text(notes.join('\n')), ...em.blocks] };
  }

  // Wrap so a thrown validation error becomes a tool error, not a crash.
  return Object.fromEntries(Object.entries(tools).map(([name, fn]) => [name, (args = {}) => {
    try { return fn(args || {}); } catch (e) { return fail(e.message); }
  }]));
}
