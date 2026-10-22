/**
 * Retimed Store — pen ids the Editor has retimed away (v3.6.0).
 *
 * `retimedPages`: the `pages` of `<dataRoot>/pages/_retimed.json`,
 * `{ "<ncodeBook>/<page>": { "s<penId>": "s<idNow>" } }`. Offline import reads
 * it to drop pen strokes whose retimed copy is already in the data folder
 * (lib/retime.js `dropRetimedPenStrokes`); the Editor save writes it, BEFORE the
 * page write that applies the retime. That order is the safe one: if the page
 * write then fails, the old id is still on disk and dropping the pen's copy of
 * it loses nothing.
 *
 * Loaded with the scan, like tags; cleared on a data-folder change.
 */

import { writable } from 'svelte/store';
import { getRetimed, recordRetimes } from '../lib/storage/local-store.js';
import { retimeEntries } from '../lib/retime.js';
import { debug } from '../lib/debug.js';
import { log } from './ui.js';

export const retimedPages = writable({});

/** Load the sidecar. Missing or corrupt means nothing retimed; never throws. */
export async function loadRetimed() {
  try {
    const raw = await getRetimed();
    retimedPages.set((raw && raw.pages) || {});
    if (raw && raw.state === 'corrupt') {
      log('Retimed strokes: _retimed.json is unreadable. The next time change replaces it; until then a pen import may bring back strokes at their old times.', 'warning');
    }
    debug('[retimed] loaded', Object.keys((raw && raw.pages) || {}).length, 'pages');
    return true;
  } catch (err) {
    console.warn('[retimed] load skipped:', err?.message || err);
    retimedPages.set({});
    return false;
  }
}

/** Forget the sidecar (data-folder change). */
export function clearRetimed() {
  retimedPages.set({});
}

/**
 * Record the retimes carried by these canvas strokes (`retimedFrom`). Throws
 * when the write fails, so the caller can hold back the page save that would
 * otherwise leave the pen's copy importable.
 *
 * @param {Array} strokeList canvas strokes about to be saved
 * @returns {Promise<number>} entries recorded
 */
export async function recordRetimesFor(strokeList) {
  const entries = retimeEntries(strokeList);
  if (entries.length === 0) return 0;
  const res = await recordRetimes(entries);
  if (res && res.pages) retimedPages.set(res.pages);
  return entries.length;
}
