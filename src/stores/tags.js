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
 *
 * `tagInfo` (v3.22.0): each tag's type and details (`{ tag: record }`, the
 * `info` section of the same file, lib/tags.js normalizeTagInfo). It travels
 * in the same patch and the same lock as the pages it goes with: rename, merge
 * and delete carry or drop it in one write, and a failed write rolls it back
 * per tag, like pages.
 *
 * `tagBlocks` (v3.23.0): hand corrections to block scope (`{ pageKey: { tag:
 * { add, remove } } }`, the `blocks` section, lib/tags.js; read by
 * lib/tag-scope.js). Same patch, same lock, same per-page rollback; a rename,
 * merge, delete or volume carry moves or drops a tag's entries in the same
 * write as its pages.
 */

import { writable, derived, get } from 'svelte/store';
import {
  normalizeTag, normalizeTagsFile, renameIsMerge, tagKey, withPageList, addTagToKeys, removeTagFromKeys,
  renameTagInMap, deleteTagFromMap, diffTagMaps, rollbackPatch, buildTagIndex, tagStats, planTagCarry,
  withTagInfo, withTagType, renameTagInfo, deleteTagInfo, diffTagInfo, rollbackInfoPatch,
  renameTagBlocks, deleteTagBlocks, diffTagBlocks, rollbackBlocksPatch, withBlockRoot, withoutBlockRoot,
  dropBlocksForUntagged
} from '../lib/tags.js';
import { getTags, patchTags } from '../lib/storage/local-store.js';
import { debug } from '../lib/debug.js';
import { log } from './ui.js';

export const pageTags = writable({});
export const dismissedTags = writable({});
/** Tag types and details (v3.22.0): `{ "<tag>": record }`; no entry = a plain tag (Topic, or Project by pattern). */
export const tagInfo = writable({});
/** Block-scope corrections (v3.23.0): `{ "<pageKey>": { "<tag>": { add?, remove? } } }`; no entry = scope from text alone. */
export const tagBlocks = writable({});

/** tag → page keys; rebuilt once per change, never per render. */
export const tagIndex = derived(pageTags, ($tags) => buildTagIndex($tags));

/** `[{ tag, pages, notebooks }]`, most-used first, from the sidecar alone. */
export const tagStatsList = derived(pageTags, ($tags) => tagStats($tags));

/**
 * The last undoable change, or null: `{ label, pages, prevPages, dismissed,
 * prevDismissed, info, prevInfo }` (the patches it applied and the maps before it). Cleared by
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
    const { pages, dismissed, info, blocks } = normalizeTagsFile(raw);
    pageTags.set(pages);
    dismissedTags.set(dismissed);
    tagInfo.set(info);
    tagBlocks.set(blocks);
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
  tagInfo.set({});
  tagBlocks.set({});
  tagUndo.set(null);
}

/**
 * Apply new maps optimistically and write the difference: pages, dismissals,
 * info and block corrections in one patch, so one locked write. Each of `next`'s
 * maps defaults to the map as it is. With `undoLabel` the change becomes the one
 * Undo puts back; without, it ends any earlier one.
 * @param {{pages?: object, dismissed?: object, info?: object, blocks?: object}} next
 * @returns {Promise<boolean>}
 */
