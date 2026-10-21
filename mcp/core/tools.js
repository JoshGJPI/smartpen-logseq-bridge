/**
 * Tool handlers, independent of the MCP transport so tests can call them directly.
 * Every handler returns `{ content: [{type:'text',text} | {type:'image',data,mimeType}], isError? }`.
 * All are read-only.
 */
import { Store, bookName } from './store.js';
import { renderPageSvg, svgToPng, composeSheet } from './render.js';
import { requireBookKey, requirePageId } from './paths.js';
import { parseBookKey } from '../../src/lib/volumes.js';
import { dayKey, dayStart, rangeBoundsMs, pagesInRange, eachDay, addDays } from '../../src/lib/timeline.js';
import { pageDayGroups, formatSittingLabel } from '../../src/lib/viewer/page-sittings.js';
import { rotationFor, normalizeRotation } from '../../src/lib/page-orientation.js';
import { computeStrokeBounds } from '../../src/lib/viewer/page-svg.js';

export const DEFAULT_WIDTH = 1000;
export const MAX_WIDTH = 2000;
export const DEFAULT_MAX_IMAGES = 8;
/** Transcripts written before this day had unreliable stroke->line matching. */
const LINE_MATCH_FIXED = '2026-08-01';

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ content: [text(`Error: ${msg}`)], isError: true });
const png = (buf) => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' });
const clampWidth = (w) => Math.max(200, Math.min(MAX_WIDTH, Math.round(w || DEFAULT_WIDTH)));
const pageKey = (p) => `${p.book}/${p.pageId}`;
const label = (aliases, p) => `${bookName(aliases, p.book)} (${p.book}) p.${p.pageId}`;

function dayRange(from, to) {
  const end = to || from;
  // dayStart() lets Date roll "2026-13-45" over; a real day round-trips unchanged.
  for (const d of [from, end]) {
    const s = dayStart(d);
    if (!s || dayKey(s) !== d) throw new Error(`Invalid date "${d}": use YYYY-MM-DD`);
  }
  const bounds = rangeBoundsMs(from, end);
  const [a, b] = from <= end ? [from, end] : [end, from];
  return { from: a, to: b, ...bounds };
}

/** The index narrowed to a notebook and/or tag. */
function filterIndex(scan, { book, tag }) {
  if (!book && !tag) return scan.index;
  const t = tag ? String(tag).toLowerCase() : null;
  const pages = {};
  for (const [k, p] of Object.entries(scan.index.pages)) {
    if (book && p.book !== book) continue;
    if (t && !(scan.tags[k] || []).includes(t)) continue;
    pages[k] = p;
  }
  return { version: 1, pages };
}

