/**
 * UI Update Functions
 */

import { elements } from './elements.js';
import { state, modules } from './state.js';

export function updatePenStatus(connected) {
  elements.penStatus.className = `status-dot ${connected ? 'connected' : ''}`;
  elements.penStatusText.textContent = connected ? 'Connected' : 'Disconnected';
  elements.btnConnect.disabled = connected;
  elements.btnDisconnect.disabled = !connected;
  elements.btnFetchOffline.disabled = !connected;
  elements.penInfo.style.display = connected ? 'block' : 'none';
}

export function updatePenInfo(info) {
  if (!info) return;
  elements.penModel.textContent = info.DeviceName || 'Unknown';
  elements.penBattery.textContent = info.Battery === 128 ? 'Charging' : `${info.Battery}%`;
  elements.penMemory.textContent = `${info.UsedMem || 0}%`;
  elements.penMac.textContent = info.MacAddress || '-';
}

export function updateSelectionInfo() {
  const count = state.selectedStrokes.size;
  if (count === 0) {
    elements.selectionInfo.textContent = 'Click strokes to select • Ctrl+click to multi-select • Shift+click for range';
    elements.selectionInfo.style.color = 'var(--text-secondary)';
    elements.btnTranscribe.disabled = true;
  } else {
    elements.selectionInfo.textContent = `${count} stroke${count > 1 ? 's' : ''} selected • Export JSON or Transcribe`;
    elements.selectionInfo.style.color = 'var(--accent)';
    // Enable transcribe if we have MyScript credentials
    const hasCredentials = elements.myscriptAppKey.value && elements.myscriptHmacKey.value;
    elements.btnTranscribe.disabled = !hasCredentials;
  }
}

