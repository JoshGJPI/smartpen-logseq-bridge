/**
 * Canvas Renderer (Svelte-adapted)
 * Handles drawing strokes to canvas and exporting SVG
 * Zoom and pan are managed externally by Svelte stores
 *
 * LINE WIDTH
 *
 * Two rendering modes, chosen per stroke:
 *
 *   - Handwriting (default) — one uniform width for the whole stroke. Cheap:
 *     one path, one stroke() call.
 *   - Sketch (`stroke.sketch === true`) — thickness varies along the line with
 *     the pen force recorded at each point, via `sketch-width.js`. Costs several
 *     stroke() calls per stroke, so it is reserved for the strokes the user has
 *     explicitly flagged.
 *
 * Canvas2D reads `lineWidth` once, when `stroke()` is called, and applies it to
 * the entire path. Assigning it inside a moveTo/lineTo loop — as this file used
 * to — silently does nothing except leave the last assignment in effect, so every
 * stroke rendered at the width implied by its FINAL dot's pressure. Varying width
 * therefore requires splitting the polyline into separately-stroked runs, which
 * is what `strokeVariableWidth()` does.
 */

import {
  DEFAULT_SKETCH_PROFILE,
  normalizeProfile,
  profileKey,
  strokePressures,
  widthsForStrokeSeries
} from './sketch-width.js';
import {
  BOOK_KEY_FRAGMENT, compareBookKeys, volumeBadge, ncodeBookOf
} from './volumes.js';

