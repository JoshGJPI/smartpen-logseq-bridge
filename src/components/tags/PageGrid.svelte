<!--
  PageGrid.svelte — a Library page grid over any list of pages (v3.1.0 page
  tags; mockups 3 and 5): one notebook's pages (NotebookPages), a tag's pages
  or the Untagged pages (TagPages).

  Above the tiles, the tag filter row (TagFilterRow: tags in THIS grid, Any |
  All) and Select. Select mode ticks pages (shift-click ticks a range in the
  order shown) and brings up the bulk bar (BulkTagBar). Filter and selection
  are per view and not persisted. Opening a page is the caller's (onOpen →
  BookViewer's guarded openRecord). Tiles read tags from the store; thumbnails
  load only on screen (PageThumb).
-->
<script>
  import { pageTags } from '$stores/tags.js';
  import { bookAliases } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { pendingSuggestions } from '$stores/tag-suggestions.js';
  import { formatBookName } from '$utils/formatting.js';
  import { recordTagKey, filterByTags, filterChoices } from '$lib/tags.js';
  import { plural } from '$lib/plural.js';
  import TagFilterRow from './TagFilterRow.svelte';
  import BulkTagBar from './BulkTagBar.svelte';
  import PageTile from './PageTile.svelte';

  /** `pageTiles()` entries: `{ record, pageId, first, last, days, transcribed }` */
  export let tiles = [];
  /** Name each page's notebook on its label (a grid across notebooks). */
  export let showNotebook = false;
  /** (record) => void */
  export let onOpen = () => {};
  export let emptyText = 'No pages.';

  let chosen = [];
  let mode = 'any';
  let selecting = false;
  let selected = new Set();
  let anchor = null;

  $: items = tiles.map((t) => {
    const key = recordTagKey(t.record);
    return { ...t, key, tags: $pageTags[key] || [] };
  });
  // A chosen tag that no page here carries any more drops out of the filter.
  $: if (chosen.some((c) => !items.some((it) => it.tags.includes(c)))) {
    chosen = chosen.filter((c) => items.some((it) => it.tags.includes(c)));
  }
  $: shown = filterByTags(items, chosen, mode);
  $: choices = filterChoices(items, chosen, mode);
  $: hasTags = items.some((it) => it.tags.length);
  $: selectedKeys = shown.filter((it) => selected.has(it.key)).map((it) => it.key);

  const nameOf = (book) => formatBookName(book, $bookAliases, 'alias-only');

  function toggleTag(tag) {
    chosen = chosen.includes(tag) ? chosen.filter((t) => t !== tag) : [...chosen, tag];
  }

  function click(e, i) {
    const it = shown[i];
    if (!selecting) return onOpen(it.record);
    const next = new Set(selected);
    if (e.shiftKey && anchor != null && shown[anchor]) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      for (let k = a; k <= b; k++) next.add(shown[k].key);
    } else {
      if (next.has(it.key)) next.delete(it.key);
      else next.add(it.key);
      anchor = i;
    }
    selected = next;
  }

  function setSelecting(on) {
    selecting = on;
    selected = new Set();
    anchor = null;
  }

  function onKey(e) {
    if (e.key === 'Escape' && selecting && !e.defaultPrevented) {
      e.preventDefault();
      setSelecting(false);
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="pg">
  {#if items.length}
    <div class="pg-bar">
      {#if hasTags || chosen.length}
        <div class="pg-filter">
          <TagFilterRow {choices} {chosen} {mode} onToggle={toggleTag} onMode={(m) => (mode = m)} onClear={() => (chosen = [])} />
        </div>
      {:else}
        <span class="grow"></span>
      {/if}
      {#if chosen.length}<span class="pg-count">{shown.length} of {items.length} {plural(items.length, 'page')}</span>{/if}
      <button type="button" class="pg-sel" class:on={selecting} aria-pressed={selecting} disabled={!$dataFolderReady} on:click={() => setSelecting(!selecting)}>
        {selecting ? '☑ Selecting' : '☐ Select'}
      </button>
    </div>
  {/if}

  {#if shown.length}
    <div class="pg-grid">
      {#each shown as it, i (it.key)}
        <PageTile
          tile={it}
          notebook={showNotebook ? nameOf(it.record.book) : ''}
          {selecting}
          selected={selected.has(it.key)}
          pending={!!$pendingSuggestions.get(it.key)}
          onClick={(e) => click(e, i)}
        />
      {/each}
    </div>
  {:else}
    <p class="pg-empty">{items.length ? 'No page here has all of these tags.' : emptyText}</p>
  {/if}

  {#if selecting}
    <BulkTagBar
      keys={selectedKeys}
      disabled={!$dataFolderReady}
      onSelectAll={() => (selected = new Set(shown.map((it) => it.key)))}
      onDone={() => setSelecting(false)}
    />
  {/if}
</div>

<style>
  .pg { display: flex; flex-direction: column; min-width: 0; }
  .pg-bar { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
  .pg-filter { flex: 1; min-width: 0; }
  .grow { flex: 1; }
  .pg-count { align-self: center; font-size: 12px; color: #888; white-space: nowrap; }
  .pg-sel {
    flex-shrink: 0;
    padding: 5px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
  }
  .pg-sel:hover:not(:disabled) { background: #f0f0f0; }
  .pg-sel.on { border-color: #4a7cf7; color: #2c56c4; background: #eef3ff; }
  .pg-sel:disabled { opacity: 0.5; cursor: default; }
  .pg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
  .pg-empty { margin: 30px 0; text-align: center; color: #999; font-size: 13px; }
</style>
