<!--
  SpreadToolbar.svelte — the Library reader's shared controls (reading-first
  package D), shown in the pane toolbar between the breadcrumb (which says
  "P101–P102 of N") and View ▾: Go to page…, and zoom − % + Fit for both
  pages at once. Rotation is per page (each page's corner); Load into Editor
  is per page (each page's header).
-->
<script>
  /** "62%" / "62% · 58%", or '' when no page shows ink (zoom hidden). */
  export let zoomLabel = '';
  /** ('in'|'out'|'fit') => void */
  export let onZoom = () => {};
  /** (text) => boolean: false when no such page. */
  export let onGoTo = () => true;

  let goText = '';
  let notFound = false;

  function submit() {
    if (!goText.trim()) return;
    notFound = !onGoTo(goText);
    if (!notFound) goText = '';
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { goText = ''; notFound = false; e.currentTarget.blur(); }
  }
</script>

<div class="st">
  <form class="st-go" on:submit|preventDefault={submit}>
    <input
      type="text"
      class:bad={notFound}
      bind:value={goText}
      on:input={() => (notFound = false)}
      on:keydown={onKey}
      placeholder="Go to page"
      aria-label="Go to page"
      title={notFound ? 'No such page in this notebook' : 'Page number, e.g. 42 or 151b. ←/→ turn pages.'}
      size="9"
    />
  </form>

  {#if zoomLabel}
    <div class="st-zoom" role="group" aria-label="Zoom both pages">
      <button type="button" on:click={() => onZoom('out')} title="Zoom out">&#x2212;</button>
      <span class="st-pct">{zoomLabel}</span>
      <button type="button" on:click={() => onZoom('in')} title="Zoom in">&#x2B;</button>
      <button type="button" class="st-fit" on:click={() => onZoom('fit')} title="Fit each page">Fit</button>
    </div>
  {/if}
</div>

<style>
  .st {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .st-go input {
    width: 92px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.8rem;
  }
  .st-go input:focus { outline: none; border-color: var(--selected-line, #4a7cf7); }
  .st-go input.bad { border-color: var(--destructive, #c0392b); }

  .st-zoom {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }
  .st-zoom button {
    padding: 3px 9px;
    border: none;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .st-zoom button:hover { color: var(--text-primary); }
  .st-fit { border-left: 1px solid var(--border) !important; font-size: 0.8rem !important; }
  .st-pct {
    min-width: 46px;
    padding: 0 4px;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
