<!--
  NotebookPages.svelte — one notebook's pages as thumbnails (reading-first
  package E): what a notebook card, a Notebook search result and the
  breadcrumb's notebook crumb open. Each tile: page number, first written day
  and ✓ when transcribed. "Go to page…" is the pane toolbar's (BookViewer
  goToPage, resolveGoToPage), as in the reader.

  A volume ("390v2") is its own notebook with its own pages; suffixed pages
  (P151b) sit in scan order after their integer page. Thumbnails load only
  when on screen (PageThumb).
-->
<script>
  import { onMount } from 'svelte';
  import { pagesByBook, bookAliases, libraryPageDates, ensureTimelineLoaded } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { parseBookKey } from '$lib/volumes.js';
  import { pageTiles, shortDay, writtenRange } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';
  import PageThumb from './PageThumb.svelte';

  /** Book key. */
  export let book;
  /** (record) => void */
  export let onOpen = () => {};

  $: records = $pagesByBook[book] || [];
  $: tiles = pageTiles(records, book, $libraryPageDates);
  $: name = formatBookName(book, $bookAliases, 'alias-only');
  $: volume = parseBookKey(book)?.volume || 1;
  $: transcribed = tiles.filter((t) => t.transcribed).length;
  $: firsts = tiles.map((t) => t.first).filter(Boolean).sort();
  $: lasts = tiles.map((t) => t.last).filter(Boolean).sort();
  $: range = writtenRange(firsts[0], lasts[lasts.length - 1]);

  function tileTitle(t) {
    const when = t.first ? writtenRange(t.first, t.last) : 'no dated ink';
    return `P${t.pageId} · ${(t.record.strokeCount || 0).toLocaleString()} strokes · ${when}${t.transcribed ? ' · transcribed' : ''}`;
  }

  onMount(ensureTimelineLoaded);
</script>

<div class="np">
  <div class="np-head">
    <h2>{name}</h2>
    {#if volume > 1}<span class="np-vol">Vol {volume}</span>{/if}
    <span class="np-sum">
      {[`${tiles.length} ${plural(tiles.length, 'page')}`, `${transcribed} transcribed`, range].filter(Boolean).join(' · ')}
    </span>
  </div>

  <div class="np-grid">
    {#each tiles as t (t.pageId)}
      <button type="button" class="np-tile" on:click={() => onOpen(t.record)} title={tileTitle(t)}>
        <PageThumb {book} pageId={t.pageId} height="150px" />
        <span class="np-label">
          <span class="np-page">P{t.pageId}</span>
          {#if t.first}<span class="np-date">{shortDay(t.first)}{#if t.days > 1}<span class="np-more">+{t.days - 1}</span>{/if}</span>{/if}
          {#if t.transcribed}<span class="np-tx" aria-label="transcribed">✓</span>{/if}
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .np { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .np-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 16px; }
  .np-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .np-vol {
    padding: 1px 7px;
    border-radius: 9px;
    background: #eef3ff;
    color: #3a5fc8;
    font-size: 12px;
    font-weight: 600;
  }
  .np-sum { font-size: 13px; color: #888; }

  .np-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
  .np-tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .np-tile:hover,
  .np-tile:focus-visible {
    border-color: #4a7cf7;
    box-shadow: 0 2px 8px rgba(74, 124, 247, 0.15);
    outline: none;
  }
  .np-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border-top: 1px solid #f0f0f0;
    font-size: 12px;
    color: #444;
    white-space: nowrap;
  }
  .np-page { font-weight: 600; font-variant-numeric: tabular-nums; }
  .np-date {
    padding: 1px 6px;
    border-radius: 8px;
    background: #f2f2f2;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .np-more { margin-left: 3px; color: #999; }
  .np-tx { margin-left: auto; color: #2f7d4f; font-weight: 700; }
</style>
