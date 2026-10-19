<!--
  PageTurnButtons.svelte — the ‹ › edge strips that turn pages in the Library
  reader. Placed over the page's ink when it shows ink, so in Ink + text they
  never cover the transcript's toolbar; over a transcript they start below its
  toolbar (`belowToolbar`). ←/→ do the same from the keyboard (BookViewer).
-->
<script>
  export let hasPrev = false;
  export let hasNext = false;
  export let onPrev = null;
  export let onNext = null;
  export let belowToolbar = false;
</script>

{#if hasPrev && onPrev}
  <button class="pt prev" class:below={belowToolbar} on:click={onPrev} title="Previous page (←)" aria-label="Previous page">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
  </button>
{/if}
{#if hasNext && onNext}
  <button class="pt next" class:below={belowToolbar} on:click={onNext} title="Next page (→)" aria-label="Next page">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
  </button>
{/if}

<style>
  .pt {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 44px;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.18);
    transition: all 0.2s;
  }
  .pt:hover { background: rgba(0, 0, 0, 0.04); color: rgba(0, 0, 0, 0.55); }
  .pt.prev { left: 0; }
  .pt.next { right: 0; }
  .pt.below { top: 44px; }
</style>
