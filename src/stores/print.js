/**
 * Print Store — Print to PDF (v3.8.0): the dialog's state, the session print
 * list (pages gathered from any notebook, in the user's order), the remembered
 * options, and the job that turns pages into a PDF.
 *
 * A job reads each page from disk (local-store `getPage`, NOT the reader's page
 * cache: a print of a whole notebook would evict the spread being read), sizes
 * it by its paper (the Neo manifest's frame, whether or not the background is
 * drawn), builds one self-contained HTML document (lib/print/print-html.js) and
 * hands it to main, which asks where to save and renders it with printToPDF.
 * Read-only: nothing here writes a PageDoc or a sidecar.
 */

import { writable, get } from 'svelte/store';
import { getPage, getBackgroundImage } from '../lib/storage/local-store.js';
import { readJson, write } from '../lib/safe-storage.js';
import { normalizePrintOptions, resolveSheet } from '../lib/print/print-layout.js';
import { buildPrintHtml, printFrame } from '../lib/print/print-html.js';
import { addRefs, removeRefs, refKey } from '../lib/print/print-list.js';
import { pageDayGroups } from '../lib/viewer/page-sittings.js';
import { writtenLabel } from '../lib/viewer/written-on.js';
import { rotationFor } from '../lib/page-orientation.js';
import { formatBookName } from '../utils/formatting.js';
import { bookAliases } from './book-aliases.js';
import { pageOrientations } from './orientation.js';
import { sketchProfile } from './sketch.js';
import { resolvePagePaper } from './backgrounds.js';
import { log } from './ui.js';

const OPTIONS_KEY = 'smartpen-print-options';

/**
 * `{ open, pages: [{ book, pageId }], fromList }`, pages in the order they print.
 * `fromList`: the dialog is editing the print list (reorder / remove write
 * through to `printList`); otherwise it is a one-off print of its own copy.
 */
export const printDialog = writable({ open: false, pages: [], fromList: false });

/**
 * The print list: pages gathered from any notebook, grid or Timeline card, in
 * print order. Session-only, like the rest of where you are in the Library.
 */
export const printList = writable([]);

/** The dialog's choices, remembered between prints. */
export const printOptions = writable(normalizePrintOptions(readJson(OPTIONS_KEY, {})));

export function setPrintOptions(patch) {
  printOptions.update((o) => {
    const next = normalizePrintOptions({ ...o, ...patch });
    write(OPTIONS_KEY, next);
    return next;
  });
}

/** One-off print of these pages (the print list is left alone). */
export function openPrintDialog(pages) {
  const list = addRefs([], pages);
  if (list.length) printDialog.set({ open: true, pages: list, fromList: false });
}

/** Open the dialog on the print list. */
export function openPrintList() {
  printDialog.set({ open: true, pages: get(printList), fromList: true });
}

export function closePrintDialog() {
  printDialog.set({ open: false, pages: [], fromList: false });
}

/** The dialog's pages after a reorder / remove; written through to the list when editing it. */
export function setDialogPages(pages) {
  printDialog.update((d) => ({ ...d, pages }));
  if (get(printDialog).fromList) printList.set(pages);
}

/** Append pages to the print list (duplicates skipped). @returns {number} how many were new */
export function addToPrintList(pages) {
  const before = get(printList);
  const next = addRefs(before, pages);
  printList.set(next);
  const added = next.length - before.length;
  const n = (pages || []).length;
  log(added
    ? `Added ${added} ${added === 1 ? 'page' : 'pages'} to the print list (${next.length} in all)`
    : `${n === 1 ? 'That page is' : 'Those pages are'} already in the print list`, 'info');
  return added;
}

export function removeFromPrintList(pages) {
  printList.update((l) => removeRefs(l, pages));
}

export function clearPrintList() {
  printList.set([]);
  printDialog.update((d) => (d.fromList ? { ...d, pages: [] } : d));
}

/** True when the page is in the print list. */
export function inPrintList(list, ref) {
  const k = refKey({ book: String(ref.book), pageId: String(ref.pageId) });
  return list.some((r) => refKey(r) === k);
}

/** A page ref from a scan record. */
export function printRefOf(record) {
  return { book: record.book, pageId: record.pageId != null ? record.pageId : record.page };
}

function bookName(book) {
  return formatBookName(book, get(bookAliases), 'alias-only') || `B${book}`;
}

