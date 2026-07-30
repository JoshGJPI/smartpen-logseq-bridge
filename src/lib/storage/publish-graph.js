/**
 * Graph I/O — read and write the JPI Tools plugin's smartpen assets in a LogSeq
 * graph folder.
 *
 * This module is the low-level transport only: it knows how to read a published
 * asset, and how to write an asset + refresh the discovery manifest. It does NOT
 * decide *what* to publish — that is `graph-export.js`.
 *
 * Files written into the graph (pure filesystem; no LogSeq runtime dependency):
 *
 *   1. <graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-B{book}-P{pageId}.json
 *      — a PageDoc, using the same hybrid serializer as the bridge's own store.
 *   2. <graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-index.json
 *      — the discovery manifest, with this page's entry added/replaced and the
 *        book alias merged (plugin spec §4.6 "page-less" model).
 *
 * `stroke-data/pages/` remains the bridge's authoritative working store. The
 * graph copy is a *curated publication* — an accumulating subset of strokes the
 * user has explicitly chosen to share (see `graph-export.js`), not a mirror.
 *
 * Unlike the pre-v2.3 auto-publish-on-save behaviour, these functions THROW on
 * failure. Export is now a deliberate user action, so a failure must surface as
 * an error rather than a background warning.
 *
 * See plugin spec §6.1 and `tools/migrate-smartpen-assets.mjs`.
 */

import { get } from 'svelte/store';
import { graphRoot } from '$stores/settings.js';
import { bookAliases } from '$stores/book-aliases.js';
import { serializePageDoc } from './page-doc-format.js';
import {
  buildSmartpenIndexEntry,
  upsertSmartpenIndex,
  emptySmartpenIndex
} from './graph-index.js';

function getBackend() {
  if (typeof window === 'undefined' || !window.storageAPI) return null;
  const api = window.storageAPI;
  if (
    typeof api.publishToGraph !== 'function' ||
    typeof api.readGraphIndex !== 'function' ||
    typeof api.readGraphAsset !== 'function'
  ) {
    return null;
  }
  return api;
}

function unwrap(response, action) {
  if (!response) throw new Error(`graph: empty response from ${action}`);
  if (response.ok === false) throw new Error(response.error || `graph: ${action} failed`);
  return response.result;
}

/** Backend present AND a graph folder chosen? */
export function isGraphConfigured() {
  return !!get(graphRoot) && !!getBackend();
}

/** The configured graph root, or throw a user-facing message. */
function requireGraphRoot() {
  const root = get(graphRoot);
  if (!root) {
    throw new Error('No LogSeq graph folder configured — set one in Settings → LogSeq Graph.');
  }
  return root;
}

function requireBackend() {
  const api = getBackend();
  if (!api) throw new Error('Graph storage backend unavailable (not running in Electron?)');
  return api;
}

/**
 * Read a page's currently-published asset from the graph.
 *
 * @param {number|string} book
 * @param {number|string} pageId - page identifier incl. any letter suffix
 * @returns {Promise<import('./page-doc.js').PageDoc|null>} null if never published
 *   or if the file on disk is unparseable (treated as "nothing published yet",
 *   so a corrupt asset can be recovered by simply exporting again).
 */
export async function readGraphPage(book, pageId) {
  const api = requireBackend();
  const root = requireGraphRoot();

  const raw = unwrap(await api.readGraphAsset(root, book, String(pageId)), 'readGraphAsset');
  if (!raw) return null;
  try {
    const doc = JSON.parse(raw);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Write a PageDoc to the graph as `book`/`pageId`, refreshing the manifest.
 * Throws on any failure.
 *
 * @param {number|string} book
 * @param {number|string} pageId
 * @param {import('./page-doc.js').PageDoc} doc - the exact doc to publish
 * @returns {Promise<{assetPath:string, indexPath:string, strokeCount:number}>}
 */
export async function writeGraphPage(book, pageId, doc) {
  const api = requireBackend();
  const root = requireGraphRoot();
  const pid = String(pageId);

  // 1. Read the current manifest (null on first publish / ENOENT).
  const rawIndex = unwrap(await api.readGraphIndex(root), 'readGraphIndex');
  let index;
  if (rawIndex) {
    try {
      index = JSON.parse(rawIndex);
    } catch {
      // A corrupt manifest shouldn't block publishing; start clean. The assets
      // themselves are the data — the manifest is only for discovery.
      index = emptySmartpenIndex();
    }
  } else {
    index = emptySmartpenIndex();
  }

  // 2. Upsert this page's entry + merge the book alias.
  const aliasMap = get(bookAliases) || {};
  const alias = aliasMap[String(book)] ?? aliasMap[book] ?? null;
  const entry = buildSmartpenIndexEntry(doc, book, pid);
  const nextIndex = upsertSmartpenIndex(index, entry, alias);

  // 3. Serialize both files on the renderer side; main just writes them
  //    atomically to the convention paths it computes from book/pageId.
  const assetText = serializePageDoc(doc);
  const indexText = JSON.stringify(nextIndex, null, 2) + '\n';

  const result = unwrap(
    await api.publishToGraph(root, book, pid, assetText, indexText),
    'publishToGraph'
  );

  return { ...result, strokeCount: entry.strokeCount };
}
