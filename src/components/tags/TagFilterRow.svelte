<!--
  TagFilterRow.svelte — narrow a page grid by tag (v3.1.0 page tags; mockup 5).

  Chosen tags first (highlighted, click to drop), then the tags present in the
  current grid with their counts (`filterChoices`: in All mode only tags that
  still match, so a click can never empty the grid), Any | All, Clear. State
  lives in the grid (PageGrid) and is not persisted.
-->
<script>
  import TagChip from './TagChip.svelte';

  /** `[{ tag, count }]` from filterChoices() */
  export let choices = [];
  export let chosen = [];
  /** 'any' | 'all' */
  export let mode = 'any';
  export let onToggle = (tag) => {};
  export let onMode = (mode) => {};
  export let onClear = () => {};
</script>

<div class="tfr" role="group" aria-label="Filter pages by tag">
  <span class="lb">Filter</span>
  {#each chosen as t (t)}
    <TagChip tag={t} on onClick={() => onToggle(t)} title="Stop filtering by {t}" />
  {/each}
  {#if chosen.length && choices.length}<span class="sep" aria-hidden="true">|</span>{/if}
  {#each choices as c (c.tag)}
    <TagChip tag={c.tag} count={c.count} onClick={() => onToggle(c.tag)} title="Show pages tagged {c.tag}" />
  {/each}
  {#if !chosen.length && !choices.length}<span class="none">No tags on these pages yet.</span>{/if}
  <span class="grow"></span>
  {#if chosen.length > 1}
    <span class="seg" role="group" aria-label="How chosen tags combine">
      <button type="button" class:on={mode === 'any'} aria-pressed={mode === 'any'} title="Pages with at least one chosen tag" on:click={() => onMode('any')}>Any</button>
      <button type="button" class:on={mode === 'all'} aria-pressed={mode === 'all'} title="Pages with every chosen tag" on:click={() => onMode('all')}>All</button>
    </span>
  {/if}
  {#if chosen.length}<button type="button" class="clear" on:click={onClear}>Clear</button>{/if}
</div>

<style>
  .tfr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border: 1px solid #e6e6e6;
    border-radius: 8px;
    background: #fff;
    min-width: 0;
  }
  .lb { margin-right: 2px; font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase; color: #999; }
  .sep { margin: 0 2px; color: #ccc; }
  .none { font-size: 12px; color: #aaa; }
  .grow { flex: 1; }
  .seg { display: inline-flex; border: 1px solid #ddd; border-radius: 7px; overflow: hidden; }
  .seg button { padding: 2px 10px; border: none; background: #fff; color: #666; font-size: 12px; cursor: pointer; }
  .seg button + button { border-left: 1px solid #ddd; }
  .seg button.on { background: #262650; color: #fff; box-shadow: inset 0 -2px 0 #4a7cf7; }
  .clear { padding: 2px 9px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 11px; cursor: pointer; }
  .clear:hover { background: #f0f0f0; }
</style>
