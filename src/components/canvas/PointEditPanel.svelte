<!--
  PointEditPanel.svelte — the floating control panel for canvas point-edit mode.

  The canvas handles let the user pick a point spatially; this panel is the
  numeric half of the same job. A stray point is usually at the Ncode origin,
  which is off in the page's top-left corner and easy to miss at fit-to-page
  zoom — so the panel lists each suspect point with its coordinates and jumps
  the view to it on click.

  Deletion actions live here rather than in the canvas header: they are modal
  (they only mean anything while point editing) and the header is already at its
  width limit.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { log } from '$stores';
  import {
    pointEditStrokes,
    pointEditPointCount,
    strayPoints,
    selectedPoints,
    selectedPointCount,
    clearPointSelection,
    selectPoint,
    selectStrayPoints,
    deleteSelectedPoints,
    deleteStrayPoints,
    exitPointEditMode
  } from '$stores/point-edit.js';
  import { formatPointCoords, pointKey, strokeDots } from '$lib/point-edit.js';

  const dispatch = createEventDispatcher();

  // Long stray lists are collapsed to keep the panel out of the drawing.
  const MAX_LISTED = 12;

  $: strokeCountLabel = `${$pointEditStrokes.length} stroke${$pointEditStrokes.length !== 1 ? 's' : ''}`;
  $: listedStrays = $strayPoints.slice(0, MAX_LISTED);

  /** Describe where a point sits, e.g. "B3017/P124 · point 1/57". */
  function describe(entry) {
    const stroke = $pointEditStrokes.find(e => e.strokeIndex === entry.strokeIndex)?.stroke;
    const total = stroke ? strokeDots(stroke).length : 0;
    const pi = stroke?.pageInfo;
    const where = pi ? `B${pi.book}/P${pi.page}` : 'unknown page';
    return `${where} · point ${entry.pointIndex + 1}/${total}`;
  }

  function reasonLabel(reason) {
    return reason === 'origin' ? 'at origin' : 'jumps away';
  }

  /** Select a listed stray and centre the view on it. */
  function focusStray(entry) {
    selectPoint(entry.strokeIndex, entry.pointIndex, 'replace');
    dispatch('focus', entry);
  }

  /**
   * Report the outcome of a removal. `refused` strokes are the ones that would
   * have been left with fewer than two points — nothing to draw — so they are
   * left alone and the user is pointed at whole-stroke deletion instead.
   */
  function report(result, what) {
    if (result.removedPoints === 0 && result.refused.length === 0) {
      log('No points removed', 'info');
      return;
    }

    if (result.removedPoints > 0) {
      const pts = `${result.removedPoints} point${result.removedPoints !== 1 ? 's' : ''}`;
      const strokesTouched = `${result.editedStrokes} stroke${result.editedStrokes !== 1 ? 's' : ''}`;
      log(`Deleted ${pts} from ${strokesTouched}${what ? ` (${what})` : ''} — save to write it to disk`, 'success');
    }

    if (result.refused.length > 0) {
      log(
        `${result.refused.length} stroke(s) left untouched — removing those points would leave fewer than 2, ` +
        `so there would be no line left. Delete the whole stroke instead.`,
        'warning'
      );
    }

    dispatch('edited', result);
  }

  function handleDeleteSelected() {
    report(deleteSelectedPoints(), null);
  }

  function handleDeleteStrays() {
    report(deleteStrayPoints(), 'suspect points');
  }

  function handleSelectStrays() {
    const n = selectStrayPoints();
    log(`Selected ${n} suspect point${n !== 1 ? 's' : ''}`, 'info');
  }
</script>

