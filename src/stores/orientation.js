/**
 * Orientation Store — which pages are shown turned, because they were written
 * with the notebook sideways.
 *
 * `{ "<bookKey>/<pageId>": 90 | 180 | 270 }`, portrait by absence. Persisted to
 * `<dataRoot>/pages/_orientation.json` through IPC, like `_aliases.json` and
 * `_volumes.json`. Display-only: no stroke or PageDoc is touched, and a change
 * is not an unsaved edit (it is written straight away).
 *
 * Views read it with `rotationFor($pageOrientations, book, pageId)` and apply
 * the turn as one transform (see lib/page-orientation.js).
 */

import { writable, get } from 'svelte/store';
import { normalizeOrientations, normalizeRotation, orientationKey } from '../lib/page-orientation.js';
import { getOrientation, setOrientation } from '../lib/storage/local-store.js';
import { log } from './ui.js';

export const pageOrientations = writable({});

/**
 * Load the sidecar. A missing data folder, a missing file or a corrupt one all
 * leave every page portrait.
 */
export async function loadOrientations() {
  try {
    const raw = await getOrientation();
    pageOrientations.set(normalizeOrientations(raw));
    return true;
  } catch (err) {
    console.warn('[orientation] load skipped:', err?.message || err);
    pageOrientations.set({});
    return false;
  }
}

/**
 * Set a page's rotation and persist it. Applied to the store first so the views
 * turn at once; rolled back if the write fails.
 *
 * @param {string} book  book key
 * @param {string|number} pageId
 * @param {number} rotation  clockwise degrees; 0 = portrait
 * @returns {Promise<boolean>}
 */
export async function setPageRotation(book, pageId, rotation) {
  const key = orientationKey(book, pageId);
  if (!key) {
    log(`Can't rotate page ${book}/${pageId}: not a valid page`, 'error');
    return false;
  }
  const r = normalizeRotation(rotation);
  const before = get(pageOrientations);
  if ((before[key] || 0) === r) return true;

  const next = { ...before };
  if (r === 0) delete next[key];
  else next[key] = r;
  pageOrientations.set(next);

  try {
    const saved = await setOrientation(String(book), String(pageId), r);
    pageOrientations.set(normalizeOrientations(saved));
    return true;
  } catch (err) {
    pageOrientations.set(before);
    log(`Could not save page rotation: ${err?.message || err}`, 'error');
    return false;
  }
}
