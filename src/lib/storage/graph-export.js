/**
 * Graph export — publish a curated subset of strokes to a LogSeq graph.
 *
 * The bridge's own store (`<dataRoot>/pages/`) is the digital twin of the
 * notebook: everything, private notes included. The graph copy is a different
 * thing entirely — a *book of sketches*, containing only what the user has
 * explicitly chosen to publish.
 *
 * Two rules follow from that, and they drive this whole module:
 *
 *   1. ADDITIVE. Each export merges into whatever is already published for that
 *      page rather than replacing it, so sketches can be added to a page over
 *      time. Strokes are deduplicated by id (`s{startTime}`), so re-exporting an
 *      overlapping selection is a safe no-op.
 *
 *   2. NO TRANSCRIPT. Transcript lines are stripped and every `lineId` reference
 *      is cleared before writing. Publishing a sketch must never carry the
 *      page's handwriting-recognised text along with it — that text is exactly
 *      the private content the selective export exists to keep out of the graph.
 *      (The plugin surfaces `transcript.lines` via its `copySmartpenTranscript`
 *      action, so anything left in the asset is user-visible in LogSeq.)
 *
 * Region cropping is deliberately NOT done here. The plugin renders a sub-region
 * from bounds in the `{{renderer :smartpen-sketch, …, minX, minY, maxX, maxY}}`
 * macro, and those bounds are chosen in the LogSeq Visualizer where the user can
 * see the result. This module only decides *which strokes exist* in the graph.
 *
 * The actual file writes live in `publish-graph.js`.
 */

import { PAGE_DOC_VERSION, computeBounds } from './page-doc.js';
import { strokeToStored } from './save-page.js';
import { readGraphPage, writeGraphPage } from './publish-graph.js';

/* -----------------------------------------------------------------
 *  Pure core
 * ----------------------------------------------------------------- */

/**
 * Drop every transcript back-reference from a stored-stroke array.
 *
 * Paired with an empty `transcript.lines`, this keeps the published asset free
 * of recognised text. Leaving `lineId` in place would also leave dangling
 * references to lines that don't exist in the published doc.
 *
 * @param {import('./page-doc.js').StoredStroke[]} strokes
 * @returns {import('./page-doc.js').StoredStroke[]}
 */
export function stripTranscriptRefs(strokes) {
  return (strokes || []).map(s => (s.lineId == null ? s : { ...s, lineId: null }));
}

/**
 * Additive merge of stored strokes, deduplicated by id.
 *
 * Existing (already-published) strokes win on collision: republishing a stroke
 * must not perturb what LogSeq already renders. Result is sorted by startTime so
 * the asset reads in drawing order regardless of export sequence.
 *
 * @param {import('./page-doc.js').StoredStroke[]} existing
 * @param {import('./page-doc.js').StoredStroke[]} incoming
 * @returns {{strokes: import('./page-doc.js').StoredStroke[], added: number, duplicates: number}}
 */
export function mergeGraphStrokes(existing, incoming) {
  const merged = [...(existing || [])];
  const seen = new Set(merged.map(s => s.id));

  let added = 0;
  let duplicates = 0;

  for (const s of incoming || []) {
    if (seen.has(s.id)) {
      duplicates++;
      continue;
    }
    seen.add(s.id);
    merged.push(s);
    added++;
  }

  merged.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  return { strokes: merged, added, duplicates };
}

/**
 * Resolve the `pageInfo` for a published doc.
 *
 * `section`/`owner` are Ncode provenance the plugin echoes into its index; take
 * them from whichever source has them (already-published doc first, since it was
 * written from the same page), falling back to zeros rather than failing — the
 * renderer only needs book/page.
 *
 * @param {import('./page-doc.js').PageDoc|null} existingDoc
 * @param {Object|null} sourcePageInfo - pageInfo from the source strokes/doc
 * @param {number} book
 * @param {number} page - integer NCode page number
 * @returns {import('./page-doc.js').PageInfo}
 */
export function resolveGraphPageInfo(existingDoc, sourcePageInfo, book, page) {
  const prev = existingDoc?.pageInfo || {};
  const src = sourcePageInfo || {};
  return {
    section: prev.section || src.section || 0,
    owner: prev.owner || src.owner || 0,
    book: Number(book),
    page: Number(page)
  };
}

/**
 * Build the PageDoc to publish: merged strokes, no transcript, fresh metadata.
 *
 * @param {Object} input
 * @param {import('./page-doc.js').PageDoc|null} input.existingDoc
 * @param {import('./page-doc.js').StoredStroke[]} input.incoming - already in storage shape
 * @param {Object|null} [input.sourcePageInfo]
 * @param {number} input.book
 * @param {number} input.page
 * @returns {{doc: import('./page-doc.js').PageDoc, added: number, duplicates: number}}
 */
