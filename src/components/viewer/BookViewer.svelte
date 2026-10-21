<!--
  BookViewer.svelte — the Library pane: LibraryBrowse (the home, a notebook's
  or a tag's page grid) when no page is open, otherwise the reader: one page,
  or a two-page spread, with the page tags strip beside it.

  The shared spread toolbar (SpreadToolbar, in the pane toolbar) drives both
  pages through zoomAll() and goToPage(); ←/→ turn pages (pageTurnKey: never
  while typing, with a modifier, or while a transcript is edited). Every page
  change goes through guardNav, so unsaved transcript edits are asked about.

  Reads page data lazily: the savedPages records are lightweight (no strokes),
  so each page view loads its PageDoc through the LRU page cache. Transcript
  edits saved by a page are reflected back into the store here (lightweight
  fields) and the page's cached doc is invalidated.
-->
<script>
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import {
    pagesByBook,
    bookAliases,
    recordRecentView,
    viewerDirty,
    clearAllViewerDirty,
    viewerSelection,
    setViewerSelection,
    clearViewerSelection,
    libraryNotebook,
    showLibraryGrid,
    transcriptEditing,
    readerPages,
    clearReaderFocus,
    applyTranscriptToRecord,
  } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { loadPageIntoEditor } from '$lib/viewer/load-into-editor.js';
  import { DISCARD_PROMPT } from '$lib/navigation.js';
  import { pageIdOf as idOf, resolveGoToPage, turnTarget, pageTurnKey, zoomText } from '$lib/viewer/page-reader.js';
  import { modalOpen } from '$lib/left-panel.js';
  import LibraryBrowse from './LibraryBrowse.svelte';
  import PageSpreadView from './PageSpreadView.svelte';
  import ReaderTagsLayout from '../tags/ReaderTagsLayout.svelte';

  // Shared viewer state, bound by App.svelte so the pane toolbar (breadcrumb,
  // View ▾, spread toolbar) can show and drive it.
  export let contentMode = 'strokes'; // 'strokes' | 'transcript' | 'inktext'
  export let twoPageMode = true;      // default to a two-page spread
  export let hasSelection = false;    // true when a page is open (not the home grid)
  export let zoomLabel = '';          // out: "62%", or "62% · 58%" when the pages differ
  export let openBook = null;         // out: the book key of the open page or page grid, else null

  // Selection is persisted in the viewer store so the Library reopens the last
  // page(s) you were viewing when you come back from the Editor (or reload).
  $: selectedBook = $viewerSelection ? $viewerSelection.book : null;
  $: selectedPageId = $viewerSelection ? $viewerSelection.pageId : null;

  function aliasFor(book) {
    return formatBookName(book, $bookAliases, 'alias-only');
  }

  $: currentBookPages = selectedBook != null ? $pagesByBook[selectedBook] || [] : [];
  $: currentIndex =
    selectedPageId != null ? currentBookPages.findIndex((p) => idOf(p) === selectedPageId) : -1;
  $: leftRecord = currentIndex >= 0 ? currentBookPages[currentIndex] : null;
  $: hasSelection = !!leftRecord;
  $: rightRecord =
    twoPageMode && currentIndex >= 0 && currentIndex + 1 < currentBookPages.length
      ? currentBookPages[currentIndex + 1]
      : null;
  // No page open: one notebook's page grid, if it still has pages, else the home.
  $: gridBook = !leftRecord && $libraryNotebook && ($pagesByBook[$libraryNotebook] || []).length ? $libraryNotebook : null;
  $: openBook = leftRecord ? selectedBook : gridBook;
  $: hasPrev = turnTarget(currentIndex, currentBookPages.length, 'prev', twoPageMode) >= 0;
  $: hasNext = turnTarget(currentIndex, currentBookPages.length, 'next', twoPageMode) >= 0;

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
  // Which pages are on screen, for the contents list's highlight.
  $: readerPages.set(slotA && !pinEdit ? [idOf(slotA.record), ...(showSlotB && slotB ? [idOf(slotB.record)] : [])]
    : editingRecord ? [idOf(editingRecord)] : []);
  onDestroy(() => {
    transcriptEditing.set(false);
    readerPages.set([]);
  });

  // A page opened from outside (contents list, feed card, search) changes the
  // selection without openIndex(); its prompt already ran, so just drop the
  // stale editing slot rather than pinning the new page into edit layout.
  let lastSelKey = null;
  $: selKey = `${selectedBook}:${selectedPageId}`;
  $: if (selKey !== lastSelKey) {
    lastSelKey = selKey;
    editingSide = null;
  }

  // Both pages' zoom, for the shared toolbar.
  let pageA = null;
  let pageB = null;
  let zoomA = null;
  let zoomB = null;
  $: zoomLabel = zoomText(zoomA, showSlotB && slotB ? zoomB : null);

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
    if (!record || !guardNav()) return;
    editingSide = null;
    clearReaderFocus();
    setViewerSelection(record.book, idOf(record));
    recordRecentView(record.book, idOf(record));
  }

  function turn(dir) {
    const t = turnTarget(currentIndex, currentBookPages.length, dir, twoPageMode);
    if (t >= 0) openRecord(currentBookPages[t]);
  }

  // ←/→ turn pages. pageTurnKey keeps them out of text fields, modifier chords
  // and an open transcript editor.
  function onKey(e) {
    if (!leftRecord || modalOpen()) return;
    if (e.key === 'Escape' && !e.defaultPrevented) clearReaderFocus();
    const dir = pageTurnKey(e, { editing: editingSide != null });
    if (!dir || turnTarget(currentIndex, currentBookPages.length, dir, twoPageMode) < 0) return;
    e.preventDefault();
    turn(dir);
  }

  /** "Go to page…" in the open spread or page grid: false when no such page. */
  export function goToPage(text) {
    const pages = leftRecord ? currentBookPages : gridBook ? $pagesByBook[gridBook] : [];
    const i = resolveGoToPage(text, pages);
    if (i < 0) return false;
    if (!leftRecord || i !== currentIndex) openRecord(pages[i]);
    return true;
  }

  /** Shared zoom: 'in' | 'out' | 'fit', applied to every page showing ink. */
  export function zoomAll(op) {
    for (const p of [pageA, pageB]) {
      if (!p) continue;
      if (op === 'fit') p.fit();
      else p.zoomBy(op === 'in' ? 1.2 : 1 / 1.2);
    }
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

  // Load a page onto the Editor canvas (appended, deduped) and show the
  // Editor: the shared guarded path, lib/viewer/load-into-editor.js.
  const loadRecordIntoEditor = (record) => loadPageIntoEditor(record);

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
    <LibraryBrowse {gridBook} onOpen={openRecord} onOpenNotebook={openNotebook} />
  {:else}
    <ReaderTagsLayout records={pinEdit ? [editingRecord] : [slotA.record, showSlotB && slotB ? slotB.record : null]}>
    <div class="bv-body" class:spread={showSlotB}>
      {#key `${slotA.record.book}:${idOf(slotA.record)}`}
        <div class="bv-page">
          <PageSpreadView
            bind:this={pageA}
            bind:zoom={zoomA}
            record={slotA.record}
            bookAlias={aliasFor(slotA.record.book)}
            contentMode={slotA.mode}
            layout={showSlotB ? 'stack' : 'side'}
            hasPrev={canTurn && hasPrev}
            hasNext={canTurn && !twoPageMode && hasNext}
            onPrev={canTurn ? () => turn('prev') : null}
            onNext={canTurn && !twoPageMode ? () => turn('next') : null}
            onTranscriptSaved={applyTranscriptToRecord}
            onLoadIntoEditor={() => loadRecordIntoEditor(slotA.record)}
            onEditingChange={(e) => reportEditing('left', e)}
          />
        </div>
      {/key}

      {#if showSlotB}
        <div class="bv-spine"></div>
        {#if slotB}
          {#key `${slotB.record.book}:${idOf(slotB.record)}`}
            <div class="bv-page">
              <PageSpreadView
                bind:this={pageB}
                bind:zoom={zoomB}
                record={slotB.record}
                bookAlias={aliasFor(slotB.record.book)}
                contentMode={slotB.mode}
                layout="stack"
                hasPrev={false}
                hasNext={canTurn && hasNext}
                onPrev={null}
                onNext={canTurn ? () => turn('next') : null}
                onTranscriptSaved={applyTranscriptToRecord}
                onLoadIntoEditor={() => loadRecordIntoEditor(slotB.record)}
                onEditingChange={(e) => reportEditing('right', e)}
              />
            </div>
          {/key}
        {:else}
          <div class="bv-page bv-endofbook">End of book</div>
        {/if}
      {/if}
    </div>
    </ReaderTagsLayout>
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

  .bv-body { flex: 1; display: flex; min-height: 0; }
  .bv-page { flex: 1; display: flex; min-width: 0; overflow: hidden; }
  .bv-spine {
    width: 3px;
    flex-shrink: 0;
    background: linear-gradient(to bottom, #d8d8d8, #b8b8b8, #d8d8d8);
    box-shadow: -1px 0 3px rgba(0, 0, 0, 0.08), 1px 0 3px rgba(0, 0, 0, 0.08);
  }
  .bv-endofbook {
    align-items: center;
    justify-content: center;
    color: #bbb;
    font-size: 14px;
    background: #f0f0f0;
  }
</style>
