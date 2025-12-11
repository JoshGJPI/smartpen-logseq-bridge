/**
 * Canvas Renderer (Svelte-adapted)
 * Handles drawing strokes to canvas and exporting SVG
 * Zoom and pan are managed externally by Svelte stores
 */

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = []; // Array of stroke paths for SVG export
    this.currentStroke = null;
    this.scale = 2.371; // Ncode to mm conversion
    
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
    
    this.viewWidth = 0;
    this.viewHeight = 0;
    
    this.resize();
    this.clear();
  }
  
  /**
   * Set zoom level
   * @param {number} level - Zoom level
   * @returns {boolean} - Whether zoom changed
   */
  setZoom(level) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    if (newZoom !== this.zoom) {
      const centerX = this.viewWidth / 2;
      const centerY = this.viewHeight / 2;
      const zoomRatio = newZoom / this.zoom;
      this.panX = centerX - (centerX - this.panX) * zoomRatio;
      this.panY = centerY - (centerY - this.panY) * zoomRatio;
      this.zoom = newZoom;
      // Don't call redraw here - let the component handle re-rendering
      // This ensures store strokes are also redrawn
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
    
    // Center the content in the viewport
    // The content's top-left in screen space would be at (0,0) after ncodeToScreen subtracts bounds.min
    // We need to offset so content is centered
    const scaledContentWidth = contentWidth * this.zoom;
    const scaledContentHeight = contentHeight * this.zoom;
    
    this.panX = (this.viewWidth - scaledContentWidth) / 2;
    this.panY = (this.viewHeight - scaledContentHeight) / 2;
    
    // Don't call redraw - let the component handle it
    
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
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
    }
  }
  
  /**
   * Calculate bounds from an array of strokes without drawing
   * Call this before drawStroke to ensure consistent coordinate transformation
   * @param {Array} strokes - Array of stroke objects
   */
  calculateBounds(strokes) {
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    
    strokes.forEach(stroke => {
      const dots = stroke.dotArray || stroke.dots || [];
      dots.forEach(dot => {
        this.bounds.minX = Math.min(this.bounds.minX, dot.x);
        this.bounds.minY = Math.min(this.bounds.minY, dot.y);
        this.bounds.maxX = Math.max(this.bounds.maxX, dot.x);
        this.bounds.maxY = Math.max(this.bounds.maxY, dot.y);
      });
    });
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
    
    // Convert ncode coordinates to screen coordinates
    const screenDot = this.ncodeToScreen(dot);
    
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
          this.ctx.lineWidth = Math.max(0.5, (dot.f / 500) * 2 * this.zoom);
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
   * Convert ncode coordinates to screen coordinates with zoom and pan
   */
  ncodeToScreen(dot) {
    let x, y;
    
    if (this.bounds.minX === Infinity) {
      x = dot.x * this.scale;
      y = dot.y * this.scale;
    } else {
      x = (dot.x - this.bounds.minX) * this.scale;
      y = (dot.y - this.bounds.minY) * this.scale;
    }
    
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
      pressure: dot.f
    };
  }
  
  /**
   * Draw a stroke from store data
   * @param {Object} stroke - Stroke object with dotArray
   * @param {boolean} highlighted - Whether to highlight this stroke
   */
  drawStroke(stroke, highlighted = false) {
    const dots = stroke.dotArray || stroke.dots || [];
    if (dots.length < 2) return;
    
    // Update bounds from stroke
    dots.forEach(dot => {
      this.bounds.minX = Math.min(this.bounds.minX, dot.x);
      this.bounds.minY = Math.min(this.bounds.minY, dot.y);
      this.bounds.maxX = Math.max(this.bounds.maxX, dot.x);
      this.bounds.maxY = Math.max(this.bounds.maxY, dot.y);
    });
    
    const color = highlighted ? '#e94560' : '#000000';
    const baseWidth = highlighted ? 3 : 2;
    
    this.ctx.strokeStyle = color;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    this.ctx.beginPath();
    const firstDot = dots[0];
    const firstScreen = this.ncodeToScreen(firstDot);
    this.ctx.moveTo(firstScreen.x, firstScreen.y);
    
    for (let i = 1; i < dots.length; i++) {
      const dot = dots[i];
      const screenDot = this.ncodeToScreen(dot);
      this.ctx.lineWidth = Math.max(0.5, ((dot.f || 500) / 500) * baseWidth * this.zoom);
      this.ctx.lineTo(screenDot.x, screenDot.y);
    }
    
    this.ctx.stroke();
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
      
      for (const dot of dots) {
        const screenDot = this.ncodeToScreen(dot);
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
  
  /**
   * Redraw all strokes (called after clear or zoom change)
   */
  redraw() {
    this.clearForRedraw();
    
    // Draw grid for reference at high zoom levels
    if (this.zoom >= 2) {
      this.drawGrid();
    }
    
    // Internal strokes array is used for real-time drawing
    // Store strokes are drawn via drawStroke() from the component
    this.strokes.forEach(stroke => {
      this.drawStrokeInternal(stroke, '#000000', Math.max(1, 2 * this.zoom));
    });
  }
  
  /**
   * Draw internal stroke (different from store strokes)
   */
  drawStrokeInternal(stroke, color = '#000000', baseWidth = 2) {
    if (!stroke.dots || stroke.dots.length < 2) return;
    
    this.ctx.strokeStyle = color;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    this.ctx.beginPath();
    const firstDot = stroke.dots[0];
    const firstScreen = this.ncodeToScreen(firstDot);
    this.ctx.moveTo(firstScreen.x, firstScreen.y);
    
    for (let i = 1; i < stroke.dots.length; i++) {
      const dot = stroke.dots[i];
      const screenDot = this.ncodeToScreen(dot);
      this.ctx.lineWidth = Math.max(0.5, (dot.f / 500) * baseWidth);
      this.ctx.lineTo(screenDot.x, screenDot.y);
    }
    
    this.ctx.stroke();
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
   */
  exportSVG(strokes = []) {
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
      
      let d = dots.map((dot, i) => {
        const x = (dot.x - minX) * this.scale + padding;
        const y = (dot.y - minY) * this.scale + padding;
        return i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(' ');
      
      paths += `  <path 
    d="${d}" 
    stroke="black" 
    stroke-width="2" 
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
