<!--
  TagPages.svelte — the pages under one tag, or the Untagged pages, across
  every notebook (v3.1.0 page tags; mockup 5): what a tag card, the Untagged
  card and a Tags search result open. The same PageGrid as a notebook's pages,
  with each label naming its notebook. Records come from the scan and the
  tag index (stores), never from reading a page.
-->
<script>
  import { onMount } from 'svelte';
  import { savedPages, searchRecords, libraryPageDates, ensureTimelineLoaded } from '$stores';
  import { pageTags, tagIndex } from '$stores/tags.js';
  import { recordsForKeys, untaggedRecords, isProjectTag } from '$lib/tags.js';
  import { pageTiles } from '$lib/library-home.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';
  import PageGrid from './PageGrid.svelte';

  /** `{ kind: 'tag', tag }` or `{ kind: 'untagged' }` */
  export let view;
  /** (record) => void */
  export let onOpen = () => {};

  $: records = view.kind === 'tag'
    ? recordsForKeys($tagIndex.get(view.tag) || [], $searchRecords)
    : untaggedRecords($savedPages, $pageTags);
  $: tiles = pageTiles(records, null, $libraryPageDates);
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
  </div>

  <PageGrid
    {tiles}
    showNotebook
    origin={view.kind === 'tag' ? { kind: 'tag', tag: view.tag } : { kind: 'untagged' }}
    filterKey={view.kind === 'tag' ? `tag:${view.tag}` : 'untagged'}
    {onOpen}
    emptyText={view.kind === 'tag' ? 'No page carries this tag any more.' : 'Every page has a tag.'}
  />
</div>

<style>
  .tp { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .tp-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 16px; }
  .tp-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .tp-head :global(.tg) { font-size: 14px; padding: 2px 10px; }
  .tp-sum { font-size: 13px; color: #888; }
</style>
