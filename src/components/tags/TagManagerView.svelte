<!--
  TagManagerView.svelte — Library › Manage tags (v3.2.0): the tag table
  (TagManager) as a Library view beside the notebooks and the tag cards, where
  pages and notebooks are already managed. It was a dialog under Settings →
  Tags. Opened from the Library home's Manage tags button (openLibraryView
  `{ kind: 'tags' }`); the breadcrumb's Library goes back.

  v3.22.0: a row's Details opens that tag's Details panel (TagDetails) beside
  the table; it closes when the tag is gone (renamed, merged or deleted).
-->
<script>
  import { tagStatsList } from '$stores/tags.js';
  import { plural } from '$lib/plural.js';
  import TagManager from './TagManager.svelte';
  import TagDetails from './TagDetails.svelte';

  let selected = null;

  $: count = $tagStatsList.length;
  $: if (selected && !$tagStatsList.some((r) => r.tag === selected)) selected = null;
</script>

<div class="tmv">
  <div class="tmv-head">
    <h2>Manage tags</h2>
    <span class="tmv-sum">{count} {plural(count, 'tag')} · rename, merge or delete; Details for a tag's type, names and notes; click a tag to see its pages</span>
  </div>
  <div class="tmv-body" class:split={selected}>
    <TagManager {selected} onDetails={(t) => (selected = t)} />
    {#if selected}
      {#key selected}
        <TagDetails tag={selected} onClose={() => (selected = null)} />
      {/key}
    {/if}
  </div>
</div>

<style>
  .tmv { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .tmv-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 16px; }
  .tmv-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .tmv-sum { font-size: 13px; color: #888; }
  .tmv-body { display: flex; align-items: flex-start; gap: 16px; }
  .tmv-body :global(.tm) { flex: 1; min-width: 0; max-width: 820px; }
  .tmv-body :global(.td) { flex: 0 0 320px; position: sticky; top: 0; }
  @media (max-width: 1000px) {
    .tmv-body.split { flex-direction: column; }
    .tmv-body :global(.td) { flex: none; width: 100%; max-width: 820px; position: static; box-sizing: border-box; }
  }
</style>
