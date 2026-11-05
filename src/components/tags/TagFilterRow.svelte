<!--
  TagFilterRow.svelte — narrow a page grid by tag (v3.1.0 page tags; mockup 5).

  Chosen tags first (highlighted, click to drop), then the tags present in the
  current grid with their counts (`filterChoices`: in All mode only tags that
  still match, so a click can never empty the grid), Any | All, Clear. State
  lives in the grid (PageGrid) and is not persisted.

  One row (v3.14.0): a notebook can carry 50+ tags, which used to fill five rows
  above the first page. The grid passes the choices most recently written first
  (`rankFilterChoices`); the row shows FILTER_CHIPS_SHOWN of them and a "+N tags"
  button that opens the rest, A to Z, with a find box. A chosen tag always shows.
-->
<script>
  import { tick } from 'svelte';
  import { compareTags, FILTER_CHIPS_SHOWN } from '$lib/tags.js';
  import TagChip from './TagChip.svelte';

  /** `[{ tag, count }]`, most recent first (rankFilterChoices) */
  export let choices = [];
  export let chosen = [];
  /** 'any' | 'all' */
  export let mode = 'any';
  /** Row label: "Filter", or "Also tagged" on a tag's own page. */
  export let label = 'Filter';
  export let onToggle = (tag) => {};
  export let onMode = (mode) => {};
  export let onClear = () => {};

  let moreOpen = false;
  let find = '';
  let findInput;
  let wrap;

  // Two extra chips are cheaper than a "+2" button.
  $: limit = choices.length <= FILTER_CHIPS_SHOWN + 2 ? choices.length : FILTER_CHIPS_SHOWN;
  $: visible = choices.slice(0, limit);
  $: rest = choices.slice(limit).sort((a, b) => compareTags(a.tag, b.tag));
  $: needle = find.trim().toLowerCase();
  $: restShown = needle ? rest.filter((c) => c.tag.toLowerCase().includes(needle)) : rest;
  $: if (!rest.length) moreOpen = false;

  async function openMore() {
    moreOpen = !moreOpen;
    find = '';
    if (moreOpen) {
      await tick();
      findInput?.focus();
    }
  }

  function pick(tag) {
    moreOpen = false;
    onToggle(tag);
  }

  function onKey(e) {
    if (e.key === 'Escape' && moreOpen) {
      e.preventDefault();
      moreOpen = false;
    } else if (e.key === 'Enter' && restShown.length === 1) {
      e.preventDefault();
      pick(restShown[0].tag);
    }
  }

  function onWindowClick(e) {
    if (moreOpen && wrap && !wrap.contains(e.target)) moreOpen = false;
  }
</script>

<svelte:window on:click={onWindowClick} />

<div class="tfr" role="group" aria-label="Filter pages by tag">
  <span class="lb">{label}</span>
  {#each chosen as t (t)}
    <TagChip tag={t} on onClick={() => onToggle(t)} title="Stop filtering by {t}" />
  {/each}
  {#if chosen.length && choices.length}<span class="sep" aria-hidden="true">|</span>{/if}
  {#each visible as c (c.tag)}
    <TagChip tag={c.tag} count={c.count} onClick={() => onToggle(c.tag)} title="Show pages tagged {c.tag}" />
  {/each}
  {#if rest.length}
    <span class="more" bind:this={wrap}>
      <button type="button" class="more-btn" class:on={moreOpen} aria-haspopup="true" aria-expanded={moreOpen}
        title="The other tags on these pages, A to Z" on:click={openMore}>+{rest.length} tags ▾</button>
      {#if moreOpen}
        <div class="pop" role="dialog" aria-label="More tags">
          <input bind:this={findInput} bind:value={find} type="search" placeholder="Find a tag…" aria-label="Find a tag" on:keydown={onKey} />
          <div class="list">
            {#each restShown as c (c.tag)}
              <TagChip tag={c.tag} count={c.count} onClick={() => pick(c.tag)} title="Show pages tagged {c.tag}" />
            {:else}
              <span class="none">No tag matches “{find.trim()}”.</span>
            {/each}
          </div>
        </div>
      {/if}
    </span>
  {/if}
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
  .more { position: relative; }
  .more-btn { padding: 2px 9px; border: 1px solid #ddd; border-radius: 99px; background: #fff; color: #555; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .more-btn:hover, .more-btn.on { border-color: #4a7cf7; color: #2c56c4; }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 300px;
    padding: 8px;
    border: 1px solid #d8d8de;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  }
  .pop input { width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px; font: inherit; font-size: 12px; }
  .pop input:focus { outline: none; border-color: #4a7cf7; }
  .list { display: flex; flex-wrap: wrap; gap: 5px; max-height: 220px; overflow-y: auto; margin-top: 8px; }
  .seg { display: inline-flex; border: 1px solid #ddd; border-radius: 7px; overflow: hidden; }
  .seg button { padding: 2px 10px; border: none; background: #fff; color: #666; font-size: 12px; cursor: pointer; }
  .seg button + button { border-left: 1px solid #ddd; }
  .seg button.on { background: #262650; color: #fff; box-shadow: inset 0 -2px 0 #4a7cf7; }
  .clear { padding: 2px 9px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 11px; cursor: pointer; }
  .clear:hover { background: #f0f0f0; }
</style>
