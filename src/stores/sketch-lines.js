/**
 * sketch-lines store (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.3): what the
 * Make sketch dialog and the reader's Mark sketch box are doing, and the UI's
 * calls into the one write path, lib/viewer/sketch-lines.js saveSketchLine().
 *
 *   sketchDialog  the Make sketch dialog: `{ pages: [{ book, pageId, ids }] }`
 *                 (one sketch per page), or null
 *   sketchMark    the reader's box mode: `{ book, pageId, mode, lineId?, label? }`,
 *                 mode 'create' (Mark sketch), 'add' (Add strokes…), 'remove'
 *                 (Remove strokes…), or null
 *
 * Every write goes through saveSketchLine (guards, savePage, the canvas copy,
 * refreshAfterSave); this file only reports to the Activity Log.
 */
import { writable, get } from 'svelte/store';
import { strokes } from './strokes.js';
import { selectedIndices } from './selection.js';
import { onDiskStrokeIds } from './pending-changes.js';
import { log } from './ui.js';
import { openPrintDialog } from './print.js';
import { getPage } from '../lib/storage/local-store.js';
import { saveSketchLine, sketchTargets } from '../lib/viewer/sketch-lines.js';
import { sketchPrintItem } from '../lib/print/print-selection.js';
import { plural } from '../lib/plural.js';

export const sketchDialog = writable(null);
export const sketchMark = writable(null);

const where = (book, pageId) => `B${book}/P${pageId}`;

/** The Editor's selection ⋯ → Make sketch…: refused (with the reason logged) for unsaved strokes. */
export function openMakeSketchFromSelection() {
  const t = sketchTargets(get(strokes), get(selectedIndices), get(onDiskStrokeIds));
  if (!t.ok) {
    log(`Make sketch: ${t.error}`, 'warning');
    return t.error;
  }
  sketchDialog.set({ pages: t.pages });
  return null;
}

/** Make sketch for strokes picked in the reader (a Mark sketch box). */
export function openMakeSketch(book, pageId, ids) {
  if (!ids || !ids.length) return;
  sketchDialog.set({ pages: [{ book: String(book), pageId: String(pageId), ids: [...ids] }] });
}

export function closeSketchDialog() {
  sketchDialog.set(null);
}

/** The reader's box mode on a page: 'create', or 'add' / 'remove' for a sketch line. */
export function startSketchMark(book, pageId, mode = 'create', line = null) {
  sketchMark.set({ book: String(book), pageId: String(pageId), mode, lineId: line ? line.id : null, label: line ? line.text : null });
}

export function stopSketchMark() {
  sketchMark.set(null);
}

/**
 * One sketch write, reported. Never throws: a refusal or failure is logged and
 * returned as `{ error }`.
 * @returns {Promise<{ changed?: boolean, lineId?: string, taken?: number, error?: string }>}
 */
export async function runSketch(book, pageId, op) {
  try {
    const r = await saveSketchLine(book, pageId, op);
    if (r.changed) log(describe(op, r, book, pageId), 'success');
    return r;
  } catch (err) {
    const msg = err?.message || String(err);
    log(`Sketch on ${where(book, pageId)}: ${msg}`, err?.name === 'SketchError' ? 'warning' : 'error');
    return { error: msg };
  }
}

function describe(op, r, book, pageId) {
  const label = r.line ? `“${r.line.text}”` : 'the sketch';
  const n = op.strokeIds ? op.strokeIds.length : r.taken;
  switch (op.op) {
    case 'create': return `Made sketch ${label} on ${where(book, pageId)} (${n} ${plural(n, 'stroke')}); Transcribe won't send its ink`;
    case 'rename': return `Renamed the sketch to ${label} (${where(book, pageId)})`;
    case 'add-strokes': return `Added ${r.taken} ${plural(r.taken, 'stroke')} to ${label} (${where(book, pageId)})`;
    case 'remove-strokes': return `Took ${r.taken} ${plural(r.taken, 'stroke')} out of ${label} (${where(book, pageId)}); they are unlinked, not deleted`;
    case 'remove': return `Removed a sketch from ${where(book, pageId)}; its ${r.taken} ${plural(r.taken, 'stroke')} are unlinked, not deleted`;
    default: return `Sketch saved (${where(book, pageId)})`;
  }
}

/**
 * Print this sketch (the sketch row's ⋯, approved with the mockup): its ink on
 * its page's paper, through the Print dialog (lib/print/print-selection.js).
 */
export async function printSketch(book, pageId, lineId) {
  try {
    const doc = await getPage(String(book), String(pageId));
    const item = doc && sketchPrintItem({ book, pageId, lineId, strokes: doc.strokes });
    if (!item) {
      log(`Print: the sketch on ${where(book, pageId)} has no ink`, 'warning');
      return false;
    }
    openPrintDialog([item]);
    return true;
  } catch (err) {
    log(`Print: could not read ${where(book, pageId)}: ${err?.message || err}`, 'error');
    return false;
  }
}
