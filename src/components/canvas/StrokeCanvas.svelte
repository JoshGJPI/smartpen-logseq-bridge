<!--
  StrokeCanvas.svelte - Main canvas wrapper with controls
-->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { strokes, strokeCount, pages, clearStrokes, batchMode } from '$stores';
  import { selectedIndices, selectedStrokes, handleStrokeClick, clearSelection, selectAll, selectionCount, selectFromBox } from '$stores';
  import { deletedIndices, pendingChanges } from '$stores';
  import { pastedStrokes, pastedSelection, pastedCount, duplicateStrokes, movePastedStrokes, clearPastedStrokes, deleteSelectedPasted, selectPastedStroke, clearPastedSelection } from '$stores';
  import { canvasZoom, setCanvasZoom, log, showFilteredStrokes, penConnected } from '$stores';
  import { filteredStrokes } from '$stores/filtered-strokes.js';
  import { pagePositions, useCustomPositions, setPagePosition, movePageBy, clearPagePositions } from '$stores';
  import { pageScales, setPageScale, getPageScale, resetPageScale, resetAllPageScales, hasScaledPages } from '$stores';
  import { deselectIndices } from '$stores/selection.js';
  import { detectDecorativeIndices } from '$lib/stroke-filter.js';
  import { pageTranscriptionsArray } from '$stores';
  import { savedPages } from '$stores';
  import { bookAliases } from '$stores';
  import { formatBookName, filterTranscriptionProperties } from '$utils/formatting.js';
  import { openTranscriptSearch, openSvgExportDialog } from '$stores';
  import { hasSelection } from '$stores/selection.js';
  import { sketchProfile, sketchProfileSummary, sketchStrokeCount, markStrokesAsSketch, unmarkStrokesAsSketch } from '$stores';
  import { reassignVolume } from '$stores/strokes.js';
  import { knownBookIds } from '$stores/book-aliases.js';
  import { volumesForBook } from '$stores/volumes.js';
  import { ncodeBookOf, volumeOf, BOOK_KEY_FRAGMENT } from '$lib/volumes.js';
  import { contextInk } from '$stores/context-ink.js';
  import { canvasPageOrder } from '$stores/timeline.js';

  // S#/O#/B<bookKey>/P# — the book portion may carry a volume suffix.
  const BOOK_PAGE_KEY_RE = new RegExp(`S\\d+\\/O\\d+\\/B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)`);
  import { dataFolderReady, graphFolderReady } from '$stores/settings.js';
  import { buildJsonExportData, buildMdExportData } from '$lib/stroke-storage.js';
  import { exportSelectionToGraph } from '$lib/storage/graph-export.js';
  import { pagesToLogseqMarkdown, textToTranscriptLines } from '$lib/viewer/transcript-markdown.js';
  import { getCachedPage } from '$lib/viewer/page-cache.js';
  import {
    pointEditMode,
    pointEditStrokes,
    selectedPoints,
    selectedPointCount,
    strayPointKeys,
    strayPoints,
    selectPoint,
    selectPoints,
    clearPointSelection,
    deleteSelectedPoints,
    togglePointEditMode,
    exitPointEditMode,
    MAX_POINT_EDIT_STROKES
  } from '$stores/point-edit.js';
  import CanvasControls from './CanvasControls.svelte';
  import PointEditPanel from './PointEditPanel.svelte';
  import PageSelector from './PageSelector.svelte';
  import SketchStylePopover from './SketchStylePopover.svelte';
  import CanvasSearch from './CanvasSearch.svelte';
  import FilteredStrokesPanel from '../strokes/FilteredStrokesPanel.svelte';
  import CreatePageDialog from '../dialog/CreatePageDialog.svelte';
  import ExportSvgDialog from '../dialog/ExportSvgDialog.svelte';
  
  let canvasElement;
  let containerElement;
  let renderer = null;
  
  // Decorative detection state
  let isDetecting = false;

  // "Export to LogSeq" in-flight guard (disk I/O in the graph folder)
  let isExportingToGraph = false;
  
  // Text view toggle state
  let showTextView = false;

  // Copy-transcript state (text view). `textPageOverlays` positions a small
  // "Copy" button over each page that actually rendered text, recomputed on
  // every paint so it tracks pan/zoom/layout.
  let textPageOverlays = [];
  let isCopyingTranscript = false;
  let copiedPageKey = null;
  let copiedResetTimer = null;

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

  // Context ink for the pages currently shown. Filtered by the SAME page
  // selection as real strokes — otherwise hiding a page with the filter would
  // leave its grey ghost behind. No index map: context ink is never selected,
  // deleted or saved, so nothing needs a position into it.
  $: visibleContextInk = $contextInk.length === 0 ? [] : $contextInk.filter(stroke => {
    const pageInfo = stroke.pageInfo || {};
    const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
    return selectedPages.has(pageKey);
  });

  // Page order is layout, so a change has to re-run the bounds pass.
  $: if (renderer && $canvasPageOrder) {
    renderer.setPageOrder($canvasPageOrder);
    renderStrokes(true);
  }

  // Context ink arrives and leaves in whole pages (a range load, a page unload,
  // Clear), and it feeds the bounds pass, so a change in how much there is needs
  // a full reset. Compared as counts rather than by identity because
  // `visibleContextInk` is a fresh array on every page-filter change, which
  // already has its own render path.
  let lastContextInkSignature = '0:0';
  $: if (renderer) {
    const contextSignature = `${$contextInk.length}:${visibleContextInk.length}`;
    if (contextSignature !== lastContextInkSignature) {
      lastContextInkSignature = contextSignature;
      renderStrokes(true);
    }
  }

  // Track previous stroke count for auto-fit
  let previousStrokeCount = 0;
  // Whether the strokes store had anything in it on the last render pass — used
  // to detect the canvas being emptied (Clear), which needs a layout reset.
  let hadCanvasStrokes = false;
  // Set to true once setLiveWritingView() has been called for the current live session.
  // Reset to false when the pen disconnects so the next session gets the initial zoom.
  let liveWritingViewSet = false;
  
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
  
  // Page resize state
  let isResizingPage = false;
  let resizePageKey = null;
  let resizeCorner = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeOriginalBounds = null;
  let resizeOriginalScale = 1.0;
  let resizePreviewScale = 1.0;
  let resizeOriginalOffset = null; // Store original Ncode offset
  
  // Pasted stroke dragging state
  let isDraggingPasted = false;
  let pastedDragStartX = 0;
  let pastedDragStartY = 0;
  
  // Create page dialog state
  let showCreatePageDialog = false;
  
  // Import renderer dynamically to avoid SSR issues
  onMount(async () => {
    const { CanvasRenderer } = await import('$lib/canvas-renderer.js');
    renderer = new CanvasRenderer(canvasElement);

    // Initial render.
    // If strokes were already in the store before this canvas mounted (e.g. via
    // "Load into Editor" from Book View), the page filter starts empty so
    // visibleStrokes is empty, and the PageSelector's auto-select may not yield a
    // stroke-count change for the render reactive block to catch — leaving the
    // canvas blank until a filter is toggled. Seed the selection from the pages
    // that already exist, then do a full render (with bounds) and fit.
    if (selectedPages.size === 0 && pageOptions.length > 0) {
      selectedPages = new Set(pageOptions);
      await tick(); // let visibleStrokes recompute from the new selection
    }
    renderStrokes(true);
    if (visibleStrokes.length > 0) {
      previousStrokeCount = visibleStrokes.length; // avoid a redundant auto-fit
      setTimeout(() => fitContent(), 100);
    }

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
      // Ctrl+F — find a page on the canvas. Shift adds "across everything
      // saved", which is the left panel's Transcripts → Search. Checked before
      // the mode-specific handling below: find is never what those keys mean.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (e.shiftKey) openTranscriptSearch();
        else canvasSearch?.focus();
        return;
      }

      // Point-edit mode owns Escape and Delete while it is active: it is a modal
      // sub-state of the canvas, and its point selection is the thing on screen
      // the user is aiming those keys at.
      if ($pointEditMode) {
        if (e.key === 'Escape') {
          e.preventDefault();
          // Step out one level at a time: drop the point selection first, and
          // only leave the mode on a second press.
          if ($selectedPointCount > 0) clearPointSelection();
          else exitPointEditMode();
          renderStrokes(false);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && $selectedPointCount > 0) {
          e.preventDefault();
          handleDeletePoints();
          return;
        }
      }

      // Escape - cancel box selection, resize, or clear pasted selection
      if (e.key === 'Escape') {
        if (isBoxSelecting || boxSelectPending) {
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
        if (isResizingPage) {
          isResizingPage = false;
          resizePageKey = null;
          resizeCorner = null;
          resizeOriginalOffset = null;
          if (canvasElement) {
            canvasElement.style.cursor = 'default';
          }
          if (renderer) {
            renderer.clearTempPageScale();
            renderStrokes(false);  // Redraw without resetting view
          }
        }
        if ($pastedSelection.size > 0) {
          clearPastedSelection();
          renderStrokes(false);
        }
      }
      
      // Ctrl/Cmd+D - duplicate selected strokes
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && $selectionCount > 0) {
        e.preventDefault();
        handleDuplicate();
      }
      
      // Delete - delete selected pasted strokes
      if (e.key === 'Delete' && $pastedSelection.size > 0) {
        e.preventDefault();
        handleDeletePasted();
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
      if (rafId) cancelAnimationFrame(rafId);
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

    // Canvas emptied (Clear button, or every stroke removed). Only a full-reset
    // render recomputes page layout, so without this the renderer kept the
    // cleared pages' offsets AND previousStrokeCount stayed high — so the next
    // import, if it brought fewer strokes than were cleared, didn't count as
    // "strokes added" and never got a layout pass: its page rendered with no
    // offset of its own, piled at the origin with anything else loaded after,
    // until the user hit Reset Layout. Reset the tracking state here so a
    // post-clear import is treated as a first load again.
    const canvasEmptied = hadCanvasStrokes && $strokeCount === 0;
    hadCanvasStrokes = $strokeCount > 0;

    if (canvasEmptied) {
      previousStrokeCount = 0;
      // A fresh canvas deserves a fresh writing view on the next live stroke.
      liveWritingViewSet = false;
      renderStrokes(true);
    } else if (strokesAdded) {
      console.log('📊 Strokes changed:', previousStrokeCount, '->', currentCount);
      // Full reset when new strokes added
      renderStrokes(true);

      if ($penConnected) {
        // Live writing: set a comfortable writing zoom once on the first stroke,
        // then leave the view alone so it doesn't jump while the user writes.
        if (!liveWritingViewSet) {
          setTimeout(() => {
            const newZoom = renderer.setLiveWritingView();
            renderStrokes();
            if (newZoom) setCanvasZoom(newZoom);
            liveWritingViewSet = true;
          }, 100);
        }
      } else {
        // Offline import / manual load: auto-fit to show all content on first load only.
        if (previousStrokeCount === 0) {
          setTimeout(() => {
            fitContent();
          }, 100);
        }
      }

      previousStrokeCount = currentCount;
    }
  }

  // Reset liveWritingViewSet when pen disconnects so the next session starts fresh
  $: if (!$penConnected) {
    liveWritingViewSet = false;
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
  
  // Re-render when pasted strokes change
  $: if (renderer && $pastedStrokes !== undefined && !$batchMode) {
    renderStrokes(false);
  }
  
  // Re-render when pasted selection changes
  $: if (renderer && $pastedSelection !== undefined) {
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
  
  // Update renderer with pending changes when they change
  $: if (renderer && $pendingChanges) {
    renderer.setPendingChanges($pendingChanges);
    // Re-render to update page labels (without resetting view)
    renderStrokes(false);
  }
  
  // Update renderer zoom when store changes and re-render
  $: if (renderer && $canvasZoom) {
    const changed = renderer.setZoom($canvasZoom);
    if (changed) {
      renderStrokes(false);
    }
  }
  
  // Update renderer with page scales when they change
  $: if (renderer && $pageScales) {
    renderer.setPageScales($pageScales);
    renderStrokes(false);
  }

  // Push the sketch thickness profile into the renderer and repaint. Cached
  // per-stroke width arrays are tagged with the profile key, so they invalidate
  // themselves — dragging a slider restyles every sketch on the canvas live.
  $: if (renderer && $sketchProfile) {
    renderer.setSketchProfile($sketchProfile);
    renderStrokes(false);
  }

  // How many of the selected strokes are already flagged. Drives whether the
  // header offers Mark, Unmark, or both for a mixed selection. Computed from
  // $strokes directly so it recomputes when the flags change, not just when the
  // selection does.
  $: selectedSketchCount = $hasSelection
    ? Array.from($selectedIndices).reduce((n, i) => n + ($strokes[i]?.sketch ? 1 : 0), 0)
    : 0;
  $: selectedPlainCount = $selectionCount - selectedSketchCount;

  /**
   * Flag or unflag the current selection as sketch strokes.
   * @param {boolean} sketch
   */
  function applySketchFlag(sketch) {
    const indices = $selectedIndices;
    if (!indices || indices.size === 0) return;

    const changed = sketch ? markStrokesAsSketch(indices) : unmarkStrokesAsSketch(indices);
    if (changed === 0) {
      log(`No change — ${$selectionCount} stroke${$selectionCount !== 1 ? 's' : ''} already ${sketch ? 'marked' : 'unmarked'}`, 'info');
      return;
    }

    const noun = `stroke${changed !== 1 ? 's' : ''}`;
    log(
      sketch
        ? `Marked ${changed} ${noun} as sketch (${$sketchProfileSummary})`
        : `Unmarked ${changed} ${noun} — back to uniform width`,
      'success'
    );
    // The flag changes how these strokes draw, and $strokes updating does not by
    // itself schedule a repaint from any of the reactive blocks above.
    renderStrokes(false);
  }

  /* ---------------------------------------------------------------
   *  Volumes — move the selection to another physical notebook
   * --------------------------------------------------------------- */

  // Volumes offered for the selection, which must all belong to one NCode book:
  // "move to volume N" is meaningless across two different books.
  $: selectionBookKeys = $hasSelection
    ? [...new Set(Array.from($selectedIndices)
        .map(i => $strokes[i]?.pageInfo?.book)
        .filter(b => b !== undefined))]
    : [];
  $: selectionNcodeBooks = [...new Set(selectionBookKeys.map(ncodeBookOf).filter(b => b != null))];
  $: selectionVolume = selectionBookKeys.length === 1 ? volumeOf(selectionBookKeys[0]) : null;
  $: canReassignVolume = $hasSelection && selectionNcodeBooks.length === 1;
  $: volumeChoices = canReassignVolume
    ? volumesForBook(selectionNcodeBooks[0], [...$knownBookIds])
    : [];
  $: maxVolume = volumeChoices.length ? Math.max(...volumeChoices) : 1;

  /**
   * Reassign the selection to another volume of the same book.
   *
   * The strokes land in a different page group, which changes the page layout —
   * so this needs a full-reset render to recompute page offsets, the same way
   * importing a page does. Without it the reassigned strokes draw at the origin
   * on top of whatever else is there.
   */
  function applyVolumeReassign(volume) {
    const indices = $selectedIndices;
    if (!indices || indices.size === 0) return;

    const result = reassignVolume(indices, volume);
    if (result.moved === 0) {
      log(`No change — selection is already in Volume ${volume}`, 'info');
      return;
    }

    const noun = `stroke${result.moved !== 1 ? 's' : ''}`;
    log(`Moved ${result.moved} ${noun} to Volume ${volume}. Save to apply — the page they came from is saved too.`, 'success');
    if (result.skipped > 0) {
      log(`${result.skipped} stroke(s) skipped (no readable book)`, 'warning');
    }

    previousStrokeCount = 0;   // treat the new page group as a first load
    renderStrokes(true);
    fitContent();
  }


  /* ---------------------------------------------------------------
   *  Point editing
   *
   *  A mode over the existing stroke selection: the selected strokes' individual
   *  captured points become clickable handles so a single bad sample (typically
   *  one at the Ncode origin, drawing a line out to the page corner) can be
   *  removed without discarding the stroke.
   * --------------------------------------------------------------- */

  function handleTogglePointEdit() {
    const result = togglePointEditMode();

    if (!result.ok) {
      if (result.reason === 'no-selection') {
        log('Select the stroke(s) you want to edit first', 'warning');
      } else if (result.reason === 'too-many') {
        log(
          `${result.count} strokes selected — point editing is limited to ${MAX_POINT_EDIT_STROKES}. ` +
          `Select a smaller area (every point of every selected stroke gets a handle).`,
          'warning'
        );
      }
      return;
    }

    if (result.entered) {
      const strays = $strayPoints.length;
      const note = strays > 0
        ? `${strays} suspect point${strays !== 1 ? 's' : ''} highlighted in amber`
        : 'no suspect points detected';
      log(`Point editing ${result.count} stroke${result.count !== 1 ? 's' : ''} — ${note}`, 'info');
    } else {
      log('Left point-edit mode', 'info');
    }

    // Handles appear/disappear; nothing else schedules this repaint.
    renderStrokes(false);
  }

  /** Delete the selected points (Del key, and the panel's button routes here). */
  function handleDeletePoints() {
    const result = deleteSelectedPoints();

    if (result.removedPoints > 0) {
      const pts = `${result.removedPoints} point${result.removedPoints !== 1 ? 's' : ''}`;
      log(`Deleted ${pts} from ${result.editedStrokes} stroke(s) — save to write it to disk`, 'success');
    }
    if (result.refused.length > 0) {
      log(
        `${result.refused.length} stroke(s) left untouched — fewer than 2 points would remain, ` +
        `leaving no line to draw. Delete the whole stroke instead.`,
        'warning'
      );
    }

    // Geometry changed, so page bounds and layout may have too — a stray point at
    // the origin stretches its page's bounding box all the way to the corner, and
    // removing it should snap the page back to the real content.
    renderStrokes(true);
  }

  /** Panel asked to jump to a point: centre it without changing zoom. */
  function handleFocusPoint(event) {
    const { strokeIndex, dot } = event.detail || {};
    if (!renderer || !dot) return;
    const stroke = $strokes[strokeIndex];
    renderer.centerOnPoint(dot, stroke?.pageInfo || null);
    renderStrokes(false);
  }

  // Repaint when the point selection or the detected strays change (the panel can
  // change both without touching the canvas).
  $: if (renderer && $pointEditMode && ($selectedPoints || $strayPointKeys)) {
    renderStrokes(false);
  }

  // Text view has no handles to click, and leaving the mode on would strand the
  // panel over a page of transcript text.
  $: if (showTextView && $pointEditMode) {
    exitPointEditMode();
  }

  // rAF-coalesced render scheduling.
  // The frequent call sites below (selection/zoom/pan/pendingChanges reactive
  // blocks, and every mousemove during a drag/pan) used to each trigger a full
  // synchronous repaint of all visible strokes. renderStrokes(false) now
  // collapses every request within a frame into a single paint, so a burst of
  // mousemoves or a cascade of reactive updates costs one redraw instead of N.
  //
  // Full-reset renders (new strokes, layout reset) run SYNCHRONOUSLY: they
  // recompute bounds/page layout that callers read immediately afterwards (e.g.
  // fitContent() → fitToContent() reads renderer.bounds), and they're
  // infrequent, so there's nothing to coalesce.
  let renderScheduled = false;
  let rafId = null;

  function renderStrokes(fullReset = false) {
    if (!renderer) return;
    if (fullReset) {
      // Supersede any pending coalesced redraw and render now.
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        renderScheduled = false;
      }
      renderStrokesNow(true);
      return;
    }
    if (renderScheduled) return;
    renderScheduled = true;
    rafId = requestAnimationFrame(() => {
      renderScheduled = false;
      rafId = null;
      renderStrokesNow(false);
    });
  }

  function renderStrokesNow(fullReset = false) {
    if (!renderer) return;

    if (fullReset) {
      renderer.clear(true);
      // Pre-calculate bounds for consistent coordinate transformation
      // Include decorative filtered strokes in bounds calculation if we're showing them
      const allStrokes = $showFilteredStrokes && $filteredStrokes.length > 0
        ? [...visibleStrokes, ...$filteredStrokes.map(fs => fs.stroke)]
        : visibleStrokes;
      // Context ink goes in as a second argument, not merged into the first:
      // it counts toward a page's BOUNDS (so a partially-loaded page keeps its
      // real size) but must not count toward its capture date, which is what
      // orders pages in date mode.
      renderer.calculateBounds(allStrokes, visibleContextInk);
      
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
      // Context ink first, so live ink always sits on top of it — the point of
      // the halftone is that the loaded strokes read as the foreground.
      visibleContextInk.forEach(stroke => {
        renderer.drawContextStroke(stroke);
      });

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
      
      // Draw pasted strokes (on top of everything else)
      $pastedStrokes.forEach((stroke, index) => {
        const isSelected = $pastedSelection.has(index);
        renderer.drawPastedStroke(stroke, isSelected);
      });

      // Point-edit handles last of all, so they sit above the strokes they belong
      // to — including the stray line running off to the page corner, which would
      // otherwise cross over the very handle the user is trying to click.
      if ($pointEditMode && $pointEditStrokes.length > 0) {
        renderer.drawPointHandles($pointEditStrokes, $selectedPoints, $strayPointKeys);
      }
    }
  }
  
  // Mouse down - start potential pan, page drag, page resize, pasted stroke drag, or selection
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

    // Point-edit mode: a click on a handle takes priority over every other
    // target (pasted strokes, page corners, page headers, stroke selection).
    // Those are all page- or stroke-level actions, and while the user is picking
    // individual points they are far more likely to hit one by accident than to
    // want it.
    if (event.button === 0 && $pointEditMode && renderer) {
      const hit = renderer.hitTestPointHandle(x, y, $pointEditStrokes);
      if (hit) {
        event.preventDefault();
        const mode = event.shiftKey ? 'remove' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'replace';
        selectPoint(hit.strokeIndex, hit.pointIndex, mode);
        renderStrokes(false);
        // Suppress the click handler, which would otherwise re-run stroke
        // hit-testing for the same press.
        didBoxSelect = true;
        return;
      }
      // Missed every handle — fall through so a drag still box-selects points and
      // a bare click still clears the point selection (handleCanvasClick).
    }

    // Left button - check for pasted stroke click first (highest priority for selection/drag)
    if (event.button === 0 && !$pointEditMode && renderer && $pastedStrokes.length > 0) {
      const pastedIndex = renderer.hitTestPasted(x, y, $pastedStrokes);
      if (pastedIndex !== -1) {
        event.preventDefault();
        
        // Handle selection with modifiers
        if (event.ctrlKey || event.metaKey) {
          // Toggle selection
          selectPastedStroke(pastedIndex, true);
        } else if (event.shiftKey) {
          // Remove from selection
          pastedSelection.update(sel => {
            const newSel = new Set(sel);
            newSel.delete(pastedIndex);
            return newSel;
          });
        } else if (!$pastedSelection.has(pastedIndex)) {
          // Replace selection if this stroke isn't already selected
          pastedSelection.set(new Set([pastedIndex]));
        }
        // If already selected and no modifiers, keep selection for drag
        
        // Start drag if any pasted strokes are selected
        if ($pastedSelection.size > 0) {
          isDraggingPasted = true;
          pastedDragStartX = event.clientX;
          pastedDragStartY = event.clientY;
          canvasElement.style.cursor = 'move';
        }
        
        return;
      }
    }
    
    // Left button - check for corner handle (unless Ctrl/Shift held)
    if (event.button === 0 && !$pointEditMode && !event.ctrlKey && !event.metaKey && !event.shiftKey && renderer) {
      const cornerHit = renderer.hitTestCorner(x, y);
      if (cornerHit) {
        event.preventDefault();
        isResizingPage = true;
        resizePageKey = cornerHit.pageKey;
        resizeCorner = cornerHit.corner;
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
        resizeOriginalBounds = renderer.getPageBoundsScreen(resizePageKey);
        resizeOriginalScale = getPageScale(resizePageKey);
        resizePreviewScale = resizeOriginalScale;
        
        // Store original Ncode offset for anchor calculation
        const pageOffset = renderer.pageOffsets.get(resizePageKey);
        if (pageOffset) {
          // Check if custom position exists
          const customPos = $pagePositions[resizePageKey];
          if (customPos) {
            resizeOriginalOffset = { x: customPos.x, y: customPos.y };
          } else {
            resizeOriginalOffset = { x: pageOffset.offsetX, y: pageOffset.offsetY };
          }
        }
        
        canvasElement.style.cursor = cornerHit.cursor;
        return;
      }
    }
    
    // Left button - check for page header click (unless Ctrl/Shift held)
    if (event.button === 0 && !$pointEditMode && !event.ctrlKey && !event.metaKey && !event.shiftKey && renderer) {
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
      // (not in point-edit mode: there the modifiers apply to points, and
      // changing the stroke selection would pull the handles out from under the
      // user mid-edit.)
      if (renderer && !$pointEditMode && (event.ctrlKey || event.metaKey || event.shiftKey)) {
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
  
  // Mouse move - page resize, page drag, pasted stroke drag, pan, or update box selection
  function handleMouseMove(event) {
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Handle dragging pasted strokes
    if (isDraggingPasted && $pastedSelection.size > 0 && renderer) {
      const deltaX = event.clientX - pastedDragStartX;
      const deltaY = event.clientY - pastedDragStartY;
      
      // Convert screen delta to Ncode delta
      const ncodeDeltaX = deltaX / (renderer.scale * renderer.zoom);
      const ncodeDeltaY = deltaY / (renderer.scale * renderer.zoom);
      
      movePastedStrokes(ncodeDeltaX, ncodeDeltaY);
      
      pastedDragStartX = event.clientX;
      pastedDragStartY = event.clientY;
      
      renderStrokes(false);
      return;
    }
    
    // Handle page resizing
    if (isResizingPage && renderer && resizePageKey && resizeOriginalOffset) {
      const deltaX = event.clientX - resizeStartX;
      const deltaY = event.clientY - resizeStartY;
      
      // Calculate new scale based on corner and delta
      const newScale = calculateScaleFromDrag(
        resizeCorner,
        deltaX,
        deltaY,
        resizeOriginalBounds,
        resizeOriginalScale,
        event.shiftKey  // Maintain aspect ratio
      );
      
      // Calculate adjusted offset to keep top-left corner anchored
      // As scale changes, we need to adjust offset proportionally to keep
      // the top-left corner at the same screen position
      const scaleRatio = resizeOriginalScale / newScale;
      const adjustedOffset = {
        x: resizeOriginalOffset.x * scaleRatio,
        y: resizeOriginalOffset.y * scaleRatio
      };
      
      // Update preview with new scale and adjusted position
      resizePreviewScale = newScale;
      renderer.setTempPageScale(resizePageKey, newScale);
      
      // Apply temporary custom position for preview
      renderer.applyCustomPositions({
        ...$pagePositions,
        [resizePageKey]: adjustedOffset
      });
      
      renderStrokes();
      return;
    }
    
    // Handle page dragging
    if (isDraggingPage && renderer && draggedPageKey) {
      const deltaX = event.clientX - pageDragStartX;
      const deltaY = event.clientY - pageDragStartY;
      
      // Get current page scale to account for scaled coordinate space
      const pageScale = getPageScale(draggedPageKey);
      
      // Convert screen delta to Ncode delta (accounting for scale and page scale)
      const ncodeDeltaX = deltaX / (renderer.scale * pageScale * renderer.zoom);
      const ncodeDeltaY = deltaY / (renderer.scale * pageScale * renderer.zoom);
      
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
    
    // Point-edit mode: the only hover affordance that matters is "there is a
    // handle here". Page corners and headers aren't actionable in this mode, so
    // their cursors would be lying.
    if ($pointEditMode && !isPanning && !isBoxSelecting && !boxSelectPending && renderer) {
      const hit = renderer.hitTestPointHandle(x, y, $pointEditStrokes);
      canvasElement.style.cursor = hit ? 'pointer' : 'crosshair';
      return;
    }

    // Update cursor based on what's under the mouse (when not actively doing something)
    if (!isPanning && !isDraggingPage && !isResizingPage && !isBoxSelecting && !boxSelectPending && renderer) {
      // Check for corner handle hover first
      const cornerHit = renderer.hitTestCorner(x, y);
      if (cornerHit && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        canvasElement.style.cursor = cornerHit.cursor;
      } else {
        // Check for selected pasted stroke hover (show move cursor)
        const pastedIndex = renderer.hitTestPasted(x, y, $pastedStrokes);
        if (pastedIndex !== -1 && $pastedSelection.has(pastedIndex)) {
          canvasElement.style.cursor = 'move';
        } else {
          // Check if hovering over a page header (draggable area)
          const pageKey = renderer.hitTestPageHeader(x, y);
          if (pageKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            canvasElement.style.cursor = 'grab';
          } else if (canvasElement.style.cursor === 'grab' || canvasElement.style.cursor === 'move' || canvasElement.style.cursor.includes('resize')) {
            // Reset if it was set to grab, move, or resize (don't override other cursors)
            canvasElement.style.cursor = 'default';
          }
        }
      }
    }
  }
  
  // Mouse up - end page resize, page drag, pasted stroke drag, pan, or complete box selection
  function handleMouseUp(event) {
    // Handle pasted stroke drag completion
    if (isDraggingPasted) {
      isDraggingPasted = false;
      pastedDragStartX = 0;
      pastedDragStartY = 0;
      canvasElement.style.cursor = 'default';
      return;
    }
    
    // Handle page resize completion
    if (isResizingPage && resizePageKey && renderer && resizeOriginalOffset) {
      const deltaX = event.clientX - resizeStartX;
      const deltaY = event.clientY - resizeStartY;
      
      // Only commit if there was actual movement
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        // Calculate final adjusted offset to keep top-left anchored
        const scaleRatio = resizeOriginalScale / resizePreviewScale;
        const adjustedOffset = {
          x: resizeOriginalOffset.x * scaleRatio,
          y: resizeOriginalOffset.y * scaleRatio
        };
        
        // Save both scale and adjusted position
        setPageScale(resizePageKey, resizePreviewScale);
        setPagePosition(resizePageKey, adjustedOffset.x, adjustedOffset.y);
        
        log(`Resized ${resizePageKey} to ${Math.round(resizePreviewScale * 100)}%`, 'info');
      }
      
      renderer.clearTempPageScale();
      isResizingPage = false;
      resizePageKey = null;
      resizeCorner = null;
      resizeOriginalOffset = null;
      canvasElement.style.cursor = 'default';
      renderStrokes(false);  // Redraw without resetting view
      return;
    }
    
    // Handle page drag completion
    if (isDraggingPage && draggedPageKey && renderer) {
      const deltaX = event.clientX - pageDragStartX;
      const deltaY = event.clientY - pageDragStartY;
      
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        // Get current page scale to account for scaled coordinate space
        const pageScale = getPageScale(draggedPageKey);
        
        // Convert screen delta to Ncode delta (accounting for scale and page scale)
        const ncodeDeltaX = deltaX / (renderer.scale * pageScale * renderer.zoom);
        const ncodeDeltaY = deltaY / (renderer.scale * pageScale * renderer.zoom);
        
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

      // In point-edit mode the box selects POINTS, not strokes — the stroke
      // selection is the fixed scope of the edit and must not shift underfoot.
      if ($pointEditMode) {
        const hits = renderer.findPointHandlesInRect($pointEditStrokes, rect);
        const mode = (event.ctrlKey || event.metaKey) ? 'add' : event.shiftKey ? 'remove' : 'replace';
        if (hits.length > 0 || mode === 'replace') {
          selectPoints(hits, mode);
        }
        didBoxSelect = true;
        isBoxSelecting = false;
        boxSelectPending = false;
        boxStartX = 0;
        boxStartY = 0;
        boxCurrentX = 0;
        boxCurrentY = 0;
        canvasElement.style.cursor = 'default';
        renderStrokes(false);
        return;
      }

      // Find regular strokes in box
      const visibleIndices = renderer.findStrokesInRect(visibleStrokes, rect);
      const fullIndices = visibleIndices.map(visIdx => visibleToFullIndexMap[visIdx]);
      
      // Find pasted strokes in box
      const pastedIndices = renderer.findPastedStrokesInRect($pastedStrokes, rect);
      
      // Determine selection mode
      const mode = (event.ctrlKey || event.metaKey) ? 'add' : event.shiftKey ? 'remove' : 'replace';
      
      // Handle regular strokes
      if (fullIndices.length > 0) {
        if (mode === 'replace') {
          selectFromBox(fullIndices, 'replace');
        } else if (mode === 'add') {
          selectFromBox(fullIndices, 'add');
        } else if (mode === 'remove') {
          deselectIndices(fullIndices);
        }
        didBoxSelect = true;
      } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        // Empty box with no modifiers - clear regular selection
        clearSelection();
        didBoxSelect = true;
      }
      
      // Handle pasted strokes
      if (pastedIndices.length > 0) {
        if (mode === 'replace') {
          // Replace pasted selection
          pastedSelection.set(new Set(pastedIndices));
        } else if (mode === 'add') {
          // Add to pasted selection
          pastedSelection.update(sel => {
            const newSel = new Set(sel);
            pastedIndices.forEach(i => newSel.add(i));
            return newSel;
          });
        } else if (mode === 'remove') {
          // Remove from pasted selection
          pastedSelection.update(sel => {
            const newSel = new Set(sel);
            pastedIndices.forEach(i => newSel.delete(i));
            return newSel;
          });
        }
        didBoxSelect = true;
      } else if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
        // Empty box with no modifiers - clear pasted selection
        clearPastedSelection();
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
  
  // Mouse leave - cancel page resize, page drag, pasted stroke drag, pan, or box selection
  function handleMouseLeave(event) {
    if (isDraggingPasted) {
      isDraggingPasted = false;
      pastedDragStartX = 0;
      pastedDragStartY = 0;
      canvasElement.style.cursor = 'default';
    }
    
    if (isResizingPage) {
      isResizingPage = false;
      resizePageKey = null;
      resizeCorner = null;
      resizeOriginalOffset = null;
      canvasElement.style.cursor = 'default';
      if (renderer) {
        renderer.clearTempPageScale();
        renderStrokes(false);  // Redraw without resetting view
      }
    }
    
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
  
  // Duplicate selected strokes (copy + paste in one action)
  function handleDuplicate() {
    if ($selectionCount === 0) return;
    
    // Calculate offset based on current view (slight offset from original)
    const offsetX = 50 / (renderer.scale * renderer.zoom);
    const offsetY = 50 / (renderer.scale * renderer.zoom);
    
    const count = duplicateStrokes($selectedStrokes, { x: offsetX, y: offsetY });
    log(`Duplicated ${count} stroke${count !== 1 ? 's' : ''}`, 'success');
    
    // Auto-select the newly duplicated strokes
    const startIndex = $pastedStrokes.length - count;
    const newSelection = new Set();
    for (let i = startIndex; i < $pastedStrokes.length; i++) {
      newSelection.add(i);
    }
    pastedSelection.set(newSelection);
    
    // Clear original selection
    clearSelection();
    
    renderStrokes(false);
  }
  
  // Delete selected pasted strokes (called by Delete key)
  function handleDeletePasted() {
    if ($pastedSelection.size === 0) return;
    
    const count = deleteSelectedPasted();
    if (count > 0) {
      log(`Deleted ${count} pasted stroke${count !== 1 ? 's' : ''}`, 'info');
      renderStrokes(false);
    }
  }
  
  // Canvas click - select stroke (only if we didn't pan or box select)
  // Helper to calculate scale from drag delta
  // Only handles SE (bottom-right) corner since top-left is anchor
  function calculateScaleFromDrag(corner, deltaX, deltaY, originalBounds, originalScale, maintainAspectRatio) {
    const { width, height } = originalBounds;
    
    // Calculate scale change based on drag distance
    let scaleChange = 0;
    
    if (maintainAspectRatio) {
      // Use diagonal distance for proportional scaling
      const diagonal = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      // SE corner: positive diagonal = grow
      const sign = (deltaX + deltaY) > 0 ? 1 : -1;
      scaleChange = (diagonal * sign) / Math.max(width, height);
    } else {
      // Free resize - use the larger dimension change
      const xChange = deltaX / width;
      const yChange = deltaY / height;
      // SE corner: both positive = grow
      scaleChange = Math.max(xChange, yChange);
    }
    
    const newScale = originalScale + scaleChange;
    
    // Clamp to reasonable range (25% to 500%)
    return Math.max(0.25, Math.min(5.0, newScale));
  }
  
  function handleCanvasClick(event) {
    if (didPan || didBoxSelect) {
      didPan = false;
      didBoxSelect = false;
      return;
    }

    if (!renderer) return;

    // Point-edit mode: handle clicks were consumed in mousedown, so reaching here
    // means the user clicked empty space — deselect points rather than changing
    // the stroke selection (which would swap out the strokes being edited).
    if ($pointEditMode) {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && $selectedPointCount > 0) {
        clearPointSelection();
        renderStrokes(false);
      }
      return;
    }


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
    // Use selected strokes if any are selected, otherwise fall back to visible strokes
    const exportStrokes = $hasSelection ? $selectedStrokes : visibleStrokes;
    if (exportStrokes.length === 0) {
      log('No strokes to export', 'warning');
      return;
    }
    openSvgExportDialog(exportStrokes);
  }

  function exportJson() {
    const exportStrokes = $hasSelection ? $selectedStrokes : visibleStrokes;
    const { exportData, filename } = buildJsonExportData(exportStrokes);
    downloadFile(JSON.stringify(exportData), filename, 'application/json');
  }

  function exportMd() {
    const exportStrokes = $hasSelection ? $selectedStrokes : visibleStrokes;
    const pages = buildMdExportData(exportStrokes);
    pages.forEach(({ content, filename }) => downloadFile(content, filename, 'text/markdown'));
  }

  /**
   * Publish the current selection (or, with nothing selected, the visible page)
   * into the LogSeq graph for the JPI Tools plugin to render.
   *
   * Additive by design: this merges into whatever that page already has in the
   * graph, so sketches can be published one at a time and the graph becomes a
   * book of sketches rather than a mirror of the notebook. Transcript text is
   * never included — see src/lib/storage/graph-export.js.
   */
  async function exportToGraph() {
    const exportStrokes = $hasSelection ? $selectedStrokes : visibleStrokes;
    if (exportStrokes.length === 0) {
      log('No strokes to export', 'warning');
      return;
    }
    if (!$graphFolderReady) {
      log('No LogSeq graph folder set — choose one in Settings → LogSeq Graph', 'warning');
      return;
    }

    isExportingToGraph = true;
    try {
      const { results, orphans } = await exportSelectionToGraph(exportStrokes);

      if (orphans > 0) {
        log(`${orphans} stroke(s) skipped — no page info to publish them under`, 'warning');
      }

      for (const r of results) {
        if (!r.success) {
          log(`Export to LogSeq failed for B${r.book}/P${r.pageId}: ${r.error}`, 'error');
          continue;
        }
        const dupNote = r.duplicates > 0 ? `, ${r.duplicates} already published` : '';
        log(
          `Exported to LogSeq B${r.book}/P${r.pageId}: +${r.added} stroke(s)${dupNote} — ${r.total} total on page`,
          r.added > 0 ? 'success' : 'info'
        );
      }
    } catch (err) {
      log(`Export to LogSeq failed: ${err.message}`, 'error');
    } finally {
      isExportingToGraph = false;
    }
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
  
  /* ---------------------------------------------------------------
   *  Toolbar overflow menu
   *
   *  Holds the layout resets — rare, and their enablement flips as pages are
   *  dragged or scaled, so keeping them out of the row means the row's width
   *  never depends on how the pages happen to be arranged.
   * --------------------------------------------------------------- */
  let showMoreMenu = false;

  /* Canvas search (panel header). Finds a page among those already loaded and
     pans to it — a navigation tool, distinct from the left panel's search over
     everything on disk. */
  let canvasSearch;

  /* The live search term, mirrored out of CanvasSearch so text view can mark it
     on the page. Empty unless the user is actually searching. */
  let canvasSearchTerm = '';

  // Repaint text view when the term changes, so highlights track typing.
  $: if (showTextView && canvasSearchTerm !== undefined) {
    renderStrokes(false);
  }

  /**
   * A page left the canvas. Page layout is only recomputed by a full-reset
   * render, so without this the remaining pages keep the offsets they had when
   * the removed page was still between them — the same stale-layout trap the
   * Clear button hit (see the July 2026 clear-canvas fixes).
   */
  function handlePageUnloaded() {
    previousStrokeCount = $strokeCount;
    if (!renderer) return;
    renderStrokes(true);
    setTimeout(() => fitContent(), 50);
  }

  /**
   * Jump to a page the search found. A page can be on the canvas but hidden by
   * the page filter, so reveal it first — otherwise the view pans to a page
   * that isn't drawn.
   */
  function handleSearchGoto(event) {
    const { pageKey, label } = event.detail;
    if (!renderer) return;

    if (!selectedPages.has(pageKey)) {
      selectedPages = new Set([...selectedPages, pageKey]);
    }

    // The page needs a layout offset before it can be centred, and a page just
    // revealed does not have one until the next full render.
    renderStrokes(true);
    requestAnimationFrame(() => {
      if (renderer?.centerOnPage(pageKey)) {
        renderStrokes(false);
        log(`Jumped to ${label}`, 'info');
      } else {
        log(`Could not locate ${label} on the canvas`, 'warning');
      }
    });
  }

  /* Export menu (below-canvas bar). SVG / JSON / MD / LogSeq were four permanent
     buttons; exports are occasional, and the width pays for the sketch controls
     that moved down from the top bar. */
  let showExportMenu = false;
  let exportMenuWrapper;

  function handleToolbarClickOutside(event) {
    if (showMoreMenu && !event.target.closest('.tb-more')) {
      showMoreMenu = false;
    }
    if (showExportMenu && exportMenuWrapper && !exportMenuWrapper.contains(event.target)) {
      showExportMenu = false;
    }
  }

  /** Run an export and close the menu — every item does both. */
  function runExport(fn) {
    showExportMenu = false;
    fn();
  }

  function resetPageLayout() {
    showMoreMenu = false;
    clearPagePositions(); // Clear stored positions, not just disable
    if (renderer) {
      renderStrokes(true);
      setTimeout(() => fitContent(), 50);
    }
    log('Reset to automatic layout', 'info');
  }

  function resetPageSizes() {
    showMoreMenu = false;
    resetAllPageScales();
    if (renderer) {
      renderer.setPageScales({});
      renderStrokes(true);
      setTimeout(() => fitContent(), 50);
    }
    log('Reset all page sizes to 100%', 'info');
  }

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
  
  // Get transcriptions for visible pages (from both MyScript and saved pages)
  // This function now matches pages more intelligently, handling section/owner mismatches
  function getVisibleTranscriptions() {
    const transcriptions = [];
    
    // Helper to match pages ignoring section/owner when needed
    function matchesPage(pageKey, book, page) {
      // Try exact match first
      if (selectedPages.has(pageKey)) return true;
      
      // Try matching just by book/page (ignore section/owner)
      for (const selectedKey of selectedPages) {
        const match = selectedKey.match(BOOK_PAGE_KEY_RE);
        // Book keys compare as strings — parseInt("388v2") is 388, which would
        // match volume 1's page as well as volume 2's.
        if (match && match[1] === String(book) && parseInt(match[2]) === page) {
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
            // Structured lines (indent levels / TODO-DONE state) drive the
            // LogSeq-format copy; `text` is what the canvas renders.
            lines: Array.isArray(pt.lines) ? pt.lines : null,
            pageId: String(pt.pageInfo.page),
            pageInfo: pt.pageInfo,
            strokeCount: pt.strokeCount,
            source: 'myscript'
          });
        }
      });
    }
    
    // Add saved pages (only if not already in MyScript transcriptions)
    if ($savedPages) {
      $savedPages.forEach(lsPage => {
        if (!lsPage.transcriptionText) return;
        
        // Check if we already have this page from MyScript (match by book/page)
        const alreadyExists = transcriptions.some(t => 
          t.pageInfo.book === lsPage.book && t.pageInfo.page === lsPage.page
        );
        if (alreadyExists) return;
        
        // Use the stored pageKey format, but check if it matches any selected page
        const pageKey = `S${lsPage.section || 0}/O${lsPage.owner || 0}/B${lsPage.book}/P${lsPage.page}`;
        
        if (!matchesPage(pageKey, lsPage.book, lsPage.page)) return;
        
        transcriptions.push({
          pageKey: pageKey,
          text: lsPage.transcriptionText,
          // Metadata-only scan records carry no lines — the copy path lazily
          // reads the PageDoc by pageId (suffix-safe) to get the hierarchy.
          lines: null,
          pageId: lsPage.pageId != null ? String(lsPage.pageId) : String(lsPage.page),
          pageInfo: {
            section: lsPage.section || 0,
            owner: lsPage.owner || 0,
            book: lsPage.book,
            page: lsPage.page
          },
          strokeCount: lsPage.strokeCount || 0,
          source: 'saved'
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
    const overlays = [];

    console.log('📝 Rendering transcribed text for', visibleTranscriptions.length, 'pages');

    visibleTranscriptions.forEach(pageData => {
      if (!pageData.text || !pageData.text.trim()) {
        console.log('  ⚠️ No text for', pageData.pageKey);
        return;
      }
      
      // Filter out property lines before displaying
      const filteredText = filterTranscriptionProperties(pageData.text);
      
      if (!filteredText || !filteredText.trim()) {
        console.log('  ⚠️ No text after filtering properties for', pageData.pageKey);
        return;
      }
      
      // Need to find the actual pageKey used in the renderer
      // The pageData.pageKey might be from a saved page (S0/O0/...) but renderer has real pen data (S3/O1012/...)
      const book = pageData.pageInfo.book;
      const page = pageData.pageInfo.page;
      
      // Find matching pageKey in renderer's pageOffsets (fuzzy match by book/page)
      let matchingPageKey = null;
      for (const [rendererPageKey, offset] of renderer.pageOffsets) {
        const match = rendererPageKey.match(BOOK_PAGE_KEY_RE);
        if (match && match[1] === String(book) && parseInt(match[2]) === page) {
          matchingPageKey = rendererPageKey;
          break;
        }
      }
      
      if (!matchingPageKey) {
        console.log('  ❌ No matching page in renderer for B', book, 'P', page);
        return;
      }
      
      console.log('  ✅ Rendering text for', matchingPageKey, '(', filteredText.length, 'chars )');

      // Render filtered text inside the page boundaries using the correct pageKey.
      // The canvas-search term is marked wherever it appears, so a text-view
      // search shows *where on the page* the hit is, not just which page.
      renderer.drawPageText(matchingPageKey, filteredText, canvasSearchTerm);

      // Place a copy button over this page (screen coords, so it follows pan/zoom)
      const rect = renderer.getPageBoundsScreen(matchingPageKey);
      if (rect) {
        overlays.push({
          key: matchingPageKey,
          entry: pageData,
          left: rect.left,
          top: rect.top,
          width: rect.width
        });
      }
    });

    textPageOverlays = overlays;
  }

  /**
   * Resolve a transcription entry to structured transcript lines for the
   * LogSeq-format copy. MyScript results already carry `lines`; saved pages are
   * metadata-only records, so read the PageDoc (cached, suffix-safe by pageId).
   * Falls back to parsing the rendered text if neither is available.
   */
  async function resolveTranscriptLines(entry) {
    if (Array.isArray(entry.lines) && entry.lines.length > 0) return entry.lines;

    try {
      const doc = await getCachedPage(entry.pageInfo.book, entry.pageId);
      const lines = doc && doc.transcript && doc.transcript.lines;
      if (Array.isArray(lines) && lines.length > 0) return lines;
    } catch (err) {
      console.warn('Could not read PageDoc transcript for copy:', err);
    }

    return textToTranscriptLines(filterTranscriptionProperties(entry.text));
  }

  /**
   * Copy one or more pages' transcripts to the clipboard as LogSeq-pasteable
   * outliner markdown (same format as Book View's Copy).
   */
  async function copyTranscripts(entries, overlayKey = null) {
    if (isCopyingTranscript) return;

    if (!entries || entries.length === 0) {
      log('No transcription data available to copy', 'warning');
      return;
    }

    isCopyingTranscript = true;
    try {
      const pageBlocks = [];
      for (const entry of entries) {
        const lines = await resolveTranscriptLines(entry);
        pageBlocks.push({
          label: `${formatBookName(entry.pageInfo.book, $bookAliases)} · P${entry.pageId}`,
          lines
        });
      }

      const md = pagesToLogseqMarkdown(pageBlocks);
      if (!md) {
        log('Nothing to copy — transcript is empty', 'warning');
        return;
      }

      await navigator.clipboard.writeText(md);

      const what = entries.length === 1
        ? `transcript B${entries[0].pageInfo.book}/P${entries[0].pageId}`
        : `${entries.length} page transcripts`;
      log(`Copied ${what} to clipboard (LogSeq format)`, 'success');

      // Brief on-button confirmation
      copiedPageKey = overlayKey || 'all';
      if (copiedResetTimer) clearTimeout(copiedResetTimer);
      copiedResetTimer = setTimeout(() => { copiedPageKey = null; }, 1500);
    } catch (err) {
      log(`Failed to copy transcript: ${err.message}`, 'error');
    } finally {
      isCopyingTranscript = false;
    }
  }

  // Copies exactly what the canvas is showing: the pages whose text actually
  // rendered (an entry with no matching page in the renderer draws nothing).
  function copyAllVisibleTranscripts() {
    const rendered = textPageOverlays.map(o => o.entry);
    copyTranscripts(rendered.length > 0 ? rendered : getVisibleTranscriptions());
  }

  onDestroy(() => {
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
  });

  // Drop the copy overlays when leaving text view
  $: if (!showTextView && textPageOverlays.length > 0) {
    textPageOverlays = [];
  }

  // Re-render when text view toggle changes
  $: if (renderer && showTextView !== undefined) {
    renderStrokes(false);
  }
</script>

<svelte:window on:click={handleToolbarClickOutside} />

<div class="canvas-panel panel">
  <div class="panel-header">
    <span class="header-title">Stroke Preview</span>

    <!-- Selection lives beside the count it changes, rather than in the toolbar
         below with the actions that operate on it. -->
    <div class="header-selection" role="group" aria-label="Selection">
      <button
        class="hdr-btn"
        on:click={() => selectAll(visibleStrokes.length)}
        disabled={visibleStrokes.length === 0}
        title={visibleStrokes.length > 0
          ? `Select all ${visibleStrokes.length} visible strokes`
          : 'No strokes on the canvas'}
      >
        Select All
      </button>
      <button
        class="hdr-btn"
        on:click={() => clearSelection()}
        disabled={$selectionCount === 0}
        title={$selectionCount > 0 ? 'Clear the stroke selection' : 'Nothing selected'}
      >
        Deselect
      </button>

      <CanvasSearch
        bind:this={canvasSearch}
        bind:term={canvasSearchTerm}
        on:goto={handleSearchGoto}
      />
    </div>

    <span class="stroke-count">
      {#if $pastedCount > 0 && $pastedSelection.size > 0}
        <span class="pasted-indicator">{$pastedSelection.size} of {$pastedCount} pasted selected</span> •
      {:else if $pastedCount > 0}
        <span class="pasted-indicator">{$pastedCount} pasted</span> •
      {/if}
      {#if $sketchStrokeCount > 0}
        <span class="sketch-indicator">✏️ {$sketchStrokeCount} sketch</span> •
      {/if}
      {#if $selectionCount > 0}
        <span class="selection-indicator">{$selectionCount} of {$strokeCount} selected</span>
      {:else if visibleStrokes.length < $strokeCount}
        {visibleStrokes.length} of {$strokeCount} strokes (filtered)
      {:else}
        {$strokeCount} strokes
      {/if}
    </span>
  </div>

  <!--
    Canvas toolbar.

    Every control is rendered at all times and toggles between enabled and
    disabled rather than appearing and disappearing, so the row never reflows
    while the selection changes — a button must not slide out from under the
    pointer between deciding to click it and clicking it. Counts that track the
    selection are left off the labels (the status line above already carries
    them); the two counts that don't — how many of the selection are plain vs.
    already-sketch — sit in fixed-width badges.

    Grouped by what the control acts on: the selection itself, then the strokes
    in it, then the view. Layout resets live in the ⋯ menu; their enablement
    flips as pages are dragged or scaled, and they are rare enough that the row
    shouldn't carry them.

    The duplicated-strokes group is the one conditional block. It is a mode the
    user enters deliberately, it doesn't react to the stroke selection, and it
    appears as a whole group rather than as buttons interleaved with the others.
  -->
  <div class="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
    <!-- Only the canvas-action groups scroll when the window is too narrow; the
         trailing tools stay put, and the ⋯ menu stays out of a clipping
         container so it can overhang the toolbar. -->
    <div class="tb-scroll">
      <!-- Select All / Deselect moved to the panel header, beside the count.
           Decorative stayed: it is a bulk *deselect* by shape, closer to the
           per-stroke actions here than to the two blunt selection buttons. -->
      <div class="tb-group" role="group" aria-label="Selected strokes">
        <button
          class="tb-btn tone-accent"
          on:click={handleDeselectDecorative}
          disabled={isDetecting || $strokeCount === 0}
          title={$strokeCount > 0
            ? 'Deselect boxes, underlines, and circles'
            : 'No strokes on the canvas'}
        >
          {isDetecting ? '⏳ Detecting…' : '🎨 Decorative'}
        </button>
        <button
          class="tb-btn tone-accent"
          on:click={handleDuplicate}
          disabled={$selectionCount === 0}
          title={$selectionCount > 0
            ? `Duplicate ${$selectionCount} selected stroke(s) (Ctrl+D)`
            : 'Select strokes to duplicate'}
        >
          🔄 Duplicate
        </button>
        <button
          class="tb-btn tone-point"
          class:active={$pointEditMode}
          on:click={handleTogglePointEdit}
          disabled={!$hasSelection && !$pointEditMode}
          title={$pointEditMode
            ? 'Leave point-edit mode (Esc)'
            : $hasSelection
              ? `Show the individual points of the ${$selectionCount} selected stroke(s) so single stray points can be deleted`
              : 'Select the stroke(s) you want to edit first'}
        >
          {$pointEditMode ? '📍 Exit Points' : '📍 Edit Points'}
        </button>
        <!-- Sketch marking lives on the bar below the canvas, beside the style
             popover that tunes it. Volume stays here: it decides which physical
             notebook a stroke belongs to, which is worth keeping in view. -->
        <!-- Select every stroke on a page and this moves the whole page. -->
        <select
          class="tb-select volume-select"
          value={selectionVolume ?? ''}
          on:change={(e) => applyVolumeReassign(Number(e.currentTarget.value))}
          disabled={!canReassignVolume}
          title={canReassignVolume
            ? "Which physical notebook these strokes belong to. NCode can't tell two identical notebooks apart, so volumes do."
            : 'Select strokes from a single notebook to move them between volumes'}
        >
          {#if canReassignVolume}
            {#each volumeChoices as v}
              <option value={v}>📚 Volume {v}{v === selectionVolume ? ' (current)' : ''}</option>
            {/each}
            {#if !volumeChoices.includes(maxVolume + 1)}
              <option value={maxVolume + 1}>➕ New Volume {maxVolume + 1}</option>
            {/if}
          {:else}
            <option value="">📚 Volume</option>
          {/if}
        </select>
      </div>

      {#if $pastedCount > 0}
        <span class="tb-sep" aria-hidden="true"></span>

        <div class="tb-group" role="group" aria-label="Duplicated strokes">
          <button
            class="tb-btn tone-success"
            on:click={() => showCreatePageDialog = true}
            title={$pastedSelection.size > 0
              ? `Save ${$pastedSelection.size} selected pasted strokes as a new page`
              : `Save all ${$pastedCount} pasted strokes as a new page`}
          >
            📄 Save as Page…
          </button>
          <button
            class="tb-btn tone-danger"
            on:click={() => {
              const count = deleteSelectedPasted();
              log(`Deleted ${count} selected pasted stroke${count !== 1 ? 's' : ''}`, 'info');
              renderStrokes(false);
            }}
            disabled={$pastedSelection.size === 0}
            title={$pastedSelection.size > 0
              ? 'Delete selected pasted strokes (Delete key)'
              : 'Select pasted strokes to delete them'}
          >
            🗑️ Delete <span class="tb-count">{$pastedSelection.size}</span>
          </button>
          <button
            class="tb-btn"
            on:click={() => {
              const count = $pastedCount;
              clearPastedStrokes();
              log(`Cleared ${count} pasted stroke${count !== 1 ? 's' : ''}`, 'info');
            }}
            title="Discard all pasted strokes"
          >
            🗑️ Clear All
          </button>
        </div>
      {/if}

      <span class="tb-sep" aria-hidden="true"></span>

      <div class="tb-group" role="group" aria-label="View">
        <button
          class="tb-btn tone-accent"
          on:click={handleTextViewToggle}
          disabled={$strokeCount === 0}
          title={$strokeCount === 0
            ? 'No strokes on the canvas'
            : showTextView ? 'Show stroke view' : 'Show transcribed text'}
        >
          {showTextView ? '✏️ Strokes' : '📝 Text'}
        </button>
        <button
          class="tb-btn"
          on:click={copyAllVisibleTranscripts}
          disabled={!showTextView || isCopyingTranscript || textPageOverlays.length === 0}
          title={!showTextView
            ? 'Switch to text view to copy transcripts'
            : textPageOverlays.length > 1
              ? `Copy ${textPageOverlays.length} page transcripts as LogSeq markdown`
              : 'Copy transcript as LogSeq markdown'}
        >
          {copiedPageKey === 'all' ? '✅ Copied' : '📋 Copy'}
        </button>
      </div>
    </div>

    <span class="tb-sep" aria-hidden="true"></span>

    <div class="tb-group" role="group" aria-label="Tools">
      <!-- Finding a page *on the canvas* is the search box in the header.
           Searching every saved page on disk is Transcripts → Search in the
           left panel, which Ctrl+F still reaches. -->
      <div class="tb-more">
        <button
          class="tb-btn tb-more-btn"
          class:active={showMoreMenu}
          on:click|stopPropagation={() => showMoreMenu = !showMoreMenu}
          title="Undo dragged page positions or page resizing"
          aria-haspopup="true"
          aria-expanded={showMoreMenu}
        >
          Page Resets ▾
        </button>

        {#if showMoreMenu}
          <div class="tb-menu">
            <!-- These act on the pages themselves. Resetting the *view* (zoom
                 and pan) is the Reset View button on the bar below the canvas. -->
            <div class="tb-menu-label">Page layout</div>
            <button
              class="tb-menu-item"
              on:click={resetPageLayout}
              disabled={!$useCustomPositions}
              title={$useCustomPositions
                ? 'Undo dragged page positions — back to automatic horizontal layout'
                : 'No pages have been dragged out of automatic layout'}
            >
              📐 Reset Layout
              <span class="tb-menu-hint">page positions</span>
            </button>
            <button
              class="tb-menu-item"
              on:click={resetPageSizes}
              disabled={!$hasScaledPages}
              title={$hasScaledPages
                ? 'Reset all pages to original size (100%)'
                : 'All pages are already at 100%'}
            >
              📏 Reset Sizes
              <span class="tb-menu-hint">page scaling</span>
            </button>
          </div>
        {/if}
      </div>
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
    
    {#if $pointEditMode}
      <PointEditPanel on:focus={handleFocusPoint} on:edited={() => renderStrokes(true)} />
    {/if}

    <!-- Per-page copy buttons (text view only). Positioned in screen coords from
         the renderer, so they follow pan/zoom/page layout. -->
    {#each textPageOverlays as overlay (overlay.key)}
      <button
        class="page-copy-btn"
        class:copied={copiedPageKey === overlay.key}
        style="left: {overlay.left + overlay.width - 8}px; top: {overlay.top + 6}px;"
        on:click|stopPropagation={() => copyTranscripts([overlay.entry], overlay.key)}
        disabled={isCopyingTranscript}
        title={`Copy B${overlay.entry.pageInfo.book}/P${overlay.entry.pageId} transcript as LogSeq markdown`}
      >
        {copiedPageKey === overlay.key ? '✅ Copied' : '📋 Copy'}
      </button>
    {/each}

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
      {#if $pastedCount > 0}
        <strong style="color: #4ade80;">Duplicated strokes (green) are movable</strong> • Box select to choose • Drag to move group • 
      {/if}
      {#if $useCustomPositions}
        <strong>Drag page labels to reposition</strong> • 
      {/if}
      {#if $hasScaledPages}
        <strong>Drag corners to resize</strong> (Shift=aspect ratio) • 
      {/if}
      {#if $pointEditMode}
        <strong style="color: #b45309;">Editing points</strong> • Click a handle • Drag a box •
        Del to delete • Esc to exit •
      {:else if showTextView}
        Showing transcribed text •
      {:else}
        Drag to select • Ctrl+D to duplicate • Ctrl+click to add • Shift+click to remove •
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
      on:unloaded={handlePageUnloaded}
    />
    
    <!-- Sketch rendering: mark strokes, then tune how marked strokes are drawn.
         Grouped here rather than in the top bar so the style popover opens
         beside the controls that produce the strokes it restyles. -->
    <div class="sketch-actions" role="group" aria-label="Sketch rendering">
      <button
        class="btn btn-secondary small tone-sketch"
        on:click={() => applySketchFlag(true)}
        disabled={selectedPlainCount === 0}
        title={selectedPlainCount > 0
          ? `Render ${selectedPlainCount} selected stroke${selectedPlainCount !== 1 ? 's' : ''} with pressure-varying thickness (${$sketchProfileSummary})`
          : 'Select strokes that are not already sketches'}
      >
        ✏️ Sketch{#if selectedPlainCount > 0} ({selectedPlainCount}){/if}
      </button>
      <button
        class="btn btn-secondary small tone-sketch"
        on:click={() => applySketchFlag(false)}
        disabled={selectedSketchCount === 0}
        title={selectedSketchCount > 0
          ? `Return ${selectedSketchCount} selected sketch stroke${selectedSketchCount !== 1 ? 's' : ''} to a uniform width`
          : 'Select sketch strokes to return them to a uniform width'}
      >
        ✒️ Unmark{#if selectedSketchCount > 0} ({selectedSketchCount}){/if}
      </button>
      <SketchStylePopover />
    </div>

    <!-- Four permanent export buttons was a poor trade for the width; exports
         are occasional. -->
    <div class="export-actions" bind:this={exportMenuWrapper}>
      <button
        class="btn btn-secondary small export-menu-btn"
        class:active={showExportMenu}
        on:click|stopPropagation={() => showExportMenu = !showExportMenu}
        title={$hasSelection
          ? `Export the ${$selectionCount} selected stroke(s)`
          : 'Export the visible strokes'}
        aria-haspopup="true"
        aria-expanded={showExportMenu}
      >
        Export{#if $hasSelection} ({$selectionCount}){/if} ▾
      </button>

      {#if showExportMenu}
        <div class="export-menu">
          <div class="export-menu-label">
            {$hasSelection ? `${$selectionCount} selected stroke${$selectionCount !== 1 ? 's' : ''}` : 'Visible strokes'}
          </div>
          <button class="export-menu-item" on:click={() => runExport(exportSvg)}>
            🖼️ SVG
          </button>
          <button class="export-menu-item" on:click={() => runExport(exportJson)}>
            📦 JSON
          </button>
          <button class="export-menu-item" on:click={() => runExport(exportMd)}>
            📝 Markdown
          </button>
          <button
            class="export-menu-item"
            on:click={() => runExport(exportToGraph)}
            disabled={isExportingToGraph || !$graphFolderReady}
            title={$graphFolderReady
              ? 'Publish to the LogSeq graph (adds to what\'s already there)'
              : 'Set a LogSeq graph folder in Settings first'}
          >
            {isExportingToGraph ? '⏳ Exporting…' : '⇪ LogSeq'}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <FilteredStrokesPanel />

  <!-- Create Page Dialog -->
  <CreatePageDialog bind:isOpen={showCreatePageDialog} />

  <!-- Export SVG Dialog -->
  <ExportSvgDialog {renderer} />
</div>

<style>
  .canvas-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* Title + status only. The controls moved to their own full-width row below
     so they no longer compete with the status line for horizontal space. */
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    flex-wrap: nowrap;
    padding-bottom: 6px;
  }

  .header-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  /* Selection controls, beside the title. `margin-right: auto` pushes the
     stroke count to the far right — the header is baseline-aligned, so these
     get their own alignment. */
  .header-selection {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    margin-right: auto;
    align-self: center;
  }

  .hdr-btn {
    padding: 4px 10px;
    font-size: 0.72rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .hdr-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .hdr-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ---------------------------------------------------------------
   *  Canvas toolbar
   * --------------------------------------------------------------- */

  .canvas-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
    /* Never wrap: a second row would change the header height and shift the
       canvas below it, making a specific stroke hard to click. */
    flex-wrap: nowrap;
    min-width: 0;
  }

  /* Takes the whole row so the trailing tools group is pushed to the right
     edge, and absorbs any overflow as a horizontal scroll rather than letting
     the toolbar grow a second row. */
  .tb-scroll {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .tb-group {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .tb-sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 2px;
    background: var(--border);
    flex-shrink: 0;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-family: inherit;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
    white-space: nowrap;
  }

  .tb-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-secondary);
    background: var(--bg-secondary);
  }

  /* Disabled is the resting state for most of these — the toolbar shows the
     full vocabulary of canvas actions and greys out what the current selection
     can't do, rather than hiding it. So it has to read as "not now", not as
     "broken": muted, but still legible enough to plan by. */
  .tb-btn:disabled,
  .tb-select:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: transparent;
    color: var(--text-secondary);
  }

  /* Count of strokes this specific action would affect — not the same number as
     the selection count in the status line. Fixed width so ticking 9 → 10 does
     not shift the buttons to its right. */
  .tb-count {
    min-width: 2.1em;
    padding: 0 4px;
    text-align: center;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    border-radius: 999px;
    background: rgba(127, 127, 127, 0.18);
    color: inherit;
  }

  .tb-btn:disabled .tb-count {
    background: rgba(127, 127, 127, 0.1);
  }

  .tone-accent:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .tone-success {
    background: var(--success);
    color: var(--bg-primary);
    font-weight: 600;
    border-color: var(--success);
  }

  .tone-success:hover:not(:disabled) {
    background: #16a34a;
    border-color: #16a34a;
    color: var(--bg-primary);
  }

  .tone-danger:hover:not(:disabled) {
    background: var(--error);
    color: white;
    border-color: var(--error);
  }

  /* Sketch marking. Distinguished from the neutral toolbar actions because it
     changes how strokes render and is a saved, page-level annotation. */
  .tone-sketch:hover:not(:disabled) {
    background: #7c5cff;
    color: white;
    border-color: #7c5cff;
  }

  .sketch-indicator {
    color: #7c5cff;
    font-weight: 600;
  }

  /* Point editing. Amber like the suspect-point handles and the save dialog's
     "Editing" total, so the whole feature reads as one thing. */
  .tone-point:hover:not(:disabled) {
    background: #f59e0b;
    color: #1f2937;
    border-color: #f59e0b;
  }

  .tone-point.active {
    background: #f59e0b;
    color: #1f2937;
    border-color: #b45309;
    font-weight: 600;
  }

  .tb-select {
    padding: 4px 8px;
    font-size: 0.75rem;
    font-family: inherit;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }

  .tb-select:hover:not(:disabled) {
    border-color: var(--text-secondary);
    background: var(--bg-secondary);
  }

  /* Fixed width so swapping between "Volume" and "Volume 2 (current)" — and
     between enabled and disabled — doesn't resize the toolbar. */
  .volume-select {
    width: 148px;
    color: #8b5cf6;
    border-color: rgba(139, 92, 246, 0.4);
  }

  /* ---------------------------------------------------------------
   *  Overflow menu
   * --------------------------------------------------------------- */

  .tb-more {
    position: relative;
    flex-shrink: 0;
  }

  .tb-more-btn {
    padding: 4px 9px;
    font-size: 0.9rem;
    line-height: 1;
  }

  .tb-more-btn.active {
    background: var(--bg-secondary);
    border-color: var(--text-secondary);
  }

  .tb-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    min-width: 172px;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }

  .tb-menu-label {
    padding: 4px 8px 5px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .tb-menu-item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    font-size: 0.75rem;
    font-family: inherit;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }

  /* Names what each reset acts on — "Reset Layout" alone read as if it might
     cover the view too. */
  .tb-menu-hint {
    font-size: 0.65rem;
    color: var(--text-secondary);
  }

  .tb-menu-item:hover:not(:disabled) {
    background: var(--bg-tertiary);
  }

  .tb-menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    color: var(--text-secondary);
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
  
  .pasted-indicator {
    color: #4ade80;
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

  /* Per-page copy button in text view — sits in the page's top-right corner.
     Faint at rest so it doesn't compete with the transcript, solid on hover. */
  .page-copy-btn {
    position: absolute;
    transform: translateX(-100%);
    z-index: 11;
    padding: 3px 8px;
    font-size: 0.7rem;
    font-family: inherit;
    line-height: 1.4;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.85);
    color: #333;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
    white-space: nowrap;
  }

  .canvas-container:hover .page-copy-btn {
    opacity: 0.85;
  }

  .page-copy-btn:hover:not(:disabled) {
    opacity: 1;
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .page-copy-btn:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .page-copy-btn.copied {
    opacity: 1;
    background: #16a34a;
    border-color: #16a34a;
    color: white;
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
    position: relative;
  }

  .export-menu-btn.active {
    border-color: var(--accent);
    background: var(--bg-tertiary);
  }

  /* Opens upward — this bar sits at the bottom of the canvas panel. */
  .export-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    min-width: 190px;
    padding: 5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .export-menu-label {
    padding: 4px 9px 6px;
    font-size: 0.65rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
    margin-bottom: 3px;
  }

  .export-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    font-size: 0.78rem;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.12s;
  }

  .export-menu-item:hover:not(:disabled) {
    background: var(--bg-tertiary);
  }

  .export-menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Sketch marking + the style popover, moved down from the top bar. */
  .sketch-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    align-items: center;
  }

  .sketch-actions .tone-sketch:not(:disabled) {
    border-color: rgba(139, 92, 246, 0.55);
    color: #c4b5fd;
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
