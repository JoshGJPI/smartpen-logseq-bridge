<!--
  LibraryHome.svelte — the Library with no notebook or page open (reading-first
  package E): a Recent pages row, then one card per notebook (NotebookCard),
  sorted by the chips (Recently written / Name / Most pages). Grouped by Tag
  (v3.1.0) the cards are tags instead (TagCardGrid). The header row is
  LibraryHomeHead.

  The cards' numbers come from the metadata-only scan and the capture-date
  index (stores/library.js); the only page reads are the thumbnails on screen
  (PageThumb → lib/viewer/thumbs.js, which keeps out of the reader's cache).
-->
<script>
  import { onMount } from 'svelte';
  import {
    savedPages, pagesByBook, bookAliases, isScanning, recentViews,
    notebookCardList, librarySort, libraryGroupBy, ensureTimelineLoaded
  } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { formatBookName } from '$utils/formatting.js';
  import { sortNotebooks, recentRecords } from '$lib/library-home.js';
  import NotebookCard from './NotebookCard.svelte';
  import PageThumb from './PageThumb.svelte';
  import LibraryHomeHead from './LibraryHomeHead.svelte';
  import TagCardGrid from '../tags/TagCardGrid.svelte';

  /** (record) => void: open a page in the reader. */
  export let onOpen = () => {};
  /** (book) => void: open a notebook's page grid. */
  export let onOpenNotebook = () => {};

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

  $: cards = sortNotebooks($notebookCardList, $librarySort);
  $: recent = recentRecords($recentViews, $pagesByBook);

  function aliasFor(book) {
    return formatBookName(book, $bookAliases, 'alias-only');
  }

  onMount(() => {
    if ($dataFolderReady && $savedPages.length === 0 && !$isScanning) scanLocalPages();
    ensureTimelineLoaded();
  });
</script>

<div class="lh">
  <LibraryHomeHead notebookCount={cards.length} />

  {#if !$dataFolderReady}
    <div class="lh-msg">
      <p>No data folder yet.</p>
      <p class="sub">Choose the folder your pages are saved in (Settings → Data Folder) to read your notebooks here.</p>
    </div>
  {:else if $isScanning && cards.length === 0}
    <div class="lh-msg">Reading your notebooks…</div>
  {:else if cards.length === 0}
    <div class="lh-msg">
      <p>No notebooks to read yet.</p>
      <p class="sub">Pages you write and save appear here, one card per notebook.</p>
    </div>
  {:else}
    {#if recent.length}
      <section class="lh-recent" aria-label="Recent pages">
        <h3>Recent pages</h3>
        <div class="lh-row">
          {#each recent as r (`${r.book}/${idOf(r)}`)}
            <button type="button" class="rp" on:click={() => onOpen(r)} title="{aliasFor(r.book)}, P{idOf(r)}">
              <PageThumb book={r.book} pageId={idOf(r)} height="96px" />
              <span class="rp-label"><span class="rp-book">{aliasFor(r.book)}</span> P{idOf(r)}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if $libraryGroupBy === 'tag'}
      <TagCardGrid />
    {:else}
      <div class="lh-grid">
        {#each cards as card (card.book)}
          <NotebookCard {card} onOpen={onOpenNotebook} />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .lh { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }

  .lh-msg { color: #999; font-size: 14px; padding: 40px 0; text-align: center; }
  .lh-msg p { margin: 0; }
  .lh-msg .sub { font-size: 12px; color: #aaa; margin-top: 6px; }

  .lh-recent { margin-bottom: 20px; }
  .lh-recent h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #666; }
  .lh-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .rp {
    flex: 0 0 132px;
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
  }
  .rp:hover { border-color: #4a7cf7; }
  .rp-label {
    padding: 5px 8px;
    border-top: 1px solid #f0f0f0;
    font-size: 12px;
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rp-book { color: #888; }

  .lh-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 16px;
  }
</style>