<div class="point-panel">
  <div class="pp-header">
    <span class="pp-title">📍 Edit Points</span>
    <button class="pp-close" on:click={exitPointEditMode} title="Leave point-edit mode (Esc)">✕</button>
  </div>

  <div class="pp-meta">
    {$pointEditPointCount} point{$pointEditPointCount !== 1 ? 's' : ''} · {strokeCountLabel}
  </div>

  {#if $strayPoints.length > 0}
    <div class="pp-section">
      <div class="pp-section-head">
        <span class="pp-warn">⚠️ {$strayPoints.length} suspect</span>
        <div class="pp-section-actions">
          <button class="pp-btn" on:click={handleSelectStrays} title="Select every suspect point">Select</button>
          <button class="pp-btn danger" on:click={handleDeleteStrays} title="Delete every suspect point">
            Delete all
          </button>
        </div>
      </div>

      <ul class="pp-list">
        {#each listedStrays as entry (pointKey(entry.strokeIndex, entry.pointIndex))}
          <li>
            <button
              class="pp-row"
              class:active={$selectedPoints.has(pointKey(entry.strokeIndex, entry.pointIndex))}
              on:click={() => focusStray(entry)}
              title="Select this point and centre the view on it"
            >
              <span class="pp-row-coords">{formatPointCoords(entry.dot)}</span>
              <span class="pp-row-reason">{reasonLabel(entry.reason)}</span>
              <span class="pp-row-where">{describe(entry)}</span>
            </button>
          </li>
        {/each}
      </ul>

      {#if $strayPoints.length > listedStrays.length}
        <div class="pp-more">+{$strayPoints.length - listedStrays.length} more</div>
      {/if}
    </div>
  {:else}
    <div class="pp-section pp-clean">No suspect points detected</div>
  {/if}

  <div class="pp-actions">
    <button
      class="pp-btn danger wide"
      on:click={handleDeleteSelected}
      disabled={$selectedPointCount === 0}
      title={$selectedPointCount > 0 ? 'Delete the selected points (Del)' : 'Click a point handle to select it'}
    >
      🗑️ Delete selected{$selectedPointCount > 0 ? ` (${$selectedPointCount})` : ''}
    </button>
    <button
      class="pp-btn"
      on:click={clearPointSelection}
      disabled={$selectedPointCount === 0}
      title="Clear the point selection"
    >
      Clear
    </button>
  </div>

  <div class="pp-hint">
    Click a handle to select · Ctrl+click to add · drag a box to select many ·
    <strong>Del</strong> to delete · <strong>Esc</strong> to exit
  </div>
</div>

<style>
  /* Sits over the canvas, top-left, clear of the page labels drawn at the top of
     each page's border. Fixed width so the coordinate rows don't reflow as the
     stray list changes. */
  .point-panel {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 12;
    width: 268px;
    padding: 10px 12px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.97);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    font-size: 0.75rem;
    color: #1f2937;
  }

  .pp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pp-title {
    font-weight: 600;
    font-size: 0.8rem;
  }

  .pp-close {
    border: none;
    background: transparent;
    color: #6b7280;
    font-size: 0.9rem;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
  }

  .pp-close:hover {
    background: #f3f4f6;
    color: #111827;
  }

  .pp-meta {
    margin-top: 2px;
    color: #6b7280;
  }

  .pp-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
  }

  .pp-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .pp-section-actions {
    display: flex;
    gap: 4px;
  }

  .pp-warn {
    color: #b45309;
    font-weight: 600;
  }

  .pp-clean {
    color: #6b7280;
  }

  .pp-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 148px;
    overflow-y: auto;
  }

  .pp-row {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'coords reason'
      'where where';
    gap: 0 6px;
    width: 100%;
    text-align: left;
    padding: 4px 6px;
    margin-bottom: 3px;
    border: 1px solid #e5e7eb;
    border-radius: 5px;
    background: #fffbeb;
    font-family: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .pp-row:hover {
    border-color: #f59e0b;
  }

  .pp-row.active {
    border-color: #e94560;
    background: #fef2f2;
  }

  .pp-row-coords {
    grid-area: coords;
    font-family: 'Courier New', monospace;
    font-weight: 600;
  }

  .pp-row-reason {
    grid-area: reason;
    color: #b45309;
    text-align: right;
  }

  .pp-row-where {
    grid-area: where;
    color: #6b7280;
  }

  .pp-more {
    margin-top: 2px;
    color: #6b7280;
  }

  .pp-actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }

  .pp-btn {
    padding: 4px 8px;
    border: 1px solid #d1d5db;
    border-radius: 5px;
    background: #f9fafb;
    color: #1f2937;
    font-family: inherit;
    font-size: 0.7rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .pp-btn.wide {
    flex: 1;
  }

  .pp-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  .pp-btn.danger:hover:not(:disabled) {
    background: #e94560;
    border-color: #e94560;
    color: white;
  }

  .pp-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .pp-hint {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 0.68rem;
    line-height: 1.45;
  }
</style>
