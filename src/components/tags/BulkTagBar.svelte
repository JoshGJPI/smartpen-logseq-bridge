<!--
  BulkTagBar.svelte — the floating bar of a page grid's select mode (v3.1.0
  page tags; mockup 3). Add a tag to every ticked page (type or pick, Enter),
  remove one of the tags they carry (Remove a tag ▾), Select all, Done.
  Each change is one locked write of the sidecar (stores/tags.js).
-->
<script>
  import { pageTags, addTagToPages, removeTagFromPages } from '$stores/tags.js';
  import { compareTags } from '$lib/tags.js';
  import { menuKeyAction } from '$lib/menu-keys.js';
  import { plural } from '$lib/plural.js';
  import TagInput from './TagInput.svelte';
  import TagChip from './TagChip.svelte';

  /** Page keys ticked. */
  export let keys = [];
  export let disabled = false;
  export let onSelectAll = () => {};
  export let onDone = () => {};

  let status = '';
  let removeOpen = false;

  // Tags on the ticked pages, with how many of them carry each.
  $: onSelection = (() => {
    const counts = new Map();
    for (const k of keys) for (const t of $pageTags[k] || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => compareTags(a.tag, b.tag));
  })();
  $: if (!keys.length || !onSelection.length) removeOpen = false;

  async function add(tag) {
    if (!keys.length) { status = 'Tick some pages first'; return; }
    const n = keys.length;
    if (await addTagToPages(keys, tag)) status = `Added “${tag}” to ${n} ${plural(n, 'page')}`;
  }

  async function remove(tag) {
    removeOpen = false;
    const n = keys.filter((k) => ($pageTags[k] || []).includes(tag)).length;
    if (await removeTagFromPages(keys, tag)) status = `Removed “${tag}” from ${n} ${plural(n, 'page')}`;
  }

  // Capture phase, so PageGrid's Escape (leave Select) sees it handled.
  function onKey(e) {
    if (menuKeyAction(e, removeOpen) === 'close') {
      e.preventDefault();
      removeOpen = false;
    }
  }
</script>

<svelte:window on:keydown|capture={onKey} />

<div class="btb" role="toolbar" aria-label="Tag selected pages">
  <b>{keys.length} selected</b>
  <div class="btb-in">
    <TagInput tags={[]} showChips={false} dark dropUp disabled={disabled || !keys.length} placeholder="Add tag to selected…" label="Add a tag to the selected pages" onAdd={add} />
  </div>
  <div class="btb-rm">
    <button type="button" disabled={disabled || !onSelection.length} aria-expanded={removeOpen} on:click={() => (removeOpen = !removeOpen)}>Remove a tag ▾</button>
    {#if removeOpen}
      <div class="btb-menu" role="menu">
        {#each onSelection as o (o.tag)}
          <button type="button" role="menuitem" on:click={() => remove(o.tag)}>
            <TagChip tag={o.tag} /><small>{o.count} of {keys.length}</small>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <button type="button" on:click={onSelectAll}>Select all</button>
  <button type="button" class="pri" on:click={onDone}>Done</button>
  {#if status}<span class="btb-status" role="status">{status}</span>{/if}
</div>

<style>
  .btb {
    position: sticky;
    bottom: 10px;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: 100%;
    margin: 14px auto 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: #262650;
    color: #fff;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    font-size: 13px;
  }
  .btb-in { min-width: 200px; }
  .btb button {
    padding: 4px 11px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
  }
  .btb button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
  .btb button:disabled { opacity: 0.45; cursor: default; }
  .btb button.pri { background: #4a7cf7; border-color: #4a7cf7; }
  .btb-rm { position: relative; }
  .btb-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    max-height: 260px;
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }
  .btb .btb-menu button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: none;
    background: none;
    color: #222;
  }
  .btb .btb-menu button:hover { background: #eef3ff; }
  .btb-menu small { color: #999; }
  .btb-status { font-size: 12px; color: #c9d4ff; }
</style>
