/**
 * Backgrounds Store — Neo's printed pages, drawn behind the strokes (v2.10 spike).
 *
 * Shown where things are READ — Book View and the Timeline — and deliberately
 * not in the Editor. The Editor sizes a page from its ink, and a fixed paper
 * frame there would touch layout, Fit, the page filter and dragged positions;
 * the read-only views fit a page to a pane and lose nothing by using the paper.
 *
 * Nothing here writes anything. The images are cached under
 * `<dataRoot>/pages/_backgrounds/<ncodeBook>/` by
 * `scripts/fetch-neo-backgrounds.mjs`; absent files mean "no background", which
 * is exactly how every view behaved before this existed.
 *
 * Keyed by NCode book number, not book key: volume 2 of a notebook is another
 * copy of the same printed paper.
 */

import { writable, derived } from 'svelte/store';
import { ncodeBookOf } from '../lib/volumes.js';
import {
  normalizeManifest,
  pageNumberOfId,
  manifestCoversPage
} from '../lib/neo-backgrounds.js';
import {
  listBackgrounds,
  getBackgroundManifest,
  getBackgroundImage
} from '../lib/storage/local-store.js';

const ENABLED_KEY = 'smartpen-page-backgrounds';

function loadEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';   // on unless switched off
  } catch {
    return true;
  }
}

/** The user's choice. A per-viewer convenience, so localStorage rather than disk. */
export const backgroundsEnabled = writable(loadEnabled());

export function setBackgroundsEnabled(on) {
  const next = !!on;
  try {
    localStorage.setItem(ENABLED_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  backgroundsEnabled.set(next);
}

export function toggleBackgrounds() {
  let next;
  backgroundsEnabled.update((v) => (next = !v));
  try {
    localStorage.setItem(ENABLED_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Books that have backgrounds: `[{ book, title, firstPage, lastPage }]`. */
export const installedBackgrounds = writable([]);

/** True when there is anything to toggle — gates the UI. */
export const backgroundsAvailable = derived(installedBackgrounds, ($b) => $b.length > 0);

// ---- caches (module-level; cleared by refreshBackgrounds) ----------------------

/** ncodeBook → Promise<normalized manifest | null> */
let manifests = new Map();
/** "ncodeBook/pageNumber" → Promise<object URL | null> */
let images = new Map();

function manifestFor(ncodeBook) {
  const key = String(ncodeBook);
  if (!manifests.has(key)) {
    const p = getBackgroundManifest(ncodeBook)
      .then(normalizeManifest)
      .catch((err) => {
        console.warn('[backgrounds] manifest read failed for', key, err?.message || err);
        return null;
      });
    manifests.set(key, p);
  }
  return manifests.get(key);
}

function imageFor(ncodeBook, pageNumber, ext) {
  const key = `${ncodeBook}/${pageNumber}`;
  if (!images.has(key)) {
    const p = getBackgroundImage(ncodeBook, pageNumber)
      .then((bytes) => {
        if (!bytes || bytes.length === 0) return null;
        return URL.createObjectURL(new Blob([bytes], { type: ext === 'png' ? 'image/png' : 'image/jpeg' }));
      })
      .catch((err) => {
        console.warn('[backgrounds] image read failed for', key, err?.message || err);
        images.delete(key);            // a transient failure shouldn't stick
        return null;
      });
    images.set(key, p);
  }
  return images.get(key);
}

/**
 * The paper behind one page: `{ frame, url }`, or null when that page has none.
 *
 * `frame` is where the image sits, in Ncode units — the same coordinates as the
 * strokes, so a view can draw the image at `(frame.x0, frame.y0)` with no scaling
 * of its own. Never throws: any failure reads as "no background".
 *
 * Object URLs are kept for the session (a few hundred small JPEGs at most) rather
 * than revoked on eviction, because a mounted card may still be showing one.
 *
 * @param {string|number} bookKey  "388" or "388v2"
 * @param {string|number} pageId   "11" or "151b"
 * @returns {Promise<{frame:{x0:number,y0:number,x1:number,y1:number}, url:string, title:string}|null>}
 */
export async function resolvePageBackground(bookKey, pageId) {
  const ncodeBook = ncodeBookOf(bookKey);
  const pageNumber = pageNumberOfId(pageId);
  if (ncodeBook === null || pageNumber === null) return null;

  const manifest = await manifestFor(ncodeBook);
  if (!manifestCoversPage(manifest, pageNumber)) return null;

  const url = await imageFor(ncodeBook, pageNumber, manifest.ext);
  return url ? { frame: manifest.frame, url, title: manifest.title } : null;
}

/** Re-scan the data folder for backgrounds, and forget anything cached. */
export async function refreshBackgrounds() {
  manifests = new Map();
  images = new Map();
  try {
    const found = await listBackgrounds();
    const list = [];
    for (const entry of found || []) {
      const m = normalizeManifest(entry.manifest);
      if (m) list.push({ book: String(entry.book), title: m.title, firstPage: m.firstPage, lastPage: m.lastPage });
    }
    list.sort((a, b) => Number(a.book) - Number(b.book));
    installedBackgrounds.set(list);
    return list;
  } catch (err) {
    // No data folder yet, or no _backgrounds — both mean "nothing installed".
    console.warn('[backgrounds] scan skipped:', err?.message || err);
    installedBackgrounds.set([]);
    return [];
  }
}
