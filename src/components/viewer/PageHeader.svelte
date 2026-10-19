<!--
  PageHeader.svelte — one page's header in the Library reader (reading-first
  package D): title, stroke count, when it was written, and the one quiet way
  across to editing ("Load into Editor", an icon button).

  Written on: one day shows as a single date chip; several show the range and a
  ribbon of day chips. Hovering a chip highlights that day's ink on the page
  (the parent draws it through SittingInk); clicking opens the day in the
  Timeline (the parent routes it through navigateTo, which guards unsaved
  transcript edits). The days are pageDayGroups(), the same groups the ink
  hover uses, so chip, highlight and Timeline day agree.

  The row wraps rather than widening the page: at 1200 wide a spread page is
  ~350 px, and the old per-page toolbar clipped "Load into Editor" there.
-->
<script>
  import { writtenLabel, writtenChips } from '$lib/viewer/written-on.js';
  import { plural } from '$lib/plural.js';

  export let title = '';
  export let strokeCount = 0;
  /** pageDayGroups().groups, or null while the page is loading. */
  export let groups = null;
  /** (group|null) => void */
  export let onHoverDay = () => {};
  /** (day) => void */
  export let onOpenDay = () => {};
  export let onLoadIntoEditor = () => {};

  $: chips = writtenChips(groups);
  $: written = writtenLabel(groups);

  function hover(chip) {
    onHoverDay(chip && groups ? groups[chip.index] : null);
  }
</script>

<div class="ph">
  <span class="ph-title" title={title}>{title}</span>
  <span class="ph-meta">{strokeCount} {plural(strokeCount, 'stroke')}</span>

  {#if chips.length}
    <!-- svelte-ignore a11y-mouse-events-have-key-events -->
    <div class="ph-written" role="group" aria-label="Written on" on:mouseleave={() => hover(null)}>
      {#if chips.length > 1}
        <span class="ph-range">{written}</span>
      {/if}
      {#each chips as chip (chip.day)}
        <button
          type="button"
          class="ph-chip"
          title={chip.title}
          on:mouseenter={() => hover(chip)}
          on:focus={() => hover(chip)}
          on:blur={() => hover(null)}
          on:click={() => onOpenDay(chip.day)}
        >{chips.length > 1 ? chip.label : written}</button>
      {/each}
    </div>
  {:else if groups}
    <span class="ph-meta">no capture time</span>
  {/if}

  <button
    type="button"
    class="ph-load"
    on:click={() => onLoadIntoEditor()}
    title="Load this page into the Editor"
    aria-label="Load this page into the Editor"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
  </button>
</div>

<style>
  .ph {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    padding: 6px 8px 6px 12px;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    flex-shrink: 0;
    min-width: 0;
  }
  .ph-title {
    font-weight: 600;
    font-size: 14px;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    max-width: 100%;
  }
  .ph-meta { font-size: 12px; color: #888; white-space: nowrap; }

  /* One row of chips that scrolls sideways rather than pushing the page wider. */
  .ph-written {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .ph-range { font-size: 12px; color: #666; white-space: nowrap; margin-right: 2px; }
  .ph-chip {
    flex-shrink: 0;
    padding: 1px 8px;
    border: 1px solid #d6d8e0;
    border-radius: 10px;
    background: #f6f7fa;
    color: #3a3f55;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }
  .ph-chip:hover,
  .ph-chip:focus-visible {
    background: #e8ecf8;
    border-color: #4a7cf7;
    color: #1a1a2e;
  }

  .ph-load {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #6a7390;
    cursor: pointer;
    flex-shrink: 0;
  }
  .ph-load:hover { background: #eef3ff; border-color: #c7d6fb; color: #4a7cf7; }
</style>
