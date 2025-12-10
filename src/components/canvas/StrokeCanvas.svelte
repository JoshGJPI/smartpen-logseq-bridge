<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes } from '$stores';
  import { selectedIndices, handleStrokeClick, clearSelection, selectAll, selectionCount } from '$stores';
  import { canvasZoom, setCanvasZoom } from '$stores';
  import CanvasControls from './CanvasControls.svelte';
  import SelectionInfo from '../strokes/SelectionInfo.svelte';
  
  let canvasElement;
  let containerElement;
  let renderer = null;
  
  // Page filtering
  let selectedPage = '';
  $: pageOptions = Array.from($pages.keys());
  
  // Filtered strokes based on page selection
  $: filteredStrokes = selectedPage 
    ? ($pages.get(selectedPage) || [])
    : $strokes;
  
  // Import renderer dynamically to avoid SSR issues
  onMount(async () => {
    const { CanvasRenderer } = await import('$lib/canvas-renderer.js');
    renderer = new CanvasRenderer(canvasElement);
    
    // Initial render
    renderStrokes();
    
    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (renderer) {
        renderer.resize();
        renderStrokes();
      }
    });
    resizeObserver.observe(containerElement);
    
    return () => {
      resizeObserver.disconnect();
    };
  });
  
  // Re-render when strokes change
  $: if (renderer && filteredStrokes) {
    renderStrokes();
  }
  
  // Re-render when selection changes
  $: if (renderer && $selectedIndices) {
    renderStrokes();
  }
  
  // Update renderer zoom when store changes
  $: if (renderer && $canvasZoom) {
    renderer.setZoom($canvasZoom);
  }
  
  function renderStrokes() {
    if (!renderer) return;
    renderer.clear();
    filteredStrokes.forEach((stroke, index) => {
      renderer.drawStroke(stroke, $selectedIndices.has(index));
    });
  }
  
  // Canvas interactions
  function handleCanvasClick(event) {
    if (!renderer) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const strokeIndex = renderer.hitTest(x, y, filteredStrokes);
    
    if (strokeIndex !== -1) {
      handleStrokeClick(strokeIndex, event.ctrlKey || event.metaKey, event.shiftKey);
    } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      clearSelection();
    }
  }
  
  function handleWheel(event) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      setCanvasZoom($canvasZoom + delta);
    }
  }
  
  // Zoom controls
  function zoomIn() {
    setCanvasZoom($canvasZoom + 0.25);
  }
  
  function zoomOut() {
    setCanvasZoom($canvasZoom - 0.25);
  }
  
  function fitContent() {
    if (renderer) {
      renderer.fitToContent();
      // Sync zoom back to store
      setCanvasZoom(renderer.getZoom());
    }
  }
  
  function resetView() {
    setCanvasZoom(1);
    if (renderer) {
      renderer.resetView();
    }
  }
  
  // Export functions
  function exportSvg() {
    if (!renderer) return;
    const svg = renderer.exportSVG(filteredStrokes);
    downloadFile(svg, 'strokes.svg', 'image/svg+xml');
  }
  
  function exportJson() {
    const json = JSON.stringify(filteredStrokes, null, 2);
    downloadFile(json, 'strokes.json', 'application/json');
  }
  
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="canvas-panel panel">
  <div class="panel-header">
    Stroke Preview
    <span class="stroke-count">{$strokeCount} strokes</span>
  </div>
  
  <div class="canvas-container" bind:this={containerElement}>
    <canvas 
      bind:this={canvasElement}
      on:click={handleCanvasClick}
      on:wheel|preventDefault={handleWheel}
    ></canvas>
  </div>
  
  <CanvasControls 
    zoom={$canvasZoom}
    on:zoomIn={zoomIn}
    on:zoomOut={zoomOut}
    on:fit={fitContent}
    on:reset={resetView}
  />
  
  <div class="page-selector">
    <label for="pageSelect">Page:</label>
    <select id="pageSelect" bind:value={selectedPage}>
      <option value="">All Pages</option>
      {#each pageOptions as page (page)}
        <option value={page}>{page}</option>
      {/each}
    </select>
    
    <button class="btn btn-secondary small" on:click={exportSvg}>Export SVG</button>
    <button class="btn btn-secondary small" on:click={exportJson}>Export JSON</button>
  </div>
  
  <SelectionInfo 
    totalCount={filteredStrokes.length}
    on:selectAll={() => selectAll(filteredStrokes.length)}
    on:clearSelection={clearSelection}
  />
</div>

<style>
  .canvas-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .stroke-count {
    float: right;
    color: var(--text-secondary);
    font-weight: normal;
    font-size: 0.85rem;
  }

  .canvas-container {
    flex: 1;
    background: white;
    border-radius: 8px;
    position: relative;
    min-height: 400px;
    overflow: hidden;
  }

  canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .page-selector {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 10px;
    background: var(--bg-tertiary);
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .page-selector label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .page-selector select {
    flex: 1;
    min-width: 150px;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .btn.small {
    padding: 8px 12px;
    font-size: 0.8rem;
  }
</style>
