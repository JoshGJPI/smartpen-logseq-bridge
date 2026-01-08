<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes, batchMode } from '$stores';
  import { selectedIndices, handleStrokeClick, clearSelection, selectAll, selectionCount, selectFromBox } from '$stores';
  import { deletedIndices } from '$stores';
  import { canvasZoom, setCanvasZoom, log, showFilteredStrokes } from '$stores';
  import { filteredStrokes } from '$stores/filtered-strokes.js';
  import { pagePositions, useCustomPositions, setPagePosition, movePageBy, clearPagePositions } from '$stores';
  import { deselectIndices } from '$stores/selection.js';
  import { detectDecorativeIndices } from '$lib/stroke-filter.js';
  import { pageTranscriptionsArray } from '$stores';
  import { logseqPages } from '$stores';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { openSearchTranscriptsDialog } from '$stores';
  import { logseqConnected } from '$stores';
  import CanvasControls from './CanvasControls.svelte';
  import PageSelector from './PageSelector.svelte';
  import FilteredStrokesPanel from '../strokes/FilteredStrokesPanel.svelte';
  import SearchTranscriptsDialog from '../dialog/SearchTranscriptsDialog.svelte';
  
  let canvasElement;
  let containerElement;
  let renderer = null;
  
  // Decorative detection state
  let isDetecting = false;
  
  // Text view toggle state
  let showTextView = false;
  
  // Page filtering - now supports multiple selections
  let selectedPages = new Set();
  $: pageOptions = Array.from($pages.keys());
  
  // Visible strokes based on page selection (empty set = show all)
  // Also track mapping from visible index to full stroke array index
  let visibleStrokes = [];
  let visibleToFullIndexMap = [];
  
  $: {
    // Always filter by selectedPages - if all are selected, all strokes show
    // If none are selected, no strokes show
    visibleStrokes = [];
    visibleToFullIndexMap = [];
    $strokes.forEach((stroke, fullIndex) => {
      const pageInfo = stroke.pageInfo || {};
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
      if (selectedPages.has(pageKey)) {
        visibleStrokes.push(stroke);
        visibleToFullIndexMap.push(fullIndex);
      }
    });
  }
  
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
  
  // Page dragging state
  let isDraggingPage = false;
  let draggedPageKey = null;
  let pageDragStartX = 0;
  let pageDragStartY = 0;
  let pageOriginalNcodeX = 0; // Store original Ncode position at drag start
  let pageOriginalNcodeY = 0; // Store original Ncode position at drag start
  
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
      
      // Ctrl/Cmd+A - select all visible strokes (using full indices)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && visibleStrokes.length > 0) {
        e.preventDefault();
        // Select using full indices from the mapping
        selectedIndices.set(new Set(visibleToFullIndexMap));
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
  
  // Re-render when deleted indices change
  $: if (renderer && $deletedIndices !== undefined) {
    renderStrokes(false);
  }
  
  // Track previous page selection for change detection
  let previousPageSelection = null;
  
  // Re-render when page filter changes (not on initial load)
  $: {
    const currentSelection = selectedPages.size > 0 ? Array.from(selectedPages).sort().join(',') : '';
    if (renderer && previousPageSelection !== null && currentSelection !== previousPageSelection && !$batchMode) {
      console.log('📄 Page filter changed, re-rendering', visibleStrokes.length, 'strokes');
      // Update renderer with visible page keys
      renderer.setVisiblePageKeys(selectedPages);
      // Use false to avoid recalculating bounds/zoom - just redraw with current view
      renderStrokes(false);
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
      
      // Set visible page keys for border rendering
      renderer.setVisiblePageKeys(selectedPages);
      
      // Apply custom positions if enabled
      if ($useCustomPositions && Object.keys($pagePositions).length > 0) {
        renderer.applyCustomPositions($pagePositions);
      }
    } else {
      renderer.clearForRedraw();
    }
    
    // Draw page borders
    renderer.drawPageBorders();
    
    if (showTextView) {
      // Text view mode - render transcribed text inside page boundaries
      renderTranscribedText();
    } else {
      // Stroke view mode - render strokes
      // Draw normal text strokes
      visibleStrokes.forEach((stroke, index) => {
        const fullIndex = visibleToFullIndexMap[index];
        const isSelected = $selectedIndices.has(fullIndex);
        const isDeleted = $deletedIndices.has(fullIndex);
        renderer.drawStroke(stroke, isSelected, false, isDeleted);
      });
      
      // Draw filtered decorative strokes if toggle is on
      if ($showFilteredStrokes && $filteredStrokes.length > 0) {
        $filteredStrokes.forEach(({ stroke }) => {
          renderer.drawStroke(stroke, false, true);
        });
      }
    }
  }
  
  // Mouse down - start potential pan, page drag, or selection
  function handleMouseDown(event) {
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
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
    
    // Left button - check for page header click first (unless Ctrl/Shift held)
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && renderer) {
      const pageKey = renderer.hitTestPageHeader(x, y);
      if (pageKey) {
        event.preventDefault();
        isDraggingPage = true;
        draggedPageKey = pageKey;
        pageDragStartX = event.clientX;
        pageDragStartY = event.clientY;
        
        // Store the ORIGINAL Ncode position at drag start
        const offset = renderer.pageOffsets.get(pageKey);
        if (offset) {
          // If page has custom position, use that; otherwise use current offset
          const customPos = $pagePositions[pageKey];
          if (customPos) {
            pageOriginalNcodeX = customPos.x;
            pageOriginalNcodeY = customPos.y;
          } else {
            pageOriginalNcodeX = offset.offsetX;
            pageOriginalNcodeY = offset.offsetY;
          }
        }
        
        canvasElement.style.cursor = 'grabbing';
        return;
      }
    }
    
    // Left button - start potential box selection or direct stroke selection
    if (event.button === 0) {
      event.preventDefault();
      const rect = canvasElement.getBoundingClientRect();
      boxStartX = event.clientX - rect.left;
      boxStartY = event.clientY - rect.top;
      boxCurrentX = boxStartX;
      boxCurrentY = boxStartY;
      
      // Check if clicking directly on a stroke for Ctrl/Shift
      if (renderer && (event.ctrlKey || event.metaKey || event.shiftKey)) {
        const visibleIndex = renderer.hitTest(boxStartX, boxStartY, visibleStrokes);
        if (visibleIndex !== -1) {
          // Map visible index to full stroke array index
          const fullIndex = visibleToFullIndexMap[visibleIndex];
          
          // Ctrl+click = add, Shift+click = remove
          if (event.shiftKey) {
            // Remove from selection
            selectedIndices.update(sel => {
              const newSel = new Set(sel);
              newSel.delete(fullIndex);
              return newSel;
            });
          } else {
            // Add to selection (Ctrl/Cmd)
            selectedIndices.update(sel => {
              const newSel = new Set(sel);
              newSel.add(fullIndex);
              return newSel;
            });
          }
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
  
  // Mouse move - page drag, pan, or update box selection
  function handleMouseMove(event) {
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Handle page dragging
    if (isDraggingPage && renderer && draggedPageKey) {
      const deltaX = event.clientX - pageDragStartX;
      const deltaY = event.clientY - pageDragStartY;
      
      // Convert screen delta to Ncode delta
      const ncodeDeltaX = deltaX / (renderer.scale * renderer.zoom);
      const ncodeDeltaY = deltaY / (renderer.scale * renderer.zoom);
      
      // Calculate new position from ORIGINAL position + delta
      const newNcodeX = pageOriginalNcodeX + ncodeDeltaX;
      const newNcodeY = pageOriginalNcodeY + ncodeDeltaY;
      
      // Update page position in renderer for visual feedback
      renderer.applyCustomPositions({
        ...$pagePositions,
        [draggedPageKey]: {
          x: newNcodeX,
          y: newNcodeY
        }
      });
      renderStrokes();
      
      return;
    }
    
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
      return;
    }
    
    // Update cursor based on what's under the mouse (when not actively doing something)
    if (!isPanning && !isDraggingPage && !isBoxSelecting && !boxSelectPending && renderer) {
      // Check if hovering over a page header (draggable area)
      const pageKey = renderer.hitTestPageHeader(x, y);
      if (pageKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        canvasElement.style.cursor = 'grab';
      } else if (canvasElement.style.cursor === 'grab') {
        // Only reset if it was set to grab (don't override other cursors)
        canvasElement.style.cursor = 'default';
      }
    }
  }
  
  // Mouse up - end page drag, pan, or complete box selection
  function handleMouseUp(event) {
    // Handle page drag completion
    if (isDraggingPage && draggedPageKey && renderer) {
      const deltaX = event.clientX - pageDragStartX;
      const deltaY = event.clientY - pageDragStartY;
      
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        // Convert screen delta to Ncode delta
        const ncodeDeltaX = deltaX / (renderer.scale * renderer.zoom);
        const ncodeDeltaY = deltaY / (renderer.scale * renderer.zoom);
        
        // Save final position = original + delta
        const newNcodeX = pageOriginalNcodeX + ncodeDeltaX;
        const newNcodeY = pageOriginalNcodeY + ncodeDeltaY;
        
        setPagePosition(draggedPageKey, newNcodeX, newNcodeY);
        log(`Moved ${draggedPageKey} to new position`, 'info');
      }
      
      isDraggingPage = false;
      draggedPageKey = null;
      pageOriginalNcodeX = 0;
      pageOriginalNcodeY = 0;
      canvasElement.style.cursor = 'default';
      return;
    }
    
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
      
      const visibleIndices = renderer.findStrokesInRect(visibleStrokes, rect);
      
      // Map visible indices to full stroke array indices
      const fullIndices = visibleIndices.map(visIdx => visibleToFullIndexMap[visIdx]);
      
      if (fullIndices.length > 0) {
        // Ctrl = add to selection, Shift = remove from selection, neither = replace
        const mode = (event.ctrlKey || event.metaKey) ? 'add' : event.shiftKey ? 'remove' : 'replace';
        
        if (mode === 'replace') {
          selectFromBox(fullIndices, 'replace');
        } else if (mode === 'add') {
          selectFromBox(fullIndices, 'add');
        } else if (mode === 'remove') {
          // Deselect the intersecting strokes
          deselectIndices(fullIndices);
        }
        
        didBoxSelect = true;
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
  
  // Mouse leave - cancel page drag, pan, or box selection
  function handleMouseLeave(event) {
    if (isDraggingPage) {
      isDraggingPage = false;
      draggedPageKey = null;
      pageOriginalNcodeX = 0;
      pageOriginalNcodeY = 0;
      canvasElement.style.cursor = 'default';
      // Re-render to remove drag preview
      if (renderer) {
        renderStrokes(true);
      }
    }
    
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
    
    const visibleIndex = renderer.hitTest(x, y, visibleStrokes);
    
    if (visibleIndex !== -1) {
      // Map visible index to full stroke array index
      const fullIndex = visibleToFullIndexMap[visibleIndex];
      
      // Ctrl = add, Shift = remove, neither = replace
      if (event.shiftKey) {
        // Remove from selection
        selectedIndices.update(sel => {
          const newSel = new Set(sel);
          newSel.delete(fullIndex);
          return newSel;
        });
      } else if (event.ctrlKey || event.metaKey) {
        // Add to selection
        selectedIndices.update(sel => {
          const newSel = new Set(sel);
          newSel.add(fullIndex);
          return newSel;
        });
      } else {
        // Replace selection with just this stroke
        selectedIndices.set(new Set([fullIndex]));
      }
    } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      clearSelection();
    }
  }
  
  function handleWheel(event) {
    event.preventDefault();
    
    if (event.ctrlKey || event.metaKey) {
      // Zoom - 25% per scroll tick, centered on cursor position
      const delta = event.deltaY > 0 ? -0.25 : 0.25;
      const newZoom = $canvasZoom + delta;
      
      if (renderer) {
        // Get cursor position relative to canvas
        const rect = canvasElement.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        
        // Zoom toward cursor position
        renderer.setZoom(newZoom, { x: cursorX, y: cursorY });
        
        // Update store to keep in sync
        setCanvasZoom(newZoom);
        
        // Re-render with new zoom
        renderStrokes();
      }
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
  
  // Handle deselect decorative strokes
  async function handleDeselectDecorative() {
    isDetecting = true;
    try {
      const allStrokes = $strokes;
      
      if (!allStrokes || allStrokes.length === 0) {
        log('No strokes available for detection', 'warning');
        return;
      }
      
      // Detect decorative strokes
      const result = detectDecorativeIndices(allStrokes);
      
      if (result.indices.length === 0) {
        log('No decorative strokes detected', 'info');
        return;
      }
      
      // If nothing is currently selected, select all first
      if ($selectionCount === 0) {
        selectAll(visibleStrokes.length);
        // Wait a tick for the selection to update
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      // Deselect the detected indices
      deselectIndices(result.indices);
      
      // Log the results
      log(`Deselected ${result.indices.length} decorative strokes (${result.stats.boxes} boxes, ${result.stats.underlines} underlines, ${result.stats.circles} circles)`, 'success');
      
    } catch (error) {
      log(`Failed to detect decorative strokes: ${error.message}`, 'error');
      console.error('Decorative detection error:', error);
    } finally {
      isDetecting = false;
    }
  }
  
  // Check if search is available
  $: canSearch = $logseqConnected && $logseqPages.some(p => p.transcriptionText);
  
  // Toggle text view - check for data when clicked
  function handleTextViewToggle() {
    // If already showing text, just toggle back to strokes
    if (showTextView) {
      showTextView = false;
      return;
    }
    
    // Check if any visible pages have transcription data
    const transcriptions = getVisibleTranscriptions();
    
    if (transcriptions.length === 0) {
      log('No transcription data available for selected pages. Transcribe strokes first or import pages with transcription data.', 'warning');
      return;
    }
    
    // Show text view
    showTextView = true;
    log(`Displaying transcription text for ${transcriptions.length} page(s)`, 'info');
  }
  
  // Get transcriptions for visible pages (from both MyScript and LogSeq)
  // This function now matches pages more intelligently, handling section/owner mismatches
  function getVisibleTranscriptions() {
    const transcriptions = [];
    
    // Helper to match pages ignoring section/owner when needed
    function matchesPage(pageKey, book, page) {
      // Try exact match first
      if (selectedPages.has(pageKey)) return true;
      
      // Try matching just by book/page (ignore section/owner)
      for (const selectedKey of selectedPages) {
        const match = selectedKey.match(/S\d+\/O\d+\/B(\d+)\/P(\d+)/);
        if (match && parseInt(match[1]) === book && parseInt(match[2]) === page) {
          return true;
        }
      }
      
      return false;
    }
    
    // Add MyScript transcriptions
    if ($pageTranscriptionsArray) {
      $pageTranscriptionsArray.forEach(pt => {
        if (matchesPage(pt.pageKey, pt.pageInfo.book, pt.pageInfo.page)) {
          transcriptions.push({
            pageKey: pt.pageKey,
            text: pt.text,
            pageInfo: pt.pageInfo,
            strokeCount: pt.strokeCount,
            source: 'myscript'
          });
        }
      });
    }
    
    // Add LogSeq imported pages (only if not already in MyScript transcriptions)
    if ($logseqPages) {
      $logseqPages.forEach(lsPage => {
        if (!lsPage.transcriptionText) return;
        
        // Check if we already have this page from MyScript (match by book/page)
        const alreadyExists = transcriptions.some(t => 
          t.pageInfo.book === lsPage.book && t.pageInfo.page === lsPage.page
        );
        if (alreadyExists) return;
        
        // Use the LogSeq pageKey format, but check if it matches any selected page
        const pageKey = `S${lsPage.section || 0}/O${lsPage.owner || 0}/B${lsPage.book}/P${lsPage.page}`;
        
        if (!matchesPage(pageKey, lsPage.book, lsPage.page)) return;
        
        transcriptions.push({
          pageKey: pageKey,
          text: lsPage.transcriptionText,
          pageInfo: {
            section: lsPage.section || 0,
            owner: lsPage.owner || 0,
            book: lsPage.book,
            page: lsPage.page
          },
          strokeCount: lsPage.strokeCount || 0,
          source: 'logseq'
        });
      });
    }
    
    // Sort by book then page
    return transcriptions.sort((a, b) => {
      if (a.pageInfo.book !== b.pageInfo.book) {
        return a.pageInfo.book - b.pageInfo.book;
      }
      return a.pageInfo.page - b.pageInfo.page;
    });
  }
  
  // Render transcribed text on canvas within page boundaries
  function renderTranscribedText() {
    if (!renderer) return;
    
    const visibleTranscriptions = getVisibleTranscriptions();
    
    console.log('📝 Rendering transcribed text for', visibleTranscriptions.length, 'pages');
    
    visibleTranscriptions.forEach(pageData => {
      if (!pageData.text || !pageData.text.trim()) {
        console.log('  ⚠️ No text for', pageData.pageKey);
        return;
      }
      
      // Need to find the actual pageKey used in the renderer
      // The pageData.pageKey might be from LogSeq (S0/O0/...) but renderer has real pen data (S3/O1012/...)
      const book = pageData.pageInfo.book;
      const page = pageData.pageInfo.page;
      
      // Find matching pageKey in renderer's pageOffsets (fuzzy match by book/page)
      let matchingPageKey = null;
      for (const [rendererPageKey, offset] of renderer.pageOffsets) {
        const match = rendererPageKey.match(/S\d+\/O\d+\/B(\d+)\/P(\d+)/);
        if (match && parseInt(match[1]) === book && parseInt(match[2]) === page) {
          matchingPageKey = rendererPageKey;
          break;
        }
      }
      
      if (!matchingPageKey) {
        console.log('  ❌ No matching page in renderer for B', book, 'P', page);
        return;
      }
      
      console.log('  ✅ Rendering text for', matchingPageKey, '(', pageData.text.length, 'chars )');
      
      // Render text inside the page boundaries using the correct pageKey
      renderer.drawPageText(matchingPageKey, pageData.text);
    });
  }
  
  // Re-render when text view toggle changes
  $: if (renderer && showTextView !== undefined) {
    renderStrokes(false);
  }
</script>

<div class="canvas-panel panel">
  <div class="panel-header">
    <div class="header-left">
      <span class="header-title">Stroke Preview</span>
    </div>
    
    <div class="header-actions">
      <!-- Search Transcripts - Always visible, placed first -->
      <button 
        class="header-btn search-btn"
        on:click={openSearchTranscriptsDialog}
        disabled={!canSearch}
        title={canSearch 
          ? 'Search transcribed text in LogSeq database'
          : 'Connect to LogSeq and scan pages with transcriptions first'}
      >
        🔍 Search Transcripts
      </button>
      
      {#if $strokeCount > 0}
        <button 
          class="header-btn" 
          on:click={() => clearSelection()}
          disabled={$selectionCount === 0}
          title="Clear selection"
        >
          Clear
        </button>
        <button 
          class="header-btn" 
          on:click={() => selectAll(visibleStrokes.length)}
          title="Select all strokes"
        >
          Select All
        </button>
        <button 
          class="header-btn decorative-btn" 
          on:click={handleDeselectDecorative}
          disabled={isDetecting}
          title="Deselect boxes, underlines, and circles"
        >
          {isDetecting ? 'Detecting...' : '🎨 Deselect Decorative'}
        </button>
        {#if $useCustomPositions}
          <button 
            class="header-btn layout-btn" 
            on:click={() => {
              clearPagePositions(); // Clear stored positions, not just disable
              if (renderer) {
                renderStrokes(true);
                setTimeout(() => fitContent(), 50);
              }
              log('Reset to automatic layout', 'info');
            }}
            title="Reset pages to automatic horizontal layout"
          >
            📐 Reset Layout
          </button>
        {/if}
        {#if $strokeCount > 0}
          <button 
            class="header-btn text-toggle-btn" 
            on:click={handleTextViewToggle}
            title={showTextView ? 'Show stroke view' : 'Show text view'}
          >
            {showTextView ? '✏️ Show Strokes' : '📝 Show Text'}
          </button>
        {/if}
      {/if}
    </div>
    
    <div class="header-right">
      <span class="stroke-count">
        {#if $selectionCount > 0}
          <span class="selection-indicator">{$selectionCount} of {$strokeCount} selected</span>
        {:else if visibleStrokes.length < $strokeCount}
          {visibleStrokes.length} of {$strokeCount} strokes (filtered)
        {:else}
          {$strokeCount} strokes
        {/if}
      </span>
    </div>
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
    
    <div class="canvas-hint">
      {#if $useCustomPositions}
        <strong>Drag page labels to reposition</strong> • 
      {/if}
      {#if showTextView}
        Showing transcribed text • 
      {:else}
        Drag to select • Ctrl+click to add • Shift+click to deselect • 
      {/if}
      Alt+drag to pan • Ctrl+scroll to zoom
    </div>
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
  
  <FilteredStrokesPanel />
  
  <!-- Search Transcripts Dialog -->
  <SearchTranscriptsDialog />
</div>

<style>
  .canvas-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding-bottom: 10px;
    margin-bottom: 15px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .header-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    justify-content: center;
  }
  
  .header-right {
    display: flex;
    align-items: center;
  }
  
  .header-btn {
    padding: 4px 10px;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }
  
  .header-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
    background: var(--bg-tertiary);
  }
  
  .header-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .decorative-btn {
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .decorative-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  
  .layout-btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .layout-btn:hover:not(:disabled) {
    background: var(--success);
    color: var(--bg-primary);
    border-color: var(--success);
  }
  
  .text-toggle-btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .text-toggle-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  
  .search-btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .search-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  
  .stroke-count {
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-weight: normal;
    white-space: nowrap;
  }
  
  .selection-indicator {
    color: var(--accent);
    font-weight: 600;
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
  
  .canvas-hint {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.7rem;
    color: #000000;
    pointer-events: none;
    white-space: nowrap;
    opacity: 0.5;
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
  
  /* No additional text view styles needed - rendering on canvas */
</style>
