<!--
  AnalysisView.svelte - Stroke analysis and shape detection
-->
<script>
  import { selectedStrokes, selectionCount, strokes, strokeCount } from '$stores';
  import { onMount } from 'svelte';
  
  let analyzer = null;
  let analysisResult = null;
  
  onMount(async () => {
    const { StrokeAnalyzer } = await import('$lib/stroke-analyzer.js');
    analyzer = new StrokeAnalyzer();
  });
  
  $: targetStrokes = $selectionCount > 0 ? $selectedStrokes : $strokes;
  
  $: if (analyzer && targetStrokes.length > 0) {
    analyzeStrokes();
  } else {
    analysisResult = null;
  }
  
  function analyzeStrokes() {
    if (!analyzer || targetStrokes.length === 0) return;
    
    const results = targetStrokes.map((stroke, i) => {
      const analysis = analyzer.analyzeStroke(stroke);
      return {
        index: i,
        ...analysis
      };
    });
    
    const summary = {
      totalStrokes: targetStrokes.length,
      shapes: {},
      avgConfidence: 0
    };
    
    let totalConfidence = 0;
    results.forEach(r => {
      if (r.isRectangle) {
        summary.shapes['rectangle'] = (summary.shapes['rectangle'] || 0) + 1;
        totalConfidence += r.rectangleConfidence || 0;
      }
    });
    
    summary.avgConfidence = results.length > 0 
      ? (totalConfidence / results.length * 100).toFixed(1) 
      : 0;
    
    analysisResult = { results, summary };
  }
</script>

<div class="analysis-view">
  {#if $strokeCount === 0}
    <p class="empty-message">
      Connect pen and write to see stroke analysis
    </p>
  {:else if !analysisResult}
    <p class="loading">Analyzing strokes...</p>
  {:else}
    <div class="summary">
      <h4>Summary</h4>
      <div class="summary-grid">
        <div class="stat">
          <span class="stat-value">{analysisResult.summary.totalStrokes}</span>
          <span class="stat-label">Strokes</span>
        </div>
        <div class="stat">
          <span class="stat-value">{Object.keys(analysisResult.summary.shapes).length}</span>
          <span class="stat-label">Shape Types</span>
        </div>
        <div class="stat">
          <span class="stat-value">{analysisResult.summary.avgConfidence}%</span>
          <span class="stat-label">Avg Confidence</span>
        </div>
      </div>
    </div>
    
    {#if Object.keys(analysisResult.summary.shapes).length > 0}
      <div class="shapes-breakdown">
        <h4>Detected Shapes</h4>
        <div class="shape-list">
          {#each Object.entries(analysisResult.summary.shapes) as [shape, count]}
            <div class="shape-item">
              <span class="shape-name">{shape}</span>
              <span class="shape-count">{count}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
    
    <details class="raw-analysis">
      <summary>Raw Analysis Data</summary>
      <pre>{JSON.stringify(analysisResult.results.slice(0, 10), null, 2)}{analysisResult.results.length > 10 ? '\n... and more' : ''}</pre>
    </details>
  {/if}
</div>

<style>
  .analysis-view {
    display: flex;
    flex-direction: column;
    gap: 15px;
    height: 100%;
    overflow-y: auto;
  }

  .empty-message, .loading {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px 20px;
  }

  .summary h4, .shapes-breakdown h4 {
    font-size: 0.9rem;
    margin-bottom: 10px;
    color: var(--text-primary);
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .stat {
    background: var(--bg-tertiary);
    padding: 12px;
    border-radius: 8px;
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--accent);
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .shape-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .shape-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .shape-name {
    text-transform: capitalize;
  }

  .shape-count {
    color: var(--text-secondary);
  }

  .raw-analysis {
    margin-top: 10px;
  }

  .raw-analysis summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.85rem;
    padding: 8px;
    background: var(--bg-tertiary);
    border-radius: 6px;
  }

  .raw-analysis pre {
    background: var(--bg-primary);
    padding: 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    overflow-x: auto;
    margin-top: 8px;
  }
</style>
