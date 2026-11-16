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
 *
 * Selected strokes: the Editor's selection joins the print list as one item per
 * pen page (lib/print/print-selection.js `selectionItems()`), copied when added,
 * printed on its page's full paper from memory instead of disk, so unsaved ink
 * prints too. The header's Print adds it when opened from the Editor with
 * strokes selected; the dialog's left panel adds or removes it beside the pages.
 *
 * Preview (v3.9.0): the dialog shows the PDF itself (`renderPreviewPdf`, main's
 * print:previewPdf, drawn with pdf.js). Pages read for it are kept while the
 * dialog is open (`loaded`), so changing an option rebuilds the document
 * without reading the pages again, and Save / Print use the same copies.
 */

import { writable, get } from 'svelte/store';
import { getPage, getBackgroundImage } from '../lib/storage/local-store.js';
import { readJson, write } from '../lib/safe-storage.js';
import { normalizePrintOptions, resolveSheet } from '../lib/print/print-layout.js';
import { buildPrintHtml, printFrame } from '../lib/print/print-html.js';
import { addRefs, removeRefs, refKey, isSelectionItem } from '../lib/print/print-list.js';
import { selectionItems, selectionPrintPage } from '../lib/print/print-selection.js';
import { pageDayGroups } from '../lib/viewer/page-sittings.js';
import { writtenLabel } from '../lib/viewer/written-on.js';
import { rotationFor } from '../lib/page-orientation.js';
import { plural } from '../lib/plural.js';
import { formatBookName } from '../utils/formatting.js';
import { bookAliases } from './book-aliases.js';
import { pageOrientations } from './orientation.js';
import { sketchProfile } from './sketch.js';
import { resolvePagePaper } from './backgrounds.js';
import { log } from './ui.js';

const OPTIONS_KEY = 'smartpen-print-options';

/**
 * Print pages read while a dialog is open, `key → Promise<print page>`. Cleared
 * whenever a dialog opens or closes, so a later print reads the disk afresh.
 */
const loaded = new Map();

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
  loaded.clear();
  const list = addRefs([], pages);
  if (list.length) printDialog.set({ open: true, pages: list, fromList: false });
}

/** Open the dialog on the print list. */
export function openPrintList() {
  loaded.clear();
  printDialog.set({ open: true, pages: get(printList), fromList: true });
}

export function closePrintDialog() {
  loaded.clear();
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
    ? `Added ${added} ${plural(added, 'page')} to the print list (${next.length} in all)`
    : `${n === 1 ? 'That page is' : 'Those pages are'} already in the print list`, 'info');
  return added;
}

/**
 * Add the Editor's selected strokes to the print list (one item per page; a
 * selection already there is skipped). Quiet: the dialog shows the list.
 * @returns {number} how many items were new
 */
