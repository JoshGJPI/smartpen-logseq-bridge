/**
 * Tags Store — keywords and project numbers on pages (v3.1.0).
 *
 * `pageTags`: `{ "<bookKey>/<pageId>": ["P2026-141", "beam"] }`, untagged by
 * absence. `dismissedTags`: project-number suggestions the user turned down,
 * per page. Persisted to `<dataRoot>/pages/_tags.json` through IPC, like
 * `_orientation.json` (stores/orientation.js is the pattern). Display
 * metadata: no PageDoc is read or written, a change is not an unsaved edit
 * (no markUnsavedChanges, no save dialog) and needs no refreshAfterSave; every
 * view reads these stores, so they all update at once.
 *
 * Every edit is worked out in lib/tags.js (map → map), applied here first, and
 * sent to main as a patch of the pages it changed. The store, not the write's
 * reply, is the truth: a failed write rolls back only the pages it changed,
 * and only where nothing has changed them since, and says so in the Activity
 * Log.
 */

import { writable, derived, get } from 'svelte/store';
import {
  normalizeTag, normalizeTagsFile, tagKey, withPageList, addTagToKeys, removeTagFromKeys,
  renameTagInMap, deleteTagFromMap, diffTagMaps, rollbackPatch, buildTagIndex, tagStats
} from '../lib/tags.js';
import { getTags, patchTags } from '../lib/storage/local-store.js';
import { debug } from '../lib/debug.js';
import { log } from './ui.js';

export const pageTags = writable({});
export const dismissedTags = writable({});

/** tag → page keys; rebuilt once per change, never per render. */
export const tagIndex = derived(pageTags, ($tags) => buildTagIndex($tags));

/** `[{ tag, pages, notebooks }]`, most-used first, from the sidecar alone. */
export const tagStatsList = derived(pageTags, ($tags) => tagStats($tags));

// Writes in flight. A reload waits for them, so a Rescan straight after a tag
// change cannot read the file before that change is in it.
let writes = Promise.resolve();

/**
 * Load the sidecar. A missing data folder, file, or a corrupt one all mean no
 * tags and no dismissals; a corrupt file is left on disk until the next change
 * replaces it.
 */
export async function loadTags() {
  await writes;
  try {
    const raw = await getTags();
    const { pages, dismissed } = normalizeTagsFile(raw);
    pageTags.set(pages);
    dismissedTags.set(dismissed);
    if (raw && raw.state === 'corrupt') {
      log('Page tags: _tags.json is unreadable, so no tags are shown. The next tag change replaces it.', 'warning');
    } else if (raw && raw.state === 'newer') {
      log(`Page tags: _tags.json is from a newer version of the app (v${raw.version}); tags can't be changed.`, 'warning');
    }
    debug('[tags] loaded', Object.keys(pages).length, 'tagged pages');
    return true;
  } catch (err) {
    console.warn('[tags] load skipped:', err?.message || err);
    clearTags();
    return false;
  }
}

/** Forget every tag (data-folder change, before the new folder loads). */
export function clearTags() {
  pageTags.set({});
  dismissedTags.set({});
}

/**
 * Apply new maps optimistically and write the difference.
 * @returns {Promise<boolean>}
 */
async function commit(nextPages, nextDismissed, what) {
  const prevPages = get(pageTags);
  const prevDismissed = get(dismissedTags);
  const pages = diffTagMaps(prevPages, nextPages);
  const dismissed = diffTagMaps(prevDismissed, nextDismissed);
  if (!Object.keys(pages).length && !Object.keys(dismissed).length) return true;

  pageTags.set(nextPages);
  dismissedTags.set(nextDismissed);

  const run = (async () => {
    try {
      const res = await patchTags({ pages, dismissed });
      if (res && res.replacedCorrupt) log('Page tags: replaced the unreadable _tags.json', 'warning');
      return true;
    } catch (err) {
      pageTags.update((m) => rollbackPatch(m, pages, prevPages));
      dismissedTags.update((m) => rollbackPatch(m, dismissed, prevDismissed));
      log(`Could not save ${what}: ${err?.message || err}`, 'error');
      return false;
    }
  })();
  writes = writes.then(() => run);
  return run;
}

const keysOf = (keys) => [...new Set([...(keys || [])].filter(Boolean))];

/**
 * Replace one page's tags.
 * @param {string} book  book key
 * @param {string|number} pageId
 * @param {string[]} tags
 */
export function setPageTagList(book, pageId, tags) {
  const key = tagKey(book, pageId);
  if (!key) {
    log(`Can't tag page ${book}/${pageId}: not a valid page`, 'error');
    return Promise.resolve(false);
  }
  return commit(withPageList(get(pageTags), key, tags), get(dismissedTags), 'the page’s tags');
}

/** Add a tag to many pages in one write. @param {string[]} keys page keys */
export function addTagToPages(keys, tag) {
  if (!normalizeTag(tag)) return Promise.resolve(false);
  return commit(addTagToKeys(get(pageTags), keysOf(keys), tag), get(dismissedTags), 'tags');
}

/** Remove a tag from many pages in one write. */
export function removeTagFromPages(keys, tag) {
  return commit(removeTagFromKeys(get(pageTags), keysOf(keys), tag), get(dismissedTags), 'tags');
}

/**
 * Rename a tag on every page. Onto an existing name it is a merge (ask first:
 * the UI does). Dismissals are untouched.
 */
export function renameTag(from, to) {
  if (!normalizeTag(from) || !normalizeTag(to)) return Promise.resolve(false);
  return commit(renameTagInMap(get(pageTags), from, to), get(dismissedTags), 'the renamed tag');
}

/** Merge `from` into `into` (a rename onto an existing tag). */
export function mergeTags(from, into) {
  return renameTag(from, into);
}

/** Remove a tag from every page. Pages themselves are not touched. */
export function deleteTag(tag) {
  return commit(deleteTagFromMap(get(pageTags), tag), get(dismissedTags), 'tags');
}

/**
 * Stop suggesting a project number on these pages. A dismissal survives
 * re-transcription; Settings → Tags can reset them all.
 */
export function dismissSuggestion(keys, tag) {
  if (!normalizeTag(tag)) return Promise.resolve(false);
  return commit(get(pageTags), addTagToKeys(get(dismissedTags), keysOf(keys), tag), 'the dismissal');
}

/** Forget every dismissal, so all suggestions come back. */
export function resetDismissed() {
  return commit(get(pageTags), {}, 'the reset');
}

/** A page's tags from a map: `tagsFor($pageTags, book, pageId)`. */
export function tagsFor(map, book, pageId) {
  const key = tagKey(book, pageId);
  return (key && map && map[key]) || [];
}
