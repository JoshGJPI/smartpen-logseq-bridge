<!--
  TagPages.svelte — the pages under one tag, or the Untagged pages, across
  every notebook (v3.1.0 page tags; mockup 5): what a tag card, the Untagged
  card and a Tags search result open. The same PageGrid as a notebook's pages,
  with each label naming its notebook. Records come from the scan and the
  tag index (stores), never from reading a page.

  Sort (v3.11.0): Notebook (notebook, then page; the default) or Last edited
  (each page's latest stroke, newest first), kept per viewer (tagPageSort). It
  orders the grid only: the reader still turns through in notebook order.

  Tasks (v3.12.0): a tag's page lists its tasks to the right of the grid
  (TagTasksPanel, with the Tasks view's state chips); below it when narrow.
-->
<script>
  import { onMount } from 'svelte';
  import { savedPages, searchRecords, libraryPageDates, ensureTimelineLoaded, tagPageSort, setTagPageSort } from '$stores';
  import { pageTags, tagIndex } from '$stores/tags.js';
  import { recordsForKeys, untaggedRecords, isProjectTag, sortTagPageTiles, TAG_PAGE_SORT_ORDERS } from '$lib/tags.js';
  import { pageTiles } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';
  import PageGrid from './PageGrid.svelte';
  import TagTasksPanel from './TagTasksPanel.svelte';

  /** `{ kind: 'tag', tag }` or `{ kind: 'untagged' }` */
  export let view;
  /** (record) => void */
  export let onOpen = () => {};

  $: records = view.kind === 'tag'
    ? recordsForKeys($tagIndex.get(view.tag) || [], $searchRecords)
    : untaggedRecords($savedPages, $pageTags);
  $: tiles = sortTagPageTiles(pageTiles(records, null, $libraryPageDates), $tagPageSort);
  $: notebooks = new Set(records.map((r) => String(r.book))).size;

  onMount(ensureTimelineLoaded);
</script>

<div class="tp">
  <div class="tp-head">
    {#if view.kind === 'tag'}
      <h2>{isProjectTag(view.tag) ? 'Project' : 'Tag'}</h2>
      <TagChip tag={view.tag} />
    {:else}
      <h2>Untagged pages</h2>
    {/if}
    <span class="tp-sum">{records.length} {plural(records.length, 'page')} · {notebooks} {plural(notebooks, 'notebook')}</span>
    {#if records.length > 1}
      <div class="tp-sort" role="group" aria-label="Sort pages">
        {#each TAG_PAGE_SORT_ORDERS as o (o.id)}
          <button type="button" class:on={$tagPageSort === o.id} aria-pressed={$tagPageSort === o.id}
            title={o.title} on:click={() => setTagPageSort(o.id)}>{o.label}</button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="tp-body">
  <div class="tp-grid">
  <PageGrid
    {tiles}
    showNotebook
    origin={view.kind === 'tag' ? { kind: 'tag', tag: view.tag } : { kind: 'untagged' }}
    filterKey={view.kind === 'tag' ? `tag:${view.tag}` : 'untagged'}
    {onOpen}
    emptyText={view.kind === 'tag' ? 'No page carries this tag any more.' : 'Every page has a tag.'}
  />
  </div>
  {#if view.kind === 'tag'}<TagTasksPanel tag={view.tag} />{/if}
  </div>
</div>

<style>
  .tp { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .tp-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 16px; }
  .tp-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .tp-head :global(.tg) { font-size: 14px; padding: 2px 10px; }
  .tp-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 20px 24px; }
  .tp-grid { flex: 999 1 520px; min-width: 0; }
  .tp-sum { font-size: 13px; color: #888; }
  .tp-sort { margin-left: auto; display: flex; gap: 2px; padding: 2px; border: 1px solid #ddd; border-radius: 7px; background: #fff; }
  .tp-sort button {
    padding: 3px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #666;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tp-sort button:hover:not(.on) { background: #f2f2f4; color: #333; }
  .tp-sort button.on { background: #eef3ff; color: #2c56c4; }
</style>
