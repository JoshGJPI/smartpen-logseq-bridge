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
import { publishPageToGraph } from './publish-graph.js';

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
  const result = unwrap(res, 'savePage');

  // Mirror the saved page into the LogSeq graph if "Publish to graph" is on.
  // This is the single choke point all save paths funnel through (capture save,
  // transcript edits, page-card rewrites), so every persisted change is
  // mirrored. Best-effort: publishPageToGraph never throws — a graph-write
  // failure must not break the authoritative bridge save. `page` here is the
  // bridge's file identifier (integer, or a letter-suffixed pageId like
  // "151b"), which is exactly the asset/manifest identity we want.
  await publishPageToGraph(book, page, doc);

  return result;
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
 * @returns {Promise<Record<number, string>>}
 */
export async function getAliases() {
  const backend = getBackend();
  const res = await backend.getAliases(requireRoot());
  const raw = unwrap(res, 'getAliases');
  // normalize keys to numbers for consumers
  const out = {};
  for (const k of Object.keys(raw || {})) {
    const n = Number(k);
    if (Number.isFinite(n)) out[n] = raw[k];
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
