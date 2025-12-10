<!--
  CanvasControls.svelte - Zoom and view controls for canvas
-->
<script>
  import { createEventDispatcher } from 'svelte';
  
  export let zoom = 1;
  
  const dispatch = createEventDispatcher();
  
  $: zoomPercent = Math.round(zoom * 100);
</script>

<div class="canvas-controls">
  <div class="zoom-controls">
    <button 
      class="btn btn-secondary zoom-btn" 
      on:click={() => dispatch('zoomOut')}
      disabled={zoom <= 0.25}
    >
      −
    </button>
    
    <span class="zoom-level">{zoomPercent}%</span>
    
    <button 
      class="btn btn-secondary zoom-btn" 
      on:click={() => dispatch('zoomIn')}
      disabled={zoom >= 10}
    >
      +
    </button>
  </div>
  
  <button class="btn btn-secondary view-btn" on:click={() => dispatch('fit')}>
    Fit
  </button>
  
  <button class="btn btn-secondary view-btn" on:click={() => dispatch('reset')}>
    Reset
  </button>
  
  <span class="help-text">Ctrl+scroll to zoom • Shift+drag to pan</span>
</div>

<style>
  .canvas-controls {
    display: flex;
    gap: 10px;
    margin-top: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-tertiary);
    padding: 5px 10px;
    border-radius: 6px;
  }

  .zoom-btn {
    padding: 6px 12px;
    font-size: 1.1rem;
    min-width: 36px;
  }

  .zoom-level {
    min-width: 50px;
    text-align: center;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .view-btn {
    padding: 8px 12px;
  }

  .help-text {
    color: var(--text-secondary);
    font-size: 0.75rem;
    margin-left: auto;
  }
</style>
