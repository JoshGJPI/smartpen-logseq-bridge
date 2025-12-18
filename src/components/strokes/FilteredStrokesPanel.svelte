<!--
  FilteredStrokesPanel.svelte - Display filter statistics and controls
-->
<script>
  import { filteredStrokes, filterStats } from '$stores/filtered-strokes.js';
  import { showFilteredStrokes, toggleFilteredStrokes } from '$stores';
  import FilterSettings from './FilterSettings.svelte';
  
  // Computed visibility
  $: hasFilteredStrokes = $filteredStrokes && $filteredStrokes.length > 0;
</script>

{#if hasFilteredStrokes}
  <div class="filtered-strokes-panel">
    <div class="panel-header">
      <span class="title">
        🎨 Filtered Decorative Strokes
      </span>
      <label class="toggle-label">
        <input 
          type="checkbox" 
          checked={$showFilteredStrokes}
          on:change={toggleFilteredStrokes}
        />
        <span>Show on canvas</span>
      </label>
    </div>
    
    <div class="stats-grid">
      <div class="stat-item">
        <span class="stat-label">Total Filtered</span>
        <span class="stat-value">{$filterStats.total}</span>
      </div>
      
      {#if $filterStats.boxes > 0}
        <div class="stat-item">
          <span class="stat-label">📦 Boxes</span>
          <span class="stat-value">{$filterStats.boxes}</span>
        </div>
      {/if}
      
      {#if $filterStats.underlines > 0}
        <div class="stat-item">
          <span class="stat-label">➖ Underlines</span>
          <span class="stat-value">{$filterStats.underlines}</span>
        </div>
      {/if}
      
      {#if $filterStats.circles > 0}
        <div class="stat-item">
          <span class="stat-label">⭕ Circles</span>
          <span class="stat-value">{$filterStats.circles}</span>
        </div>
      {/if}
    </div>
    
    <div class="info-text">
      These decorative elements were removed before transcription to prevent emoji misinterpretation.
      {#if $showFilteredStrokes}
        They are shown as <span style="color: #000000;">dashed black lines</span> on the canvas (or <span style="color: #e94560;">dashed red</span> when selected).
      {/if}
    </div>
    
    <FilterSettings />
  </div>
{/if}

<style>
  .filtered-strokes-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    margin-top: 12px;
  }
  
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  
  .title {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 0.9rem;
  }
  
  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  
  .toggle-label input[type="checkbox"] {
    cursor: pointer;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  
  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .stat-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--accent);
  }
  
  .info-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.4;
    padding: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
</style>
