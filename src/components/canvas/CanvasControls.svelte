<!--
  CanvasControls.svelte - Zoom and view controls for canvas, and the page order
  (by notebook or by capture date). The order was the Dates tab's "Order canvas
  by date" until v3.10.0; a load from the Timeline still sets date order itself.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { canvasPageOrder, setCanvasPageOrder } from '$stores/timeline.js';

  export let zoom = 1;
  
  const dispatch = createEventDispatcher();
  
  $: zoomPercent = Math.round(zoom * 100);
</script>

<div class="canvas-controls">
  <div class="zoom-controls">
    <button 
      class="zoom-btn" 
      on:click={() => dispatch('zoomOut')}
      disabled={zoom <= 0.25}
      title="Zoom out"
    >
      −
    </button>
    
    <span class="zoom-level">{zoomPercent}%</span>
    
    <button 
      class="zoom-btn" 
      on:click={() => dispatch('zoomIn')}
      disabled={zoom >= 10}
      title="Zoom in"
    >
      +
    </button>
  </div>
  
  <button class="view-btn" on:click={() => dispatch('fit')} title="Zoom to fit all content">
    Fit
  </button>

  <!-- "Reset View" rather than "Reset": this resets zoom and pan only. The ⋯
       menu's Reset Layout and Reset Sizes act on the pages themselves, and the
       bare label made this one look like it already covered them. -->
  <button class="view-btn" on:click={() => dispatch('reset')} title="Reset zoom to 100% and recentre">
    Reset View
  </button>

  <div class="order" role="group" aria-label="Page order">
    <span class="order-label">Order</span>
    <button class="order-btn" class:active={$canvasPageOrder !== 'date'} aria-pressed={$canvasPageOrder !== 'date'}
      on:click={() => setCanvasPageOrder('book')} title="Lay pages out by notebook and page number">Book</button>
    <button class="order-btn" class:active={$canvasPageOrder === 'date'} aria-pressed={$canvasPageOrder === 'date'}
      on:click={() => setCanvasPageOrder('date')} title="Lay pages out by when they were written">Date</button>
  </div>
</div>

<style>
  .canvas-controls {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-shrink: 0;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-tertiary);
    padding: 4px 6px;
    border-radius: 6px;
  }

  .zoom-btn {
    padding: 4px 10px;
    font-size: 1rem;
    min-width: 28px;
    border: none;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }
  
  .zoom-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }
  
  .zoom-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .zoom-level {
    min-width: 42px;
    text-align: center;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .view-btn {
    padding: 6px 10px;
    font-size: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .view-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .order {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-tertiary);
    padding: 3px 4px;
    border-radius: 6px;
  }

  .order-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    padding: 0 4px;
  }

  .order-btn {
    padding: 3px 8px;
    font-size: 0.75rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
  }

  .order-btn:hover:not(.active) {
    color: var(--text-primary);
  }

  /* Selected = neutral raised, as the panel tabs. */
  .order-btn.active {
    background: var(--selected-bg);
    color: var(--text-primary);
  }
</style>
