<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes } from '$stores';
  import { selectedIndices, handleStrokeClick, clearSelection, selectAll, selectionCount } from '$stores';
  import { canvasZoom, setCanvasZoom, log } from '$stores';
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
  
  // Track previous stroke count for auto-fit
  let previousStrokeCount = 0;
  
  // Panning state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let didPan = false; // Track if we actually panned (to distinguish from click)
  
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
  
  // Re-render when strokes change and auto-fit if new strokes added
  $: if (renderer && filteredStrokes) {
    const currentCount = filteredStrokes.length;
    const shouldAutoFit = currentCount > 0 && (previousStrokeCount === 0 || currentCount >= previousStrokeCount + 10);
    
    // Full reset when strokes change significantly
    if (previousStrokeCount !== currentCount) {
      renderStrokes(true);
    } else {
      renderStrokes(false);
    }
    
    // Auto-fit when strokes are first loaded or batch added
    if (shouldAutoFit) {
      // Small delay to ensure bounds are updated
      setTimeout(() => {
        fitContent();
      }, 100);
    }
    previousStrokeCount = currentCount;
  }
  
  // Re-render when selection changes (don't reset bounds)
  $: if (renderer && $selectedIndices !== undefined) {
    renderStrokes(false);
  }
  
  // Update renderer zoom when store changes and re-render
  $: if (renderer && $canvasZoom) {
    const changed = renderer.setZoom($canvasZoom);
    if (changed) {
      renderStrokes(false);
    }
  }
  
  function renderStrokes(fullReset = false) {
    if (!renderer) return;
    
    if (fullReset) {
      renderer.clear(true);
      // Pre-calculate bounds for consistent coordinate transformation
      renderer.calculateBounds(filteredStrokes);
    } else {
      renderer.clearForRedraw();
    }
    
    filteredStrokes.forEach((stroke, index) => {
      renderer.drawStroke(stroke, $selectedIndices.has(index));
    });
  }
  
  // Mouse down - start potential pan or selection
  function handleMouseDown(event) {
    // Middle mouse button or left + space for panning
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      event.preventDefault();
      isPanning = true;
      didPan = false;
      panStartX = event.clientX;
      panStartY = event.clientY;
      canvasElement.style.cursor = 'grabbing';
    }
  }
  
  // Mouse move - pan if dragging
  function handleMouseMove(event) {
    if (isPanning && renderer) {
      const deltaX = event.clientX - panStartX;
      const deltaY = event.clientY - panStartY;
      
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        didPan = true;
        renderer.pan(deltaX, deltaY);
        renderStrokes();
        panStartX = event.clientX;
        panStartY = event.clientY;
      }
    }
  }
  
  // Mouse up - end pan
  function handleMouseUp(event) {
    if (isPanning) {
      isPanning = false;
      canvasElement.style.cursor = 'default';
    }
  }
  
  // Mouse leave - cancel pan
  function handleMouseLeave(event) {
    if (isPanning) {
      isPanning = false;
      canvasElement.style.cursor = 'default';
    }
  }
  
  // Canvas click - select stroke (only if we didn't pan)
  function handleCanvasClick(event) {
    if (didPan) {
      didPan = false;
      return;
    }
    
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
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Zoom
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      setCanvasZoom($canvasZoom + delta);
    } else {
      // Pan with scroll wheel
      if (renderer) {
        renderer.pan(-event.deltaX, -event.deltaY);
        renderStrokes();
      }
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
      const newZoom = renderer.fitToContent();
      renderStrokes();
      // Sync zoom back to store
      if (newZoom) {
        setCanvasZoom(newZoom);
      }
    }
  }
  
  function resetView() {
    setCanvasZoom(1);
    if (renderer) {
      renderer.resetView();
      renderStrokes();
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
      on:mousedown={handleMouseDown}
      on:mousemove={handleMouseMove}
      on:mouseup={handleMouseUp}
      on:mouseleave={handleMouseLeave}
      on:click={handleCanvasClick}
      on:wheel={handleWheel}
    ></canvas>
    <div class="pan-hint">Shift+drag or middle-click to pan • Scroll to pan • Ctrl+scroll to zoom</div>
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
    cursor: default;
  }
  
  .pan-hint {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.7rem;
    color: rgba(0, 0, 0, 0.4);
    pointer-events: none;
    white-space: nowrap;
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
