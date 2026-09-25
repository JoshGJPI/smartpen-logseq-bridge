<!--
  BookFilterMenu.svelte — which notebooks the date features count.

  One shared filter (`timelineExcludedBooks`): the Dates tab's grid, tallies and
  day list, the Timeline feed, and every date load into the Editor read through
  it, so what the feed shows is what a load brings in. It appears in both the
  Dates tab (dark) and the feed header (light); `theme` picks the palette.

  Each row shows the book's strokes inside the selected range, so it's clear
  which books a change would actually affect. "Only" narrows to one book in a
  click — the common case of "just my meeting notes".
-->
<script>
  import {
    timelineBooks, timelineExcludedBooks, setBookIncluded, includeAllBooks, includeOnlyBook
  } from '$stores/timeline.js';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';

  export let theme = 'light'; // 'light' | 'dark'
  /** Which edge the menu lines up with — 'right' where the button sits at a panel's right edge. */
  export let align = 'left';

  let open = false;
  let root;

  $: books = $timelineBooks;
  $: excluded = $timelineExcludedBooks;
  $: includedCount = books.filter((b) => !excluded.has(b.book)).length;
  $: filtering = includedCount < books.length;
  $: label = !filtering ? 'All books' : `${includedCount} of ${books.length} books`;

  function onWindowClick(event) {
    if (open && root && !root.contains(event.target)) open = false;
  }

  function onWindowKey(event) {
    if (open && event.key === 'Escape') open = false;
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />

<div class="bf {theme}" class:align-right={align === 'right'} bind:this={root}>
  <button type="button" class="bf-btn" class:filtering aria-haspopup="true" aria-expanded={open}
    on:click={() => (open = !open)} disabled={books.length === 0}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
    {label}
    <span class="bf-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="bf-menu" role="group" aria-label="Books to include">
      <div class="bf-top">
        <span>Include books</span>
        <button type="button" class="bf-link" on:click={includeAllBooks} disabled={!filtering}>All</button>
      </div>
      {#each books as b (b.book)}
        <div class="bf-row" class:quiet={b.inRange === 0}>
          <label>
            <input type="checkbox" checked={!excluded.has(b.book)}
              on:change={(e) => setBookIncluded(b.book, e.currentTarget.checked)} />
            <span class="bf-name">{formatBookName(b.book, $bookAliases, 'alias-only')}</span>
          </label>
          <em title="Strokes in the selected range">{b.inRange ? b.inRange.toLocaleString() : '—'}</em>
          <button type="button" class="bf-link only" on:click={() => includeOnlyBook(b.book)}
            title="Show only this book">Only</button>
        </div>
      {/each}
      <p class="bf-note">Counts are strokes in the selected range. Applies to the Dates tab, the timeline and loads into the Editor.</p>
    </div>
  {/if}
</div>

<style>
  .bf { position: relative; }

  .bf-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .bf-btn:disabled { opacity: 0.5; cursor: default; }
  .bf-caret { font-size: 10px; opacity: 0.7; }

  .bf-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 280px;
    max-height: 360px;
    overflow-y: auto;
    border-radius: 8px;
    padding: 8px 0;
    box-shadow: 0 8px 24px rgba(10, 10, 30, 0.25);
  }

  .align-right .bf-menu { left: auto; right: 0; }

  .bf-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 12px 6px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .bf-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    font-size: 13px;
  }

  .bf-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .bf-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bf-row em { font-style: normal; font-size: 12px; font-variant-numeric: tabular-nums; }
  .bf-row.quiet .bf-name { opacity: 0.6; }

  .bf-link {
    background: none;
    border: none;
    padding: 0 2px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .bf-link:disabled { opacity: 0.4; cursor: default; }
  .bf-link.only { visibility: hidden; }
  .bf-row:hover .bf-link.only,
  .bf-row:focus-within .bf-link.only { visibility: visible; }

  .bf-note { margin: 6px 12px 0; font-size: 11px; line-height: 1.4; }

  /* ---- light (feed header) ---- */
  .light .bf-btn { background: #fff; border: 1px solid #dcdce2; color: #45454f; }
  .light .bf-btn:hover:not(:disabled) { background: #f2f2f4; }
  .light .bf-btn.filtering { color: #2f5fd8; border-color: #c7d6fb; background: #eef3ff; }
  .light .bf-menu { background: #fff; border: 1px solid #e0e0e6; color: #2b2b33; }
  .light .bf-top, .light .bf-row em, .light .bf-note { color: #62626e; }
  .light .bf-row:hover { background: #f5f5f8; }
  .light .bf-link { color: #2f5fd8; }

  /* ---- dark (Dates tab) ---- */
  .dark .bf-btn { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-secondary); }
  .dark .bf-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent); }
  .dark .bf-btn.filtering { color: var(--text-primary); border-color: var(--accent); }
  .dark .bf-menu { background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-primary); }
  .dark .bf-top, .dark .bf-row em, .dark .bf-note { color: var(--text-secondary); }
  .dark .bf-row:hover { background: rgba(255, 255, 255, 0.04); }
  .dark .bf-link { color: #8fb0ff; }
</style>
