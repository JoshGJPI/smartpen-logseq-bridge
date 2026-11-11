/**
 * Pages whose strokes share an id (v3.18.0), read off the capture-date index:
 * main's timeline pass counts `duplicateStrokes` per page while it reads every
 * start time (electron/main.cjs `extractCaptureDays`), so no page is opened for
 * this. Settings → Maintenance shows the count and opens the cleanup dialog
 * (`DuplicateStrokesDialog`); a change in the set is logged once as a warning,
 * which is what the Activity Log badge counts. What a cleanup does is in
 * `lib/storage/duplicate-strokes.js`.
 */
import { derived } from 'svelte/store';
import { timelineIndex } from './timeline.js';
import { log } from './ui.js';
import { compareBookKeys } from '$lib/volumes.js';

/** @type {import('svelte/store').Readable<Array<{book:string, pageId:string, page:number, duplicateStrokes:number}>>} */
export const pagesWithDuplicateStrokes = derived(timelineIndex, ($index) => {
  const pages = ($index && $index.pages) || {};
  return Object.values(pages)
    .filter((p) => p && p.duplicateStrokes > 0)
    .map((p) => ({ book: String(p.book), pageId: String(p.pageId), page: p.page, duplicateStrokes: p.duplicateStrokes }))
    .sort((a, b) => compareBookKeys(a.book, b.book)
      || a.pageId.localeCompare(b.pageId, undefined, { numeric: true }));
});

let lastLogged = '';
pagesWithDuplicateStrokes.subscribe((list) => {
  const sig = list.map((p) => `${p.book}/${p.pageId}:${p.duplicateStrokes}`).join(',');
  if (sig === lastLogged) return;
  lastLogged = sig;
  if (!list.length) return;
  const n = list.reduce((sum, p) => sum + p.duplicateStrokes, 0);
  const where = list.slice(0, 5).map((p) => `B${p.book}/P${p.pageId}`).join(', ') + (list.length > 5 ? ', …' : '');
  log(`${n} stroke${n === 1 ? '' : 's'} share${n === 1 ? 's' : ''} an id with another on the same page (${where}). `
    + 'Settings → Maintenance → Clean up duplicate strokes…', 'warning');
});