export function addSelectionToPrintList(canvasStrokes) {
  const { items, skipped } = selectionItems(canvasStrokes);
  if (skipped) log(`${skipped} selected ${plural(skipped, 'stroke')} on no page (a pasted copy) won't print`, 'info');
  const before = get(printList);
  const next = addRefs(before, items);
  printList.set(next);
  return next.length - before.length;
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

const pageTitle = (ref) => `${bookName(ref.book)} — P${ref.pageId}`;

/** The page's ruling as a data URL, when asked for and installed; else null. */
async function loadBackground(paper, opts) {
  if (!opts.background || !paper || opts.content === 'transcript') return null;
  try {
    const bytes = await getBackgroundImage(paper.ncodeBook, paper.pageNumber);
    if (bytes && bytes.length) return { frame: paper.frame, dataUrl: toDataUrl(bytes, paper.ext) };
  } catch {
    /* no background: the ink prints on white */
  }
  return null;
}

/**
 * One page as print-html.js wants it. A page that can't be read prints as a
 * labelled blank rather than failing the whole job.
 */
async function loadPrintPage(ref, opts) {
  const title = pageTitle(ref);
  let doc = null;
  let readFailed = false;
  try {
    doc = await getPage(ref.book, ref.pageId);
  } catch (err) {
    log(`Print: could not read ${title}: ${err?.message || err}`, 'warning');
    readFailed = true;
  }
  const strokes = (doc && doc.strokes) || [];
  const paper = await resolvePagePaper(ref.book, ref.pageId);
  const background = await loadBackground(paper, opts);

  return {
    title,
    subtitle: writtenLabel(pageDayGroups(strokes).groups),
    frame: printFrame(paper ? paper.frame : null, strokes),
    rotation: rotationFor(get(pageOrientations), ref.book, ref.pageId),
    strokes,
    lines: doc && doc.transcript && Array.isArray(doc.transcript.lines) ? doc.transcript.lines : null,
    background,
    readFailed
  };
}

/**
 * One selected-strokes page: its full paper (or the selection's ink box without
 * one), turned like the canvas page (the integer page's rotation).
 */
async function loadSelectionPage(group, opts) {
  const paper = await resolvePagePaper(group.book, group.pageId);
  return selectionPrintPage(group, {
    paperFrame: paper ? paper.frame : null,
    rotation: rotationFor(get(pageOrientations), group.book, group.pageId),
    title: pageTitle(group),
    background: await loadBackground(paper, opts)
  });
}

/**
 * The sheet a job would print on, from the pages' paper alone (no stroke
 * reads; a selection's strokes are in memory), for the dialog's "Auto · 2 per
 * sheet" hint.
 */
export async function previewSheet(refs, opts) {
  const pages = await Promise.all(refs.map(async (r) => {
    if (isSelectionItem(r)) return loadSelectionPage(r, { ...opts, background: false });
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

/**
 * One print page through `loaded`: a page ref read from disk, a selection item
 * from memory. Only the background depends on the options, so it is part of the
 * key (a selection prints its ink, so its ruling, under any content choice); a
 * page that couldn't be read isn't kept.
 */
async function loadOnce(item, opts) {
  const sel = isSelectionItem(item);
  const bg = !!opts.background && (sel || opts.content !== 'transcript');
  const key = `${refKey(item)}:${bg}`;
  if (!loaded.has(key)) {
    loaded.set(key, sel ? loadSelectionPage(item, { ...opts, content: 'strokes' }) : loadPrintPage(item, opts));
  }
  try {
    const page = await loaded.get(key);
    if (page.readFailed) loaded.delete(key);
    return page;
  } catch (err) {
    loaded.delete(key);
    throw err;
  }
}

/**
 * Load the pages and build the print document: `{ html, sheet, docTitle, opts }`.
 * `docTitle` names the PDF.
 */
async function buildJob(items, opts, docTitle, onProgress) {
  const pages = [];
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    pages.push(await loadOnce(items[i], opts));
  }
  onProgress(items.length, items.length);

  const sheet = resolveSheet(pages.filter((p) => p.frame), opts);
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
  const job = await buildJob(refs, normalizePrintOptions(options), printDocTitle(refs), onProgress);
  return savePdf(api, job);
}

async function savePdf(api, { html, docTitle, opts }) {
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
  const job = await buildJob(refs, normalizePrintOptions(options), printDocTitle(refs), onProgress);
  return toPrinter(api, job);
}

async function toPrinter(api, { html, sheet }) {
  const res = await api.toPrinter(html, { widthIn: sheet.widthIn, heightIn: sheet.heightIn });
  if (!res || res.ok === false) throw new Error((res && res.error) || 'Printing failed');
  return res.result;
}

/**
 * The job's PDF as bytes, for the dialog's preview: the same document Save PDF
 * and Print would send.
 * @returns {Promise<{pdf: Uint8Array, sheet: Object}>}
 */
export async function renderPreviewPdf(items, options, onProgress = () => {}) {
  const api = printAPI();
  if (!api.previewPdf) throw new Error('Preview needs the desktop app to be restarted.');
  const job = await buildJob(items, normalizePrintOptions(options), printDocTitle(items), onProgress);
  const res = await api.previewPdf(job.html);
  if (!res || res.ok === false) throw new Error((res && res.error) || 'Preview failed');
  return { pdf: res.result, sheet: job.sheet };
}
