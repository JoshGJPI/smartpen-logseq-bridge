<!--
  PaneToolbar.svelte — one row over the reading pane (reading-first package C):
  where you are on the left, View ▾ on the right.

  Library:  Library › Notebook › P12–P13   ("Library" goes back to the page grid)
  Timeline: Timeline                       (the range is in the feed's Range ▾)

  The Editor has no pane toolbar: none of the View options apply to it, and its
  canvas has its own toolbar. The crumb ellipsises before it can widen the
  page (App.svelte's `.canvas-section { min-width: 0 }` contract).
-->
<script>
  import ViewMenu from './ViewMenu.svelte';
  import { destination, viewerSelection, pagesByBook, bookAliases, backgroundsAvailable } from '$stores';
  import { viewOptionsFor, pageCrumb } from '$lib/pane-toolbar.js';
  import { formatBookName } from '$utils/formatting.js';

  export let contentMode = 'strokes';
  export let spread = true;
  export let hasSelection = false;
  export let onHome = () => {};
  export let onContent = (mode) => {};
  export let onToggleSpread = () => {};

  $: options = viewOptionsFor({
    destination: $destination,
    hasSelection,
    contentMode,
    backgroundsAvailable: $backgroundsAvailable
  });
  $: open = $destination === 'library' && hasSelection && $viewerSelection;
  $: bookLabel = open ? formatBookName($viewerSelection.book, $bookAliases, 'alias-only') : '';
  $: pagesLabel = open ? pageCrumb($viewerSelection, $pagesByBook, spread) : '';

  function setSpread(on) {
    if (on !== spread) onToggleSpread();
  }
</script>

<div class="pane-toolbar">
  <nav class="crumbs" aria-label="Location">
    {#if $destination === 'library'}
      {#if open}
        <button type="button" class="crumb link" on:click={onHome} title="Back to all notebooks">Library</button>
        <span class="sep" aria-hidden="true">›</span>
        <span class="crumb">{bookLabel}</span>
        {#if pagesLabel}
          <span class="sep" aria-hidden="true">›</span>
          <span class="crumb here">{pagesLabel}</span>
        {/if}
      {:else}
        <span class="crumb here">Library</span>
      {/if}
    {:else}
      <span class="crumb here">Timeline</span>
    {/if}
  </nav>

  <ViewMenu {options} {contentMode} {spread} onContent={onContent} onSpread={setSpread} />
</div>

<style>
  .pane-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    min-width: 0;
  }

  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 7px;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.9rem;
  }

  .crumb {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb.here {
    color: var(--text-primary);
    font-weight: 600;
  }

  .crumb.link {
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    cursor: pointer;
  }

  .crumb.link:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .sep {
    flex-shrink: 0;
    color: var(--text-secondary);
    opacity: 0.6;
  }
</style>
