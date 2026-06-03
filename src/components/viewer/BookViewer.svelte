<!--
  BookViewer.svelte — the Book View pane (replaces the capture canvas when the
  pane is in 'book' mode).

  Home state: thumbnail grid of recent pages + all pages grouped by book.
  Page state: one or two PageSpreadView pages with page-turn navigation and the
  viewer-wide Strokes⇄Transcript / Single⇄Spread toggles.

  Reads page data (strokes + transcript) straight from the logseqPages store
  (each record already carries its full pageDoc). Transcript edits saved by a
  child pane are reflected back into the store here.
-->
<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    logseqPages,
    pagesByBook,
    bookIds,
    bookAliases,
    isScanning,
    recentViews,
    recordRecentView,
    viewerDirty,
    clearAllViewerDirty,
    viewerSelection,
    setViewerSelection,
    clearViewerSelection,
    setViewerMode,
  } from '$stores';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { importStrokesFromFolder } from '$lib/storage/load-page.js';
  import { generateThumbnailSVG } from '$lib/viewer/page-svg.js';
  import PageSpreadView from './PageSpreadView.svelte';

  // Shared viewer state — bound by App.svelte so the global controls (Home,
  // Strokes/Transcript, Single/Spread) can live in the top bar, right of the
  // Capture/Book View switch, giving both spread pages an identical header.
  export let contentMode = 'strokes'; // 'strokes' | 'transcript'
  export let twoPageMode = true;      // default to a two-page spread
  export let hasSelection = false;    // true when a page is open (not the home grid)

  // Home grid: book sections are collapsed by default so a long page list
  // doesn't bury the book you want.
  let expandedBooks = new Set();
  let recentOpen = true;

  const thumbCache = new Map();

  // Selection is persisted in the viewer store so Book View reopens the last
  // page(s) you were viewing when you toggle back from the Editor (or reload).
  $: selectedBook = $viewerSelection ? $viewerSelection.book : null;
  $: selectedPageId = $viewerSelection ? $viewerSelection.pageId : null;

  $: grouped = $pagesByBook;
  $: books = $bookIds;

  function aliasFor(book) {
    return $bookAliases[book] || `B${book}`;
  }

  function idOf(record) {
    return record.pageId != null ? String(record.pageId) : String(record.page);
  }

  $: currentBookPages = selectedBook != null ? grouped[selectedBook] || [] : [];
  $: currentIndex =
    selectedPageId != null ? currentBookPages.findIndex((p) => idOf(p) === selectedPageId) : -1;
  $: leftRecord = currentIndex >= 0 ? currentBookPages[currentIndex] : null;
  $: hasSelection = !!leftRecord;
  $: rightRecord =
    twoPageMode && currentIndex >= 0 && currentIndex + 1 < currentBookPages.length
      ? currentBookPages[currentIndex + 1]
      : null;
  $: hasPrev = currentIndex > 0;
  $: hasNextSingle = currentIndex >= 0 && currentIndex < currentBookPages.length - 1;
  $: hasNextSpread = currentIndex >= 0 && currentIndex + 2 <= currentBookPages.length - 1;

  $: recentRecords = $recentViews
    .map((rv) => (grouped[rv.book] || []).find((p) => idOf(p) === rv.pageId))
    .filter(Boolean);

  function strokesOf(record) {
    return (record && (record.strokes || (record.pageDoc && record.pageDoc.strokes))) || [];
  }

  // Compute thumbnails lazily (after first paint) and cache, so a home view of
  // many dense pages doesn't block the initial render.
  async function thumbAsync(record) {
    const key = `${record.book}:${record.page}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    await new Promise((r) => setTimeout(r, 0));
    const svg = generateThumbnailSVG(strokesOf(record), 240, 180);
    thumbCache.set(key, svg);
    return svg;
  }

  function guardNav() {
    if (get(viewerDirty)) {
      if (!window.confirm('You have unsaved transcript edits. Discard them?')) return false;
      clearAllViewerDirty();
    }
    return true;
  }

  function selectPage(record) {
    if (!guardNav()) return;
    setViewerSelection(record.book, idOf(record));
    recordRecentView(record.book, idOf(record));
  }

  export function goHome() {
    if (!guardNav()) return;
    clearViewerSelection();
  }

  function toggleBook(book) {
    const next = new Set(expandedBooks);
    next.has(book) ? next.delete(book) : next.add(book);
    expandedBooks = next;
  }

  function prevSpread() {
    if (currentIndex <= 0 || !guardNav()) return;
    const step = twoPageMode ? 2 : 1;
    const rec = currentBookPages[Math.max(0, currentIndex - step)];
    setViewerSelection(rec.book, idOf(rec));
    recordRecentView(rec.book, idOf(rec));
  }

  function nextSpread() {
    if (!guardNav()) return;
    const step = twoPageMode ? 2 : 1;
    const t = currentIndex + step;
    if (t < currentBookPages.length) {
      const rec = currentBookPages[t];
      setViewerSelection(rec.book, idOf(rec));
      recordRecentView(rec.book, idOf(rec));
    }
  }

  // Load a single page into the live editor canvas and switch to the Editor
  // view. Strokes are appended (deduped by id), matching the existing "Import
  // Strokes" behaviour — non-destructive to anything already on the canvas.
  async function loadRecordIntoEditor(record) {
    if (!record || !guardNav()) return;
    await importStrokesFromFolder(record);
    setViewerMode('editor');
  }

  export function setContentMode(mode) {
    if (mode === contentMode) return;
    if (!guardNav()) return;
    contentMode = mode;
  }

  export function toggleSpread() {
    if (!guardNav()) return;
    twoPageMode = !twoPageMode;
  }

  // Reflect a saved transcript back into the store so the display refreshes.
  // `pageId` is the unique-within-book file identifier (string, incl. suffix).
  function applyTranscriptToStore(book, pageId, lines) {
    logseqPages.update((pages) =>
      pages.map((p) => {
        if (p.book !== book || idOf(p) !== String(pageId)) return p;
        const transcriptionText = lines.length
          ? lines.map((l) => '  '.repeat(l.indentLevel || 0) + (l.text || '')).join('\n')
          : null;
        const pageDoc = p.pageDoc
          ? { ...p.pageDoc, transcript: { ...(p.pageDoc.transcript || {}), lines } }
          : p.pageDoc;
        return {
          ...p,
          pageDoc,
          strokeData: pageDoc,
          transcriptionText,
          transcribed: !!transcriptionText,
        };
      })
    );
  }

  async function rescan() {
    thumbCache.clear();
    await scanLocalPages();
  }

  onMount(() => {
    if ($logseqPages.length === 0 && !$isScanning) {
      scanLocalPages();
    }
  });
</script>

<div class="book-viewer">
  {#if !leftRecord}
    <!-- Home / page picker -->
    <div class="bv-home">
      <div class="bv-home-head">
        <h2>Books &amp; Pages</h2>
        <button class="bv-rescan" on:click={rescan} disabled={$isScanning}>
          {$isScanning ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      {#if $isScanning && $logseqPages.length === 0}
        <div class="bv-msg">Scanning data folder…</div>
      {:else if books.length === 0}
        <div class="bv-msg">
          <p>No saved pages found.</p>
          <p class="sub">Capture and save pages, or check your data folder in Settings.</p>
        </div>
      {:else}
        {#if recentRecords.length}
          <section class="bv-section">
            <button class="bv-section-header" on:click={() => (recentOpen = !recentOpen)}>
              <span class="bv-chevron" class:open={recentOpen}>▸</span>
              <span class="bv-section-title">Recent</span>
              <span class="bv-count">{recentRecords.length}</span>
            </button>
            {#if recentOpen}
              <div class="bv-grid">
                {#each recentRecords as r (`${r.book}:${idOf(r)}`)}
                  <button class="bv-card" on:click={() => selectPage(r)} title="{aliasFor(r.book)} — P{idOf(r)}">
                    <div class="bv-thumb">
                      {#await thumbAsync(r) then svg}{@html svg}{/await}
                    </div>
                    <div class="bv-label">{aliasFor(r.book)} — P{idOf(r)}</div>
                  </button>
                {/each}
              </div>
            {/if}
          </section>
        {/if}

        {#each books as b (b)}
          <section class="bv-section">
            <button class="bv-section-header" on:click={() => toggleBook(b)}>
              <span class="bv-chevron" class:open={expandedBooks.has(b)}>▸</span>
              <span class="bv-section-title">{aliasFor(b)}</span>
              <span class="bv-count">{grouped[b].length}</span>
            </button>
            {#if expandedBooks.has(b)}
              <div class="bv-grid">
                {#each grouped[b] as r (`${r.book}:${idOf(r)}`)}
                  <button class="bv-card" on:click={() => selectPage(r)} title="P{idOf(r)} · {strokesOf(r).length} strokes">
                    <div class="bv-thumb">
                      {#await thumbAsync(r) then svg}{@html svg}{/await}
                    </div>
                    <div class="bv-label">P{idOf(r)}</div>
                  </button>
                {/each}
              </div>
            {/if}
          </section>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Page / spread view -->
    <div class="bv-body" class:spread={twoPageMode}>
      {#key `${leftRecord.book}:${idOf(leftRecord)}`}
        <div class="bv-page">
          <PageSpreadView
            record={leftRecord}
            bookAlias={aliasFor(leftRecord.book)}
            {contentMode}
            {hasPrev}
            hasNext={twoPageMode ? false : hasNextSingle}
            onPrev={prevSpread}
            onNext={twoPageMode ? null : nextSpread}
            onTranscriptSaved={applyTranscriptToStore}
            onLoadIntoEditor={() => loadRecordIntoEditor(leftRecord)}
          />
        </div>
      {/key}

      {#if twoPageMode}
        <div class="bv-spine"></div>
        {#if rightRecord}
          {#key `${rightRecord.book}:${idOf(rightRecord)}`}
            <div class="bv-page">
              <PageSpreadView
                record={rightRecord}
                bookAlias={aliasFor(rightRecord.book)}
                {contentMode}
                hasPrev={false}
                hasNext={hasNextSpread}
                onPrev={null}
                onNext={nextSpread}
                onTranscriptSaved={applyTranscriptToStore}
                onLoadIntoEditor={() => loadRecordIntoEditor(rightRecord)}
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

  /* ---- home ---- */
  .bv-home {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }
  .bv-home-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .bv-home-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
  }
  .bv-rescan {
    padding: 5px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
  }
  .bv-rescan:hover:not(:disabled) { background: #f0f0f0; }
  .bv-rescan:disabled { opacity: 0.5; cursor: not-allowed; }

  .bv-msg {
    color: #999;
    font-size: 14px;
    padding: 40px 0;
    text-align: center;
  }
  .bv-msg .sub { font-size: 12px; color: #bbb; margin-top: 6px; }

  .bv-section { margin-bottom: 8px; }
  .bv-section-header {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 4px;
    background: none;
    border: none;
    border-bottom: 1px solid #ececec;
    cursor: pointer;
    text-align: left;
  }
  .bv-section-header:hover { background: #fafafa; }
  .bv-section-title {
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }
  .bv-chevron {
    display: inline-block;
    color: #999;
    font-size: 12px;
    transition: transform 0.15s;
  }
  .bv-chevron.open { transform: rotate(90deg); }
  .bv-count {
    font-size: 11px;
    color: #888;
    font-weight: 500;
    background: #eee;
    border-radius: 10px;
    padding: 1px 9px;
  }

  .bv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
    margin: 12px 0 18px;
  }
  .bv-card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: all 0.15s;
  }
  .bv-card:hover {
    border-color: #4a7cf7;
    box-shadow: 0 2px 8px rgba(74, 124, 247, 0.15);
    transform: translateY(-1px);
  }
  .bv-thumb {
    height: 150px;
    background: #fafafa;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-bottom: 1px solid #f0f0f0;
    padding: 6px;
  }
  .bv-thumb :global(svg) { max-width: 100%; max-height: 100%; }
  .bv-label {
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 500;
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- page / spread ---- */
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
