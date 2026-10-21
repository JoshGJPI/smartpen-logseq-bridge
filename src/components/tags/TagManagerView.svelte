<!--
  TagManagerView.svelte — Library › Manage tags (v3.2.0): the tag table
  (TagManager) as a Library view beside the notebooks and the tag cards, where
  pages and notebooks are already managed. It was a dialog under Settings →
  Tags. Opened from the Library home's Manage tags button (openLibraryView
  `{ kind: 'tags' }`); the breadcrumb's Library goes back.
-->
<script>
  import { tagStatsList } from '$stores/tags.js';
  import { plural } from '$lib/plural.js';
  import TagManager from './TagManager.svelte';

  $: count = $tagStatsList.length;
</script>

<div class="tmv">
  <div class="tmv-head">
    <h2>Manage tags</h2>
    <span class="tmv-sum">{count} {plural(count, 'tag')} · rename, merge or delete; click a tag to see its pages</span>
  </div>
  <TagManager />
</div>

<style>
  .tmv { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .tmv-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 16px; }
  .tmv-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .tmv-sum { font-size: 13px; color: #888; }
  .tmv :global(.tm) { max-width: 820px; }
</style>