async function commit(next, what, undoLabel = null) {
  const prevPages = get(pageTags);
  const prevDismissed = get(dismissedTags);
  const prevInfo = get(tagInfo);
  const prevBlocks = get(tagBlocks);
  const nextPages = next.pages || prevPages;
  const nextDismissed = next.dismissed || prevDismissed;
  const nextInfo = next.info || prevInfo;
  // A tag leaving a page takes its block corrections there with it, in this same write (v3.23.0).
  const nextBlocks = dropBlocksForUntagged(next.blocks || prevBlocks, prevPages, nextPages);
  const pages = diffTagMaps(prevPages, nextPages);
  const dismissed = diffTagMaps(prevDismissed, nextDismissed);
  const info = diffTagInfo(prevInfo, nextInfo);
  const blocks = diffTagBlocks(prevBlocks, nextBlocks);
  if (![pages, dismissed, info, blocks].some((m) => Object.keys(m).length)) return true;

  pageTags.set(nextPages);
  dismissedTags.set(nextDismissed);
  tagInfo.set(nextInfo);
  tagBlocks.set(nextBlocks);
  const undo = undoLabel
    ? { label: undoLabel, pages, prevPages, dismissed, prevDismissed, info, prevInfo, blocks, prevBlocks }
    : null;
  tagUndo.set(undo);

  const patch = { pages, dismissed };
  if (Object.keys(info).length) patch.info = info;
  if (Object.keys(blocks).length) patch.blocks = blocks;
  const run = (async () => {
    try {
      const res = await patchTags(patch);
      if (res && res.replacedCorrupt) log('Page tags: replaced the unreadable _tags.json', 'warning');
      return true;
    } catch (err) {
      pageTags.update((m) => rollbackPatch(m, pages, prevPages));
      dismissedTags.update((m) => rollbackPatch(m, dismissed, prevDismissed));
      tagInfo.update((m) => rollbackInfoPatch(m, info, prevInfo));
      tagBlocks.update((m) => rollbackBlocksPatch(m, blocks, prevBlocks));
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
 * The info to write beside a tag being added (v3.22.0): with `typeAs` (the tag
 * input's "Add as Person", `{ tag, type, label }`) that tag's type and label
 * are set in the SAME patch as the page lists, so the page and the person land
 * or fail together. Only for a tag the new lists actually carry.
 */
function infoForAdd(pages, typeAs) {
  const info = get(tagInfo);
  if (!typeAs) return info;
  const t = normalizeTag(typeAs.tag);
  if (!t || !Object.values(pages).some((list) => list.includes(t))) return info;
  return withTagType(info, t, typeAs.type, typeAs.label || '');
}

/**
 * Replace one page's tags.
 * @param {string} book  book key
 * @param {string|number} pageId
 * @param {string[]} tags
 * @param {{typeAs?: {tag: string, type: 'person'|'topic', label?: string}}} [opts]
 *   v3.22.0: a new tag's type, written in the same patch
 */
export function setPageTagList(book, pageId, tags, { typeAs = null } = {}) {
  const key = tagKey(book, pageId);
  if (!key) {
    log(`Can't tag page ${book}/${pageId}: not a valid page`, 'error');
    return Promise.resolve(false);
  }
  const pages = withPageList(get(pageTags), key, tags);
  return commit({ pages, info: infoForAdd(pages, typeAs) }, 'the page’s tags', untagLabel(pages));
}

/**
 * An Undo label when a change drops block corrections (a tag leaving a page
 * that had them, v3.23.0), so Undo can bring them back; else null (a plain
 * untag stays not undoable, as before).
 */
function untagLabel(pages) {
  const blocks = get(tagBlocks);
  if (dropBlocksForUntagged(blocks, get(pageTags), pages) === blocks) return null;
  const prev = get(pageTags);
  const gone = new Set();
  let n = 0;
  for (const key of Object.keys(blocks)) {
    const lost = Object.keys(blocks[key]).filter((t) => (prev[key] || []).includes(t) && !(pages[key] || []).includes(t));
    if (lost.length) n++;
    for (const t of lost) gone.add(t);
  }
  return `Removed ${[...gone].map((t) => `“${t}”`).join(', ')} and its block corrections from ${n} ${n === 1 ? 'page' : 'pages'}`;
}

/**
 * Add a tag to many pages in one write. @param {string[]} keys page keys
 * @param {{typeAs?: object}} [opts]  as setPageTagList
 */
export function addTagToPages(keys, tag, { typeAs = null } = {}) {
  if (!normalizeTag(tag)) return Promise.resolve(false);
  const pages = addTagToKeys(get(pageTags), keysOf(keys), tag);
  return commit({ pages, info: infoForAdd(pages, typeAs) }, 'tags');
}

/** Remove a tag from many pages in one write. */
export function removeTagFromPages(keys, tag) {
  const pages = removeTagFromKeys(get(pageTags), keysOf(keys), tag);
  return commit({ pages }, 'tags', untagLabel(pages));
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
  // A merge whenever the target is on a page OR has details of its own (v3.22.0):
  // the same rule as the tag manager's confirm (lib/tags.js renameIsMerge).
  const exists = renameIsMerge(map, get(tagInfo), t);
  const label = exists ? `Merged “${f}” into “${t}”` : `Renamed “${f}” to “${t}”`;
  return commit({
    pages: renameTagInMap(map, f, t),
    info: renameTagInfo(get(tagInfo), f, t, exists),
    blocks: renameTagBlocks(get(tagBlocks), f, t)
  }, 'the renamed tag', label);
}

/** Merge `from` into `into` (a rename onto an existing tag). */
export function mergeTags(from, into) {
  return renameTag(from, into);
}

/**
 * Remove a tag from every page, and its details. Pages themselves are not
 * touched. A tag on no page (only details kept, v3.22.0) just loses its details.
 */
export function deleteTag(tag) {
  const map = get(pageTags);
  const t = normalizeTag(tag);
  const n = Object.values(map).filter((list) => list.includes(t)).length;
  const label = n ? `Removed “${t}” from ${n} ${n === 1 ? 'page' : 'pages'}` : `Removed the details of “${t}”`;
  return commit({
    pages: deleteTagFromMap(map, tag),
    info: deleteTagInfo(get(tagInfo), tag),
    blocks: deleteTagBlocks(get(tagBlocks), tag)
  }, 'tags', label);
}

/**
 * Replace a tag's details (v3.22.0, Manage tags → Details): one record,
 * normalized by lib/tags.js; null or an empty record removes it. Written at
 * once, rolled back if the write fails.
 */
export function setTagInfo(tag, record) {
  const t = normalizeTag(tag);
  if (!t || t !== tag) return Promise.resolve(false);
  return commit({ info: withTagInfo(get(tagInfo), t, record) }, 'the tag’s details');
}

/**
 * Make a keyword a Person or a Topic (v3.22.0). A project number's type is
 * fixed and nothing becomes a project: those come back false, unwritten.
 * `label` is the display name to store when the tag has none yet.
 */
export function setTagType(tag, type, label = '') {
  const t = normalizeTag(tag);
  const cur = get(tagInfo);
  if (!t || t !== tag) return Promise.resolve(false);
  const next = withTagType(cur, t, type, label);
  if (next === cur) return Promise.resolve(false);
  return commit({ info: next }, 'the tag’s type');
}

/**
 * Stop suggesting a project number on these pages. A dismissal survives
 * re-transcription; Library › Manage tags can reset them all.
 */
export function dismissSuggestion(keys, tag) {
  if (!normalizeTag(tag)) return Promise.resolve(false);
  return commit({ dismissed: addTagToKeys(get(dismissedTags), keysOf(keys), tag) }, 'the dismissal');
}

/** Forget every dismissal, so all suggestions come back. */
export function resetDismissed() {
  return commit({ dismissed: {} }, 'the reset', 'Brought back dismissed suggestions');
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
  const info = rollbackInfoPatch(get(tagInfo), u.info, u.prevInfo);
  const blocks = rollbackBlocksPatch(get(tagBlocks), u.blocks, u.prevBlocks);
  return commit({ pages, dismissed, info, blocks }, 'the undo');
}

/**
 * After a save that moved strokes between volumes: carry the tags (and
 * dismissals and block corrections) of each page the move emptied onto its one target page, unless
 * the target already has its own (lib/tags.js planTagCarry). A partial move
 * leaves them where they are. Called from ActionBar after finalizePageMoves.
 * @param {Array<{fromBook, fromPage, toBook, toPage}>} moves  finalizePageMoves().emptied
 * @returns {Promise<number>} how many pages' tags moved
 */
export async function carryTagsForMoves(moves) {
  if (!moves || !moves.length) return 0;
  const plan = planTagCarry({ pages: get(pageTags), dismissed: get(dismissedTags), blocks: get(tagBlocks) }, moves);
  if (!plan.carried.length && plan.dismissed === get(dismissedTags) && plan.blocks === get(tagBlocks)) return 0;
  const ok = await commit({ pages: plan.pages, dismissed: plan.dismissed, blocks: plan.blocks }, 'tags for the moved pages');
  return ok ? plan.carried.length : 0;
}

/**
 * "Tag this block…" (v3.23.0, D.4): make line `lineId` a root of `tag` on the
 * page, adding the tag to the page first when it is missing, in ONE write.
 * `byText`: the line already names the tag (it only stops being removed).
 * `typeAs` as setPageTagList (a new tag added as a Person).
 */
export function tagBlock(book, pageId, tag, lineId, { byText = false, typeAs = null } = {}) {
  const key = tagKey(book, pageId);
  const t = normalizeTag(tag);
  if (!key || !t || !lineId) return Promise.resolve(false);
  const cur = get(pageTags)[key] || [];
  const pages = cur.includes(t) ? get(pageTags) : withPageList(get(pageTags), key, [...cur, t]);
  return commit({
    pages,
    info: infoForAdd(pages, typeAs),
    blocks: withBlockRoot(get(tagBlocks), key, t, lineId, byText)
  }, 'the block’s tag');
}

/**
 * "Not this person" (v3.23.0, D.4): line `lineId` stops being a root of `tag`
 * on the page (an added root is dropped; a root by its text is removed). The
 * page keeps the tag.
 */
export function untagBlock(book, pageId, tag, lineId, { byText = false } = {}) {
  const key = tagKey(book, pageId);
  const t = normalizeTag(tag);
  if (!key || !t || !lineId) return Promise.resolve(false);
  return commit({ blocks: withoutBlockRoot(get(tagBlocks), key, t, lineId, byText) }, 'the block correction');
}

/** A page's tags from a map: `tagsFor($pageTags, book, pageId)`. */
export function tagsFor(map, book, pageId) {
  const key = tagKey(book, pageId);
  return (key && map && map[key]) || [];
}
