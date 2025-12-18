<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes, batchMode } from '$stores';
  import { selectedIndices, handleStrokeClick, clearSelection, selectAll, selectionCount, selectFromBox } from '$stores';
  import { canvasZoom, setCanvasZoom, log, showFilteredStrokes } from '$stores';
  import { filteredStrokes } from '$stores/filtered-strokes.js';
  import CanvasControls from './CanvasControls.svelte';
  import PageSelector from './PageSelector.svelte';
  import SelectionInfo from '../strokes/SelectionInfo.svelte';
  import FilteredStrokesPanel from '../strokes/FilteredStrokesPanel.svelte';
  
  let canvasElement;
  let containerElement;
  let renderer = null;
  
  // Page filtering - now supports multiple selections
  let selectedPages = new Set();
  $: pageOptions = Array.from($pages.keys());
  
  // Visible strokes based on page selection (empty set = show all)
  $: visibleStrokes = selectedPages.size === 0
    ? $strokes
    : $strokes.filter(stroke => {
        const pageInfo = stroke.pageInfo || {};
        const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
        return selectedPages.has(pageKey);
      });
  
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && visibleStrokes.length > 0) {
        e.preventDefault();
        selectAll(visibleStrokes.length);
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
    
    if (batchModeJustEnded && renderer && visibleStrokes.length > 0) {
      console.log('🎨 Batch mode ended - forcing canvas update with', visibleStrokes.length, 'strokes');
      // Schedule the update to happen after this reactive block completes
      setTimeout(() => {
        renderStrokes(true);
        fitContent();
        previousStrokeCount = visibleStrokes.length;
      }, 50);
    }
  }
  
  // Re-render when strokes change and auto-fit if new strokes added
  // Skip updates when in batch mode (during offline import)
  $: if (renderer && visibleStrokes && !$batchMode) {
    const currentCount = visibleStrokes.length;
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
  
  // Re-render when filtered strokes toggle changes
  $: if (renderer && $showFilteredStrokes !== undefined && !$batchMode) {
    renderStrokes(false);
  }
  
  // Re-render when filtered strokes data changes
  $: if (renderer && $filteredStrokes !== undefined && $showFilteredStrokes && !$batchMode) {
    renderStrokes(false);
  }
  
  // Track previous page selection for change detection
  let previousPageSelection = null;
  
  // Re-render when page filter changes (not on initial load)
  $: {
    const currentSelection = selectedPages.size > 0 ? Array.from(selectedPages).sort().join(',') : '';
    if (renderer && previousPageSelection !== null && currentSelection !== previousPageSelection && !$batchMode) {
      console.log('📄 Page filter changed, re-rendering', visibleStrokes.length, 'strokes');
      renderStrokes(true);
      // Auto-fit to show filtered content
      setTimeout(() => {
        fitContent();
      }, 50);
    }
    previousPageSelection = currentSelection;
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
      // Include decorative filtered strokes in bounds calculation if we're showing them
      const allStrokes = $showFilteredStrokes && $filteredStrokes.length > 0
        ? [...visibleStrokes, ...$filteredStrokes.map(fs => fs.stroke)]
        : visibleStrokes;
      renderer.calculateBounds(allStrokes);
    } else {
      renderer.clearForRedraw();
    }
    
    // Draw normal text strokes
    visibleStrokes.forEach((stroke, index) => {
      renderer.drawStroke(stroke, $selectedIndices.has(index), false);
    });
    
    // Draw filtered decorative strokes if toggle is on
    if ($showFilteredStrokes && $filteredStrokes.length > 0) {
      $filteredStrokes.forEach(({ stroke }) => {
        renderer.drawStroke(stroke, false, true);
      });
    }
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
        const strokeIndex = renderer.hitTest(boxStartX, boxStartY, visibleStrokes);
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
      
      const intersectingIndices = renderer.findStrokesInRect(visibleStrokes, rect);
      
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
    
    const strokeIndex = renderer.hitTest(x, y, visibleStrokes);
    
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
  
  // Handle page selection change
  function handlePageSelectionChange(event) {
    selectedPages = event.detail.selectedPages;
  }
  
  // Zoom controls
  function zoomIn() {
    setCanvasZoom($canvasZoom + 0.5);
  }
  
  function zoomOut() {
    setCanvasZoom($canvasZoom - 0.5);
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
    const svg = renderer.exportSVG(visibleStrokes);
    downloadFile(svg, 'strokes.svg', 'image/svg+xml');
  }
  
  function exportJson() {
    const json = JSON.stringify(visibleStrokes, null, 2);
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
    <span class="stroke-count">
      {#if selectedPages.size > 0}
        {visibleStrokes.length} of {$strokeCount} strokes (filtered)
      {:else}
        {$strokeCount} strokes
      {/if}
    </span>
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
  
  <div class="canvas-controls-row">
    <CanvasControls 
      zoom={$canvasZoom}
      on:zoomIn={zoomIn}
      on:zoomOut={zoomOut}
      on:fit={fitContent}
      on:reset={resetView}
    />
    
    <PageSelector 
      {selectedPages}
      on:change={handlePageSelectionChange}
    />
    
    <div class="export-actions">
      <button class="btn btn-secondary small" on:click={exportSvg}>SVG</button>
      <button class="btn btn-secondary small" on:click={exportJson}>JSON</button>
    </div>
  </div>
  
  <SelectionInfo 
    totalCount={visibleStrokes.length}
    on:selectAll={() => selectAll(visibleStrokes.length)}
    on:clearSelection={clearSelection}
  />
  
  <FilteredStrokesPanel />
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

  .export-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  
  .canvas-controls-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  
  /* Let page selector grow but not too much */
  .canvas-controls-row :global(.page-selector) {
    flex: 1;
    min-width: 150px;
    max-width: 400px;
  }

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
  
  .btn.small:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }
</style>
