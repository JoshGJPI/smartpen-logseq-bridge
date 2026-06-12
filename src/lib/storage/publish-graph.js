/**
 * Publish to graph — mirror a saved PageDoc into a LogSeq graph folder so the
 * JPI Tools plugin can render it.
 *
 * When the user enables "Publish to LogSeq graph on save" and picks a
 * `graphRoot`, every successful bridge save also writes two files into the
 * graph (pure filesystem; no LogSeq runtime dependency):
 *
 *   1. <graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-B{book}-P{pageId}.json
 *      — the PageDoc verbatim (same hybrid serializer as the bridge's own store).
 *   2. <graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-index.json
 *      — the discovery manifest, with this page's entry added/replaced and the
 *        book alias merged (plugin spec §4.6 "page-less" model).
 *
 * `stroke-data/pages/` stays the bridge's working store; the graph copy is a
 * published mirror. The graph copy is BEST-EFFORT: a publish failure logs a
 * warning but never fails the authoritative bridge save (this module never
 * throws).
 *
 * See plugin spec §6.1 and `tools/migrate-smartpen-assets.mjs` (`--from-clean`
 * does this same write batch-wise).
 */

import { get } from 'svelte/store';
import { log } from '$stores';
import { graphRoot, publishToGraph } from '$stores/settings.js';
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
  if (typeof api.publishToGraph !== 'function' || typeof api.readGraphIndex !== 'function') {
    return null;
  }
  return api;
}

function unwrap(response, action) {
  if (!response) throw new Error(`graph: empty response from ${action}`);
  if (response.ok === false) throw new Error(response.error || `graph: ${action} failed`);
  return response.result;
}

/** Is the feature turned on AND a graph folder chosen? (one-time read) */
export function isGraphPublishEnabled() {
  return !!get(publishToGraph) && !!get(graphRoot);
}

/**
 * Publish a single page to the graph, if enabled. Never throws.
 *
 * @param {number|string} book   - book identifier (matches the bridge filename)
 * @param {number|string} pageId - page identifier incl. any letter suffix
 * @param {import('./page-doc.js').PageDoc} doc - the PageDoc just written to the bridge store
 * @returns {Promise<{skipped:boolean, reason?:string, success?:boolean,
 *   error?:string, assetPath?:string, indexPath?:string}>}
 */
export async function publishPageToGraph(book, pageId, doc) {
  if (!get(publishToGraph)) return { skipped: true, reason: 'disabled' };

  const root = get(graphRoot);
  if (!root) return { skipped: true, reason: 'no-graph-root' };

  const api = getBackend();
  if (!api) return { skipped: true, reason: 'no-backend' };

  const pid = String(pageId);

  try {
    // 1. Read the current manifest (null on first publish / ENOENT).
    const rawIndex = unwrap(await api.readGraphIndex(root), 'readGraphIndex');
    let index;
    if (rawIndex) {
      try {
        index = JSON.parse(rawIndex);
      } catch {
        // A corrupt manifest shouldn't block publishing; start clean.
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

    log(`Published B${book}/P${pid} to graph (${entry.strokeCount} stroke(s))`, 'success');
    return { skipped: false, success: true, ...result };
  } catch (err) {
    log(`Graph publish failed for B${book}/P${pid}: ${err.message}`, 'warning');
    return { skipped: false, success: false, error: err.message || String(err) };
  }
}
