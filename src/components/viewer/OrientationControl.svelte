<!--
  OrientationControl.svelte — turn one page for display: ↺ / ↻ a quarter at a
  time, or pick Portrait / Landscape ↻ / Landscape ↺ / Upside down.

  Used on the corner of each Library page (compact) and in the Editor's canvas toolbar. Writes the
  page's entry in pages/_orientation.json straight away (stores/orientation.js);
  nothing about the page's strokes changes, so there is nothing to save.
  Disabled (rather than hidden) when there is no single page to act on, so the
  Editor toolbar doesn't reflow.
-->
<script>
  import { get } from 'svelte/store';
  import { pageOrientations, setPageRotation } from '$stores/orientation.js';
  import { ROTATIONS, rotationFor, rotateBy, rotationLabel } from '$lib/page-orientation.js';

  /** Book key ("388", "388v2"), or null when there is no single page. */
  export let book = null;
  /** Page id ("12", "151b"). */
  export let pageId = null;
  /** Why the control is disabled, shown as its tooltip. */
  export let disabledReason = 'Select strokes on one page to rotate it';
  /** Smaller, for the corner of a page in the Library reader. */
  export let compact = false;

  // Portrait, the two landscapes, then upside down — the order you reach for them.
  const CHOICES = [0, 90, 270, 180].filter((r) => ROTATIONS.includes(r));

  $: enabled = book != null && pageId != null && pageId !== '';
  $: rotation = enabled ? rotationFor($pageOrientations, book, pageId) : 0;
  $: where = enabled ? `B${book}/P${pageId}` : '';

  // Steps from the store, not from `rotation`: a `$:` value updates only at the
  // next flush, so two quick clicks would both start from the same angle.
  function turn(dir) {
    if (enabled) setPageRotation(book, pageId, rotateBy(rotationFor(get(pageOrientations), book, pageId), dir));
  }

  function pick(e) {
    if (enabled) setPageRotation(book, pageId, Number(e.currentTarget.value));
  }
</script>

<span class="oc" class:compact role="group" aria-label="Page orientation">
  <button
    type="button"
    class="oc-btn"
    on:click={() => turn(-1)}
    disabled={!enabled}
    title={enabled ? `Rotate ${where} a quarter turn left (display only)` : disabledReason}
    aria-label="Rotate left"
  >&#x21BA;</button>
  <select
    class="oc-select"
    value={rotation}
    on:change={pick}
    disabled={!enabled}
    title={enabled ? `How ${where} is shown. Display only: the strokes are not changed.` : disabledReason}
  >
    {#each CHOICES as r}
      <option value={r}>{rotationLabel(r)}</option>
    {/each}
  </select>
  <button
    type="button"
    class="oc-btn"
    on:click={() => turn(1)}
    disabled={!enabled}
    title={enabled ? `Rotate ${where} a quarter turn right (display only)` : disabledReason}
    aria-label="Rotate right"
  >&#x21BB;</button>
</span>

<style>
  .oc {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .oc-btn,
  .oc-select {
    height: 26px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .oc-btn {
    width: 26px;
    padding: 0;
    font-size: 14px;
    line-height: 1;
  }

  .oc-select {
    padding: 0 4px;
  }

  .oc-btn:hover:not(:disabled),
  .oc-select:hover:not(:disabled) {
    background: #f2f2f2;
    border-color: #ccc;
  }

  .compact .oc-btn,
  .compact .oc-select {
    height: 22px;
    font-size: 11px;
  }

  .compact .oc-btn { width: 22px; font-size: 13px; }

  .oc-btn:disabled,
  .oc-select:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
