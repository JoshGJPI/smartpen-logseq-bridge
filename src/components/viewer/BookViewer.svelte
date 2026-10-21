<!--
  BookViewer.svelte — the Library pane: LibraryBrowse (the home, a notebook's
  or a tag's page grid, the tag manager) when no page is open, otherwise the
  reader (ReaderSpread): one page, or a two-page spread, with the page tags
  strip beside it.

  The shared spread toolbar (SpreadToolbar, in the pane toolbar) drives both
  pages through zoomAll() and goToPage(); ←/→ turn pages (pageTurnKey: never
  while typing, with a modifier, or while a transcript is edited). Every page
  change goes through guardNav, so unsaved transcript edits are asked about.

  Pages turn through `readingList` (v3.2.0): the open notebook in Book order,
  or in Tag order the pages of the grid the page was opened from (a tag's
  pages, Untagged, a filtered grid), notebook then page. setReadingOrder() is
  the Book | Tag toggle.

  Reads page data lazily: the savedPages records are lightweight (no strokes),
  so each page view loads its PageDoc through the LRU page cache.
-->
<script>
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    pagesByBook,
    recordRecentView,
    viewerDirty,
    clearAllViewerDirty,
    viewerSelection,
    setViewerSelection,
    clearViewerSelection,
    libraryNotebook,
    showLibraryGrid,
    openLibraryView,
    transcriptEditing,
    readerPages,
    clearReaderFocus,
    readerSequence,
    setReaderSequence,
    setReaderOrder,
    readingList,
    readingSequence,
  } from '$stores';
  import { DISCARD_PROMPT } from '$lib/navigation.js';
  import { pageIdOf as idOf, resolveGoToPage, turnTarget, pageTurnKey, zoomText } from '$lib/viewer/page-reader.js';
  import { landingInSequence } from '$lib/viewer/reading-order.js';
  import { modalOpen } from '$lib/left-panel.js';
  import LibraryBrowse from './LibraryBrowse.svelte';
  import ReaderSpread from './ReaderSpread.svelte';

  // Shared viewer state, bound by App.svelte so the pane toolbar (breadcrumb,
  // View ▾, spread toolbar) can show and drive it.
  export let contentMode = 'strokes'; // 'strokes' | 'transcript' | 'inktext'
  export let twoPageMode = true;      // default to a two-page spread
  export let hasSelection = false;    // true when a page is open (not the home grid)
  export let zoomLabel = '';          // out: "62%", or "62% · 58%" when the pages differ
  export let openBook = null;         // out: the book key of the open page or page grid, else null

  // The open page lives in the viewer store (session-only), so the Library
  // reopens it when you come back from the Timeline or the Editor.
  $: selectedBook = $viewerSelection ? $viewerSelection.book : null;
  $: selectedPageId = $viewerSelection ? $viewerSelection.pageId : null;

  // What ←/→ turn through: the open notebook, or the Tag order sequence.
  $: currentPages = $readingList.pages;
  $: inTagOrder = $readingList.order === 'tag';
  $: bookPages = selectedBook != null ? $pagesByBook[selectedBook] || [] : [];
  $: currentIndex = selectedPageId != null ? currentPages.findIndex((p) => isOpen(p, selectedBook, selectedPageId)) : -1;
  $: leftRecord = currentIndex >= 0 ? currentPages[currentIndex] : null;
  $: hasSelection = !!leftRecord;
  $: rightRecord =
    twoPageMode && currentIndex >= 0 && currentIndex + 1 < currentPages.length
      ? currentPages[currentIndex + 1]
      : null;
  // No page open: one notebook's page grid, if it still has pages, else the home.
  $: gridBook = !leftRecord && $libraryNotebook && ($pagesByBook[$libraryNotebook] || []).length ? $libraryNotebook : null;
  $: openBook = leftRecord ? selectedBook : gridBook;
  $: hasPrev = turnTarget(currentIndex, currentPages.length, 'prev', twoPageMode) >= 0;
  $: hasNext = turnTarget(currentIndex, currentPages.length, 'next', twoPageMode) >= 0;

  // While a transcript is being edited in Strokes or Transcript mode, both
  // spread slots focus that one page: the editor stays in its slot and the
  // companion slot shows the same page's strokes for reference. `editingSide`
  // says which physical slot hosts the editor ('left' | 'right'); null means
  // normal browsing. Ink + text already shows the page's ink beside its text,
  // so it is not re-laid out (`pinEdit`), but turning pages is still off.
  let editingSide = null;
  $: editingRecord =
    editingSide === 'left' ? leftRecord : editingSide === 'right' ? rightRecord : null;
  $: pinEdit = !!editingRecord && contentMode !== 'inktext';

  // Physical slot resolution → { record, mode }. Keying panes by record id means
  // the editor slot keeps its identity (record + mode unchanged) across the
  // transition, so its draft survives; only the companion slot remounts.
  $: slotA = pinEdit
    ? { record: editingRecord, mode: editingSide === 'left' ? 'transcript' : 'strokes' }
    : (leftRecord ? { record: leftRecord, mode: contentMode } : null);
  $: slotB = pinEdit
    ? { record: editingRecord, mode: editingSide === 'right' ? 'transcript' : 'strokes' }
    : (twoPageMode && rightRecord ? { record: rightRecord, mode: contentMode } : null);
  // Companion strokes pane is forced visible during editing even in single mode.
  $: showSlotB = pinEdit || twoPageMode;
  $: canTurn = !editingRecord;
  $: transcriptEditing.set(editingSide != null);
  // Which of the open notebook's pages are on screen, for the contents list's
  // highlight. In Tag order the right page can be another notebook's: left out.
  $: readerPages.set(slotA && !pinEdit
    ? [idOf(slotA.record), ...(showSlotB && slotB && String(slotB.record.book) === String(selectedBook) ? [idOf(slotB.record)] : [])]
    : editingRecord ? [idOf(editingRecord)] : []);
  onDestroy(() => {
    transcriptEditing.set(false);
    readerPages.set([]);
  });

  // A page opened from outside (contents list, feed card, search) changes the
  // selection without openRecord(); its prompt already ran, so just drop the
  // stale editing slot rather than pinning the new page into edit layout.
  let lastSelKey = null;
  $: selKey = `${selectedBook}:${selectedPageId}`;
  $: if (selKey !== lastSelKey) {
    lastSelKey = selKey;
    editingSide = null;
  }

  // Both pages' zoom, for the shared toolbar.
  let spreadView = null;
  let zoomA = null;
  let zoomB = null;
  $: zoomLabel = leftRecord ? zoomText(zoomA, showSlotB && slotB ? zoomB : null) : '';

  function isOpen(record, book, pageId) {
    return !!record && String(record.book) === String(book) && idOf(record) === String(pageId);
  }

  const inSequence = (record) => !!record && $readingSequence.some((r) => isOpen(r, record.book, idOf(record)));

  function reportEditing(side, isEditing) {
    editingSide = isEditing ? side : null;
  }

  function guardNav() {
    if (get(viewerDirty)) {
      if (!window.confirm(DISCARD_PROMPT)) return false;
      clearAllViewerDirty();
    }
    return true;
  }

  function openRecord(record) {
    if (!record || !guardNav()) return false;
    editingSide = null;
    clearReaderFocus();
    setViewerSelection(record.book, idOf(record));
    recordRecentView(record.book, idOf(record));
    return true;
  }

  /**
   * A page opened from a grid or the home. `sequence` is the grid's pages
   * (buildSequence) for Tag order; null or absent reads in Book order.
   */
  function openFromGrid(record, sequence = null) {
    if (!record || !guardNav()) return;
    setReaderSequence(sequence);
    openRecord(record);
  }

  function turn(dir) {
    const t = turnTarget(currentIndex, currentPages.length, dir, twoPageMode);
    if (t >= 0) openRecord(currentPages[t]);
  }

  // ←/→ turn pages. pageTurnKey keeps them out of text fields, modifier chords
  // and an open transcript editor.
  function onKey(e) {
    if (!leftRecord || modalOpen()) return;
    if (e.key === 'Escape' && !e.defaultPrevented) clearReaderFocus();
    const dir = pageTurnKey(e, { editing: editingSide != null });
    if (!dir || turnTarget(currentIndex, currentPages.length, dir, twoPageMode) < 0) return;
    e.preventDefault();
    turn(dir);
  }

  /**
   * "Go to page…" in the open notebook (or its page grid): false when no such
   * page. In Tag order, a page outside the sequence switches to Book order.
   */
  export function goToPage(text) {
    const pages = leftRecord ? bookPages : gridBook ? $pagesByBook[gridBook] : [];
    const i = resolveGoToPage(text, pages);
    if (i < 0) return false;
    const target = pages[i];
    if (leftRecord && isOpen(target, selectedBook, selectedPageId)) return true;
    if (openRecord(target) && inTagOrder && !inSequence(target)) setReaderOrder('book');
    return true;
  }

  /**
   * The Book | Tag toggle. Switching to Tag order from a page that is not in
   * the sequence (Book order turned off it) lands on the nearest one.
   * @param {'book'|'tag'} order
   */
  export function setReadingOrder(order) {
    if (order !== 'tag') return setReaderOrder('book');
    if (!$readerSequence) return;
    if (inSequence(leftRecord)) return setReaderOrder('tag');
    const landing = landingInSequence($readingSequence, leftRecord);
    if (landing && openRecord(landing)) setReaderOrder('tag');
  }

  /** Shared zoom: 'in' | 'out' | 'fit', applied to every page showing ink. */
  export function zoomAll(op) {
    spreadView?.zoomAll(op);
  }

  export function goHome() {
    if (!guardNav()) return;
    editingSide = null;
    showLibraryGrid(null);
    clearViewerSelection();
  }

  /** A notebook's page grid (a card, the breadcrumb's notebook crumb). */
  export function openNotebook(book) {
    if (!guardNav()) return;
    editingSide = null;
    showLibraryGrid(book);
    clearViewerSelection();
  }

  /** Back to the grid the Tag order came from (the breadcrumb's tag crumb). */
  export function openSequenceOrigin() {
    const origin = $readerSequence?.origin;
    if (!origin) return goHome();
    if (origin.kind === 'notebook') return openNotebook(origin.book);
    if (!guardNav()) return;
    editingSide = null;
    openLibraryView(origin.kind === 'tag' ? { kind: 'tag', tag: origin.tag } : { kind: 'untagged' });
  }

  export function setContentMode(mode) {
    if (mode === contentMode) return;
    if (!guardNav()) return;
    editingSide = null;
    contentMode = mode;
  }

  export function toggleSpread() {
    if (!guardNav()) return;
    editingSide = null;
    twoPageMode = !twoPageMode;
  }

  // A saved transcript is reflected into the scan record (and the page's
  // cached doc dropped) by applyTranscriptToRecord in stores/saved-pages.js.
</script>

<svelte:window on:keydown={onKey} />

<div class="book-viewer">
  {#if !leftRecord}
    <LibraryBrowse {gridBook} onOpen={openFromGrid} onOpenNotebook={openNotebook} />
  {:else}
    <ReaderSpread
      bind:this={spreadView}
      bind:zoomA
      bind:zoomB
      {slotA}
      {slotB}
      {showSlotB}
      {pinEdit}
      {editingRecord}
      {twoPageMode}
      {canTurn}
      {hasPrev}
      {hasNext}
      endLabel={inTagOrder ? 'End of tagged pages' : 'End of book'}
      onTurn={turn}
      onEditingChange={reportEditing}
    />
  {/if}
</div>

<style>
  .book-viewer {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #f5f5f5;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e0e0e0;
  }
</style>