// Page keys are `S#/O#/B<bookKey>/P#`, where the book portion may carry a volume
// suffix ("388v2"). Built from BOOK_KEY_FRAGMENT rather than a hand-written
// `\d+` — every site that hardcoded the latter either dropped volume pages or,
// unanchored, matched their numeric prefix and returned the wrong book.
const BOOK_IN_KEY_RE = new RegExp(`B(${BOOK_KEY_FRAGMENT})`);
const BOOK_PAGE_IN_KEY_RE = new RegExp(`B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)`);

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = []; // Array of stroke paths for SVG export
    this.currentStroke = null;
    this.scale = 2.371; // Ncode to mm conversion

    // Uniform widths (screen px at zoom 1) for non-sketch strokes. These match
    // the width handwriting has always effectively rendered at, now stated
    // deliberately instead of falling out of the final dot's pressure.
    this.handwritingWidth = 0.4;
    this.handwritingSelectedWidth = 0.6;

    // Pressure → thickness mapping for sketch strokes. Replaced from the store
    // via setSketchProfile(); the key is the cache tag for computed widths.
    this.sketchProfile = normalizeProfile(DEFAULT_SKETCH_PROFILE);
    this.sketchProfileKey = profileKey(this.sketchProfile);

    // Quantisation step (screen px) for sketch segment widths. Consecutive
    // segments that round to the same width are stroked as one sub-path, which
    // collapses a 50-dot stroke from 49 stroke() calls to a handful without any
    // visible stepping.
    this.sketchWidthQuantum = 0.25;

    // Point-edit handles (drawn only in the canvas "Edit Points" mode).
    // Sizes are in screen px and deliberately zoom-independent: a handle is a UI
    // affordance, so it has to stay clickable at fit-to-page zoom where a
    // stroke's dots are only a pixel or two apart.
    this.pointHandleRadius = 3;
    this.pointHandleHitRadius = 9;

    // Per-page scale factors (non-destructive display scaling)
    this.pageScales = {}; // Map of pageKey -> scale factor
    this.tempPageScales = {}; // Temporary scales during drag preview
    
    // Zoom and pan state
    this.zoom = 1;
    this.minZoom = 0.25;
    this.maxZoom = 10;
    this.panX = 0;
    this.panY = 0;
    
    // Bounds tracking for SVG export
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    
    // Page-based layout
    this.pageOffsets = new Map(); // Map of "B{book}/P{page}" -> {offsetX, offsetY, bounds}
    this.pageSpacing = 20; // mm between pages (horizontal and vertical)
    this.pageColumns = 5; // pages per row before wrapping

    // Page layout order: 'book' (book key, then page) or 'date' (earliest
    // capture time of the strokes loaded for the page). See setPageOrder().
    this.pageOrderMode = 'book';
    // pageKey -> earliest loaded stroke's startTime, filled by calculateBounds.
    this.pageFirstCapture = new Map();

    // Context ink (stores/context-ink.js): the rest of a partially-loaded page,
    // drawn so the loaded strokes can be read in place. Halftone by COLOUR, at
    // the same width as live ink — thinning it as well would read as faint
    // handwriting rather than as background.
    this.contextInkColor = '#c3c7d4';
    
    this.viewWidth = 0;
    this.viewHeight = 0;
    
    // Page visualization settings
    this.showPageBackgrounds = true; // Toggle for page borders
    // Corner handle visualization
    this.showCornerHandles = true; // Toggle for corner resize handles
    this.cornerHandles = new Map(); // Map of pageKey -> array of handle objects
    this.handleSize = 8; // Size of corner handles in pixels
    
    this.pageColors = [ // Colors for different books (10 distinct colors)
      'rgba(233, 69, 96, 0.8)',   // Red
      'rgba(75, 192, 192, 0.8)',  // Teal
      'rgba(255, 205, 86, 0.8)',  // Yellow
      'rgba(153, 102, 255, 0.8)', // Purple
      'rgba(255, 159, 64, 0.8)',  // Orange
      'rgba(54, 162, 235, 0.8)',  // Blue
      'rgba(255, 99, 132, 0.8)',  // Pink
      'rgba(76, 175, 80, 0.8)',   // Green
      'rgba(121, 85, 72, 0.8)',   // Brown
      'rgba(158, 158, 158, 0.8)', // Gray
    ];
    this.visiblePageKeys = null; // Set of visible page keys (for filtering borders)
    
    this.resize();
    this.clear();
  }
  
  /**
   * Set zoom level, optionally centered on a specific point
   * @param {number} level - Zoom level
   * @param {Object} centerPoint - Optional {x, y} in screen coordinates to zoom toward
   * @returns {boolean} - Whether zoom changed
   */
  setZoom(level, centerPoint = null) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    if (newZoom !== this.zoom) {
      const zoomRatio = newZoom / this.zoom;
      
      // If no center point provided, zoom toward viewport center
      const centerX = centerPoint ? centerPoint.x : this.viewWidth / 2;
      const centerY = centerPoint ? centerPoint.y : this.viewHeight / 2;
      
      // Adjust pan to keep the center point fixed in world space
      // The point under the cursor should stay at the same screen position
      this.panX = centerX - (centerX - this.panX) * zoomRatio;
      this.panY = centerY - (centerY - this.panY) * zoomRatio;
      
      this.zoom = newZoom;
      return true;
    }
    return false;
  }
  
  /**
   * Zoom in by a fixed factor
   */
  zoomIn() {
    this.setZoom(this.zoom * 1.25);
  }
  
  /**
   * Zoom out by a fixed factor
   */
  zoomOut() {
    this.setZoom(this.zoom / 1.25);
  }
  
  /**
   * Reset zoom and pan to defaults
   * Note: Does not redraw - caller should trigger re-render
   */
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    // Don't call redraw - let the component handle it
  }
  
  /**
   * Pan the view by delta amounts
   * Note: Does not redraw - caller should trigger re-render
   * @param {number} deltaX - Horizontal pan amount
   * @param {number} deltaY - Vertical pan amount
   */
  pan(deltaX, deltaY) {
    this.panX += deltaX;
    this.panY += deltaY;
    // Don't call redraw - let the component handle it
  }
  
  /**
   * Get current pan position
   */
  getPan() {
    return { x: this.panX, y: this.panY };
  }
  
  /**
   * Fit all content in view and center on strokes
   * Note: Does not redraw - caller should trigger re-render
   * @returns {number|undefined} - New zoom level if changed
   */
  fitToContent() {
    if (this.bounds.minX === Infinity) {
      this.resetView();
      return;
    }
    
    const contentWidth = (this.bounds.maxX - this.bounds.minX) * this.scale;
    const contentHeight = (this.bounds.maxY - this.bounds.minY) * this.scale;
    
    const padding = 40;
    const availWidth = this.viewWidth - padding * 2;
    const availHeight = this.viewHeight - padding * 2;
    
    if (contentWidth <= 0 || contentHeight <= 0) {
      this.resetView();
      return;
    }
    
    const scaleX = availWidth / contentWidth;
    const scaleY = availHeight / contentHeight;
    this.zoom = Math.min(scaleX, scaleY, this.maxZoom);
    
    // Center the content in the viewport.
    // World space starts at bounds.minX/minY, which is NOT always 0:
    // calculateBounds() normalises the computed layout to the origin, but
    // applyCustomPositions() recomputes bounds from dragged page offsets and
    // leaves them wherever the pages sit. Centring as if content began at 0
    // pushed a dragged page off-screen by its own offset.
    const scaledContentWidth = contentWidth * this.zoom;
    const scaledContentHeight = contentHeight * this.zoom;

    this.panX = (this.viewWidth - scaledContentWidth) / 2 - this.bounds.minX * this.scale * this.zoom;
    this.panY = (this.viewHeight - scaledContentHeight) / 2 - this.bounds.minY * this.scale * this.zoom;
    
    // Don't call redraw - let the component handle it
    
    return this.zoom;
  }
  
  /**
   * Set a comfortable view for live writing: 3× zoom with the top of the current
   * writing area positioned near the top of the viewport (with padding).
   * Call this when the first live stroke arrives and then keep the view stable.
   * Does NOT redraw — the caller should trigger a re-render.
   * @returns {number} New zoom level
   */
  setLiveWritingView() {
    const LIVE_ZOOM = 3;
    const TOP_PADDING = 50; // px from top of canvas to top of writing content
    const LEFT_PADDING = 20; // px from left edge to left of writing content

    this.zoom = LIVE_ZOOM;

    // If we have real bounds, position so the content's top-left is in view.
    // ncodeToScreen: screenX = (dot.x - bounds.minX) * scale * zoom + panX
    // We want the top of the content at y = TOP_PADDING, so:
    //   panY = TOP_PADDING  (since minY maps to y=0 in world space after ncodeToScreen)
    // Similarly for X:
    //   panX = LEFT_PADDING
    this.panX = LEFT_PADDING;
    this.panY = TOP_PADDING;

    return this.zoom;
  }

  /**
   * Resize canvas to fit container
   */
  resize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    
    // Use device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    this.ctx.scale(dpr, dpr);
    
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
    
    this.redraw();
  }
  
  /**
   * Clear canvas and optionally reset state
   * @param {boolean} resetBounds - Whether to reset bounds tracking (default: true)
   */
  clear(resetBounds = true) {
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.viewWidth || this.canvas.width, this.viewHeight || this.canvas.height);
    this.strokes = [];
    this.currentStroke = null;
    
    if (resetBounds) {
      this.bounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
      };
      // Do NOT reset zoom/pan here — view state is managed by the component
      // (fitToContent or setLiveWritingView). Resetting it here caused the
      // view to snap back to zoom=1 after every stroke completion.
    }
  }
  
  /**
   * How pages are ordered on the canvas.
   *
   *   'book' — book key, then page number. The notebook's own order, and the
   *            default.
   *   'date' — earliest capture time of the strokes loaded for each page, then
   *            book and page. Rows break on a change of day, so a date-range
   *            load reads as one row per day.
   *
   * Set from the Dates panel; a date-range load switches to 'date' because the
   * pages it brings in have no meaningful book order between them.
   */
  setPageOrder(mode) {
    this.pageOrderMode = mode === 'date' ? 'date' : 'book';
  }

  /**
   * Calculate bounds and page offsets from an array of strokes
   * Groups strokes by page and positions them into a grid
   *
   * @param {Array} strokes - Array of stroke objects
   * @param {Array} [contextStrokes] - Context ink (see stores/context-ink.js).
   *   Counted for page BOUNDS so a partially-loaded page keeps its real size and
   *   does not resize as the date range changes — but never for page ORDER,
   *   which follows the strokes the user actually loaded.
   */
  calculateBounds(strokes, contextStrokes = null) {
    // Reset
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    this.pageOffsets.clear();

    if (strokes.length === 0) return;

    // Group strokes by page (using full key to match pages store)
    const pageGroups = new Map();
    strokes.forEach(stroke => {
      const pageInfo = stroke.pageInfo;

      // Handle strokes without pageInfo or with incomplete pageInfo
      if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) {
        console.warn('Stroke missing valid pageInfo:', stroke);
        // Use a default page for strokes without pageInfo
        const fallbackKey = 'S0/O0/B0/P0';
        if (!pageGroups.has(fallbackKey)) {
          pageGroups.set(fallbackKey, []);
        }
        pageGroups.get(fallbackKey).push(stroke);
        return;
      }

      // Use full key format to match pages store: S{section}/O{owner}/B{book}/P{page}
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
      if (!pageGroups.has(pageKey)) {
        pageGroups.set(pageKey, []);
      }
      pageGroups.get(pageKey).push(stroke);
    });

    // Earliest capture time per page, from the LOADED strokes only. Read before
    // context ink is folded in below: context ink is by definition outside the
    // selected range, so letting it set a page's date would file the page under
    // writing the user did not ask to see.
    this.pageFirstCapture = new Map();
    pageGroups.forEach((pageStrokes, pageKey) => {
      let min = Infinity;
      for (const s of pageStrokes) {
        const t = Number(s.startTime);
        if (Number.isFinite(t) && t > 0 && t < min) min = t;
      }
      if (min !== Infinity) this.pageFirstCapture.set(pageKey, min);
    });

    // Fold context ink into the bounds pass. A page with only context ink can
    // exist transiently (its real strokes were just unloaded), so it is allowed
    // its own group rather than being dropped — it simply has no capture date
    // and sorts last in date mode.
    if (contextStrokes && contextStrokes.length > 0) {
      contextStrokes.forEach(stroke => {
        const pageInfo = stroke.pageInfo;
        if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) return;
        const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
        if (!pageGroups.has(pageKey)) pageGroups.set(pageKey, []);
        pageGroups.get(pageKey).push(stroke);
      });
    }

    // Calculate bounds for each page and assign offsets
    const byDate = this.pageOrderMode === 'date';
    const sortedPageEntries = Array.from(pageGroups.entries()).sort((a, b) => {
      const keyA = a[0];
      const keyB = b[0];

      if (byDate) {
        // A page with no capture time (context ink only) sorts last rather than
        // jumping to the front, which is what Infinity would do in reverse.
        const tA = this.pageFirstCapture.get(keyA);
        const tB = this.pageFirstCapture.get(keyB);
        if (tA !== tB) {
          if (tA === undefined) return 1;
          if (tB === undefined) return -1;
          return tA - tB;
        }
        // Same instant (or both undefined) — fall through to book/page order so
        // the layout is still deterministic.
      }

      // Extract book key and page from keys (format: S#/O#/B<key>/P#).
      // A `\d+` book here failed to match any volume page, and the `return 0`
      // below made it compare equal to EVERYTHING — arbitrary left-to-right
      // layout order, with no error to show for it.
      const matchA = keyA.match(BOOK_PAGE_IN_KEY_RE);
      const matchB = keyB.match(BOOK_PAGE_IN_KEY_RE);

      if (!matchA || !matchB) return 0;

      const bookA = matchA[1];
      const pageA = parseInt(matchA[2]);
      const bookB = matchB[1];
      const pageB = parseInt(matchB[2]);

      // Sort by book (NCode book, then volume) first, then by page
      const bookOrder = compareBookKeys(bookA, bookB);
      if (bookOrder !== 0) {
        return bookOrder;
      }
      return pageA - pageB;
    });

    // First pass: compute per-page bounds, width, and height
    const pageBoundsArray = sortedPageEntries.map(([pageKey, pageStrokes]) => {
      let pageMinX = Infinity, pageMinY = Infinity;
      let pageMaxX = -Infinity, pageMaxY = -Infinity;

      pageStrokes.forEach(stroke => {
        const dots = stroke.dotArray || stroke.dots || [];
        dots.forEach(dot => {
          pageMinX = Math.min(pageMinX, dot.x);
          pageMinY = Math.min(pageMinY, dot.y);
          pageMaxX = Math.max(pageMaxX, dot.x);
          pageMaxY = Math.max(pageMaxY, dot.y);
        });
      });

      return {
        pageKey,
        bounds: { minX: pageMinX, minY: pageMinY, maxX: pageMaxX, maxY: pageMaxY },
        width: pageMaxX - pageMinX,
        height: pageMaxY - pageMinY
      };
    });

    // Assign each page a (row, col). In book order that is a plain wrap every
    // `pageColumns`; in date order a row ALSO breaks whenever the day changes,
    // so each row is one day's writing and the grouping is legible without
    // drawing anything extra.
    const columns = this.pageColumns;
    let row = 0, col = 0, prevDay = null;
    pageBoundsArray.forEach(page => {
      const captured = this.pageFirstCapture.get(page.pageKey);
      const day = (byDate && captured !== undefined) ? this.captureDayKey(captured) : null;

      if (col >= columns || (byDate && prevDay !== null && day !== prevDay && col > 0)) {
        row++;
        col = 0;
      }
      page.row = row;
      page.col = col;
      page.day = day;
      col++;
      prevDay = day;
    });

    // Compute the max height for each row (needed to space rows apart)
    const rowCount = row + 1;
    const rowMaxHeights = new Array(rowCount).fill(0);
    pageBoundsArray.forEach(page => {
      rowMaxHeights[page.row] = Math.max(rowMaxHeights[page.row], page.height);
    });

    // Compute cumulative Y start position for each row
    const rowStartY = new Array(rowCount).fill(0);
    for (let r = 1; r < rowCount; r++) {
      rowStartY[r] = rowStartY[r - 1] + rowMaxHeights[r - 1] + this.pageSpacing;
    }

    // Second pass: assign offsets and update global bounds
    // offsetX positions the page's left edge in world space (world_x = dot.x - bounds.minX + offsetX)
    // offsetY positions the page's top edge in world space (world_y = dot.y - bounds.minY + offsetY)
    let currentRowX = 0;
    pageBoundsArray.forEach(page => {
      const col = page.col;
      const row = page.row;

      if (col === 0) currentRowX = 0;

      const offsetX = currentRowX;
      const offsetY = rowStartY[row];

      this.pageOffsets.set(page.pageKey, {
        offsetX,
        offsetY,
        bounds: page.bounds
      });

      this.bounds.minX = Math.min(this.bounds.minX, offsetX);
      this.bounds.minY = Math.min(this.bounds.minY, offsetY);
      this.bounds.maxX = Math.max(this.bounds.maxX, offsetX + page.width);
      this.bounds.maxY = Math.max(this.bounds.maxY, offsetY + page.height);

      currentRowX += page.width + this.pageSpacing;
    });

    // Normalise so the top-left of all content is at world (0, 0)
    this.bounds.minX = 0;
    this.bounds.minY = 0;
    
    console.log('Page offsets calculated:', Array.from(this.pageOffsets.keys()));
  }
  
  /**
   * Clear canvas without resetting zoom/pan/bounds (for redraws)
   */
  clearForRedraw() {
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.viewWidth || this.canvas.width, this.viewHeight || this.canvas.height);
  }
  
  /**
   * Add a dot from the pen (real-time drawing)
   * @param {Object} dot - Dot object with x, y, f, dotType, pageInfo
   */
  addDot(dot) {
    // Update bounds (in Ncode coordinates)
    this.bounds.minX = Math.min(this.bounds.minX, dot.x);
    this.bounds.minY = Math.min(this.bounds.minY, dot.y);
    this.bounds.maxX = Math.max(this.bounds.maxX, dot.x);
    this.bounds.maxY = Math.max(this.bounds.maxY, dot.y);
    
    // Convert ncode coordinates to screen coordinates WITH pageInfo
    const screenDot = this.ncodeToScreen(dot, dot.pageInfo);
    
    switch (dot.dotType) {
      case 0: // Pen Down
        this.ctx.beginPath();
        this.ctx.moveTo(screenDot.x, screenDot.y);
        this.currentStroke = {
          dots: [{ x: dot.x, y: dot.y, f: dot.f }],
          color: '#000000',
          width: 2
        };
        break;
        
      case 1: // Pen Move
        if (this.currentStroke) {
          this.ctx.lineTo(screenDot.x, screenDot.y);
          this.ctx.strokeStyle = '#000000';
          // Uniform, matching how this stroke will look once re-rendered from the
          // store. Live capture used to vary width per dot here while re-render
          // did not (see the class header), so a stroke visibly changed weight
          // the moment anything triggered a redraw. Strokes are not flagged as
          // sketches until after capture, so live has nothing better to go on.
          this.ctx.lineWidth = Math.max(0.5, this.handwritingWidth * this.zoom);
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.stroke();
          
          this.ctx.beginPath();
          this.ctx.moveTo(screenDot.x, screenDot.y);
          
          this.currentStroke.dots.push({ x: dot.x, y: dot.y, f: dot.f });
        }
        break;
        
      case 2: // Pen Up
        if (this.currentStroke) {
          this.currentStroke.dots.push({ x: dot.x, y: dot.y, f: dot.f });
          this.strokes.push(this.currentStroke);
          this.currentStroke = null;
        }
        this.ctx.closePath();
        break;
        
      case 3: // Hover
        // Optionally show hover cursor
        break;
    }
  }
  
  /**
   * Convert ncode coordinates to screen coordinates with zoom, pan, page offset, and page scale
   * @param {Object} dot - Dot with x, y coordinates
   * @param {Object} pageInfo - Page information (section, owner, book, page) to determine offset
   */
  ncodeToScreen(dot, pageInfo = null) {
    let x, y;
    
    // Get page offset if available
    let offsetX = 0;
    let offsetY = 0;
    let pageBounds = null;
    let pageKey = null;
    
    if (pageInfo && this.pageOffsets.size > 0) {
      // Use full key format to match pages store
      pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
      const pageOffset = this.pageOffsets.get(pageKey);
      
      if (pageOffset) {
        offsetX = pageOffset.offsetX;
        offsetY = pageOffset.offsetY;
        pageBounds = pageOffset.bounds;
      }
    }
    
    // Get per-page scale factor (default: 1.0)
    const pageScale = pageKey ? this.getEffectiveScale(pageKey) : 1.0;
    
    // Use simple scaling if:
    // 1. No bounds calculated yet (first strokes), OR
    // 2. Page offset not found (real-time strokes on new page)
    if (this.bounds.minX === Infinity || (pageInfo && !pageBounds)) {
      x = dot.x * this.scale * pageScale;
      y = dot.y * this.scale * pageScale;
    } else {
      // Transform relative to page bounds (or global bounds if no page offset)
      const bounds = pageBounds || this.bounds;
      x = (dot.x - bounds.minX + offsetX) * this.scale * pageScale;
      y = (dot.y - bounds.minY + offsetY) * this.scale * pageScale;
    }
    
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
      pressure: dot.f
    };
  }
  
  /**
   * Convert ncode to screen without page offset lookup
   * Used for pasted strokes that aren't attached to a page
   * @param {Object} dot - Dot with x, y, f coordinates
   * @returns {Object} Screen coordinates {x, y, pressure}
   */
  ncodeToScreenDirect(dot) {
    const x = dot.x * this.scale * this.zoom + this.panX;
    const y = dot.y * this.scale * this.zoom + this.panY;
    return { x, y, pressure: dot.f };
  }
  
  /**
   * Compute (and cache) a stroke's bounding box in Ncode space.
   * Cached on the stroke as `_nb` — Ncode coords never change after capture, so
   * the box is reusable across zoom/pan/scale changes (those only affect the
   * screen transform, applied separately in isStrokeOffscreen).
   * @param {Object} stroke
   * @param {Array} dots - stroke.dotArray (passed in to avoid re-resolving)
   * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
   */
  strokeNcodeBounds(stroke, dots) {
    if (stroke._nb) return stroke._nb;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (d.x < minX) minX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.x > maxX) maxX = d.x;
      if (d.y > maxY) maxY = d.y;
    }
    stroke._nb = { minX, minY, maxX, maxY };
    return stroke._nb;
  }

  /**
   * Fast viewport-culling test: is the stroke's screen bounding box entirely
   * outside the visible canvas? Transforms only the two Ncode-bounds corners
   * (the screen transform is linear/monotonic, so the corners map to the screen
   * bbox), which is O(1) versus O(dots) for actually drawing the stroke.
   * @returns {boolean} true if the stroke can be skipped this frame
   */
  isStrokeOffscreen(stroke, dots, pageInfo) {
    const nb = this.strokeNcodeBounds(stroke, dots);
    const a = this.ncodeToScreen({ x: nb.minX, y: nb.minY, f: 0 }, pageInfo);
    const b = this.ncodeToScreen({ x: nb.maxX, y: nb.maxY, f: 0 }, pageInfo);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const margin = 24; // px slack so stroke caps near the edge aren't clipped
    return (
      right < -margin ||
      left > this.viewWidth + margin ||
      bottom < -margin ||
      top > this.viewHeight + margin
    );
  }

  /**
   * Replace the pressure → thickness mapping used for sketch strokes.
   *
   * Changing the profile invalidates every cached width array; that happens
   * implicitly because the cache is tagged with the profile key.
   * @param {Object} profile - partial SketchProfile; missing fields take defaults
   */
  setSketchProfile(profile) {
    this.sketchProfile = normalizeProfile(profile);
    this.sketchProfileKey = profileKey(this.sketchProfile);
  }

  /**
   * Per-point widths (in Ncode mm) for a sketch stroke, cached on the stroke.
   *
   * Cached because the mapping runs a smoothing pass and a two-direction slew
   * pass over the whole dot series — fine once, wasteful on every pan frame. The
   * cache tag is the profile key, so dragging a thickness slider recomputes and
   * anything else reuses. Mirrors the existing `_nb` bounds cache.
   *
   * @param {Object} stroke
   * @returns {number[]}
   */
  sketchWidths(stroke) {
    if (stroke._sw && stroke._sw.key === this.sketchProfileKey) return stroke._sw.widths;

    // widthsForStrokeSeries owns the "no real pressure data → flatWidth" rule, so
    // this path and the SVG paths cannot disagree about a legacy page.
    const widths = widthsForStrokeSeries(strokePressures(stroke), this.sketchProfile);

    stroke._sw = { key: this.sketchProfileKey, widths };
    return widths;
  }

  /**
   * Per-page display scale for a stroke's page, or 1 when it has no page.
   * @param {Object|null} pageInfo
   * @returns {number}
   */
  pageScaleFor(pageInfo) {
    if (!pageInfo) return 1.0;
    const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
    return this.getEffectiveScale(pageKey);
  }

  /**
   * Stroke a polyline through vertices a…b (inclusive) at a single width.
   * @param {ArrayLike<number>} xs
   * @param {ArrayLike<number>} ys
   * @param {number} a - first vertex index
   * @param {number} b - last vertex index
   * @param {number} width - screen px
   */
  strokeRun(xs, ys, a, b, width) {
    if (b <= a) return;
    const ctx = this.ctx;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(xs[a], ys[a]);
    for (let i = a + 1; i <= b; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
  }

  /**
   * Draw a polyline whose thickness follows a per-vertex width array.
   *
   * Each segment takes the mean of its two endpoint widths, then consecutive
   * segments of equal quantised width are stroked together. Successive runs share
   * their boundary vertex and `lineCap: 'round'` fills the joint, so the line
   * reads as continuous rather than as a chain of separate dashes.
   *
   * @param {ArrayLike<number>} xs - screen x per vertex
   * @param {ArrayLike<number>} ys - screen y per vertex
   * @param {number[]} widths - width in Ncode mm per vertex
   * @param {number} pxPerMm - mm → screen px factor (scale × pageScale × zoom)
   * @param {number} [boost] - multiplier for selection emphasis
   */
  strokeVariableWidth(xs, ys, widths, pxPerMm, boost = 1) {
    const vertexCount = widths.length;
    const segmentCount = vertexCount - 1;
    if (segmentCount < 1) return;

    const quantum = this.sketchWidthQuantum;
    const widthAt = (segment) => {
      const mm = (widths[segment] + widths[segment + 1]) / 2;
      // Floor at a visible hairline: below ~0.4px the line disappears at low zoom.
      return Math.max(0.4, Math.round((mm * pxPerMm * boost) / quantum) * quantum);
    };

    let runStart = 0;
    let runWidth = widthAt(0);

    for (let i = 1; i < segmentCount; i++) {
      const w = widthAt(i);
      if (w !== runWidth) {
        // Segments runStart…i-1 span vertices runStart…i.
        this.strokeRun(xs, ys, runStart, i, runWidth);
        runStart = i;
        runWidth = w;
      }
    }
    this.strokeRun(xs, ys, runStart, segmentCount, runWidth);
  }

  /**
   * Project a dot array into screen-space coordinate arrays.
   * @param {Array} dots
   * @param {Object|null} pageInfo
   * @param {boolean} [direct] - use ncodeToScreenDirect (pasted strokes, no page)
   * @returns {{xs: Float64Array, ys: Float64Array}}
   */
  projectDots(dots, pageInfo, direct = false) {
    const n = dots.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = direct ? this.ncodeToScreenDirect(dots[i]) : this.ncodeToScreen(dots[i], pageInfo);
      xs[i] = s.x;
      ys[i] = s.y;
    }
    return { xs, ys };
  }

  /**
   * Draw a stroke from store data
   * @param {Object} stroke - Stroke object with dotArray and pageInfo
   * @param {boolean} highlighted - Whether to highlight this stroke
   * @param {boolean} filtered - Whether this is a filtered decorative stroke
   * @param {boolean} deleted - Whether this stroke is marked for deletion
   */
  drawStroke(stroke, highlighted = false, filtered = false, deleted = false) {
    const dots = stroke.dotArray || stroke.dots || [];
    if (dots.length < 2) return;

    const pageInfo = stroke.pageInfo;

    // Viewport culling: skip strokes whose screen bounding box is entirely
    // off-canvas. With many pages laid out in a grid, only a handful are visible
    // at typical edit zoom, so this avoids transforming/stroking the dots of the
    // ~95% that aren't on screen — the dominant per-frame cost.
    if (this.isStrokeOffscreen(stroke, dots, pageInfo)) return;

    // Determine color and style based on state
    let color, uniformWidth, opacity, dashed;

    if (deleted) {
      // Deleted strokes: gray with reduced opacity and dashed
      color = '#888888';
      uniformWidth = this.handwritingWidth;
      opacity = 0.4;
      dashed = [3, 3]; // Dashed to indicate deletion
    } else if (filtered) {
      // Filtered decorative strokes are ALWAYS dashed
      // Color depends on selection state
      color = highlighted ? '#e94560' : '#000000'; // Red if selected, black if not
      uniformWidth = highlighted ? this.handwritingSelectedWidth : this.handwritingWidth;
      opacity = 1;
      dashed = [5, 5]; // Always dashed for filtered strokes
    } else {
      // Normal text strokes are always solid
      color = highlighted ? '#e94560' : '#000000'; // Red if selected, black if not
      uniformWidth = highlighted ? this.handwritingSelectedWidth : this.handwritingWidth;
      opacity = 1;
      dashed = null; // Solid line
    }

    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = opacity;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash(dashed || []);

    // Sketch strokes render with pressure-driven thickness — but only when solid.
    // A dash pattern restarts at every sub-path, and the variable-width path is
    // deliberately many sub-paths, so a dashed sketch stroke would come out as
    // uneven stipple. Deleted and decorative strokes keep the uniform path so
    // their dashes stay readable; the dash is the more important signal there.
    if (stroke.sketch && !dashed) {
      const { xs, ys } = this.projectDots(dots, pageInfo);
      const pxPerMm = this.scale * this.pageScaleFor(pageInfo) * this.zoom;
      this.strokeVariableWidth(xs, ys, this.sketchWidths(stroke), pxPerMm, highlighted ? 1.6 : 1);
    } else {
      const { xs, ys } = this.projectDots(dots, pageInfo);
      this.strokeRun(xs, ys, 0, dots.length - 1, Math.max(0.5, uniformWidth * this.zoom));
    }

    this.ctx.setLineDash([]); // Reset to solid for next stroke
  }

  /**
   * Local calendar day key for a capture timestamp. Mirrors `dayKey` in
   * src/lib/timeline.js and `dayKeyLocal` in electron/main.cjs — all three have
   * to agree or a row would break on a different boundary than the one the
   * Dates panel selected.
   */
  captureDayKey(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear()
      + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * Draw a context-ink stroke — the part of a partially-loaded page that falls
   * outside the selected date range.
   *
   * Always uniform and always solid: it is background, so a pressure taper or a
   * dash pattern would draw attention to exactly the ink meant to recede. It is
   * never selected, never deleted and never decorative, so it takes none of
   * drawStroke's state.
   *
   * @param {Object} stroke - Canvas-format stroke (dotArray + pageInfo)
   */
  drawContextStroke(stroke) {
    const dots = stroke.dotArray || stroke.dots || [];
    if (dots.length < 2) return;

    const pageInfo = stroke.pageInfo;
    if (this.isStrokeOffscreen(stroke, dots, pageInfo)) return;

    this.ctx.strokeStyle = this.contextInkColor;
    this.ctx.globalAlpha = 1;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash([]);

    const { xs, ys } = this.projectDots(dots, pageInfo);
    this.strokeRun(xs, ys, 0, dots.length - 1, Math.max(0.5, this.handwritingWidth * this.zoom));
  }

  /**
   * Draw a pasted stroke with offset applied
   * Visual distinction: green selection color when selected
   * @param {Object} stroke - Pasted stroke object with dotArray and _offset
   * @param {boolean} highlighted - Whether to highlight this stroke
   */
  drawPastedStroke(stroke, highlighted = false) {
    const dots = stroke.dotArray || [];
    if (dots.length < 2) return;
    
    const offset = stroke._offset || { x: 0, y: 0 };

    // Apply offset to coordinates during rendering
    const color = highlighted ? '#4ade80' : '#555555';  // Green when selected, dark gray otherwise
    const uniformWidth = highlighted ? this.handwritingSelectedWidth : this.handwritingWidth;

    this.ctx.strokeStyle = color;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash([]);  // Solid line
    this.ctx.globalAlpha = 1;

    // Offset is applied in Ncode space before projection; pasted strokes are not
    // attached to a page, so they project directly with no page offset or scale.
    const shifted = dots.map(d => ({ x: d.x + offset.x, y: d.y + offset.y, f: d.f }));
    const { xs, ys } = this.projectDots(shifted, null, true);

    // A stroke duplicated from a sketch is still a sketch.
    if (stroke.sketch) {
      this.strokeVariableWidth(
        xs, ys,
        this.sketchWidths(stroke),
        this.scale * this.zoom,
        highlighted ? 1.6 : 1
      );
    } else {
      this.strokeRun(xs, ys, 0, dots.length - 1, Math.max(0.5, uniformWidth * this.zoom));
    }
  }
  
  /**
   * Hit test to find pasted stroke at coordinates
   * Tests in reverse order so top strokes are selected first
   * @param {number} screenX - Screen X coordinate
   * @param {number} screenY - Screen Y coordinate
   * @param {Array} pastedStrokes - Array of pasted strokes to test
   * @returns {number} Index of hit stroke, or -1 if none
   */
  hitTestPasted(screenX, screenY, pastedStrokes) {
    const hitRadius = 10 / this.zoom;
    
    // Test in reverse order (top strokes first)
    for (let i = pastedStrokes.length - 1; i >= 0; i--) {
      const stroke = pastedStrokes[i];
      const dots = stroke.dotArray || [];
      const offset = stroke._offset || { x: 0, y: 0 };
      
      for (const dot of dots) {
        const screenDot = this.ncodeToScreenDirect({
          x: dot.x + offset.x,
          y: dot.y + offset.y,
          f: dot.f
        });
        
        const dx = screenDot.x - screenX;
        const dy = screenDot.y - screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= hitRadius) {
          return i;
        }
      }
    }
    
    return -1;
  }
  
  /**
   * Get bounding box for a pasted stroke in screen coordinates
   * @param {Object} stroke - Pasted stroke object with _offset
   * @returns {Object} Bounds object with left, top, right, bottom
   */
  getPastedStrokeBounds(stroke) {
    const dots = stroke.dotArray || [];
    if (dots.length === 0) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    
    const offset = stroke._offset || { x: 0, y: 0 };
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    dots.forEach(dot => {
      const screen = this.ncodeToScreenDirect({
        x: dot.x + offset.x,
        y: dot.y + offset.y,
        f: dot.f
      });
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x);
      maxY = Math.max(maxY, screen.y);
    });
    
    return { 
      left: minX, 
      top: minY, 
      right: maxX, 
      bottom: maxY 
    };
  }
  
  /**
   * Check if pasted stroke bounding box intersects with rectangle
   * @param {Object} stroke - Pasted stroke object
   * @param {Object} rect - Rectangle with left, top, right, bottom
   * @returns {boolean} True if intersects
   */
  pastedStrokeIntersectsBox(stroke, rect) {
    const bounds = this.getPastedStrokeBounds(stroke);
    
    return !(bounds.right < rect.left || 
             bounds.left > rect.right ||
             bounds.bottom < rect.top ||
             bounds.top > rect.bottom);
  }
  
  /**
   * Find all pasted stroke indices that intersect with a rectangle
   * @param {Array} pastedStrokes - Array of pasted stroke objects
   * @param {Object} rect - Rectangle with left, top, right, bottom
   * @returns {number[]} Array of intersecting stroke indices
   */
  findPastedStrokesInRect(pastedStrokes, rect) {
    return pastedStrokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => this.pastedStrokeIntersectsBox(stroke, rect))
      .map(({ index }) => index);
  }
  
  /**
   * Highlight strokes by indices (from selection store)
   * @param {Set} indices - Set of selected stroke indices
   */
  highlightStrokes(indices) {
    // This method is called reactively by Svelte when selection changes
    // The actual highlighting is done during redraw via drawStroke's highlighted param
  }
  
  /**
   * Get bounding box for a stroke in screen coordinates
   * @param {Object} stroke - Stroke object with pageInfo
   * @returns {Object} Bounds object with left, top, right, bottom
   */
  getStrokeBounds(stroke) {
    const dots = stroke.dotArray || stroke.dots || [];
    if (dots.length === 0) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    
    const pageInfo = stroke.pageInfo;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    dots.forEach(dot => {
      const screen = this.ncodeToScreen(dot, pageInfo);
      minX = Math.min(minX, screen.x);
      minY = Math.min(minY, screen.y);
      maxX = Math.max(maxX, screen.x);
      maxY = Math.max(maxY, screen.y);
    });
    
    return { 
      left: minX, 
      top: minY, 
      right: maxX, 
      bottom: maxY 
    };
  }
  
  /**
   * Check if stroke bounding box intersects with rectangle
   * @param {Object} stroke - Stroke object
   * @param {Object} rect - Rectangle with left, top, right, bottom
   * @returns {boolean} True if intersects
   */
  strokeIntersectsBox(stroke, rect) {
    const bounds = this.getStrokeBounds(stroke);
    
    return !(bounds.right < rect.left || 
             bounds.left > rect.right ||
             bounds.bottom < rect.top ||
             bounds.top > rect.bottom);
  }
  
  /**
   * Find all stroke indices that intersect with a rectangle
   * @param {Array} strokes - Array of stroke objects
   * @param {Object} rect - Rectangle with left, top, right, bottom
   * @returns {number[]} Array of intersecting stroke indices
   */
  findStrokesInRect(strokes, rect) {
    return strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => this.strokeIntersectsBox(stroke, rect))
      .map(({ index }) => index);
  }
  
  /**
   * Hit test to find stroke at coordinates
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @param {Array} strokes - Array of strokes to test against
   * @returns {number} Index of hit stroke, or -1 if none
   */
  hitTest(x, y, strokes) {
    const hitRadius = 10 / this.zoom; // Adjust for zoom level
    
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      const dots = stroke.dotArray || stroke.dots || [];
      const pageInfo = stroke.pageInfo;
      
      for (const dot of dots) {
        const screenDot = this.ncodeToScreen(dot, pageInfo);
        const dx = screenDot.x - x;
        const dy = screenDot.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= hitRadius) {
          return i;
        }
      }
    }

    return -1;
  }

  /* ---------------------------------------------------------------
   *  Point editing
   *
   *  In "Edit Points" mode the individual captured dots of the selected strokes
   *  are drawn as handles so a single bad sample (typically one at the Ncode
   *  origin, which draws a line out to the page corner) can be picked off
   *  without discarding the stroke.
   *
   *  Handle geometry is screen-space and zoom-independent, unlike stroke
   *  hit-testing above: at fit-to-page zoom a stroke's dots are a pixel or two
   *  apart, and a hit radius that shrank with zoom would be unclickable exactly
   *  when the user is looking for the stray.
   * --------------------------------------------------------------- */

  /**
   * Is this stroke's page currently shown? The stroke selection survives a change
   * of page filter, so without this a selected stroke on a now-hidden page would
   * contribute handles floating over an unrelated page — and be clickable there.
   * @param {Object|null} pageInfo
   * @returns {boolean}
   */
  isPageVisible(pageInfo) {
    if (!this.visiblePageKeys) return true;
    if (!pageInfo) return true;
    const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
    return this.visiblePageKeys.has(pageKey);
  }

  /**
   * Draw point handles for the strokes open for point editing.
   *
   * Ordinary points are hollow; detected strays are filled amber; points picked
   * for deletion are filled red and drawn last so they sit on top of their
   * neighbours in a dense cluster.
   *
   * @param {Array<{strokeIndex:number, stroke:Object}>} entries
   * @param {Set<string>} [selectedKeys] - "strokeIndex:pointIndex"
   * @param {Set<string>} [strayKeys]
   * @returns {number} handles actually drawn (off-screen ones are skipped)
   */
  drawPointHandles(entries, selectedKeys = new Set(), strayKeys = new Set()) {
    if (!entries || entries.length === 0) return 0;

    const ctx = this.ctx;
    const margin = this.pointHandleRadius + 2;
    const plain = [];
    const stray = [];
    const chosen = [];

    for (const { strokeIndex, stroke } of entries) {
      const dots = stroke.dotArray || stroke.dots || [];
      const pageInfo = stroke.pageInfo;
      if (!this.isPageVisible(pageInfo)) continue;
      for (let i = 0; i < dots.length; i++) {
        const s = this.ncodeToScreen(dots[i], pageInfo);
        if (s.x < -margin || s.x > this.viewWidth + margin) continue;
        if (s.y < -margin || s.y > this.viewHeight + margin) continue;

        const key = `${strokeIndex}:${i}`;
        if (selectedKeys.has(key)) chosen.push(s);
        else if (strayKeys.has(key)) stray.push(s);
        else plain.push(s);
      }
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    const paint = (points, fill, ring, radius) => {
      if (points.length === 0) return;
      ctx.fillStyle = fill;
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1.25;
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    paint(plain, 'rgba(255, 255, 255, 0.9)', '#2563eb', this.pointHandleRadius);
    paint(stray, '#f59e0b', '#7c2d12', this.pointHandleRadius + 1.5);
    paint(chosen, '#e94560', '#ffffff', this.pointHandleRadius + 2);

    return plain.length + stray.length + chosen.length;
  }

  /**
   * Find the point handle nearest a screen position, within the hit radius.
   * @param {number} x
   * @param {number} y
   * @param {Array<{strokeIndex:number, stroke:Object}>} entries
   * @returns {{strokeIndex:number, pointIndex:number, distance:number}|null}
   */
  hitTestPointHandle(x, y, entries) {
    if (!entries || entries.length === 0) return null;

    // Nearest wins rather than first: in a dense cluster several handles overlap
    // the cursor, and picking the closest is what the user means.
    let best = null;
    const limit = this.pointHandleHitRadius;

    for (const { strokeIndex, stroke } of entries) {
      const dots = stroke.dotArray || stroke.dots || [];
      const pageInfo = stroke.pageInfo;
      if (!this.isPageVisible(pageInfo)) continue;
      for (let i = 0; i < dots.length; i++) {
        const s = this.ncodeToScreen(dots[i], pageInfo);
        const dx = s.x - x;
        const dy = s.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= limit && (!best || distance < best.distance)) {
          best = { strokeIndex, pointIndex: i, distance };
        }
      }
    }

    return best;
  }

  /**
   * All point handles inside a screen rectangle (box-select in point-edit mode).
   * @param {Array<{strokeIndex:number, stroke:Object}>} entries
   * @param {{left:number, top:number, right:number, bottom:number}} rect
   * @returns {Array<{strokeIndex:number, pointIndex:number}>}
   */
  findPointHandlesInRect(entries, rect) {
    const found = [];
    if (!entries || entries.length === 0) return found;

    for (const { strokeIndex, stroke } of entries) {
      const dots = stroke.dotArray || stroke.dots || [];
      const pageInfo = stroke.pageInfo;
      if (!this.isPageVisible(pageInfo)) continue;
      for (let i = 0; i < dots.length; i++) {
        const s = this.ncodeToScreen(dots[i], pageInfo);
        if (s.x >= rect.left && s.x <= rect.right && s.y >= rect.top && s.y <= rect.bottom) {
          found.push({ strokeIndex, pointIndex: i });
        }
      }
    }

    return found;
  }

  /**
   * Pan so an Ncode point sits at the centre of the viewport, leaving zoom alone.
   * Used by the point-edit panel to jump to a listed stray point.
   * Does NOT redraw — the caller triggers the render.
   * @param {{x:number, y:number}} dot
   * @param {Object|null} pageInfo
   */
  centerOnPoint(dot, pageInfo = null) {
    if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) return;
    const s = this.ncodeToScreen(dot, pageInfo);
    this.panX += this.viewWidth / 2 - s.x;
    this.panY += this.viewHeight / 2 - s.y;
  }

  /**
   * Bring a whole page to the middle of the view, leaving zoom alone.
   *
   * Works off the laid-out page rect rather than a dot, so it lands on the page
   * the user picked even when that page has no strokes near its centre.
   *
   * @param {string} pageKey - Page identifier, e.g. "S3/O1012/B388/P42"
   * @returns {boolean} false when the page has no layout offset yet
   */
  centerOnPage(pageKey) {
    const rect = this.getPageBoundsScreen(pageKey);
    if (!rect) return false;
    this.panX += this.viewWidth / 2 - (rect.left + rect.width / 2);
    this.panY += this.viewHeight / 2 - (rect.top + rect.height / 2);
    return true;
  }

  /**
   * Set which page keys should be visible (for filtering borders)
   * @param {Set|null} pageKeys - Set of visible page keys, or null for all
   */
  setVisiblePageKeys(pageKeys) {
    this.visiblePageKeys = pageKeys;
  }
  
  /**
   * Set page scale factors from store
   * @param {Object} scales - Map of pageKey -> scale factor
   */
  setPageScales(scales) {
    this.pageScales = scales || {};
  }
  
  /**
   * Set temporary page scale (for drag preview)
   * @param {string} pageKey - Page identifier
   * @param {number} scale - Temporary scale factor
   */
  setTempPageScale(pageKey, scale) {
    this.tempPageScales[pageKey] = scale;
  }
  
  /**
   * Clear all temporary page scales
   */
  clearTempPageScale() {
    this.tempPageScales = {};
  }
  
  /**
   * Get effective scale for a page (temp overrides permanent)
   * @param {string} pageKey - Page identifier
   * @returns {number} Scale factor (default: 1.0)
   */
  getEffectiveScale(pageKey) {
    return this.tempPageScales[pageKey] || this.pageScales[pageKey] || 1.0;
  }
  
  /**
   * Get color index for a book ID (consistent across pages)
   * @param {string} bookId - Book ID (e.g., "123")
   * @returns {number} Color index
   */
  getBookColorIndex(bookId) {
    // Simple hash of book ID to get consistent color
    let hash = 0;
    const str = String(bookId);
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % this.pageColors.length;
  }
  
  /**
   * Set pending changes map (for showing unsaved indicators)
   * @param {Map} changes - Map of pageKey -> change info
   */
  setPendingChanges(changes) {
    this.pendingChanges = changes;
  }
  
  /**
   * Draw page borders and labels (above the border)
   * Only draws borders for pages that are currently visible
   */
  drawPageBorders() {
    if (!this.showPageBackgrounds || this.pageOffsets.size === 0) return;
    
    this.pageOffsets.forEach((offset, pageKey) => {
      // Skip if page is not visible (filtered out)
      if (this.visiblePageKeys && !this.visiblePageKeys.has(pageKey)) {
        return;
      }
      const { offsetX, offsetY, bounds } = offset;
      
      // Get per-page scale factor
      const pageScale = this.getEffectiveScale(pageKey);
      
      // Calculate screen coordinates for page bounds (with per-page scale)
      const left = offsetX * this.scale * pageScale * this.zoom + this.panX;
      const top = offsetY * this.scale * pageScale * this.zoom + this.panY;
      const width = (bounds.maxX - bounds.minX) * this.scale * pageScale * this.zoom;
      const height = (bounds.maxY - bounds.minY) * this.scale * pageScale * this.zoom;
      
      // Extract the book KEY from pageKey (format: S#/O#/B<key>/P#).
      // Unanchored `/B(\d+)/` would partially match "B388" inside "B388v2" and
      // return a plausible-but-wrong 388 — worse than no match at all.
      const bookMatch = pageKey.match(BOOK_IN_KEY_RE);
      const bookId = bookMatch ? bookMatch[1] : '0';
      
      // Get color based on book ID (consistent across all pages in the book)
      const colorIndex = this.getBookColorIndex(bookId);
      const baseColor = this.pageColors[colorIndex];
      
      // Parse RGB from rgba string
      const match = baseColor.match(/rgba\(([^,]+),([^,]+),([^,]+),/);
      let borderColor = 'rgba(200, 200, 200, 0.5)'; // Default gray
      if (match) {
        const r = match[1].trim();
        const g = match[2].trim();
        const b = match[3].trim();
        // Use color at full opacity for border
        borderColor = `rgba(${r},${g},${b},0.8)`;
      }
      
      // Draw border (no fill)
      this.ctx.strokeStyle = borderColor;
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(left, top, width, height);
      
      // Draw page label ABOVE the border
      const fontSize = Math.max(11, 13 * this.zoom);
      this.ctx.font = `600 ${fontSize}px 'Segoe UI', sans-serif`;
      this.ctx.fillStyle = borderColor; // Match border color
      
      // Extract book key and page from pageKey (format: S#/O#/B<key>/P#)
      const parts = pageKey.match(BOOK_PAGE_IN_KEY_RE);
      if (parts) {
        const book = parts[1];
        const page = parts[2];
        // Volume 2+ shows its volume, or two same-numbered pages from different
        // physical notebooks are indistinguishable side by side. Volume 1 renders
        // exactly as before.
        const badge = volumeBadge(book);
        const ncode = badge ? ncodeBookOf(book) : book;
        let label = badge ? `B${ncode} ${badge} / P${page}` : `B${book} / P${page}`;

        // In date order the notebook is no longer what places a page, so the
        // label has to say which day put it here — rows break on a change of
        // day, but a row on its own doesn't name the day it belongs to.
        if (this.pageOrderMode === 'date') {
          const captured = this.pageFirstCapture.get(pageKey);
          if (captured !== undefined) {
            const d = new Date(captured);
            if (!Number.isNaN(d.getTime())) {
              label = `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${label}`;
            }
          }
        }

        // Check if this page has pending changes (unsaved strokes)
        const hasUnsavedChanges = this.pendingChanges && this.pendingChanges.has(`B${book}/P${page}`);
        const pageChanges = hasUnsavedChanges ? this.pendingChanges.get(`B${book}/P${page}`) : null;
        // Unsaved strokes, a stored stroke whose sketch flag was toggled, or one
        // whose points were edited — all three are lost unless the page is
        // saved, so all three earn the asterisks.
        const hasUnsavedStrokeWork = !!pageChanges && (
          (pageChanges.additions && pageChanges.additions.length > 0) ||
          (pageChanges.edits && pageChanges.edits.length > 0) ||
          (pageChanges.modifications && pageChanges.modifications.length > 0) ||
          // Strokes this page still owes a deletion for, having been reassigned
          // to another volume. They're drawn on the target page now, so without
          // this the source page shows no sign of the pending work.
          (pageChanges.moves && pageChanges.moves.length > 0)
        );

        if (hasUnsavedStrokeWork) {
          label = `* ${label} *`;
        }
        
        // Add scale percentage if not 1.0
        if (pageScale !== 1.0) {
          const scalePercent = Math.round(pageScale * 100);
          label += ` (${scalePercent}%)`;
        }
        
        // Position label above the top border with some padding
        const labelY = top - 6;
        this.ctx.fillText(label, left + 4, labelY);
      }
      
    });
    
    // Draw corner handles if enabled
    if (this.showCornerHandles) {
      this.drawCornerHandles();
    }
  }
  
  /**
   * Draw corner handles for all visible pages
   * Only shows bottom-right corner (top-left is anchor)
   */
  drawCornerHandles() {
    // Clear previous handle data
    this.cornerHandles.clear();
    
    this.pageOffsets.forEach((offset, pageKey) => {
      // Skip if page is not visible (filtered out)
      if (this.visiblePageKeys && !this.visiblePageKeys.has(pageKey)) {
        return;
      }
      
      const bounds = this.getPageBoundsScreen(pageKey);
      if (!bounds) return;
      
      const { left, top, width, height } = bounds;
      
      // Extract book ID for color matching
      const bookMatch = pageKey.match(BOOK_IN_KEY_RE);
      const bookId = bookMatch ? bookMatch[1] : '0';
      const colorIndex = this.getBookColorIndex(bookId);
      const baseColor = this.pageColors[colorIndex];
      
      // Parse RGB from base color for handle
      const match = baseColor.match(/rgba\(([^,]+),([^,]+),([^,]+),/);
      let handleColor = 'rgba(233, 69, 96, 0.9)'; // Default red
      if (match) {
        const r = match[1].trim();
        const g = match[2].trim();
        const b = match[3].trim();
        handleColor = `rgba(${r},${g},${b},0.9)`;
      }
      
      // Only bottom-right corner (SE) - top-left is anchor
      const corner = {
        x: left + width,
        y: top + height,
        corner: 'se',
        cursor: 'nwse-resize'
      };
      
      // Draw corner handle
      const handleRadius = this.handleSize / 2;
      this.ctx.fillStyle = handleColor;
      this.ctx.strokeStyle = 'white';
      this.ctx.lineWidth = 2;
      
      this.ctx.beginPath();
      this.ctx.arc(corner.x, corner.y, handleRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      
      // Store handle data for hit testing
      this.cornerHandles.set(pageKey, [{
        x: corner.x,
        y: corner.y,
        corner: corner.corner,
        cursor: corner.cursor,
        radius: handleRadius + 2 // Slightly larger hit area
      }]);
    });
  }
  
  /**
   * Hit test to find corner handle at coordinates
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {Object|null} {pageKey, corner, handle, cursor} if hit, null otherwise
   */
  hitTestCorner(x, y) {
    if (!this.cornerHandles || this.cornerHandles.size === 0) return null;
    
    // Check in reverse order (top pages first)
    const entries = Array.from(this.cornerHandles.entries());
    for (let i = entries.length - 1; i >= 0; i--) {
      const [pageKey, handles] = entries[i];
      
      for (const handle of handles) {
        const dx = x - handle.x;
        const dy = y - handle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= handle.radius) {
          return {
            pageKey,
            corner: handle.corner,
            handle,
            cursor: handle.cursor
          };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Find page at screen coordinates (for hover tooltip)
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {string|null} Page key or null
   */
  getPageAtPosition(x, y) {
    if (this.pageOffsets.size === 0) return null;
    
    for (const [pageKey, offset] of this.pageOffsets) {
      const { offsetX, offsetY, bounds } = offset;
      
      const left = offsetX * this.scale * this.zoom + this.panX;
      const top = offsetY * this.scale * this.zoom + this.panY;
      const width = (bounds.maxX - bounds.minX) * this.scale * this.zoom;
      const height = (bounds.maxY - bounds.minY) * this.scale * this.zoom;
      
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        return pageKey;
      }
    }
    
    return null;
  }
  
  /**
   * Check if click is on a page header/label area (draggable region)
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {string|null} Page key if clicking on header, null otherwise
   */
  hitTestPageHeader(x, y) {
    if (this.pageOffsets.size === 0) return null;
    
    for (const [pageKey, offset] of this.pageOffsets) {
      const { offsetX, offsetY, bounds } = offset;
      const pageScale = this.getEffectiveScale(pageKey);
      
      const left = offsetX * this.scale * pageScale * this.zoom + this.panX;
      const top = offsetY * this.scale * pageScale * this.zoom + this.panY;
      const width = (bounds.maxX - bounds.minX) * this.scale * pageScale * this.zoom;
      
      // Draggable region is ONLY the label area above the border
      // Label is drawn at top - 6, so check from top - 28 to top + 2
      // This gives ~30px height for the label only, not extending into strokes
      if (x >= left && x <= left + width && y >= top - 28 && y <= top + 2) {
        return pageKey;
      }
    }
    
    return null;
  }
  
  /**
   * Apply custom positions from store to page offsets
   * @param {Object} customPositions - Map of pageKey -> {x, y} positions
   */
  applyCustomPositions(customPositions) {
    if (!customPositions || Object.keys(customPositions).length === 0) return;
    
    this.pageOffsets.forEach((offset, pageKey) => {
      const customPos = customPositions[pageKey];
      if (customPos) {
        // Apply custom offset (these are in Ncode space, already accounted for in calculation)
        offset.offsetX = customPos.x;
        offset.offsetY = customPos.y;
      }
    });
    
    // Recalculate global bounds based on custom positions
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    
    this.pageOffsets.forEach((offset) => {
      const { offsetX, offsetY, bounds } = offset;
      const pageWidth = bounds.maxX - bounds.minX;
      const pageHeight = bounds.maxY - bounds.minY;
      
      this.bounds.minX = Math.min(this.bounds.minX, offsetX);
      this.bounds.minY = Math.min(this.bounds.minY, offsetY);
      this.bounds.maxX = Math.max(this.bounds.maxX, offsetX + pageWidth);
      this.bounds.maxY = Math.max(this.bounds.maxY, offsetY + pageHeight);
    });
  }
  
  /**
   * Get page bounds in screen coordinates (accounting for per-page scale)
   * @param {string} pageKey - Page identifier
   * @returns {Object|null} Object with {left, top, right, bottom, width, height}
   */
  getPageBoundsScreen(pageKey) {
    const offset = this.pageOffsets.get(pageKey);
    if (!offset) return null;
    
    const pageScale = this.getEffectiveScale(pageKey);
    const { offsetX, offsetY, bounds } = offset;
    const left = offsetX * this.scale * pageScale * this.zoom + this.panX;
    const top = offsetY * this.scale * pageScale * this.zoom + this.panY;
    const width = (bounds.maxX - bounds.minX) * this.scale * pageScale * this.zoom;
    const height = (bounds.maxY - bounds.minY) * this.scale * pageScale * this.zoom;
    
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height
    };
  }
  
  /**
   * Draw transcribed text within a page's boundaries
   * @param {string} pageKey - Page identifier
   * @param {string} text - Transcribed text to render
   * @param {string} [highlight] - term to mark wherever it appears in the text
   */
  drawPageText(pageKey, text, highlight = '') {
    const pageBounds = this.getPageBoundsScreen(pageKey);
    if (!pageBounds) return;
    
    const { left, top, width, height } = pageBounds;
    
    // Start with default sizing
    let fontSize = Math.max(3, 4 * this.zoom);
    let lineHeight = 5 * this.zoom;
    let padding = 4 * this.zoom;
    
    // Helper function to calculate wrapped lines
    const calculateWrappedLines = (text, fontSize, maxWidth) => {
      this.ctx.font = `${fontSize}px 'Courier New', monospace`;
      const lines = text.split('\n');
      const wrappedLines = [];
      
      lines.forEach(line => {
        if (line.trim() === '') {
          wrappedLines.push('');
          return;
        }
        
        const metrics = this.ctx.measureText(line);
        
        if (metrics.width <= maxWidth) {
          wrappedLines.push(line);
        } else {
          // Wrap line by words
          const words = line.split(' ');
          let currentLine = '';
          
          words.forEach(word => {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const testMetrics = this.ctx.measureText(testLine);
            
            if (testMetrics.width <= maxWidth) {
              currentLine = testLine;
            } else {
              if (currentLine) wrappedLines.push(currentLine);
              currentLine = word;
            }
          });
          
          if (currentLine) wrappedLines.push(currentLine);
        }
      });
      
      return wrappedLines;
    };
    
    // Calculate if text fits with current sizing
    const maxWidth = width - (padding * 2);
    let wrappedLines = calculateWrappedLines(text, fontSize, maxWidth);
    let requiredHeight = wrappedLines.length * lineHeight + (padding * 2);
    
    // If text doesn't fit, scale down until it does (or hit minimum)
    const minFontSize = Math.max(2, 2 * this.zoom);
    while (requiredHeight > height && fontSize > minFontSize) {
      // Scale down by 0.5px
      fontSize = Math.max(minFontSize, fontSize - 0.5);
      lineHeight = fontSize * 1.25; // Maintain proportional line height
      padding = fontSize; // Adjust padding proportionally
      
      // Recalculate
      const newMaxWidth = width - (padding * 2);
      wrappedLines = calculateWrappedLines(text, fontSize, newMaxWidth);
      requiredHeight = wrappedLines.length * lineHeight + (padding * 2);
    }
    
    // Set final text styling
    this.ctx.font = `${fontSize}px 'Courier New', monospace`;
    this.ctx.textBaseline = 'top';

    // Draw wrapped lines
    let y = top + padding;
    const maxY = top + height - padding;
    const needle = (highlight || '').trim().toLowerCase();

    for (const line of wrappedLines) {
      if (y + lineHeight > maxY) {
        // Draw ellipsis if text still doesn't fit (shouldn't happen often now)
        this.ctx.fillStyle = '#000000';
        this.ctx.fillText('...', left + padding, y);
        break;
      }

      // Highlight rects go down first so the glyphs sit on top of them. Word
      // wrapping happens above, so a match spanning a wrap boundary shows on
      // the line that holds it — searching for a phrase that breaks across
      // lines finds the page but marks nothing, which is the honest result.
      if (needle) {
        this.drawTextHighlights(line, needle, left + padding, y, lineHeight);
      }

      this.ctx.fillStyle = '#000000';
      this.ctx.fillText(line, left + padding, y);
      y += lineHeight;
    }
  }

  /**
   * Paint highlight rectangles behind every occurrence of `needle` in one
   * already-wrapped line of page text.
   *
   * Assumes `ctx.font` is the font the line will be drawn with — offsets come
   * from measuring the text before each match, so any mismatch misaligns them.
   *
   * @param {string} line - the rendered line
   * @param {string} needle - lower-cased search term
   * @param {number} x - left edge the line is drawn at
   * @param {number} y - top edge the line is drawn at
   * @param {number} lineHeight
   */
  drawTextHighlights(line, needle, x, y, lineHeight) {
    const haystack = line.toLowerCase();
    let from = 0;
    let at = haystack.indexOf(needle, from);
    if (at === -1) return;

    const prev = this.ctx.fillStyle;
    // Amber, matching the search result snippets and the stray-point handles.
    this.ctx.fillStyle = 'rgba(251, 191, 36, 0.55)';

    while (at !== -1) {
      const before = this.ctx.measureText(line.slice(0, at)).width;
      const matchWidth = this.ctx.measureText(line.slice(at, at + needle.length)).width;
      this.ctx.fillRect(x + before, y - lineHeight * 0.08, matchWidth, lineHeight * 0.96);

      from = at + needle.length;
      at = haystack.indexOf(needle, from);
    }

    this.ctx.fillStyle = prev;
  }
  
  /**
   * Redraw all strokes (called after clear or zoom change)
   */
  redraw() {
    this.clearForRedraw();
    
    // Draw page borders first
    this.drawPageBorders();
    
    // Draw grid for reference at high zoom levels
    if (this.zoom >= 2) {
      this.drawGrid();
    }
    
    // Internal strokes array is used for real-time drawing
    // Store strokes are drawn via drawStroke() from the component
    this.strokes.forEach(stroke => {
      this.drawStrokeInternal(stroke, '#000000');
    });
  }
  
  /**
   * Draw internal stroke (the in-progress live-capture buffer, not store strokes)
   * @param {Object} stroke - { dots: [{x, y, f}] }
   * @param {string} [color]
   * @param {number} [width] - screen px; uniform for the whole stroke
   */
  drawStrokeInternal(stroke, color = '#000000', width = null) {
    if (!stroke.dots || stroke.dots.length < 2) return;

    this.ctx.strokeStyle = color;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash([]);

    const { xs, ys } = this.projectDots(stroke.dots, null);
    // Uniform, for the same reason as addDot(): this is live capture, which has
    // no sketch flag to consult yet.
    const px = width == null ? this.handwritingWidth * this.zoom : width;
    this.strokeRun(xs, ys, 0, stroke.dots.length - 1, Math.max(0.5, px));
  }
  
  /**
   * Draw reference grid
   */
  drawGrid() {
    const gridSize = 10 * this.scale * this.zoom;
    
    this.ctx.strokeStyle = '#f0f0f0';
    this.ctx.lineWidth = 1;
    
    const startX = this.panX % gridSize;
    for (let x = startX; x < this.viewWidth; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.viewHeight);
      this.ctx.stroke();
    }
    
    const startY = this.panY % gridSize;
    for (let y = startY; y < this.viewHeight; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.viewWidth, y);
      this.ctx.stroke();
    }
  }
  
  /**
   * Export strokes as SVG
   * @param {Array} strokes - Strokes to export (from store)
   * @param {number} strokeWidth - SVG stroke width (default 0.5)
   */
  exportSVG(strokes = [], strokeWidth = 0.5) {
    const allStrokes = strokes.length > 0 ? strokes : this.strokes;

    if (allStrokes.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    }

    // Calculate bounds from provided strokes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    allStrokes.forEach(stroke => {
      const dots = stroke.dotArray || stroke.dots || [];
      dots.forEach(dot => {
        minX = Math.min(minX, dot.x);
        minY = Math.min(minY, dot.y);
        maxX = Math.max(maxX, dot.x);
        maxY = Math.max(maxY, dot.y);
      });
    });

    const padding = 10;
    const width = (maxX - minX) * this.scale + padding * 2;
    const height = (maxY - minY) * this.scale + padding * 2;

    let paths = '';

    allStrokes.forEach((stroke, index) => {
      const dots = stroke.dotArray || stroke.dots || [];
      if (dots.length < 2) return;

      const px = (dot) => ((dot.x - minX) * this.scale + padding).toFixed(2);
      const py = (dot) => ((dot.y - minY) * this.scale + padding).toFixed(2);

      if (stroke.sketch) {
        // A single <path> carries one stroke-width, so a pressure-varying line is
        // emitted as consecutive constant-width runs sharing their end vertices.
        // The requested `strokeWidth` is treated as a multiplier here: the shape of
        // the taper comes from the sketch profile, and the export dialog's slider
        // still scales the whole drawing up or down.
        const widthsMm = this.sketchWidths(stroke);
        const quantum = 0.05;
        const widthAt = (segment) => {
          const mm = (widthsMm[segment] + widthsMm[segment + 1]) / 2;
          const units = mm * this.scale * (strokeWidth / 0.5);
          return Math.max(quantum, Math.round(units / quantum) * quantum);
        };

        const emit = (a, b, width) => {
          let d = `M ${px(dots[a])} ${py(dots[a])}`;
          for (let i = a + 1; i <= b; i++) d += ` L ${px(dots[i])} ${py(dots[i])}`;
          paths += `  <path
    d="${d}"
    stroke="black"
    stroke-width="${Math.round(width * 1000) / 1000}"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    data-stroke-index="${index}"
    data-sketch="true"
  />\n`;
        };

        const segmentCount = dots.length - 1;
        let runStart = 0;
        let runWidth = widthAt(0);
        for (let i = 1; i < segmentCount; i++) {
          const w = widthAt(i);
          if (w !== runWidth) {
            emit(runStart, i, runWidth);
            runStart = i;
            runWidth = w;
          }
        }
        emit(runStart, segmentCount, runWidth);
        return;
      }

      const d = dots.map((dot, i) => `${i === 0 ? 'M' : 'L'} ${px(dot)} ${py(dot)}`).join(' ');

      paths += `  <path
    d="${d}"
    stroke="black"
    stroke-width="${strokeWidth}"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    data-stroke-index="${index}"
    data-dot-count="${dots.length}"
  />\n`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}"
  width="${width.toFixed(2)}mm"
  height="${height.toFixed(2)}mm"
  data-source="neosmartpen"
  data-stroke-count="${allStrokes.length}"
>
${paths}</svg>`;
  }
  
  /**
   * Get current zoom level
   */
  getZoom() {
    return this.zoom;
  }
}
