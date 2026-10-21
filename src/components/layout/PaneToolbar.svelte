<!--
  PaneToolbar.svelte — one row over the reading pane (reading-first package C):
  where you are on the left, View ▾ on the right.

  Library:  Library › Notebook › P12–P13 of 48   ("Library" goes back to the notebook
            cards, "Notebook" to that notebook's page grid), then the reader's shared
            controls (the default slot: SpreadToolbar). On a page grid: Library › Notebook.
            A tag's pages, Untagged or the suggestions queue: Library › Tag: beam (v3.1.0).
            Tag order (v3.2.0): Library › Tag: beam › 3–4 of 9 ("Tag: beam" goes back to the
            grid the pages came from). The tag manager: Library › Manage tags.
  Timeline: Timeline                       (the range is in the feed's Range ▾)

  The Editor has no pane toolbar: none of the View options apply to it, and its
  canvas has its own toolbar. The crumb ellipsises before it can widen the
  page (App.svelte's `.canvas-section { min-width: 0 }` contract).
-->
<script>
  import ViewMenu from './ViewMenu.svelte';
  import {
    destination, viewerSelection, pagesByBook, bookAliases, backgroundsAvailable, libraryView,
    readingList, readingLabel
  } from '$stores';
  import { viewOptionsFor, pageCrumb } from '$lib/pane-toolbar.js';
  import { sequenceCrumb } from '$lib/viewer/reading-order.js';
  import { pageIdOf } from '$lib/viewer/page-reader.js';
  import { formatBookName } from '$utils/formatting.js';

  export let contentMode = 'strokes';
  export let spread = true;
  export let hasSelection = false;
  /** Book key of the open page or page grid, else null. */
  export let openBook = null;
  export let onHome = () => {};
  /** (book) => void: that notebook's page grid. */
  export let onNotebook = () => {};
  /** Back to the grid Tag order's pages came from. */
  export let onSequence = () => {};
  export let onContent = (mode) => {};
  export let onToggleSpread = () => {};

  $: options = viewOptionsFor({
    destination: $destination,
    hasSelection,
    contentMode,
    backgroundsAvailable: $backgroundsAvailable
  });
  $: open = $destination === 'library' && openBook != null;
  $: bookLabel = open ? formatBookName(openBook, $bookAliases, 'alias-only') : '';
  $: pagesLabel = open && hasSelection && $viewerSelection ? pageCrumb($viewerSelection, $pagesByBook, spread) : '';
  // Tag order: where the open page sits among the tagged pages.
  $: tagOrder = open && hasSelection && $readingList.order === 'tag' && $viewerSelection;
  $: seqIndex = tagOrder
    ? $readingList.pages.findIndex((r) => String(r.book) === String($viewerSelection.book) && pageIdOf(r) === $viewerSelection.pageId)
    : -1;
  $: seqLabel = tagOrder ? sequenceCrumb(seqIndex, $readingList.pages.length, spread) : '';
  // A tag's pages, the Untagged pages or the suggestions queue (v3.1.0).
  $: viewLabel = !open && !hasSelection && $libraryView
    ? ({ tag: `Tag: ${$libraryView.tag}`, untagged: 'Untagged', suggestions: 'Suggestions', tags: 'Manage tags' })[$libraryView.kind] || ''
    : '';

  function setSpread(on) {
    if (on !== spread) onToggleSpread();
  }
</script>

<div class="pane-toolbar">
  <nav class="crumbs" aria-label="Location">
    {#if $destination === 'library'}
      {#if seqLabel}
        <button type="button" class="crumb link" on:click={onHome} title="Back to the Library">Library</button>
        <span class="sep" aria-hidden="true">›</span>
        <button type="button" class="crumb link book" on:click={onSequence} title="Back to these pages">{$readingLabel}</button>
        <span class="sep" aria-hidden="true">›</span>
        <span class="crumb here">{seqLabel}</span>
      {:else if open}
        <button type="button" class="crumb link" on:click={onHome} title="Back to all notebooks">Library</button>
        <span class="sep" aria-hidden="true">›</span>
        {#if pagesLabel}
          <button type="button" class="crumb link book" on:click={() => onNotebook(openBook)} title="All pages of {bookLabel}">{bookLabel}</button>
        {:else}
          <span class="crumb here">{bookLabel}</span>
        {/if}
        {#if pagesLabel}
          <span class="sep" aria-hidden="true">›</span>
          <span class="crumb here">{pagesLabel}</span>
        {/if}
      {:else if viewLabel}
        <button type="button" class="crumb link" on:click={onHome} title="Back to the Library">Library</button>
        <span class="sep" aria-hidden="true">›</span>
        <span class="crumb here">{viewLabel}</span>
      {:else}
        <span class="crumb here">Library</span>
      {/if}
    {:else}
      <span class="crumb here">Timeline</span>
    {/if}
  </nav>

  <slot />

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

  /* A long notebook name shrinks and ellipsises; "Library" never does. */
  .crumb.link.book { flex-shrink: 1; min-width: 0; }

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