export function buildGraphPageDoc({ existingDoc, incoming, sourcePageInfo = null, book, page }) {
  // Strip both sides: an asset published before this rule existed may still
  // carry lineIds, and re-publishing is the natural way to clean it up.
  const existingStrokes = stripTranscriptRefs(existingDoc?.strokes || []);
  const incomingStrokes = stripTranscriptRefs(incoming);

  const { strokes, added, duplicates } = mergeGraphStrokes(existingStrokes, incomingStrokes);

  const doc = {
    version: PAGE_DOC_VERSION,
    pageInfo: resolveGraphPageInfo(existingDoc, sourcePageInfo, book, page),
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalStrokes: strokes.length,
      bounds: computeBounds(strokes)
    },
    // Deliberately empty — see module header.
    transcript: { lastTranscribed: null, lines: [] },
    strokes
  };

  return { doc, added, duplicates };
}

/**
 * Group canvas-format strokes by the page they belong to.
 *
 * A box selection can span pages, and each page is a separate asset, so an
 * export has to fan out into one merge+write per page. Strokes without usable
 * pageInfo are reported separately rather than silently dropped.
 *
 * @param {Object[]} canvasStrokes - strokes with { pageInfo, dotArray }
 * @returns {{groups: Array<{book:number, page:number, strokes:Object[]}>, orphans:number}}
 */
export function groupCanvasStrokesByPage(canvasStrokes) {
  const byKey = new Map();
  let orphans = 0;

  for (const stroke of canvasStrokes || []) {
    const info = stroke?.pageInfo;
    const book = Number(info?.book);
    const page = Number(info?.page);
    if (!Number.isFinite(book) || !Number.isFinite(page)) {
      orphans++;
      continue;
    }
    const key = `${book}/${page}`;
    let group = byKey.get(key);
    if (!group) {
      group = { book, page, strokes: [] };
      byKey.set(key, group);
    }
    group.strokes.push(stroke);
  }

  const groups = [...byKey.values()].sort((a, b) =>
    a.book !== b.book ? a.book - b.book : a.page - b.page
  );
  return { groups, orphans };
}

/* -----------------------------------------------------------------
 *  Facades (touch disk via publish-graph.js)
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} GraphExportPageResult
 * @property {number} book
 * @property {number|string} pageId
 * @property {boolean} success
 * @property {number} added       - strokes newly published
 * @property {number} duplicates  - strokes already published (skipped)
 * @property {number} total       - strokes in the published asset afterwards
 * @property {string} [error]
 */

/**
 * Publish a set of already-storage-shaped strokes to one page, merging with
 * whatever that page already has in the graph.
 *
 * @param {Object} input
 * @param {number} input.book
 * @param {number|string} input.pageId - identifier incl. any letter suffix
 * @param {number} [input.page] - integer NCode page (defaults to pageId sans suffix)
 * @param {import('./page-doc.js').StoredStroke[]} input.strokes
 * @param {Object|null} [input.sourcePageInfo]
 * @returns {Promise<GraphExportPageResult>}
 */
export async function exportStoredStrokesToGraphPage({
  book,
  pageId,
  page,
  strokes,
  sourcePageInfo = null
}) {
  const pid = String(pageId);
  const pageNum = Number.isFinite(Number(page))
    ? Number(page)
    : Number(pid.replace(/[a-z]+$/i, '')) || 0;

  try {
    const existingDoc = await readGraphPage(book, pid);
    const { doc, added, duplicates } = buildGraphPageDoc({
      existingDoc,
      incoming: strokes,
      sourcePageInfo,
      book,
      page: pageNum
    });

    await writeGraphPage(book, pid, doc);

    return {
      book,
      pageId: pid,
      success: true,
      added,
      duplicates,
      total: doc.strokes.length
    };
  } catch (err) {
    return {
      book,
      pageId: pid,
      success: false,
      added: 0,
      duplicates: 0,
      total: 0,
      error: err.message || String(err)
    };
  }
}

/**
 * Export canvas-format strokes (a selection, or a whole visible page) to the
 * graph. Fans out across every page the strokes belong to.
 *
 * @param {Object[]} canvasStrokes - strokes with { pageInfo, dotArray }
 * @returns {Promise<{results: GraphExportPageResult[], orphans:number}>}
 */
export async function exportSelectionToGraph(canvasStrokes) {
  const { groups, orphans } = groupCanvasStrokesByPage(canvasStrokes);

  const results = [];
  for (const group of groups) {
    results.push(
      await exportStoredStrokesToGraphPage({
        book: group.book,
        pageId: group.page,
        page: group.page,
        strokes: group.strokes.map(strokeToStored),
        sourcePageInfo: group.strokes[0]?.pageInfo || null
      })
    );
  }

  return { results, orphans };
}

/**
 * Export an entire saved PageDoc to the graph — the backfill path for pages
 * that were captured before selective export existed, or whole pages the user
 * is happy to publish in full. Still additive and still transcript-free.
 *
 * @param {number} book
 * @param {number|string} pageId
 * @param {import('./page-doc.js').PageDoc} doc - as read from the bridge store
 * @returns {Promise<GraphExportPageResult>}
 */
export async function exportPageDocToGraph(book, pageId, doc) {
  return exportStoredStrokesToGraphPage({
    book,
    pageId,
    page: doc?.pageInfo?.page,
    strokes: doc?.strokes || [],
    sourcePageInfo: doc?.pageInfo || null
  });
}
