/**
 * Canvas Renderer
 * Handles drawing strokes to canvas and exporting SVG
 * Now with zoom and pan support
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
    this.isPanning = false;
    this.lastPanX = 0;
    this.lastPanY = 0;
    
    // Bounds tracking for SVG export
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    
    this.resize();
    this.clear();
    this.setupInteraction();
  }
  
  /**
   * Setup mouse/touch interaction for pan and zoom
   */
  setupInteraction() {
    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Zoom factor
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
      
      if (newZoom !== this.zoom) {
        // Adjust pan to zoom toward mouse position
        const zoomRatio = newZoom / this.zoom;
        this.panX = mouseX - (mouseX - this.panX) * zoomRatio;
        this.panY = mouseY - (mouseY - this.panY) * zoomRatio;
        this.zoom = newZoom;
        this.redraw();
        this.updateZoomDisplay();
      }
    }, { passive: false });
    
    // Pan with middle mouse or shift+left click
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        this.canvas.style.cursor = 'grabbing';
      }
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.lastPanX;
        const dy = e.clientY - this.lastPanY;
        this.panX += dx;
        this.panY += dy;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        this.redraw();
      }
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    });
    
    // Prevent context menu on middle click
    this.canvas.addEventListener('contextmenu', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }
  
  /**
   * Update zoom display in UI
   */
  updateZoomDisplay() {
    const zoomDisplay = document.getElementById('zoomLevel');
    if (zoomDisplay) {
      zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }
  
  /**
   * Set zoom level programmatically
   */
  setZoom(level) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    if (newZoom !== this.zoom) {
      // Zoom toward center
      const centerX = this.viewWidth / 2;
      const centerY = this.viewHeight / 2;
      const zoomRatio = newZoom / this.zoom;
      this.panX = centerX - (centerX - this.panX) * zoomRatio;
      this.panY = centerY - (centerY - this.panY) * zoomRatio;
      this.zoom = newZoom;
      this.redraw();
      this.updateZoomDisplay();
    }
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
   * Reset zoom and pan to fit content
   */
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.redraw();
    this.updateZoomDisplay();
  }
  
  /**
   * Fit all content in view
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
    
    const scaleX = availWidth / contentWidth;
    const scaleY = availHeight / contentHeight;
    this.zoom = Math.min(scaleX, scaleY, this.maxZoom);
    
    // Center content
    this.panX = (this.viewWidth - contentWidth * this.zoom) / 2;
    this.panY = (this.viewHeight - contentHeight * this.zoom) / 2;
    
    this.redraw();
    this.updateZoomDisplay();
  }
  
  resize() {
    const container = this.canvas.parentElement;
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
    
    // Redraw all strokes
    this.redraw();
  }
  
  clear() {
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    this.strokes = [];
    this.currentStroke = null;
    this.bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateZoomDisplay();
  }
  
  /**
   * Add a dot from the pen
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
          // Pressure-based width, scaled with zoom
          this.ctx.lineWidth = Math.max(0.5, (dot.f / 500) * 2 * this.zoom);
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.stroke();
          
          // Continue path for next segment
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
    // Base position from Ncode coordinates
    let x, y;
    
    if (this.bounds.minX === Infinity) {
      // No bounds yet, use raw scaled position
      x = dot.x * this.scale;
      y = dot.y * this.scale;
    } else {
      // Position relative to content bounds
      x = (dot.x - this.bounds.minX) * this.scale;
      y = (dot.y - this.bounds.minY) * this.scale;
    }
    
    // Apply zoom and pan
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
      pressure: dot.f
    };
  }
  
  /**
   * Redraw all strokes (after resize, zoom, or filter change)
   */
  redraw() {
    // Clear canvas
    this.ctx.fillStyle = 'white';
    this.ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    
    // Draw grid for reference at high zoom levels
    if (this.zoom >= 2) {
      this.drawGrid();
    }
    
    // Draw all strokes
    this.strokes.forEach((stroke, index) => {
      this.drawStroke(stroke, '#000000', Math.max(1, 2 * this.zoom));
    });
  }
  
  /**
   * Draw a reference grid
   */
  drawGrid() {
    const gridSize = 10 * this.scale * this.zoom; // 10mm grid
    
    this.ctx.strokeStyle = '#f0f0f0';
    this.ctx.lineWidth = 1;
    
    // Vertical lines
    const startX = this.panX % gridSize;
    for (let x = startX; x < this.viewWidth; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.viewHeight);
      this.ctx.stroke();
    }
    
    // Horizontal lines
    const startY = this.panY % gridSize;
    for (let y = startY; y < this.viewHeight; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.viewWidth, y);
      this.ctx.stroke();
    }
  }
  
  /**
   * Draw a single stroke
   */
  drawStroke(stroke, color = '#000000', baseWidth = 2) {
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
      
      // Vary line width based on pressure
      this.ctx.lineWidth = Math.max(0.5, (dot.f / 500) * baseWidth);
      
      this.ctx.lineTo(screenDot.x, screenDot.y);
    }
    
    this.ctx.stroke();
  }
  
  /**
   * Highlight a specific stroke
   */
  highlightStroke(index) {
    this.redraw();
    
    if (index >= 0 && index < this.strokes.length) {
      const stroke = this.strokes[index];
      this.drawStroke(stroke, '#e94560', Math.max(2, 4 * this.zoom));
    }
  }
  
  /**
   * Export strokes as SVG
   * Preserves original ncode coordinates for analysis
   */
  exportSVG() {
    if (this.strokes.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    }
    
    // Calculate viewBox from bounds
    const padding = 10;
    const width = (this.bounds.maxX - this.bounds.minX) * this.scale + padding * 2;
    const height = (this.bounds.maxY - this.bounds.minY) * this.scale + padding * 2;
    
    let paths = '';
    
    this.strokes.forEach((stroke, index) => {
      if (!stroke.dots || stroke.dots.length < 2) return;
      
      let d = stroke.dots.map((dot, i) => {
        const x = (dot.x - this.bounds.minX) * this.scale + padding;
        const y = (dot.y - this.bounds.minY) * this.scale + padding;
        return i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }).join(' ');
      
      // Include stroke metadata as data attributes
      paths += `  <path 
    d="${d}" 
    stroke="black" 
    stroke-width="2" 
    fill="none" 
    stroke-linecap="round" 
    stroke-linejoin="round"
    data-stroke-index="${index}"
    data-dot-count="${stroke.dots.length}"
  />\n`;
    });
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg 
  xmlns="http://www.w3.org/2000/svg" 
  viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}"
  width="${width.toFixed(2)}mm"
  height="${height.toFixed(2)}mm"
  data-source="neosmartpen"
  data-stroke-count="${this.strokes.length}"
  data-bounds='${JSON.stringify({
    minX: this.bounds.minX,
    minY: this.bounds.minY,
    maxX: this.bounds.maxX,
    maxY: this.bounds.maxY
  })}'
>
${paths}</svg>`;
  }
  
  /**
   * Export raw coordinate data as JSON
   */
  exportJSON() {
    return JSON.stringify({
      bounds: this.bounds,
      scale: this.scale,
      strokes: this.strokes.map(stroke => ({
        dots: stroke.dots,
        color: stroke.color,
        width: stroke.width
      }))
    }, null, 2);
  }
  
  /**
   * Get current zoom level
   */
  getZoom() {
    return this.zoom;
  }
}
