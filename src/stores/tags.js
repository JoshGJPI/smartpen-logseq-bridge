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
 *
 * The tag manager's changes (rename, merge, delete, reset dismissals) can be
 * undone (v3.2.0): `tagUndo` holds the last one until the next tag change of
 * any kind, and undoTagChange() puts back the pages it changed the same way a
 * failed write is rolled back. Session-only.
 */

import { writable, derived, get } from 'svelte/store';
import {
  normalizeTag, normalizeTagsFile, tagExists, tagKey, withPageList, addTagToKeys, removeTagFromKeys,
  renameTagInMap, deleteTagFromMap, diffTagMaps, rollbackPatch, buildTagIndex, tagStats, planTagCarry
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

/**
 * The last undoable change, or null: `{ label, pages, prevPages, dismissed,
 * prevDismissed }` (the patches it applied and the maps before it). Cleared by
 * any later tag change, an undo, a failed write, or a data-folder change.
 */
export const tagUndo = writable(null);

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
  tagUndo.set(null);
}

/**
 * Apply new maps optimistically and write the difference. With `undoLabel`
 * the change becomes the one Undo puts back; without, it ends any earlier one.
 * @returns {Promise<boolean>}
 */
async function commit(nextPages, nextDismissed, what, undoLabel = null) {
  const prevPages = get(pageTags);
  const prevDismissed = get(dismissedTags);
  const pages = diffTagMaps(prevPages, nextPages);
  const dismissed = diffTagMaps(prevDismissed, nextDismissed);
  if (!Object.keys(pages).length && !Object.keys(dismissed).length) return true;

  pageTags.set(nextPages);
  dismissedTags.set(nextDismissed);
  const undo = undoLabel
    ? { label: undoLabel, pages, prevPages, dismissed, prevDismissed }
    : null;
  tagUndo.set(undo);

  const run = (async () => {
    try {
      const res = await patchTags({ pages, dismissed });
      if (res && res.replacedCorrupt) log('Page tags: replaced the unreadable _tags.json', 'warning');
      return true;
    } catch (err) {
      pageTags.update((m) => rollbackPatch(m, pages, prevPages));
      dismissedTags.update((m) => rollbackPatch(m, dismissed, prevDismissed));
      if (undo && get(tagUndo) === undo) tagUndo.set(null);
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
  const f = normalizeTag(from);
  const t = normalizeTag(to);
  if (!f || !t) return Promise.resolve(false);
  const map = get(pageTags);
  const label = tagExists(map, t) ? `Merged “${f}” into “${t}”` : `Renamed “${f}” to “${t}”`;
  return commit(renameTagInMap(map, f, t), get(dismissedTags), 'the renamed tag', label);
}

/** Merge `from` into `into` (a rename onto an existing tag). */
export function mergeTags(from, into) {
  return renameTag(from, into);
}

/** Remove a tag from every page. Pages themselves are not touched. */
export function deleteTag(tag) {
  const map = get(pageTags);
  const n = Object.values(map).filter((list) => list.includes(normalizeTag(tag))).length;
  return commit(deleteTagFromMap(map, tag), get(dismissedTags), 'tags', `Removed “${normalizeTag(tag)}” from ${n} ${n === 1 ? 'page' : 'pages'}`);
}

/**
 * Stop suggesting a project number on these pages. A dismissal survives
 * re-transcription; Library › Manage tags can reset them all.
 */
export function dismissSuggestion(keys, tag) {
  if (!normalizeTag(tag)) return Promise.resolve(false);
  return commit(get(pageTags), addTagToKeys(get(dismissedTags), keysOf(keys), tag), 'the dismissal');
}

/** Forget every dismissal, so all suggestions come back. */
export function resetDismissed() {
  return commit(get(pageTags), {}, 'the reset', 'Brought back dismissed suggestions');
}

/**
 * Undo the last tag manager change: each page it changed goes back to what it
 * was, unless something has changed that page since (rollbackPatch). In
 * practice nothing has, since any tag change ends the undo. One write.
 * @returns {Promise<boolean>} false when there was nothing to undo or the write failed
 */
export function undoTagChange() {
  const u = get(tagUndo);
  if (!u) return Promise.resolve(false);
  const pages = rollbackPatch(get(pageTags), u.pages, u.prevPages);
  const dismissed = rollbackPatch(get(dismissedTags), u.dismissed, u.prevDismissed);
  return commit(pages, dismissed, 'the undo');
}

/**
 * After a save that moved strokes between volumes: carry the tags (and
 * dismissals) of each page the move emptied onto its one target page, unless
 * the target already has its own (lib/tags.js planTagCarry). A partial move
 * leaves them where they are. Called from ActionBar after finalizePageMoves.
 * @param {Array<{fromBook, fromPage, toBook, toPage}>} moves  finalizePageMoves().emptied
 * @returns {Promise<number>} how many pages' tags moved
 */
export async function carryTagsForMoves(moves) {
  if (!moves || !moves.length) return 0;
  const plan = planTagCarry({ pages: get(pageTags), dismissed: get(dismissedTags) }, moves);
  if (!plan.carried.length && plan.dismissed === get(dismissedTags)) return 0;
  const ok = await commit(plan.pages, plan.dismissed, 'tags for the moved pages');
  return ok ? plan.carried.length : 0;
}

/** A page's tags from a map: `tagsFor($pageTags, book, pageId)`. */
export function tagsFor(map, book, pageId) {
  const key = tagKey(book, pageId);
  return (key && map && map[key]) || [];
}