/** "JPI Dotted P42", "JPI Dotted P3–P20", or "Smartpen pages (12)" across notebooks. */
export function printDocTitle(refs) {
  if (!refs.length) return 'Smartpen pages';
  const books = new Set(refs.map((r) => r.book));
  if (books.size > 1) return `Smartpen pages (${refs.length})`;
  const name = bookName(refs[0].book);
  if (refs.length === 1) return `${name} P${refs[0].pageId}`;
  return `${name} P${refs[0].pageId}–P${refs[refs.length - 1].pageId}`;
}

function toDataUrl(bytes, ext) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${ext === 'png' ? 'image/png' : 'image/jpeg'};base64,${btoa(bin)}`;
}

/**
 * One page as print-html.js wants it. A page that can't be read prints as a
 * labelled blank rather than failing the whole job.
 */
async function loadPrintPage(ref, opts) {
  const title = `${bookName(ref.book)} — P${ref.pageId}`;
  let doc = null;
  try {
    doc = await getPage(ref.book, ref.pageId);
  } catch (err) {
    log(`Print: could not read ${title}: ${err?.message || err}`, 'warning');
  }
  const strokes = (doc && doc.strokes) || [];
  const paper = await resolvePagePaper(ref.book, ref.pageId);

  let background = null;
  if (opts.background && paper && opts.content !== 'transcript') {
    try {
      const bytes = await getBackgroundImage(paper.ncodeBook, paper.pageNumber);
      if (bytes && bytes.length) background = { frame: paper.frame, dataUrl: toDataUrl(bytes, paper.ext) };
    } catch {
      /* no background: the ink prints on white */
    }
  }

  return {
    title,
    subtitle: writtenLabel(pageDayGroups(strokes).groups),
    frame: printFrame(paper ? paper.frame : null, strokes),
    rotation: rotationFor(get(pageOrientations), ref.book, ref.pageId),
    strokes,
    lines: doc && doc.transcript && Array.isArray(doc.transcript.lines) ? doc.transcript.lines : null,
    background
  };
}

/**
 * The sheet a job would print on, from the pages' paper alone (no stroke
 * reads), for the dialog's "Auto · 2 per sheet" hint.
 */
export async function previewSheet(refs, opts) {
  const pages = await Promise.all(refs.map(async (r) => {
    const paper = await resolvePagePaper(r.book, r.pageId);
    return { frame: paper ? paper.frame : null, rotation: rotationFor(get(pageOrientations), r.book, r.pageId) };
  }));
  return resolveSheet(pages.filter((p) => p.frame), opts);
}

function printAPI() {
  if (typeof window === 'undefined' || !window.printAPI) {
    throw new Error('Printing needs the desktop app.');
  }
  return window.printAPI;
}

/** Read the pages and build the print document: `{ html, sheet, docTitle, opts }`. */
async function buildJob(refs, options, onProgress) {
  const opts = normalizePrintOptions(options);
  const pages = [];
  for (let i = 0; i < refs.length; i++) {
    onProgress(i, refs.length);
    pages.push(await loadPrintPage(refs[i], opts));
  }
  onProgress(refs.length, refs.length);

  const sheet = resolveSheet(pages.filter((p) => p.frame), opts);
  const docTitle = printDocTitle(refs);
  const html = buildPrintHtml(pages, { ...opts, sheet, sketchProfile: get(sketchProfile), docTitle });
  return { html, sheet, docTitle, opts };
}

/**
 * Print pages to a PDF the user saves.
 * @param {Array<{book:string, pageId:string}>} refs
 * @param {Object} options  normalizePrintOptions() shape
 * @param {(done:number, total:number) => void} [onProgress]
 * @returns {Promise<{path:string, bytes:number}|{canceled:true}>}
 */
export async function printPagesToPdf(refs, options, onProgress = () => {}) {
  const api = printAPI();
  const { html, docTitle, opts } = await buildJob(refs, options, onProgress);
  const res = await api.savePdf(html, docTitle, opts.openWhenDone);
  if (!res || res.ok === false) throw new Error((res && res.error) || 'Print to PDF failed');
  return res.result;
}

/**
 * Print pages through the Windows print dialog, preset to the job's sheet.
 * Same document as the PDF. Resolves once the dialog is closed.
 * @returns {Promise<{printed: boolean, reason: string|null}>}  reason 'cancelled' when dismissed
 */
export async function printPagesToPrinter(refs, options, onProgress = () => {}) {
  const api = printAPI();
  const { html, sheet } = await buildJob(refs, options, onProgress);
  const res = await api.toPrinter(html, { widthIn: sheet.widthIn, heightIn: sheet.heightIn });
  if (!res || res.ok === false) throw new Error((res && res.error) || 'Printing failed');
  return res.result;
}
