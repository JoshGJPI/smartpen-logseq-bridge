<!--
  LibraryContents.svelte — the Library's table of contents in the left panel
  (reading-first package C). Replaces the Pages tab beside the Library; the
  Pages tab itself (import, export, edit structure) stays with the Editor.

  Notebooks and their pages from the metadata-only scan: a dot marks a
  transcribed page, the open page (both pages of a spread) is highlighted, and a click opens the page
  in the Library (`openPageInLibrary`, which asks before dropping unsaved
  transcript edits). No page file is read here. Which notebooks are open is
  kept in a store, since this tab is unmounted when the panel collapses.
-->
<script>
  import { onMount, tick } from 'svelte';
  import {
    pagesByBook, bookIds, bookAliases, savedPages, isScanning, viewerSelection,
    openPageInLibrary, contentsOpenBooks, setContentsBookOpen, readerPages
  } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { buildContents } from '$lib/library-contents.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';

  let listEl;

  $: contents = buildContents($pagesByBook, $bookIds, (b) => formatBookName(b, $bookAliases, 'alias-only'));
  $: sel = $viewerSelection;
  $: totalPages = contents.reduce((n, b) => n + b.pages.length, 0);

  // Opening a page opens its notebook here, so the highlight is visible; the
  // notebook can still be folded afterwards.
  let lastSelKey = null;
  $: selKey = sel ? `${sel.book}/${sel.pageId}` : null;
  $: if (selKey !== lastSelKey) {
    lastSelKey = selKey;
    if (sel) setContentsBookOpen(sel.book, true);
  }

  // Both pages of a spread (readerPages, set by BookViewer); the selection
  // alone before the reader has reported.
  $: shown = $readerPages.length ? $readerPages : sel ? [sel.pageId] : [];
  $: isCurrent = (book, pageId) => !!sel && String(sel.book) === book && shown.includes(pageId);

  onMount(async () => {
    if ($dataFolderReady && $savedPages.length === 0 && !$isScanning) scanLocalPages();
    await tick();
    listEl?.querySelector('.page.current')?.scrollIntoView({ block: 'center' });
  });
</script>

<div class="contents">
  {#if !$dataFolderReady}
    <p class="note">Choose a data folder in Settings to see your notebooks.</p>
  {:else if $isScanning && contents.length === 0}
    <p class="note">Scanning the data folder…</p>
  {:else if contents.length === 0}
    <p class="note">No saved pages yet.</p>
  {:else}
    <p class="summary">
      {contents.length} {plural(contents.length, 'notebook')} · {totalPages} {plural(totalPages, 'page')}
      <span class="legend"><i class="dot"></i> transcribed</span>
    </p>
    <div class="list" bind:this={listEl}>
      {#each contents as b (b.book)}
        {@const open = $contentsOpenBooks.has(b.book)}
        <section class="book">
          <button type="button" class="book-head" aria-expanded={open} on:click={() => setContentsBookOpen(b.book)}>
            <span class="chev" class:open>▸</span>
            <span class="name" title={b.name}>{b.name}</span>
            <span class="count">{b.pages.length} pp · {b.transcribed} <i class="dot"></i></span>
          </button>
          {#if open}
            <div class="pages">
              {#each b.pages as p (p.pageId)}
                <button
                  type="button"
                  class="page"
                  class:current={isCurrent(b.book, p.pageId)}
                  aria-current={isCurrent(b.book, p.pageId) ? 'page' : null}
                  title={`P${p.pageId} · ${p.strokeCount.toLocaleString()} ${plural(p.strokeCount, 'stroke')}${p.transcribed ? ' · transcribed' : ''}`}
                  on:click={() => openPageInLibrary(b.book, p.pageId)}
                >
                  P{p.pageId}
                  {#if p.transcribed}<i class="dot" aria-label="transcribed"></i>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .contents {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .note,
  .summary {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .summary { display: flex; align-items: center; gap: 10px; }
  .legend { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; }

  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6ea8fe;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .list::-webkit-scrollbar { width: 8px; }
  .list::-webkit-scrollbar-track { background: var(--bg-tertiary); border-radius: 4px; }
  .list::-webkit-scrollbar-thumb { background: #3a3a60; border-radius: 4px; }

  .book { border-bottom: 1px solid var(--border); }

  .book-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 4px;
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }

  .book-head:hover { background: rgba(255, 255, 255, 0.04); }

  .chev { color: var(--text-secondary); font-size: 0.75rem; transition: transform 0.15s; }
  .chev.open { transform: rotate(90deg); }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pages {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
    gap: 4px;
    padding: 2px 4px 10px 20px;
  }

  .page {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .page:hover { color: var(--text-primary); border-color: var(--selected-border); }

  .page.current {
    background: var(--selected-bg);
    border-color: var(--selected-line);
    color: white;
    font-weight: 600;
    box-shadow: inset 0 -2px 0 var(--selected-line);
  }
</style>
