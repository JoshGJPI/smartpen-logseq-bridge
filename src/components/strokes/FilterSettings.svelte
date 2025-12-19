<!--
  FilterSettings.svelte - Adjust decorative stroke detection thresholds
  Optional component for advanced users to fine-tune the detection algorithm
  Used by the "Deselect Decorative" button in SelectionInfo
-->
<script>
  import { config } from '$lib/stroke-filter.js';
  
  let isExpanded = false;
  
  // Local state for threshold values (for UI)
  let thresholds = {
    boxTimeThreshold: config.BOX_TIME_THRESHOLD,
    boxMinSize: config.BOX_MIN_SIZE,
    boxMaxSize: config.BOX_MAX_SIZE,
    boxMinContent: config.BOX_MIN_CONTENT,
    underlineMinAspect: config.UNDERLINE_MIN_ASPECT,
    underlineMinStraightness: config.UNDERLINE_MIN_STRAIGHTNESS,
    underlineMinWidth: config.UNDERLINE_MIN_WIDTH,
    circleMinDots: config.CIRCLE_MIN_DOTS,
    circleMinSize: config.CIRCLE_MIN_SIZE,
    circleMaxEndpointDist: config.CIRCLE_MAX_ENDPOINT_DIST,
    circleMinContent: config.CIRCLE_MIN_CONTENT
  };
  
  function resetToDefaults() {
    thresholds = {
      boxTimeThreshold: 5000,
      boxMinSize: 5.0,
      boxMaxSize: 50.0,
      boxMinContent: 2,
      underlineMinAspect: 50,
      underlineMinStraightness: 0.90,
      underlineMinWidth: 15.0,
      circleMinDots: 30,
      circleMinSize: 4.0,
      circleMaxEndpointDist: 2.0,
      circleMinContent: 1
    };
  }
  
  function toggleExpanded() {
    isExpanded = !isExpanded;
  }
</script>

<div class="filter-settings">
  <button class="settings-toggle" on:click={toggleExpanded}>
    <span class="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
    Advanced Filter Settings
  </button>
  
  {#if isExpanded}
    <div class="settings-content">
      <div class="settings-info">
        <strong>⚠️ Experimental:</strong> These settings control the "Deselect Decorative" detection algorithm.
        Adjusting these values changes how boxes, underlines, and circles are identified.
        Start with small adjustments and test with your handwriting samples.
      </div>
      
      <div class="settings-section">
        <h4>📦 Box Detection</h4>
        <div class="setting-row">
          <label>
            Time Threshold (ms)
            <input type="number" bind:value={thresholds.boxTimeThreshold} min="1000" max="10000" step="500" />
          </label>
          <span class="setting-hint">Max time between 2 strokes to form a box</span>
        </div>
        <div class="setting-row">
          <label>
            Min Size (mm)
            <input type="number" bind:value={thresholds.boxMinSize} min="1" max="20" step="1" />
          </label>
          <span class="setting-hint">Minimum box dimension</span>
        </div>
        <div class="setting-row">
          <label>
            Max Size (mm)
            <input type="number" bind:value={thresholds.boxMaxSize} min="20" max="100" step="5" />
          </label>
          <span class="setting-hint">Maximum box dimension</span>
        </div>
        <div class="setting-row">
          <label>
            Min Content Strokes
            <input type="number" bind:value={thresholds.boxMinContent} min="1" max="10" step="1" />
          </label>
          <span class="setting-hint">Minimum strokes inside to be decorative</span>
        </div>
      </div>
      
      <div class="settings-section">
        <h4>➖ Underline Detection</h4>
        <div class="setting-row">
          <label>
            Min Aspect Ratio
            <input type="number" bind:value={thresholds.underlineMinAspect} min="10" max="100" step="5" />
          </label>
          <span class="setting-hint">Width/height ratio (higher = more horizontal)</span>
        </div>
        <div class="setting-row">
          <label>
            Min Straightness
            <input type="number" bind:value={thresholds.underlineMinStraightness} min="0.5" max="1.0" step="0.05" />
          </label>
          <span class="setting-hint">How straight the line must be (0-1)</span>
        </div>
        <div class="setting-row">
          <label>
            Min Width (mm)
            <input type="number" bind:value={thresholds.underlineMinWidth} min="5" max="30" step="1" />
          </label>
          <span class="setting-hint">Minimum length to be underline</span>
        </div>
      </div>
      
      <div class="settings-section">
        <h4>⭕ Circle Detection</h4>
        <div class="setting-row">
          <label>
            Min Dots
            <input type="number" bind:value={thresholds.circleMinDots} min="10" max="100" step="5" />
          </label>
          <span class="setting-hint">Minimum dots for smooth curve</span>
        </div>
        <div class="setting-row">
          <label>
            Min Size (mm)
            <input type="number" bind:value={thresholds.circleMinSize} min="2" max="10" step="0.5" />
          </label>
          <span class="setting-hint">Minimum size to distinguish from letters</span>
        </div>
        <div class="setting-row">
          <label>
            Max Endpoint Distance (mm)
            <input type="number" bind:value={thresholds.circleMaxEndpointDist} min="0.5" max="5" step="0.5" />
          </label>
          <span class="setting-hint">Max gap between start/end for closed loop</span>
        </div>
        <div class="setting-row">
          <label>
            Min Content Strokes
            <input type="number" bind:value={thresholds.circleMinContent} min="1" max="5" step="1" />
          </label>
          <span class="setting-hint">Minimum strokes inside to be decorative</span>
        </div>
      </div>
      
      <div class="settings-actions">
        <button class="btn btn-secondary" on:click={resetToDefaults}>
          Reset to Defaults
        </button>
        <div class="action-hint">
          Note: Changes apply when you next use "Deselect Decorative"
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .filter-settings {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-top: 12px;
    overflow: hidden;
  }
  
  .settings-toggle {
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background 0.15s;
  }
  
  .settings-toggle:hover {
    background: var(--bg-secondary);
  }
  
  .toggle-icon {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }
  
  .settings-content {
    padding: 12px;
    border-top: 1px solid var(--border);
  }
  
  .settings-info {
    padding: 10px;
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 4px;
    font-size: 0.8rem;
    line-height: 1.4;
    margin-bottom: 16px;
  }
  
  .settings-section {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  
  .settings-section:last-of-type {
    border-bottom: none;
  }
  
  .settings-section h4 {
    margin: 0 0 12px 0;
    font-size: 0.9rem;
    color: var(--text-primary);
  }
  
  .setting-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  
  .setting-row label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .setting-row input {
    width: 100px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.8rem;
  }
  
  .setting-hint {
    font-size: 0.7rem;
    color: var(--text-secondary);
    font-style: italic;
  }
  
  .settings-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  
  .action-hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-style: italic;
  }
  
  .btn {
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-primary);
  }
  
  .btn-secondary:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
</style>