export function createTools(root) {
  const store = new Store(root);

  function pageRef(args) {
    return { book: requireBookKey(args.book), page: requirePageId(args.page) };
  }

  function rotationFrom(scan, args, book, pageId) {
    return args.rotation != null ? normalizeRotation(args.rotation) : rotationFor(scan.orientations, book, pageId);
  }

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
          activeVolume: parsed.volume === activeVol
        };
      });
      return { content: [text(JSON.stringify(rows, null, 1))] };
    },

    list_pages(args) {
      const book = requireBookKey(args.book);
      const scan = store.scan();
      const tag = args.tag ? String(args.tag).toLowerCase() : null;
      let range = null;
      if (args.from) range = dayRange(args.from, args.to);
      let pages = scan.pages.filter((p) => p.book === book);
      if (tag) pages = pages.filter((p) => (scan.tags[pageKey(p)] || []).includes(tag));
      if (range) pages = pages.filter((p) => Object.keys(p.days).some((d) => d >= range.from && d <= range.to));
      const limit = Math.min(args.limit || 100, 300), offset = args.offset || 0;
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
      const note = when.slice(0, 10) < LINE_MATCH_FIXED
        ? '\n(Transcribed before the line-matching fix: text is fine, but per-line ink links are unreliable.)' : '';
      return { content: [text(`Transcript ${book}/${page}, transcribed ${when.slice(0, 10)}:\n${body}${note}`)] };
    },

    render_page(args) {
      const { book, page } = pageRef(args);
      const scan = store.scan();
      const doc = store.getPage(book, page);
      if (!doc) return fail(`No page ${book}/${page}`);
      const rotation = rotationFrom(scan, args, book, page);
      const r = renderPageSvg(doc.strokes || [], { rotation });
      if (!r) return { content: [text(`Page ${book}/${page} has no ink.`)] };
      const meta = `${bookName(scan.aliases, book)} (${book}) p.${page}: ${r.strokes} strokes, rotation ${rotation}`;
      if (args.format === 'svg') return { content: [text(meta), text(r.svg)] };
      const out = svgToPng(r.svg, clampWidth(args.width));
      return { content: [text(`${meta}; PNG ${out.width}x${out.height}, ${Math.round(out.png.length / 1024)} KB`), png(out.png)] };
    },

    days_summary(args) {
      let range;
      try { range = dayRange(args.from, args.to); } catch (e) { return fail(e.message); }
      const scan = store.scan();
      const index = filterIndex(scan, args);
      const perDay = [];
      for (const day of eachDay(range.from, range.to)) {
        const pages = [];
        let strokes = 0;
        for (const p of Object.values(index.pages)) {
          const n = p.days[day] || 0;
          if (!n) continue;
          strokes += n;
          pages.push({ page: `${p.book}/${p.pageId}`, notebook: bookName(scan.aliases, p.book), strokesThatDay: n, strokesOnPage: p.strokes });
        }
        if (strokes) perDay.push({ day, strokes, pages });
      }
      if (!perDay.length) return { content: [text(`No ink written ${range.from}${range.to !== range.from ? ` to ${range.to}` : ''}.`)] };
      return { content: [text(JSON.stringify(perDay))] };
    },

    render_days(args) {
      let range;
      try { range = dayRange(args.from, args.to); } catch (e) { return fail(e.message); }
      const scan = store.scan();
      const index = filterIndex(scan, args);
      const hits = pagesInRange(index, range.from, range.to);
      if (!hits.length) return { content: [text(`No ink written ${range.from}${range.to !== range.from ? ` to ${range.to}` : ''}.`)] };

      const mode = args.mode === 'composite' ? 'composite' : 'pages';
      const cap = Math.min(args.limit || DEFAULT_MAX_IMAGES, 20);
      const offset = args.offset || 0;
      const width = clampWidth(args.width);
      const withContext = args.context !== false;
      // composite packs a whole set into one image; `pages` mode pages by image.
      const slice = mode === 'composite' ? hits.slice(offset, offset + 12) : hits.slice(offset, offset + cap);

      const notes = [];
      const rendered = [];
      for (const h of slice) {
        const doc = store.getPage(h.book, h.pageId);
        if (!doc) continue;
        const all = doc.strokes || [];
        const inDay = [], other = [];
        for (const s of all) {
          const t = Number(s && s.startTime);
          (Number.isFinite(t) && t >= range.startMs && t < range.endMs ? inDay : other).push(s);
        }
        const rotation = rotationFrom(scan, args, h.book, h.pageId);
        const r = renderPageSvg(inDay, {
          context: withContext ? other : [], rotation, bounds: computeStrokeBounds(all)
        });
        if (!r) continue;
        const sittings = pageDayGroups(inDay).groups
          .map((g) => `${formatSittingLabel(g.startTime, g.endTime)} (${g.strokes.length})`).join('; ');
        const title = `${label(scan.aliases, h)}: ${h.inRangeStrokes} of ${h.totalStrokes} strokes in range. ${sittings}`;
        rendered.push({ ...r, label: `${bookName(scan.aliases, h.book)} p.${h.pageId}`, title, h, doc });
      }

      const content = [];
      if (mode === 'composite') {
        const sheet = composeSheet(rendered);
        if (args.format === 'svg') content.push(text(sheet.svg));
        else {
          const out = svgToPng(sheet.svg, Math.max(width, 1400));
          content.push(png(out.png));
          notes.push(`composite PNG ${out.width}x${out.height}, ${Math.round(out.png.length / 1024)} KB`);
        }
        rendered.forEach((r) => notes.push(r.title));
      } else {
        for (const r of rendered) {
          if (args.format === 'svg') { content.push(text(r.title), text(r.svg)); continue; }
          const out = svgToPng(r.svg, width);
          content.push(png(out.png));
          notes.push(`${r.title} [PNG ${out.width}x${out.height}, ${Math.round(out.png.length / 1024)} KB]`);
          if (args.transcript && r.doc.transcript && r.doc.transcript.lines.length) {
            notes.push(`  whole-page transcript (not limited to this day): ${r.doc.transcript.lines.map((l) => l.text).join(' / ').slice(0, 1200)}`);
          }
        }
      }
      const shown = slice.length;
      const left = hits.length - offset - shown;
      notes.unshift(`${range.from}${range.to !== range.from ? ` to ${range.to}` : ''}: ${hits.length} page(s) with ink in range; showing ${shown} (offset ${offset})`
        + (left > 0 ? `; ${left} more, call again with offset=${offset + shown}` : '')
        + (withContext ? '. Dark ink = written in range, grey = rest of the page.' : '.'));
      return { content: [text(notes.join('\n')), ...content] };
    },

    search(args) {
      const q = String(args.query || '').toLowerCase().trim();
      if (!q) return fail('Empty query');
      const terms = q.split(/\s+/);
      const scan = store.scan();
      const out = [];
      for (const p of scan.pages) {
        const tags = scan.tags[pageKey(p)] || [];
        const hay = `${p.text}\n${tags.join(' ')}\n${bookName(scan.aliases, p.book)}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
        const i = p.text.toLowerCase().indexOf(terms[0]);
        const snippet = i >= 0 ? p.text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ') : '';
        out.push({
          page: pageKey(p), notebook: bookName(scan.aliases, p.book), days: Object.keys(p.days).sort(), tags, snippet
        });
      }
      const limit = Math.min(args.limit || 20, 100);
      return { content: [text(`${out.length} page(s) match${out.length > limit ? `; first ${limit}` : ''}\n${JSON.stringify(out.slice(0, limit))}`)] };
    }
  };

  // Wrap so a thrown validation error becomes a tool error, not a crash.
  return Object.fromEntries(Object.entries(tools).map(([name, fn]) => [name, (args = {}) => {
    try { return fn(args); } catch (e) { return fail(e.message); }
  }]));
}

export { addDays, dayKey };
