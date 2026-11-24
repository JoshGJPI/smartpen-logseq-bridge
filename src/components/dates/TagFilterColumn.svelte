<!--
  TagFilterColumn.svelte — the book filter's tag column.

  Lists only tags on pages of the notebooks the book and type filters leave in
  (`timelineTags`), so no row can filter to nothing by notebook alone. Ticking
  tags keeps pages with ANY of them; none ticked = no tag filter. The count is
  pages with ink in the selected range; tags with none there are dimmed and
  sorted with the rest. Session-only (`timelineTagFilter`).
-->
<script>
  import { timelineTags, timelineTagFilter, setTagIncluded, includeOnlyTag, clearTagFilter } from '$stores/timeline.js';
  import { tagInfo } from '$stores/tags.js';
  import { tagLabel, tagTypeOf } from '$lib/tags.js';

  let query = '';

  $: chosen = $timelineTagFilter;
  $: q = query.trim().toLowerCase();
  $: rows = $timelineTags.filter((r) => !q || r.tag.includes(q) || tagLabel(r.tag, $tagInfo).toLowerCase().includes(q));
</script>

<div class="tf">
  <div class="bf-top">
    <span>Tags</span>
    <button type="button" class="bf-link" on:click={clearTagFilter} disabled={chosen.size === 0}
      title="Show pages with or without tags">Any</button>
  </div>
  {#if $timelineTags.length > 8}
    <input class="tf-search" type="search" placeholder="Find a tag" bind:value={query} aria-label="Find a tag" />
  {/if}
  <div class="tf-list">
    {#each rows as r (r.tag)}
      {@const type = tagTypeOf(r.tag, $tagInfo)}
      <div class="bf-row" class:quiet={r.inRange === 0}>
        <label>
          <input type="checkbox" checked={chosen.has(r.tag)}
            on:change={(e) => setTagIncluded(r.tag, e.currentTarget.checked)} />
          <span class="dot {type}" aria-hidden="true"></span>
          <span class="bf-name" title={r.tag}>{tagLabel(r.tag, $tagInfo)}</span>
        </label>
        <em title="Pages with ink in the selected range">{r.inRange || '—'}</em>
        <button type="button" class="bf-link only" on:click={() => includeOnlyTag(r.tag)}
          title="Show only this tag">Only</button>
      </div>
    {/each}
    {#if $timelineTags.length === 0}
      <p class="bf-note">No tagged pages in these notebooks.</p>
    {:else if rows.length === 0}
      <p class="bf-note">No tag matches.</p>
    {/if}
  </div>
</div>

<style>
  .tf { display: flex; flex-direction: column; min-height: 0; }
  .tf-list { overflow-y: auto; min-height: 0; flex: 1; }
  .tf-search {
    margin: 0 12px 6px;
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 5px;
    border: 1px solid rgba(128, 128, 140, 0.35);
    background: transparent;
    color: inherit;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #9a9aa6; }
  .dot.project { background: #0f766e; }
  .dot.person { background: #6a3fa8; }

  /* Row styles mirror BookFilterMenu's (Svelte scopes styles per component). */
  .bf-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 12px 6px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .bf-row { display: flex; align-items: center; gap: 8px; padding: 4px 12px; font-size: 13px; }
  .bf-row label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
  .bf-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bf-row em { font-style: normal; font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.75; }
  .bf-row.quiet .bf-name { opacity: 0.6; }
  .bf-row:hover { background: rgba(128, 128, 140, 0.08); }
  .bf-link { background: none; border: none; padding: 0 2px; font-size: 12px; font-weight: 600; cursor: pointer; color: inherit; }
  .bf-link:disabled { opacity: 0.4; cursor: default; }
  .bf-link.only { visibility: hidden; }
  .bf-row:hover .bf-link.only,
  .bf-row:focus-within .bf-link.only { visibility: visible; }
  .bf-note { margin: 6px 12px 0; font-size: 11px; line-height: 1.4; opacity: 0.8; }
</style>
