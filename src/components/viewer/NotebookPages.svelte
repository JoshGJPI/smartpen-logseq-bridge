<!--
  NotebookPages.svelte — one notebook's pages as thumbnails (reading-first
  package E): what a notebook card, a Notebook search result and the
  breadcrumb's notebook crumb open. The tiles, tag filter and select mode are
  the shared PageGrid (v3.1.0). "Go to page…" is the pane toolbar's
  (BookViewer goToPage, resolveGoToPage), as in the reader.

  A volume ("390v2") is its own notebook with its own pages; suffixed pages
  (P151b) sit in scan order after their integer page. Thumbnails load only
  when on screen (PageThumb).
-->
<script>
  import { onMount } from 'svelte';
  import { pagesByBook, bookAliases, libraryPageDates, ensureTimelineLoaded } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { parseBookKey } from '$lib/volumes.js';
  import { pageTiles, writtenRange } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';
  import PageGrid from '../tags/PageGrid.svelte';

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

  <PageGrid {tiles} {onOpen} />
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

</style>
