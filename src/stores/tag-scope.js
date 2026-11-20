/**
 * Tag scope store (v3.23.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase D).
 *
 * Block scope (lib/tag-scope.js) comes from the scan records' `transcriptionText`
 * everywhere, with no page reads. Hand corrections (`_tags.json` `blocks`) name
 * lines by id, and the scan text has none, so for the few pages that HAVE a
 * correction this store reads the page once (`getPage`, never the reader's page
 * cache, so a list of them can't evict the reader's spread) and keeps only
 * `{ id, text, indentLevel }` per line, keyed by the record's `lastUpdated`: a
 * page written since is read again. `scopeLines` is that map (`pageKey →
 * lines`); a page not in it uses its scan text.
 *
 * Also the reader's two bits of block-scope UI state (session-only):
 * `scopeTagShown` (the tag whose covered lines the reader marks, chosen in the
 * page's tag strip) and `tagBlockDialog` (what "Tag this block…" is asking).
 */

import { writable, readable, get } from 'svelte/store';
import { savedPages } from './saved-pages.js';
import { tagBlocks } from './tags.js';
import { getPage } from '../lib/storage/local-store.js';
import { scopeLinesOf } from '../lib/tag-scope.js';
import { debug } from '../lib/debug.js';
import { openPageInLibrary, focusReaderLineId } from './viewer.js';

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/** pageKey → { lastUpdated, lines } for pages with hand corrections. */
let cache = new Map();
let running = false;
let again = false;

async function refresh(set) {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const keys = Object.keys(get(tagBlocks) || {});
      const byKey = new Map(get(savedPages).map((r) => [`${r.book}/${idOf(r)}`, r]));
      const next = new Map();
      let changed = cache.size !== keys.length;
      for (const key of keys) {
        const r = byKey.get(key);
        if (!r) continue;
        const have = cache.get(key);
        if (have && have.lastUpdated === r.lastUpdated) {
          next.set(key, have);
          continue;
        }
        try {
          const doc = await getPage(r.book, idOf(r));
          next.set(key, { lastUpdated: r.lastUpdated, lines: scopeLinesOf(doc?.transcript?.lines) });
          changed = true;
        } catch (err) {
          debug('[tag-scope] read skipped', key, err?.message || err);
        }
      }
      cache = next;
      if (changed) set(new Map([...cache].map(([k, v]) => [k, v.lines])));
    } while (again);
  } finally {
    running = false;
  }
}

/** pageKey → lines with ids, for pages with block corrections (read once per page write). */
export const scopeLines = readable(new Map(), (set) => {
  let timer = null;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(set), 50);
  };
  const a = tagBlocks.subscribe(kick);
  const b = savedPages.subscribe(kick);
  return () => {
    clearTimeout(timer);
    a();
    b();
  };
});

/**
 * The tag whose block scope the reader marks beside the transcript (D.4):
 * `{ key: "<bookKey>/<pageId>", tag }` or null. Picked in the page's tag strip.
 */
export const scopeTagShown = writable(null);

/** Show (or, on the same tag again, hide) a tag's scope on a page. */
export function toggleScopeTag(key, tag) {
  const cur = get(scopeTagShown);
  scopeTagShown.set(cur && cur.key === key && cur.tag === tag ? null : { key, tag });
}

/**
 * "Tag this block…" (D.4): `{ book, pageId, lineId, text }` while the picker is
 * open, else null. TagBlockDialog reads it.
 */
export const tagBlockDialog = writable(null);

export function openTagBlockDialog(book, pageId, line) {
  if (!line || !line.id) return;
  tagBlockDialog.set({ book: String(book), pageId: String(pageId), lineId: line.id, text: line.text || '' });
}

export function closeTagBlockDialog() {
  tagBlockDialog.set(null);
}

/**
 * Open a page in the reader with one transcript line marked (a block on a tag
 * page, D.2). Lines from scan text have no ids, so the page is read here, once,
 * on the click (`index` into its transcript; `text` checks it is still that line,
 * else the first line with that text).
 * @returns {Promise<boolean>}
 */
export async function openScopeLine(record, index, text, lineId = null) {
  const book = String(record.book);
  const pageId = idOf(record);
  let id = lineId;
  if (!id && index != null) {
    try {
      const lines = (await getPage(book, pageId))?.transcript?.lines || [];
      const want = String(text || '').trim();
      const at = lines[index];
      const hit = at && (!want || String(at.text || '').trim() === want) ? at : lines.find((l) => String(l.text || '').trim() === want);
      id = hit ? hit.id : null;
    } catch (err) {
      debug('[tag-scope] open read failed', err?.message || err);
    }
  }
  if (openPageInLibrary(book, pageId) === 'cancelled') return false;
  if (id) focusReaderLineId(book, pageId, id);
  return true;
}
