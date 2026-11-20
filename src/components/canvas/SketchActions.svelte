<!--
  SketchActions.svelte — the bar below the Editor's canvas: mark the selected
  strokes as sketches (pressure-varying thickness) or unmark them, then tune
  how marked strokes are drawn (SketchStylePopover). Split out of StrokeCanvas
  (v3.20.0); `onChanged` asks the canvas to repaint, since $strokes changing
  does not by itself schedule one there.
-->
<script>
  import { strokes } from '$stores/strokes.js';
  import { selectedIndices, hasSelection } from '$stores/selection.js';
  import { log, sketchProfileSummary, markStrokesAsSketch, unmarkStrokesAsSketch, selectionCount } from '$stores';
  import SketchStylePopover from './SketchStylePopover.svelte';

  export let onChanged = () => {};

  // How many of the selected strokes are already flagged. Drives whether the
  // bar offers Mark, Unmark, or both for a mixed selection. Computed from
  // $strokes directly so it recomputes when the flags change, not just when the
  // selection does.
  $: selectedSketchCount = $hasSelection
    ? Array.from($selectedIndices).reduce((n, i) => n + ($strokes[i]?.sketch ? 1 : 0), 0)
    : 0;
  $: selectedPlainCount = $selectionCount - selectedSketchCount;

  /**
   * Flag or unflag the current selection as sketch strokes.
   * @param {boolean} sketch
   */
  function applySketchFlag(sketch) {
    const indices = $selectedIndices;
    if (!indices || indices.size === 0) return;

    const changed = sketch ? markStrokesAsSketch(indices) : unmarkStrokesAsSketch(indices);
    if (changed === 0) {
      log(`No change — ${$selectionCount} stroke${$selectionCount !== 1 ? 's' : ''} already ${sketch ? 'marked' : 'unmarked'}`, 'info');
      return;
    }

    const noun = `stroke${changed !== 1 ? 's' : ''}`;
    log(
      sketch
        ? `Marked ${changed} ${noun} as Pressure ink (${$sketchProfileSummary})`
        : `Unmarked ${changed} ${noun} — back to uniform width`,
      'success'
    );
    onChanged();
  }
</script>

<!-- Pressure ink (the stroke flag stored as `sketch: true`; its UI name since
     v3.24.0, spec E.9, so it isn't confused with sketch lines): mark strokes,
     then tune how marked strokes are drawn.
     Grouped here rather than in the top bar so the style popover opens
     beside the controls that produce the strokes it restyles. -->
<div class="sketch-actions" role="group" aria-label="Pressure ink">
  <button
    class="btn btn-secondary small tone-sketch"
    on:click={() => applySketchFlag(true)}
    disabled={selectedPlainCount === 0}
    title={selectedPlainCount > 0
      ? `Render ${selectedPlainCount} selected stroke${selectedPlainCount !== 1 ? 's' : ''} with pressure-varying thickness (${$sketchProfileSummary})`
      : 'Select strokes that are not already Pressure ink'}
  >
    ✏️ Pressure ink{#if selectedPlainCount > 0} ({selectedPlainCount}){/if}
  </button>
  <button
    class="btn btn-secondary small tone-sketch"
    on:click={() => applySketchFlag(false)}
    disabled={selectedSketchCount === 0}
    title={selectedSketchCount > 0
      ? `Return ${selectedSketchCount} selected Pressure ink stroke${selectedSketchCount !== 1 ? 's' : ''} to a uniform width`
      : 'Select Pressure ink strokes to return them to a uniform width'}
  >
    ✒️ Unmark{#if selectedSketchCount > 0} ({selectedSketchCount}){/if}
  </button>
  <SketchStylePopover />
</div>

<style>
  .sketch-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    align-items: center;
  }

  /* The look of StrokeCanvas's small bar buttons, repeated: styles are scoped. */
  .btn.small {
    padding: 6px 10px;
    font-size: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  /* Sketch marking. Distinguished from the neutral toolbar actions because it
     changes how strokes render and is a saved, page-level annotation. */
  .tone-sketch:not(:disabled) {
    border-color: rgba(139, 92, 246, 0.55);
    color: #c4b5fd;
  }

  .tone-sketch:hover:not(:disabled) {
    background: #7c5cff;
    color: white;
    border-color: #7c5cff;
  }
</style>
