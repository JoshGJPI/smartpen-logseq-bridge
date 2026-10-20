<!--
  RangeMenu.svelte — the Timeline's "Range ▾" (reading-first package C).

  One place in the feed to set the range: From / To and the presets the Dates
  tab offers (Latest day, 1, 7, 30 days). Replaces "Change range", which only
  opened the left panel. The button's own text is the range, so the feed head
  says it once. Writes go through `setTimelineRange`, the same store the Dates
  tab, the heat grid and the strip use.
-->
<script>
  import { timelineRange, timelineRangeExtent, setTimelineRange } from '$stores';
  import { RANGE_PRESETS, rangePreset } from '$lib/timeline-range.js';

  /** The formatted range, e.g. "12–18 October 2026". */
  export let label = '';

  let open = false;
  let rootEl;

  $: range = $timelineRange;
  $: extent = $timelineRangeExtent;

  // Handlers read $timelineRange, not `range`: a `$:` value only catches up at
  // the next flush, so From then To in quick succession would see a stale end.
  function applyPreset(id) {
    const r = rangePreset(id, $timelineRange, extent);
    if (r) setTimelineRange(r.from, r.to);
    open = false;
  }

  function onFrom(e) {
    if (e.target.value) setTimelineRange(e.target.value, $timelineRange.to || e.target.value);
  }

  function onTo(e) {
    if (e.target.value) setTimelineRange($timelineRange.from || e.target.value, e.target.value);
  }

  function onWindowPointer(e) {
    if (open && rootEl && !rootEl.contains(e.target)) open = false;
  }

  function onKey(e) {
    if (open && e.key === 'Escape') { open = false; e.preventDefault(); }
  }
</script>

<svelte:window on:pointerdown={onWindowPointer} on:keydown={onKey} />

<div class="rm" bind:this={rootEl}>
  <button type="button" class="rm-btn" class:open aria-haspopup="true" aria-expanded={open}
    on:click={() => (open = !open)} title="Change the range">
    <span class="rm-label">{label || 'Pick a range'}</span>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
  </button>

  {#if open}
    <div class="rm-pop" role="dialog" aria-label="Range">
      <div class="rm-fields">
        <label>
          <span>From</span>
          <input type="date" value={range.from || ''} max={extent?.last || null} on:change={onFrom} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={range.to || ''} on:change={onTo} />
        </label>
      </div>
      <div class="rm-presets">
        {#each RANGE_PRESETS as p (p.id)}
          <button type="button" on:click={() => applyPreset(p.id)} disabled={!extent}>{p.label}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .rm { position: relative; min-width: 0; }

  .rm-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: #1f1f28;
    font-size: 16px;
    font-weight: 650;
    cursor: pointer;
  }

  .rm-btn:hover,
  .rm-btn.open { background: #f2f2f4; border-color: #dcdce2; }

  .rm-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .rm-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    background: #fff;
    border: 1px solid #dcdce2;
    border-radius: 9px;
    box-shadow: 0 8px 24px rgba(20, 20, 40, 0.16);
  }

  .rm-fields { display: flex; gap: 8px; }

  .rm-fields label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #62626e;
  }

  .rm-fields input {
    width: 100%;
    padding: 5px 6px;
    border: 1px solid #dcdce2;
    border-radius: 5px;
    font-size: 13px;
    color: #1f1f28;
  }

  .rm-presets { display: flex; flex-wrap: wrap; gap: 6px; }

  .rm-presets button {
    padding: 5px 10px;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    background: #fff;
    color: #45454f;
    font-size: 12.5px;
    cursor: pointer;
  }

  .rm-presets button:hover:not(:disabled) { background: #eef3ff; border-color: #4a7cf7; }
  .rm-presets button:disabled { opacity: 0.5; cursor: default; }
</style>
