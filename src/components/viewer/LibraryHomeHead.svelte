<!--
  LibraryHomeHead.svelte — the Library home's header row: title and summary,
  Group by Notebook | Tag (v3.1.0), the sort chips for that grouping, the
  Suggestions (n) entry when there are unreviewed project numbers, and
  Rescan. Choices persist per viewer (stores/library.js).
-->
<script>
  import {
    savedPages, isScanning, librarySort, setLibrarySort, libraryGroupBy, setLibraryGroupBy,
    libraryTagSort, setLibraryTagSort, tagCardList, untaggedSummary
  } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { suggestionCount, ensureSuggestionScan } from '$stores/tag-suggestions.js';
  import { openLibraryView } from '$stores/viewer.js';
  import { loadTimeline } from '$stores/timeline.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { clearPageCache } from '$lib/viewer/page-cache.js';
  import { thumbs } from '$lib/viewer/thumbs.js';
  import { SORT_ORDERS } from '$lib/library-home.js';
  import { TAG_SORT_ORDERS } from '$lib/tags.js';
  import { plural } from '$lib/plural.js';

  /** How many notebooks there are (0 hides the controls). */
  export let notebookCount = 0;

  $: byTag = $libraryGroupBy === 'tag';
  $: orders = byTag ? TAG_SORT_ORDERS : SORT_ORDERS;
  $: current = byTag ? $libraryTagSort : $librarySort;
  $: totalPages = $savedPages.length;
  // The suggestion pass reads stored transcripts only; it reruns after a scan.
  $: if ($savedPages && !$isScanning) ensureSuggestionScan();
  $: summary = byTag
    ? `${$tagCardList.length} ${plural($tagCardList.length, 'tag')} · ${$untaggedSummary.pageCount} of ${totalPages} ${plural(totalPages, 'page')} untagged`
    : `${notebookCount} ${plural(notebookCount, 'notebook')} · ${totalPages} ${plural(totalPages, 'page')}`;

  function sortBy(id) {
    if (byTag) setLibraryTagSort(id);
    else setLibrarySort(id);
  }

  async function rescan() {
    thumbs.clear();
    clearPageCache();
    await scanLocalPages();
    loadTimeline({ silent: true });
  }
</script>

<div class="lh-head">
  <h2>Library</h2>
  {#if notebookCount}
    <span class="lh-sum">{summary}</span>
    <span class="seg" role="group" aria-label="Group by">
      <button type="button" class:on={!byTag} aria-pressed={!byTag} on:click={() => setLibraryGroupBy('book')}>Notebook</button>
      <button type="button" class:on={byTag} aria-pressed={byTag} on:click={() => setLibraryGroupBy('tag')}>Tag</button>
    </span>
    <div class="lh-sort" role="group" aria-label={byTag ? 'Sort tags' : 'Sort notebooks'}>
      {#each orders as o (o.id)}
        <button type="button" class="chip" class:on={current === o.id} aria-pressed={current === o.id} on:click={() => sortBy(o.id)}>{o.label}</button>
      {/each}
    </div>
  {/if}
  <span class="grow"></span>
  {#if $suggestionCount > 0}
    <button class="lh-sug" on:click={() => openLibraryView({ kind: 'suggestions' })} title="Project numbers found in transcripts, to tag or dismiss">
      Suggestions <span class="badge">{$suggestionCount}</span>
    </button>
  {/if}
  <button class="lh-rescan" on:click={rescan} disabled={$isScanning || !$dataFolderReady}>
    {$isScanning ? 'Scanning…' : 'Rescan'}
  </button>
</div>

<style>
  .lh-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 16px; }
  .lh-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
  }
  .lh-sum { font-size: 13px; color: #888; }
  .grow { flex: 1; }

  .seg { display: inline-flex; border: 1px solid #ddd; border-radius: 7px; overflow: hidden; }
  .seg button { padding: 4px 12px; border: none; background: #fff; color: #666; font-size: 12px; cursor: pointer; }
  .seg button + button { border-left: 1px solid #ddd; }
  .seg button.on { background: #262650; color: #fff; box-shadow: inset 0 -2px 0 #4a7cf7; }

  .lh-sort { display: flex; gap: 4px; }
  .chip {
    padding: 4px 11px;
    border: 1px solid #ddd;
    border-radius: 14px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
  }
  .chip:hover { border-color: #bbb; color: #222; }
  .chip.on { background: #eef3ff; border-color: #4a7cf7; color: #2c56c4; font-weight: 600; }

  .lh-rescan {
    padding: 5px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
  }
  .lh-rescan:hover:not(:disabled) { background: #f0f0f0; }
  .lh-sug {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid #e0b84a;
    border-radius: 6px;
    background: #fff8e1;
    color: #7a5200;
    font-size: 12px;
    cursor: pointer;
  }
  .lh-sug:hover { background: #fff1c4; }
  .badge { padding: 0 6px; border-radius: 99px; background: #e0a200; color: #fff; font-size: 11px; font-weight: 600; }
  .lh-rescan:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