export function updateStrokeList() {
  if (state.strokes.length === 0) {
    elements.strokeList.innerHTML = `
      <p style="color: var(--text-secondary); text-align: center; padding: 20px;">
        Connect pen and write to see strokes
      </p>
    `;
    return;
  }
  
  elements.strokeList.innerHTML = state.strokes.map((stroke, index) => {
    const dotCount = stroke.dotArray?.length || stroke.Dots?.length || 0;
    const pageInfo = stroke.pageInfo || (stroke.Dots?.[0]?.pageInfo) || {};
    const isSelected = state.selectedStrokes.has(index);
    
    // Quick analysis for display
    const analysis = modules.analyzer.analyzeStroke(stroke);
    const shapeIndicator = analysis.isRectangle ? '▢' : '';
    
    return `
      <div class="stroke-item ${isSelected ? 'selected' : ''}" data-index="${index}">
        <div class="stroke-header">
          <span class="stroke-id">${shapeIndicator} Stroke #${index + 1}</span>
          <span class="stroke-dots">${dotCount} dots</span>
        </div>
        <div class="stroke-meta">
          Page: S${pageInfo.section || '-'}/O${pageInfo.owner || '-'}/B${pageInfo.book || '-'}/P${pageInfo.page || '-'}
        </div>
        <div class="stroke-meta" style="font-size: 0.7rem; margin-top: 3px;">
          Bounds: ${analysis.bounds?.width?.toFixed(1) || 0} × ${analysis.bounds?.height?.toFixed(1) || 0}
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers with modifier key support
  elements.strokeList.querySelectorAll('.stroke-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const index = parseInt(item.dataset.index);
      handleStrokeClick(index, e.ctrlKey || e.metaKey, e.shiftKey);
    });
  });
  
  elements.strokeCount.textContent = `${state.strokes.length} strokes`;
}

export function handleStrokeClick(index, ctrlKey, shiftKey) {
  if (shiftKey && state.lastSelectedIndex !== null) {
    // Range selection
    const start = Math.min(state.lastSelectedIndex, index);
    const end = Math.max(state.lastSelectedIndex, index);
    
    if (!ctrlKey) {
      state.selectedStrokes.clear();
    }
    
    for (let i = start; i <= end; i++) {
      state.selectedStrokes.add(i);
    }
  } else if (ctrlKey) {
    // Toggle selection
    if (state.selectedStrokes.has(index)) {
      state.selectedStrokes.delete(index);
    } else {
      state.selectedStrokes.add(index);
    }
  } else {
    // Single selection
    state.selectedStrokes.clear();
    state.selectedStrokes.add(index);
  }
  
  state.lastSelectedIndex = index;
  
  updateStrokeList();
  updateSelectionInfo();
  highlightSelectedStrokes();
  updateAnalysisView();
}

export function highlightSelectedStrokes() {
  if (!modules.renderer) return;
  
  modules.renderer.redraw();
  
  // Highlight all selected strokes
  state.selectedStrokes.forEach(index => {
    if (index >= 0 && index < state.strokes.length) {
      const stroke = state.strokes[index];
      modules.renderer.drawStroke({
        dots: stroke.dotArray || [],
        color: '#e94560',
        width: 2
      }, '#e94560', Math.max(2, 4 * modules.renderer.getZoom()));
    }
  });
}

export function updateAnalysisView() {
  if (state.selectedStrokes.size === 0) {
    // Show overall analysis
    const lineAnalysis = modules.analyzer.analyzeLines(state.strokes);
    elements.analysisViewer.textContent = JSON.stringify({
      summary: {
        totalStrokes: state.strokes.length,
        lineCount: lineAnalysis.lineCount,
        detectedLineHeight: lineAnalysis.detectedLineHeight?.toFixed(2),
        lines: lineAnalysis.lines
      },
      hint: 'Select strokes to see detailed analysis'
    }, null, 2);
  } else if (state.selectedStrokes.size === 1) {
    // Single stroke analysis
    const index = Array.from(state.selectedStrokes)[0];
    const stroke = state.strokes[index];
    const analysis = modules.analyzer.analyzeStroke(stroke);
    
    elements.analysisViewer.textContent = JSON.stringify({
      strokeIndex: index,
      analysis
    }, null, 2);
  } else {
    // Multiple stroke analysis
    const analyses = Array.from(state.selectedStrokes).map(index => ({
      index,
      analysis: modules.analyzer.analyzeStroke(state.strokes[index])
    }));
    
    elements.analysisViewer.textContent = JSON.stringify({
      selectedCount: state.selectedStrokes.size,
      strokes: analyses
    }, null, 2);
  }
}

export function updateJsonViewer() {
  // Show a clean representation of the data structure
  const sampleData = {
    totalStrokes: state.strokes.length,
    pages: Array.from(state.pages.keys()),
    sampleStroke: state.strokes[0] || null,
    rawDataStructure: state.strokes.length > 0 ? describeStructure(state.strokes[0]) : null
  };
  
  elements.jsonViewer.textContent = JSON.stringify(sampleData, null, 2);
}

function describeStructure(obj, depth = 0) {
  if (depth > 3) return '...';
  if (obj === null) return 'null';
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return `Array(${obj.length}) [${describeStructure(obj[0], depth + 1)}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    const result = {};
    keys.forEach(key => {
      result[key] = typeof obj[key] === 'object' 
        ? describeStructure(obj[key], depth + 1)
        : typeof obj[key];
    });
    return result;
  }
  return typeof obj;
}

export function updatePageSelect() {
  const currentValue = elements.pageSelect.value;
  elements.pageSelect.innerHTML = '<option value="">All Pages</option>';
  
  state.pages.forEach((dots, pageKey) => {
    const option = document.createElement('option');
    option.value = pageKey;
    option.textContent = `${pageKey} (${dots.length} dots)`;
    elements.pageSelect.appendChild(option);
  });
  
  elements.pageSelect.value = currentValue;
}

export function updateShapePreview() {
  const rectangles = [];
  
  state.strokes.forEach((stroke, index) => {
    const analysis = modules.analyzer.analyzeStroke(stroke);
    if (analysis.isRectangle) {
      rectangles.push({
        index,
        bounds: analysis.bounds,
        confidence: analysis.rectangleConfidence,
        details: analysis.rectangleDetails
      });
    }
  });
  
  if (rectangles.length > 0) {
    elements.shapePreview.style.display = 'block';
    elements.detectedShapes.innerHTML = rectangles.map(r => `
      <div class="shape-item" style="cursor: pointer;" data-stroke-index="${r.index}">
        <div class="shape-type">
          <div class="shape-icon"></div>
          <span>Rectangle (Stroke #${r.index + 1})</span>
        </div>
        <div class="shape-bounds">
          ${r.bounds.width?.toFixed(1)}×${r.bounds.height?.toFixed(1)} | ${(r.confidence * 100).toFixed(0)}%
        </div>
      </div>
    `).join('');
    
    // Make shape items clickable
    elements.detectedShapes.querySelectorAll('.shape-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.strokeIndex);
        handleStrokeClick(index, false, false);
      });
    });
  } else {
    elements.shapePreview.style.display = 'none';
  }
}
