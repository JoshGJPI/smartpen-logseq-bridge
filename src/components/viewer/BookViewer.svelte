<!--
  BookViewer.svelte — the Library pane: the home grid (LibraryHome) when no
  page is open, otherwise the reader: one page, or a two-page spread.

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
  import { get } from 'svelte/store';
  import {
    savedPages,
    pagesByBook,
    bookAliases,
    recordRecentView,
    viewerDirty,
    clearAllViewerDirty,
    viewerSelection,
    setViewerSelection,
    clearViewerSelection,
    navigateTo,
  } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { importStrokesFromFolder } from '$lib/storage/load-page.js';
  import { getCachedPage, invalidatePage } from '$lib/viewer/page-cache.js';
  import { DISCARD_PROMPT } from '$lib/navigation.js';
  import { pageIdOf as idOf, resolveGoToPage, turnTarget, pageTurnKey, zoomText } from '$lib/viewer/page-reader.js';
  import LibraryHome from './LibraryHome.svelte';
  import PageSpreadView from './PageSpreadView.svelte';

  // Shared viewer state, bound by App.svelte so the pane toolbar (breadcrumb,
  // View ▾, spread toolbar) can show and drive it.
  export let contentMode = 'strokes'; // 'strokes' | 'transcript' | 'inktext'
  export let twoPageMode = true;      // default to a two-page spread
  export let hasSelection = false;    // true when a page is open (not the home grid)
  export let zoomLabel = '';          // out: "62%", or "62% · 58%" when the pages differ

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
    if (!leftRecord) return;
    const dir = pageTurnKey(e, { editing: editingSide != null });
    if (!dir || turnTarget(currentIndex, currentBookPages.length, dir, twoPageMode) < 0) return;
    e.preventDefault();
    turn(dir);
  }

  /** "Go to page…": false when the entry names no page in this notebook. */
  export function goToPage(text) {
    const i = resolveGoToPage(text, currentBookPages);
    if (i < 0) return false;
    if (i !== currentIndex) openRecord(currentBookPages[i]);
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
    clearViewerSelection();
  }

  // Load a single page into the live editor canvas and switch to the Editor
  // view. Strokes are appended (deduped by id), matching the existing "Import
  // Strokes" behaviour — non-destructive to anything already on the canvas.
  async function loadRecordIntoEditor(record) {
    if (!record || !guardNav()) return;
    // Reuse the cached doc if present (the page is open in the spread) to
    // avoid a second disk read; importStrokesFromFolder lazily loads otherwise.
    const pageDoc = await getCachedPage(record.book, idOf(record));
    await importStrokesFromFolder({ ...record, pageDoc });
    navigateTo('editor');
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

  // Reflect a saved transcript back into the store record — lightweight fields
  // only (no strokes/pageDoc residency) — and drop the cached doc so a re-view
  // re-reads the fresh transcript. `pageId` is the unique-within-book id.
  function applyTranscriptToStore(book, pageId, lines) {
    const transcriptionText = lines.length
      ? lines.map((l) => '  '.repeat(l.indentLevel || 0) + (l.text || '')).join('\n')
      : null;
    savedPages.update((pages) =>
      pages.map((p) => {
        if (p.book !== book || idOf(p) !== String(pageId)) return p;
        return {
          ...p,
          transcriptionText,
          transcribed: !!transcriptionText,
          transcriptLineCount: lines.length,
        };
      })
    );
    invalidatePage(book, pageId);
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="book-viewer">
  {#if !leftRecord}
    <LibraryHome onOpen={openRecord} />
  {:else}
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
            onTranscriptSaved={applyTranscriptToStore}
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
                onTranscriptSaved={applyTranscriptToStore}
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
