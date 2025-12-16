<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes, batchMode } from '$stores';
  import { selectedIndices, handleStrokeClick, clearSelection, selectAll, selectionCount, selectFromBox } from '$stores';
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
  
  // Track previous batch mode state for transition detection
  let wasBatchMode = false;
  
  // Panning state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let didPan = false; // Track if we actually panned (to distinguish from click)
  
  // Box selection state
  let isBoxSelecting = false;
  let boxSelectPending = false; // Waiting to see if drag exceeds threshold
  let didBoxSelect = false; // Track if we completed a box selection (to prevent click handler)
  let boxStartX = 0;
  let boxStartY = 0;
  let boxCurrentX = 0;
  let boxCurrentY = 0;
  let dragThreshold = 5; // pixels before activating box selection
  
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
    
    // Keyboard shortcuts
    const handleKeyDown = (e) => {
      // Escape - cancel box selection
      if (e.key === 'Escape' && (isBoxSelecting || boxSelectPending)) {
        isBoxSelecting = false;
        boxSelectPending = false;
        didBoxSelect = false;
        boxStartX = 0;
        boxStartY = 0;
        boxCurrentX = 0;
        boxCurrentY = 0;
        if (canvasElement) {
          canvasElement.style.cursor = 'default';
        }
      }
      
      // Ctrl/Cmd+A - select all visible strokes
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && filteredStrokes.length > 0) {
        e.preventDefault();
        selectAll(filteredStrokes.length);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
  
  // Explicitly handle batch mode transitions
  // This ensures canvas updates when batch mode ends, even if Svelte's reactivity has timing issues
  $: {
    const batchModeJustEnded = wasBatchMode && !$batchMode;
    wasBatchMode = $batchMode;
    
    if (batchModeJustEnded && renderer && filteredStrokes.length > 0) {
      console.log('🎨 Batch mode ended - forcing canvas update with', filteredStrokes.length, 'strokes');
      // Schedule the update to happen after this reactive block completes
      setTimeout(() => {
        renderStrokes(true);
        fitContent();
        previousStrokeCount = filteredStrokes.length;
      }, 50);
    }
  }
  
  // Re-render when strokes change and auto-fit if new strokes added
  // Skip updates when in batch mode (during offline import)
  $: if (renderer && filteredStrokes && !$batchMode) {
    const currentCount = filteredStrokes.length;
    const strokesAdded = currentCount > previousStrokeCount;
    const shouldAutoFit = currentCount > 0 && (previousStrokeCount === 0 || currentCount >= previousStrokeCount + 10);
    
    if (strokesAdded) {
      console.log('📊 Strokes changed:', previousStrokeCount, '->', currentCount);
      // Full reset when new strokes added
      renderStrokes(true);
      
      // Auto-fit when strokes are first loaded or batch added
      if (shouldAutoFit) {
        setTimeout(() => {
          fitContent();
        }, 100);
      }
      
      previousStrokeCount = currentCount;
    }
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
    // Middle mouse button or Alt+left for panning
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      isPanning = true;
      didPan = false;
      panStartX = event.clientX;
      panStartY = event.clientY;
      canvasElement.style.cursor = 'grabbing';
      return;
    }
    
    // Left button - start potential box selection or direct stroke selection
    if (event.button === 0) {
      event.preventDefault();
      const rect = canvasElement.getBoundingClientRect();
      boxStartX = event.clientX - rect.left;
      boxStartY = event.clientY - rect.top;
      boxCurrentX = boxStartX;
      boxCurrentY = boxStartY;
      
      // Check if clicking directly on a stroke for Ctrl+click toggle
      if (renderer && (event.ctrlKey || event.metaKey)) {
        const strokeIndex = renderer.hitTest(boxStartX, boxStartY, filteredStrokes);
        if (strokeIndex !== -1) {
          // Ctrl+click on stroke - toggle it immediately
          handleStrokeClick(strokeIndex, true, false);
          boxStartX = 0;
          boxStartY = 0;
          return;
        }
      }
      
      // Otherwise, prepare for potential box selection
      boxSelectPending = true;
      isBoxSelecting = false;
    }
  }
  
  // Mouse move - pan or update box selection
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
      return;
    }
    
    // Update box selection if we're in selection mode or pending
    if (boxSelectPending || isBoxSelecting) {
      const rect = canvasElement.getBoundingClientRect();
      boxCurrentX = event.clientX - rect.left;
      boxCurrentY = event.clientY - rect.top;
      
      const dx = boxCurrentX - boxStartX;
      const dy = boxCurrentY - boxStartY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Activate box selection once drag exceeds threshold
      if (boxSelectPending && distance > dragThreshold) {
        isBoxSelecting = true;
        boxSelectPending = false;
        canvasElement.style.cursor = 'crosshair';
      }
    }
  }
  
  // Mouse up - end pan or complete box selection
  function handleMouseUp(event) {
    if (isPanning) {
      isPanning = false;
      canvasElement.style.cursor = 'default';
      return;
    }
    
    if (isBoxSelecting && renderer) {
      // Complete box selection
      const rect = {
        left: Math.min(boxStartX, boxCurrentX),
        top: Math.min(boxStartY, boxCurrentY),
        right: Math.max(boxStartX, boxCurrentX),
        bottom: Math.max(boxStartY, boxCurrentY)
      };
      
      const intersectingIndices = renderer.findStrokesInRect(filteredStrokes, rect);
      
      if (intersectingIndices.length > 0) {
        // Ctrl = add to selection, Shift = toggle, neither = replace selection
        const mode = (event.ctrlKey || event.metaKey) ? 'add' : event.shiftKey ? 'toggle' : 'replace';
        selectFromBox(intersectingIndices, mode);
        didBoxSelect = true; // Mark that we completed a box selection
      } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        // Empty box with no modifiers - clear selection
        clearSelection();
        didBoxSelect = true;
      }
      
      // Reset box selection state
      isBoxSelecting = false;
      boxSelectPending = false;
      boxStartX = 0;
      boxStartY = 0;
      boxCurrentX = 0;
      boxCurrentY = 0;
      canvasElement.style.cursor = 'default';
      return;
    }
    
    // If we had a pending selection but didn't drag enough, treat as click
    if (boxSelectPending) {
      boxSelectPending = false;
      boxStartX = 0;
      boxStartY = 0;
      // Let the click handler deal with it
    }
  }
  
  // Mouse leave - cancel pan or box selection
  function handleMouseLeave(event) {
    if (isPanning) {
      isPanning = false;
      canvasElement.style.cursor = 'default';
    }
    
    if (isBoxSelecting || boxSelectPending) {
      isBoxSelecting = false;
      boxSelectPending = false;
      didBoxSelect = false;
      boxStartX = 0;
      boxStartY = 0;
      boxCurrentX = 0;
      boxCurrentY = 0;
      canvasElement.style.cursor = 'default';
    }
  }
  
  // Canvas click - select stroke (only if we didn't pan or box select)
  function handleCanvasClick(event) {
    if (didPan || didBoxSelect) {
      didPan = false;
      didBoxSelect = false;
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
    
    {#if isBoxSelecting}
      <div 
        class="selection-box"
        style="
          left: {Math.min(boxStartX, boxCurrentX)}px;
          top: {Math.min(boxStartY, boxCurrentY)}px;
          width: {Math.abs(boxCurrentX - boxStartX)}px;
          height: {Math.abs(boxCurrentY - boxStartY)}px;
        "
      ></div>
    {/if}
    
    <div class="pan-hint">Drag to select • Ctrl/Shift to add/toggle • Alt+drag to pan • Ctrl+scroll to zoom</div>
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
  
  .selection-box {
    position: absolute;
    border: 2px dashed var(--accent);
    background: rgba(233, 69, 96, 0.1);
    pointer-events: none;
    z-index: 10;
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
