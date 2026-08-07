/**
 * Volumes Store — which physical notebook new strokes belong to.
 *
 * NCode can't tell two identical notebooks apart, so the app has to: each NCode
 * book has an **active volume**, and strokes arriving from the pen are stamped
 * with the matching book key ("388" for volume 1, "388v2" for volume 2) before
 * they reach the strokes store.
 *
 * Persisted to `<dataRoot>/pages/_volumes.json`. An absent file means every book
 * is volume 1, which is byte-identical to how the app behaved before volumes
 * existed — that is the entire migration story.
 *
 * Volume *names* are not here: they live in `_aliases.json` keyed by book key,
 * so "388v2" gets its own name through the existing Book Aliases UI.
 *
 * See docs/VOLUMES-SPEC.md and src/lib/volumes.js (the pure mapping).
 */

import { writable, derived, get } from 'svelte/store';
import { makeBookKey, pageInfoWithBookKey, parseBookKey } from '../lib/volumes.js';
import { getVolumes, setActiveVolume as persistActiveVolume } from '../lib/storage/local-store.js';
import { log } from './ui.js';

/** `{ version, active: { "<ncodeBook>": volume } }` — volume 1 recorded by absence. */
export const volumeRegistry = writable({ version: 1, active: {} });

/** Just the routing map, for components. */
export const activeVolumes = derived(volumeRegistry, ($r) => $r.active || {});

/** True when any book has been given a second volume — gates the UI. */
export const hasVolumes = derived(activeVolumes, ($a) => Object.keys($a).length > 0);

/**
 * The volume new strokes from this NCode book route to. Defaults to 1.
 * @param {number|string} ncodeBook
 * @returns {number}
 */
export function activeVolumeFor(ncodeBook) {
  const n = Number(ncodeBook);
  if (!Number.isInteger(n)) return 1;
  const v = get(volumeRegistry).active?.[String(n)];
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * Stamp a raw pen `pageInfo` with the book key for its active volume.
 *
 * This is the single boundary between "what the pen reported" and "what the app
 * stores". Applied in `addStroke`/`addOfflineStrokes` and on the live-preview dot
 * paths — deliberately NOT further upstream in pen-sdk.js, where `pageInfo.book`
 * is still used for transfer matching and pen-memory bookkeeping and must stay
 * the raw NCode id.
 *
 * Idempotent: a pageInfo that already carries `volume` has been through here (or
 * came off disk) and is returned untouched, so re-adding a stroke can't demote a
 * volume-2 page back to volume 1.
 *
 * @param {Object} pageInfo
 * @returns {Object} the same object when nothing changes, else a new one
 */
export function applyActiveVolume(pageInfo) {
  if (!pageInfo || pageInfo.volume != null) return pageInfo;

  const n = Number(pageInfo.book);
  if (!Number.isInteger(n)) return pageInfo;

  const volume = activeVolumeFor(n);
  const bookKey = makeBookKey(n, volume);
  if (!bookKey) return pageInfo;

  return pageInfoWithBookKey(pageInfo, bookKey);
}

/** Load the registry from disk. Safe to call when no data folder is set. */
export async function loadVolumes() {
  try {
    const registry = await getVolumes();
    volumeRegistry.set({
      version: registry?.version || 1,
      active: registry?.active || {}
    });
    const count = Object.keys(registry?.active || {}).length;
    if (count > 0) log(`Loaded volume routing for ${count} book(s)`, 'info');
    return true;
  } catch (err) {
    // No data folder yet, or no _volumes.json — both mean "everything is volume 1".
    console.warn('[volumes] load skipped:', err.message);
    return false;
  }
}

/**
 * Point an NCode book's capture at a volume, and persist it.
 * @param {number|string} ncodeBook
 * @param {number} volume
 */
export async function setActiveVolume(ncodeBook, volume) {
  const n = Number(ncodeBook);
  const v = Number(volume);
  if (!Number.isInteger(n) || !Number.isInteger(v) || v < 1) {
    log(`Invalid volume selection: book ${ncodeBook}, volume ${volume}`, 'error');
    return false;
  }

  try {
    const registry = await persistActiveVolume(n, v);
    volumeRegistry.set({
      version: registry?.version || 1,
      active: registry?.active || {}
    });
    log(`New strokes from book ${n} will be saved as Volume ${v}`, 'success');
    return true;
  } catch (err) {
    log(`Could not set volume: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Every volume known for an NCode book — the ones with pages on disk, the active
 * one, and always volume 1. Sorted. Drives the volume pickers.
 *
 * @param {number|string} ncodeBook
 * @param {string[]} knownBookKeys book keys seen on disk / in session
 * @returns {number[]}
 */
export function volumesForBook(ncodeBook, knownBookKeys = []) {
  const n = Number(ncodeBook);
  const found = new Set([1, activeVolumeFor(n)]);
  for (const key of knownBookKeys) {
    const parsed = parseBookKey(key);
    if (parsed && parsed.ncodeBook === n) found.add(parsed.volume);
  }
  return [...found].sort((a, b) => a - b);
}
