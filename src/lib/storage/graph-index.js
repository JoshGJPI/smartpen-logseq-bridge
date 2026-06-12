/**
 * Graph index helpers — the asset-name convention and `smartpen-index.json`
 * manifest logic used by the "Publish to graph" feature.
 *
 * The JPI Tools LogSeq plugin (v1.9.66+) discovers smartpen pages from an index
 * manifest asset rather than from per-page `.md` files (it went "page-less").
 * When the bridge publishes a page it (1) writes the PageDoc verbatim as an
 * asset and (2) adds/replaces that page's entry in the manifest. These pure
 * functions build that manifest; the actual file writes happen in
 * `publish-graph.js` (renderer facade) → IPC (`electron/main.cjs`).
 *
 * Mirrors the reference implementation in the plugin repo
 * (`tools/migrate-smartpen-assets.mjs`) and spec §4.6 / §6.1.
 *
 * Identity = `book` + `pageId` from the bridge's *filename* convention (the
 * same identifier used to write `pages/B{book}/P{pageId}.json`), never the
 * PageDoc's internal `pageInfo` — occasional source files disagree, and keeping
 * identity tied to the filename keeps the index entry, the asset name, and the
 * page name in lockstep.
 */

/** LogSeq plugin id that owns the asset storage sub-folder. */
export const SMARTPEN_PLUGIN_ID = 'logseq-plugin-jpi-tools';

/** Graph-relative folder that holds the smartpen assets + index manifest. */
export const SMARTPEN_ASSETS_REL = `assets/storages/${SMARTPEN_PLUGIN_ID}`;

/** Filename of the discovery manifest inside {@link SMARTPEN_ASSETS_REL}. */
export const SMARTPEN_INDEX_NAME = 'smartpen-index.json';

/**
 * Asset filename for a page. `pageId` preserves any letter suffix (e.g. "151b").
 * @param {number|string} book
 * @param {number|string} pageId
 * @returns {string} e.g. "smartpen-B390-P151b.json"
 */
export function smartpenAssetName(book, pageId) {
  return `smartpen-B${book}-P${pageId}.json`;
}

/**
 * Graph-relative path of a page's asset (forward slashes, LogSeq convention).
 * @param {number|string} book
 * @param {number|string} pageId
 * @returns {string}
 */
export function smartpenAssetRelPath(book, pageId) {
  return `${SMARTPEN_ASSETS_REL}/${smartpenAssetName(book, pageId)}`;
}

/**
 * A fresh, empty index manifest.
 * @returns {{version:number, updatedAt:string|null, aliases:Object, pages:Array}}
 */
export function emptySmartpenIndex() {
  return { version: 1, updatedAt: null, aliases: {}, pages: [] };
}

/**
 * Build the index entry for one page. Identity (`book`, `pageId`) comes from the
 * caller (the filename), not the PageDoc — see module note.
 * @param {import('./page-doc.js').PageDoc} doc
 * @param {number|string} book
 * @param {number|string} pageId
 */
export function buildSmartpenIndexEntry(doc, book, pageId) {
  const pid = String(pageId);
  // Integer page number for sorting/labels: strip a trailing letter suffix,
  // fall back to the doc's own page number, then 0.
  const pageNum = Number(pid.replace(/[a-z]+$/i, '')) || doc?.pageInfo?.page || 0;
  return {
    book: Number(book),
    page: pageNum,
    pageId: pid,
    strokeCount: (doc?.strokes || []).length,
    transcriptLines: (doc?.transcript?.lines || []).length,
    bounds: doc?.metadata?.bounds,
    section: doc?.pageInfo?.section,
    owner: doc?.pageInfo?.owner,
    lastUpdated: doc?.metadata?.lastUpdated
  };
}

/**
 * Coerce an arbitrary parsed value into a well-formed index shape, defensively
 * (a hand-edited or partially-written manifest shouldn't crash a save).
 */
function normalizeIndex(index) {
  const base = index && typeof index === 'object' ? index : {};
  return {
    version: 1,
    updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : null,
    aliases: base.aliases && typeof base.aliases === 'object' ? { ...base.aliases } : {},
    pages: Array.isArray(base.pages) ? [...base.pages] : []
  };
}

/**
 * Add or replace a page's entry in the manifest and merge its book alias.
 * Returns a NEW index object (does not mutate the input); pages are sorted by
 * book then page number, `updatedAt` is bumped.
 *
 * @param {Object} index - existing manifest (or null/garbage — normalized)
 * @param {ReturnType<typeof buildSmartpenIndexEntry>} entry
 * @param {string|null} [alias] - friendly book name to merge (ignored if blank)
 * @returns {{version:number, updatedAt:string, aliases:Object, pages:Array}}
 */
export function upsertSmartpenIndex(index, entry, alias = null) {
  const next = normalizeIndex(index);
  const book = Number(entry.book);
  const pageId = String(entry.pageId);

  next.pages = next.pages.filter(
    (e) => !(Number(e.book) === book && String(e.pageId) === pageId)
  );
  next.pages.push(entry);
  next.pages.sort((a, b) =>
    a.book !== b.book ? a.book - b.book : (a.page || 0) - (b.page || 0)
  );

  if (alias != null && String(alias).trim() !== '') {
    next.aliases[String(book)] = String(alias);
  }

  next.version = 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
