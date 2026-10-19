<!--
  ViewMenu.svelte — the reading pane's "View ▾" popover (reading-first package C).

  Replaces the row of toggle buttons that sat above Book View. It shows only
  the options that apply to what is on screen (lib/pane-toolbar.js
  `viewOptionsFor`); each one drives the same store or BookViewer method the
  old button did. Spread/Single and Strokes/Transcript go through BookViewer,
  which asks before dropping unsaved transcript edits.
-->
<script>
  import {
    backgroundsEnabled, toggleBackgrounds, sittingHoverEnabled, toggleSittingHover,
    feedOrder, setFeedOrder
  } from '$stores';

  /** @type {Array<'content'|'layout'|'times'|'paper'|'order'>} */
  export let options = [];
  export let contentMode = 'strokes';
  export let spread = true;
  export let onContent = (mode) => {};
  export let onSpread = (on) => {};

  let open = false;
  let rootEl;

  function onWindowClick(e) {
    if (open && rootEl && !rootEl.contains(e.target)) open = false;
  }

  function onKey(e) {
    if (open && e.key === 'Escape') {
      open = false;
      e.stopPropagation();
    }
  }

  // Closing after a segmented choice keeps the menu from lingering over the page;
  // the on/off rows stay open so both can be flipped in one visit.
  function choose(fn) {
    fn();
    open = false;
  }

  $: if (!options.length) open = false;
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKey} />

{#if options.length}
  <div class="vm" bind:this={rootEl}>
    <button
      type="button"
      class="vm-btn"
      class:open
      aria-haspopup="true"
      aria-expanded={open}
      on:click={() => (open = !open)}
    >
      View
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    {#if open}
      <div class="vm-pop" role="menu">
        {#if options.includes('content')}
          <div class="vm-row">
            <span class="vm-label">Show</span>
            <div class="vm-seg" role="group" aria-label="Show">
              <button type="button" class:active={contentMode === 'strokes'} aria-pressed={contentMode === 'strokes'}
                on:click={() => choose(() => onContent('strokes'))}>Strokes</button>
              <button type="button" class:active={contentMode === 'transcript'} aria-pressed={contentMode === 'transcript'}
                on:click={() => choose(() => onContent('transcript'))}>Transcript</button>
            </div>
          </div>
        {/if}

        {#if options.includes('layout')}
          <div class="vm-row">
            <span class="vm-label">Pages</span>
            <div class="vm-seg" role="group" aria-label="Pages">
              <button type="button" class:active={spread} aria-pressed={spread}
                on:click={() => choose(() => onSpread(true))}>Spread</button>
              <button type="button" class:active={!spread} aria-pressed={!spread}
                on:click={() => choose(() => onSpread(false))}>Single</button>
            </div>
          </div>
        {/if}

        {#if options.includes('order')}
          <div class="vm-row">
            <span class="vm-label">Order</span>
            <div class="vm-seg" role="group" aria-label="Order">
              <button type="button" class:active={$feedOrder === 'newest'} aria-pressed={$feedOrder === 'newest'}
                on:click={() => choose(() => setFeedOrder('newest'))}>Newest first</button>
              <button type="button" class:active={$feedOrder === 'oldest'} aria-pressed={$feedOrder === 'oldest'}
                on:click={() => choose(() => setFeedOrder('oldest'))}>Oldest first</button>
            </div>
          </div>
        {/if}

        {#if options.includes('times')}
          <label class="vm-check" title="Hover ink to see when it was written">
            <input type="checkbox" checked={$sittingHoverEnabled} on:change={toggleSittingHover} />
            <span>Times<span class="vm-hint">Hover ink to see when it was written</span></span>
          </label>
        {/if}

        {#if options.includes('paper')}
          <label class="vm-check" title="Show the printed page behind your writing">
            <input type="checkbox" checked={$backgroundsEnabled} on:change={toggleBackgrounds} />
            <span>Paper<span class="vm-hint">Printed page behind the ink</span></span>
          </label>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .vm { position: relative; flex-shrink: 0; }

  .vm-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  .vm-btn:hover,
  .vm-btn.open {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .vm-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    min-width: 270px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  }

  .vm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .vm-label {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .vm-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .vm-seg button {
    padding: 4px 11px;
    border: none;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .vm-seg button + button { border-left: 1px solid var(--border); }
  .vm-seg button:hover { color: var(--text-primary); }

  .vm-seg button.active {
    background: var(--selected-bg);
    color: white;
    box-shadow: inset 0 -2px 0 var(--selected-line);
  }

  .vm-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .vm-check input { margin-top: 4px; }

  .vm-hint {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
