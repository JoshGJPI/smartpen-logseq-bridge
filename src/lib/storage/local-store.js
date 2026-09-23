/**
 * Local Store — renderer-side facade over the storage backend.
 *
 * In the Electron build this delegates to window.storageAPI (IPC handlers in
 * electron/main.cjs). A future File System Access API backend could plug in
 * here without changes to callers.
 *
 * See docs/LOCAL-STORAGE-PIVOT-SPEC.md for the design.
 */

import { get } from 'svelte/store';
import { dataRoot } from '$stores/settings.js';
import { PAGE_DOC_VERSION, emptyPageDoc, computeBounds, validatePageDoc } from './page-doc.js';

export { PAGE_DOC_VERSION, emptyPageDoc, computeBounds, validatePageDoc };

/**
 * Throw if the storage backend isn't available in this runtime
 * (e.g. running in the browser without Electron).
 */
function getBackend() {
  if (typeof window === 'undefined' || !window.storageAPI) {
    throw new Error('Local storage backend is not available (Electron only in v2.0).');
  }
  return window.storageAPI;
}

/**
 * Unwrap the { ok, result } | { ok: false, error } envelope used by the IPC layer.
 */
function unwrap(response, action) {
  if (!response) throw new Error(`storage: empty response from ${action}`);
  if (response.ok === false) throw new Error(response.error || `storage: ${action} failed`);
  return response.result;
}

/**
 * Read the current data root from settings. Throws if unset.
 */
function requireRoot() {
  const root = get(dataRoot);
  if (!root || typeof root !== 'string') {
    throw new Error('No data folder selected. Pick one in Settings.');
  }
  return root;
}

/* ============================================================
 *  Folder & availability
 * ============================================================ */

export async function pickFolder() {
  const backend = getBackend();
  const res = await backend.pickFolder();
  return unwrap(res, 'pickFolder');
}

export async function isAvailable(root = null) {
  const backend = getBackend();
  const r = root ?? get(dataRoot);
  if (!r) return false;
  const res = await backend.isAvailable(r);
  return unwrap(res, 'isAvailable');
}

export async function openInExplorer(root = null) {
  const backend = getBackend();
  const r = root ?? requireRoot();
  const res = await backend.openInExplorer(r);
  return unwrap(res, 'openInExplorer');
}

/* ============================================================
 *  Pages
 * ============================================================ */

/**
 * @returns {Promise<import('./page-doc.js').PageMeta[]>}
 */
export async function listPages() {
  const backend = getBackend();
  const res = await backend.listPages(requireRoot());
  return unwrap(res, 'listPages');
}

/**
 * @returns {Promise<import('./page-doc.js').PageDoc|null>}
 */
export async function getPage(book, page) {
  const backend = getBackend();
  const res = await backend.getPage(requireRoot(), book, page);
  return unwrap(res, 'getPage');
}

/**
 * @param {number} book
 * @param {number} page
 * @param {import('./page-doc.js').PageDoc} doc
 * @returns {Promise<import('./page-doc.js').SaveResult>}
 */
export async function savePage(book, page, doc) {
  const backend = getBackend();
  const issues = validatePageDoc(doc);
  if (issues.length) {
    throw new Error(`PageDoc validation failed: ${issues.join('; ')}`);
  }
  const res = await backend.savePage(requireRoot(), book, page, doc);

  // NOTE: saving does NOT publish to the LogSeq graph. Before v2.3 this was the
  // choke point that mirrored every save into the graph, which made the graph a
  // full digital twin of the notebook — private notes included. Publishing is
  // now an explicit, additive, opt-in action per selection: see
  // `graph-export.js` (`exportSelectionToGraph` / `exportPageDocToGraph`).
  return unwrap(res, 'savePage');
}

export async function deletePage(book, page) {
  const backend = getBackend();
  const res = await backend.deletePage(requireRoot(), book, page);
  return unwrap(res, 'deletePage');
}

/* ============================================================
 *  Aliases
 * ============================================================ */

/**
 * Aliases are keyed by **book key** — "388" or "388v2" — so each volume can
 * carry its own name.
 *
 * Keys pass through as written. This used to coerce them with `Number()`, which
 * meant `Number("388v2")` → NaN silently dropped every volume alias on each
 * scan; it also disagreed with main.cjs (which writes `String(book)`) and with
 * `knownBookIds` (strings), which is why publish-graph.js had to hedge with
 * `aliasMap[String(book)] ?? aliasMap[book]`. Strings everywhere now.
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function getAliases() {
  const backend = getBackend();
  const res = await backend.getAliases(requireRoot());
  const raw = unwrap(res, 'getAliases');
  const out = {};
  for (const k of Object.keys(raw || {})) {
    out[String(k)] = raw[k];
  }
  return out;
}

export async function setAlias(book, alias) {
  const backend = getBackend();
  const res = await backend.setAlias(requireRoot(), book, alias);
  return unwrap(res, 'setAlias');
}

export async function removeAlias(book) {
  const backend = getBackend();
  const res = await backend.removeAlias(requireRoot(), book);
  return unwrap(res, 'removeAlias');
}

/* ============================================================
 *  Capture-date index
 * ============================================================ */

/**
 * The capture-date index: `{ version, builtAt, pages: { "<book>/<pageId>": entry } }`,
 * each entry carrying `{ book, page, pageId, suffix, strokes, firstStroke,
 * lastStroke, days: { "YYYY-MM-DD": count } }`.
 *
 * Built and cached in the main process (`pages/_timeline.json`) — see
 * `buildTimeline` in electron/main.cjs for why capture date needs its own index
 * rather than riding on `metadata.lastUpdated`. Day keys are LOCAL calendar days.
 *
 * Entries are histograms, never strokes: the whole index for a ~300-page corpus
 * is a few tens of KB, so holding it resident costs nothing.
 *
 * @param {{force?: boolean}} [options] force re-reads every page file
 * @returns {Promise<{version:number, builtAt:string, pages:Record<string, Object>}>}
 */
export async function getTimelineIndex(options = {}) {
  const backend = getBackend();
  const res = await backend.getTimeline(requireRoot(), options);
  return unwrap(res, 'getTimeline');
}

/* ============================================================
 *  Volumes
 * ============================================================ */

/**
 * The volume registry: `{ version, active: { "<ncodeBook>": <volume> } }`.
 * An absent file reads as `{ active: {} }` — every book is volume 1.
 * @returns {Promise<{version: number, active: Record<string, number>}>}
 */
export async function getVolumes() {
  const backend = getBackend();
  const res = await backend.getVolumes(requireRoot());
  return unwrap(res, 'getVolumes');
}

/**
 * Point an NCode book's capture at a volume. Volume 1 clears the entry.
 * @param {number} ncodeBook
 * @param {number} volume
 */
export async function setActiveVolume(ncodeBook, volume) {
  const backend = getBackend();
  const res = await backend.setActiveVolume(requireRoot(), ncodeBook, volume);
  return unwrap(res, 'setActiveVolume');
}
