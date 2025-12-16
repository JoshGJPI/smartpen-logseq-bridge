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
  
  <button class="view-btn" on:click={() => dispatch('fit')} title="Fit content">
    Fit
  </button>
  
  <button class="view-btn" on:click={() => dispatch('reset')} title="Reset view">
    Reset
  </button>
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
</style>
