/**
 * NeoSmartpen → LogSeq Bridge
 * Main application entry point
 */

// Load polyfills first (required by web_pen_sdk)
import './polyfills.js';

import { PenHelper, NoteServer, PenMessageType } from 'web_pen_sdk';
import { StrokeAnalyzer } from './stroke-analyzer.js';
import { LogSeqAPI } from './logseq-api.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { MyScriptAPI } from './myscript-api.js';

// ============================================================
// Application State
// ============================================================
const state = {
  controller: null,
  authorized: false,
  penInfo: null,
  strokes: [],
  currentPageInfo: null,
  pages: new Map(), // Map<pageKey, Dot[]>
  
  // Selection state (supports multi-select)
  selectedStrokes: new Set(),
  lastSelectedIndex: null, // For shift+click range selection
};

// Module instances
let renderer = null;
let analyzer = null;
let logseqApi = null;
let myscriptApi = null;
let lastTranscription = null; // Store last transcription result

// ============================================================
// DOM Elements
// ============================================================
const elements = {
  // Status
  penStatus: document.getElementById('penStatus'),
  penStatusText: document.getElementById('penStatusText'),
  logseqStatus: document.getElementById('logseqStatus'),
  logseqStatusText: document.getElementById('logseqStatusText'),
  
  // Buttons
  btnConnect: document.getElementById('btnConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  btnFetchOffline: document.getElementById('btnFetchOffline'),
  btnClearCanvas: document.getElementById('btnClearCanvas'),
  btnTestLogseq: document.getElementById('btnTestLogseq'),
  btnSendToLogseq: document.getElementById('btnSendToLogseq'),
  btnExportSvg: document.getElementById('btnExportSvg'),
  btnExportJson: document.getElementById('btnExportJson'),
  btnTranscribe: document.getElementById('btnTranscribe'),
  btnTestMyScript: document.getElementById('btnTestMyScript'),
  
  // Zoom controls
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnFitContent: document.getElementById('btnFitContent'),
  btnResetView: document.getElementById('btnResetView'),
  zoomLevel: document.getElementById('zoomLevel'),
  
  // Pen Info
  penInfo: document.getElementById('penInfo'),
  penModel: document.getElementById('penModel'),
  penBattery: document.getElementById('penBattery'),
  penMemory: document.getElementById('penMemory'),
  penMac: document.getElementById('penMac'),
  
  // Canvas
  strokeCanvas: document.getElementById('strokeCanvas'),
  strokeCount: document.getElementById('strokeCount'),
  pageSelect: document.getElementById('pageSelect'),
  selectionInfo: document.getElementById('selectionInfo'),
  
  // Data
  strokeList: document.getElementById('strokeList'),
  jsonViewer: document.getElementById('jsonViewer'),
  analysisViewer: document.getElementById('analysisViewer'),
  messageLog: document.getElementById('messageLog'),
  
  // MyScript settings
  myscriptAppKey: document.getElementById('myscriptAppKey'),
  myscriptHmacKey: document.getElementById('myscriptHmacKey'),
  
  // Settings
  logseqHost: document.getElementById('logseqHost'),
  logseqToken: document.getElementById('logseqToken'),
  
  // Shape detection
  shapePreview: document.getElementById('shapePreview'),
  detectedShapes: document.getElementById('detectedShapes'),
  
  // Tabs
  tabs: document.querySelectorAll('.tab'),
  tabStrokes: document.getElementById('tabStrokes'),
  tabRaw: document.getElementById('tabRaw'),
  tabAnalysis: document.getElementById('tabAnalysis'),
  tabTranscription: document.getElementById('tabTranscription'),
  transcriptionResult: document.getElementById('transcriptionResult'),
};

// ============================================================
// Logging Utility
// ============================================================
function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-${level}">${message}</span>`;
  elements.messageLog.insertBefore(entry, elements.messageLog.firstChild);
  
  // Keep only last 50 entries
  while (elements.messageLog.children.length > 50) {
    elements.messageLog.removeChild(elements.messageLog.lastChild);
  }
  
  console.log(`[${level.toUpperCase()}] ${message}`);
}

// ============================================================
// UI Update Functions
// ============================================================
function updatePenStatus(connected) {
  elements.penStatus.className = `status-dot ${connected ? 'connected' : ''}`;
  elements.penStatusText.textContent = connected ? 'Connected' : 'Disconnected';
  elements.btnConnect.disabled = connected;
  elements.btnDisconnect.disabled = !connected;
  elements.btnFetchOffline.disabled = !connected;
  elements.penInfo.style.display = connected ? 'block' : 'none';
}

function updatePenInfo(info) {
  if (!info) return;
  elements.penModel.textContent = info.DeviceName || 'Unknown';
  elements.penBattery.textContent = info.Battery === 128 ? 'Charging' : `${info.Battery}%`;
  elements.penMemory.textContent = `${info.UsedMem || 0}%`;
  elements.penMac.textContent = info.MacAddress || '-';
}

function updateSelectionInfo() {
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

function updateStrokeList() {
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
    const analysis = analyzer.analyzeStroke(stroke);
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

function handleStrokeClick(index, ctrlKey, shiftKey) {
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

function highlightSelectedStrokes() {
  if (!renderer) return;
  
  renderer.redraw();
  
  // Highlight all selected strokes
  state.selectedStrokes.forEach(index => {
    if (index >= 0 && index < state.strokes.length) {
      const stroke = state.strokes[index];
      renderer.drawStroke({
        dots: stroke.dotArray || [],
        color: '#e94560',
        width: 2
      }, '#e94560', Math.max(2, 4 * renderer.getZoom()));
    }
  });
}

function updateAnalysisView() {
  if (state.selectedStrokes.size === 0) {
    // Show overall analysis
    const lineAnalysis = analyzer.analyzeLines(state.strokes);
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
    const analysis = analyzer.analyzeStroke(stroke);
    
    elements.analysisViewer.textContent = JSON.stringify({
      strokeIndex: index,
      analysis
    }, null, 2);
  } else {
    // Multiple stroke analysis
    const analyses = Array.from(state.selectedStrokes).map(index => ({
      index,
      analysis: analyzer.analyzeStroke(state.strokes[index])
    }));
    
    elements.analysisViewer.textContent = JSON.stringify({
      selectedCount: state.selectedStrokes.size,
      strokes: analyses
    }, null, 2);
  }
}

function updateJsonViewer() {
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

function updatePageSelect() {
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

// ============================================================
// Pen SDK Callbacks
// ============================================================
function setupPenCallbacks() {
  // Dot callback - receives individual dots as you write
  PenHelper.dotCallback = async (mac, dot) => {
    processDot(dot);
  };
  
  // Message callback - pen events
  PenHelper.messageCallback = async (mac, type, args) => {
    processMessage(mac, type, args);
  };
}

function processDot(dot) {
  // Update current page info
  if (!state.currentPageInfo || !PenHelper.isSamePage(state.currentPageInfo, dot.pageInfo)) {
    state.currentPageInfo = dot.pageInfo;
    const pageKey = `S${dot.pageInfo.section}/O${dot.pageInfo.owner}/B${dot.pageInfo.book}/P${dot.pageInfo.page}`;
    
    if (!state.pages.has(pageKey)) {
      state.pages.set(pageKey, []);
      updatePageSelect();
    }
  }
  
  // Store dot
  const pageKey = `S${dot.pageInfo.section}/O${dot.pageInfo.owner}/B${dot.pageInfo.book}/P${dot.pageInfo.page}`;
  state.pages.get(pageKey).push(dot);
  
  // Build strokes from dots
  if (dot.dotType === 0) {
    // Pen down - start new stroke
    state.strokes.push({
      pageInfo: { ...dot.pageInfo },
      startTime: dot.timeStamp,
      dotArray: [{ x: dot.x, y: dot.y, f: dot.f, timestamp: dot.timeStamp }]
    });
  } else if (dot.dotType === 1 && state.strokes.length > 0) {
    // Pen move - add to current stroke
    const currentStroke = state.strokes[state.strokes.length - 1];
    currentStroke.dotArray.push({ x: dot.x, y: dot.y, f: dot.f, timestamp: dot.timeStamp });
  } else if (dot.dotType === 2 && state.strokes.length > 0) {
    // Pen up - finalize stroke
    const currentStroke = state.strokes[state.strokes.length - 1];
    currentStroke.endTime = dot.timeStamp;
    
    // Analyze stroke for shapes
    const analysis = analyzer.analyzeStroke(currentStroke);
    if (analysis.isRectangle) {
      log(`Detected rectangle at stroke #${state.strokes.length}`, 'success');
      updateShapePreview();
    }
    
    updateStrokeList();
    updateJsonViewer();
  }
  
  // Render to canvas
  if (renderer) {
    renderer.addDot(dot);
  }
  
  // Enable send button if we have data
  elements.btnSendToLogseq.disabled = state.strokes.length === 0;
}

function processMessage(mac, type, args) {
  console.log('Pen message:', { mac, type, args });
  
  switch (type) {
    case PenMessageType.PEN_SETTING_INFO:
      state.controller = PenHelper.pens.find(c => c.info.MacAddress === mac);
      state.penInfo = args;
      updatePenInfo(args);
      log(`Pen settings received: Battery ${args.Battery}%`, 'info');
      break;
      
    case PenMessageType.PEN_AUTHORIZED:
      state.authorized = true;
      log('Pen authorized successfully', 'success');
      // Request real-time data for all papers
      if (state.controller) {
        state.controller.RequestAvailableNotes([0], [0], null);
        state.controller.SetHoverEnable(true);
      }
      break;
      
    case PenMessageType.PEN_DISCONNECTED:
      state.controller = null;
      state.authorized = false;
      state.penInfo = null;
      updatePenStatus(false);
      log('Pen disconnected', 'warning');
      break;
      
    case PenMessageType.PEN_PASSWORD_REQUEST:
      handlePasswordRequest(args);
      break;
      
    case PenMessageType.PEN_CONNECTION_SUCCESS:
      updatePenStatus(true);
      log('Pen connected!', 'success');
      break;
      
    case PenMessageType.OFFLINE_DATA_NOTE_LIST:
      handleOfflineNoteList(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_PAGE_LIST:
      log(`Offline page list: ${JSON.stringify(args)}`, 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_START:
      log('Receiving offline data...', 'info');
      elements.penStatus.className = 'status-dot syncing';
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_STATUS:
      log(`Offline sync: ${args}%`, 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_SUCCESS:
      handleOfflineDataReceived(args);
      elements.penStatus.className = 'status-dot connected';
      log('Offline data received!', 'success');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_FAILURE:
      log('Failed to receive offline data', 'error');
      elements.penStatus.className = 'status-dot connected';
      break;
      
    case PenMessageType.EVENT_DOT_PUI:
      log(`PUI touched: ${JSON.stringify(args)}`, 'info');
      break;
      
    default:
      // Log unknown events for discovery
      log(`Event ${type}: ${JSON.stringify(args).substring(0, 100)}`, 'info');
  }
}

function handlePasswordRequest(args) {
  const password = prompt(
    `Enter pen password (4 digits)\nAttempts: ${args.RetryCount}/10\n⚠️ Data will be reset after 10 failed attempts`
  );
  
  if (password && password.length === 4) {
    state.controller?.InputPassword(password);
  }
}

function handleOfflineNoteList(noteList) {
  if (!noteList || noteList.length === 0) {
    log('No offline notes found', 'warning');
    return;
  }
  
  log(`Found ${noteList.length} offline note(s)`, 'info');
  
  // Show what we found
  const noteInfo = noteList.map(n => `S${n.Section}/O${n.Owner}/B${n.Note}`).join(', ');
  const download = confirm(`Found offline notes:\n${noteInfo}\n\nDownload all?`);
  
  if (download) {
    noteList.forEach(note => {
      state.controller?.RequestOfflineData(
        note.Section, 
        note.Owner, 
        note.Note, 
        false, // Don't delete after download
        []     // All pages
      );
    });
  }
}

function handleOfflineDataReceived(data) {
  if (!Array.isArray(data)) return;
  
  // Process offline strokes
  data.forEach(stroke => {
    if (stroke.Dots && Array.isArray(stroke.Dots)) {
      // Convert to our stroke format
      const convertedStroke = {
        pageInfo: stroke.Dots[0]?.pageInfo || {},
        startTime: stroke.Dots[0]?.timeStamp || 0,
        endTime: stroke.Dots[stroke.Dots.length - 1]?.timeStamp || 0,
        dotArray: stroke.Dots.map(d => ({
          x: d.x,
          y: d.y,
          f: d.f,
          timestamp: d.timeStamp
        })),
        // Keep original for debugging
        _raw: stroke
      };
      
      state.strokes.push(convertedStroke);
      
      // Add to pages map
      const pageKey = `S${convertedStroke.pageInfo.section}/O${convertedStroke.pageInfo.owner}/B${convertedStroke.pageInfo.book}/P${convertedStroke.pageInfo.page}`;
      if (!state.pages.has(pageKey)) {
        state.pages.set(pageKey, []);
      }
      stroke.Dots.forEach(d => state.pages.get(pageKey).push(d));
      
      // Render each dot
      stroke.Dots.forEach(dot => renderer?.addDot(dot));
    }
  });
  
  updateStrokeList();
  updateJsonViewer();
  updatePageSelect();
  elements.btnSendToLogseq.disabled = state.strokes.length === 0;
  
  // Run shape detection and line analysis
  updateShapePreview();
  
  // Calculate and log line height
  const lineAnalysis = analyzer.analyzeLines(state.strokes);
  if (lineAnalysis.lineCount > 1) {
    log(`Detected ${lineAnalysis.lineCount} lines, height: ${lineAnalysis.detectedLineHeight?.toFixed(2)} units`, 'info');
    analyzer.setLineHeight(lineAnalysis.detectedLineHeight);
  }
  
  // Auto-fit canvas to show all content
  setTimeout(() => renderer?.fitToContent(), 100);
}

function updateShapePreview() {
  const rectangles = [];
  
  state.strokes.forEach((stroke, index) => {
    const analysis = analyzer.analyzeStroke(stroke);
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

// ============================================================
// Button Handlers
// ============================================================
async function handleConnect() {
  try {
    log('Scanning for pen...', 'info');
    await PenHelper.scanPen();
  } catch (error) {
    log(`Connection failed: ${error.message}`, 'error');
    console.error('Connection error:', error);
  }
}

function handleDisconnect() {
  if (state.controller) {
    PenHelper.disconnect(state.controller);
  }
}

function handleFetchOffline() {
  if (!state.controller) {
    log('No pen connected', 'error');
    return;
  }
  
  log('Requesting offline note list...', 'info');
  state.controller.RequestOfflineNoteList(0, 0); // 0,0 = all notes
}

function handleClearCanvas() {
  state.strokes = [];
  state.pages.clear();
  state.selectedStrokes.clear();
  state.lastSelectedIndex = null;
  
  renderer?.clear();
  updateStrokeList();
  updateJsonViewer();
  updatePageSelect();
  updateSelectionInfo();
  elements.shapePreview.style.display = 'none';
  elements.btnSendToLogseq.disabled = true;
  
  log('Canvas cleared', 'info');
}

async function handleTestLogseq() {
  const host = elements.logseqHost.value;
  const token = elements.logseqToken.value;
  
  logseqApi = new LogSeqAPI(host, token);
  
  try {
    const connected = await logseqApi.testConnection();
    if (connected) {
      elements.logseqStatus.className = 'status-dot connected';
      elements.logseqStatusText.textContent = 'LogSeq: Connected';
      log('LogSeq connection successful!', 'success');
    } else {
      throw new Error('Connection test failed');
    }
  } catch (error) {
    elements.logseqStatus.className = 'status-dot';
    elements.logseqStatusText.textContent = 'LogSeq: Error';
    log(`LogSeq error: ${error.message}`, 'error');
  }
}

async function handleSendToLogseq() {
  if (state.strokes.length === 0) {
    log('No strokes to send', 'warning');
    return;
  }
  
  if (!logseqApi) {
    log('Test LogSeq connection first', 'warning');
    return;
  }
  
  try {
    // Generate SVG from strokes
    const svg = renderer.exportSVG();
    
    // Prepare data for LogSeq
    const data = {
      strokes: state.strokes,
      svg: svg,
      pages: Array.from(state.pages.keys()),
      timestamp: new Date().toISOString()
    };
    
    await logseqApi.sendHandwrittenNote(data);
    log('Sent to LogSeq!', 'success');
  } catch (error) {
    log(`Failed to send: ${error.message}`, 'error');
  }
}

function handleExportSvg() {
  if (!renderer) return;
  
  const svg = renderer.exportSVG();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartpen-export-${Date.now()}.svg`;
  a.click();
  
  URL.revokeObjectURL(url);
  log('SVG exported', 'success');
}

function handleExportJson() {
  // Export selected strokes or all if none selected
  const indicesToExport = state.selectedStrokes.size > 0
    ? Array.from(state.selectedStrokes).sort((a, b) => a - b)
    : state.strokes.map((_, i) => i);
  
  const strokesData = indicesToExport.map(index => {
    const stroke = state.strokes[index];
    const analysis = analyzer.analyzeStroke(stroke);
    return {
      index,
      pageInfo: stroke.pageInfo,
      startTime: stroke.startTime,
      endTime: stroke.endTime,
      dotArray: stroke.dotArray,
      analysis: {
        dotCount: analysis.dotCount,
        bounds: analysis.bounds,
        pathLength: analysis.pathLength,
        isClosed: analysis.isClosed,
        isRectangle: analysis.isRectangle,
        rectangleConfidence: analysis.rectangleConfidence
      }
    };
  });
  
  const exportData = {
    exportDate: new Date().toISOString(),
    selectedCount: indicesToExport.length,
    totalStrokes: state.strokes.length,
    pages: Array.from(state.pages.keys()),
    lineAnalysis: analyzer.analyzeLines(state.strokes),
    strokes: strokesData
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartpen-strokes-${Date.now()}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
  
  const msg = state.selectedStrokes.size > 0 
    ? `Exported ${indicesToExport.length} selected strokes` 
    : `Exported all ${state.strokes.length} strokes`;
  log(msg, 'success');
}

function handlePageFilter() {
  const pageKey = elements.pageSelect.value;
  
  if (pageKey && state.pages.has(pageKey)) {
    // Filter to specific page
    renderer?.clear();
    const dots = state.pages.get(pageKey);
    dots.forEach(dot => renderer?.addDot(dot));
  } else {
    // Show all
    renderer?.clear();
    state.pages.forEach(dots => {
      dots.forEach(dot => renderer?.addDot(dot));
    });
  }
}

function handleTabSwitch(e) {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  
  elements.tabs.forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  
  elements.tabStrokes.style.display = tab === 'strokes' ? 'block' : 'none';
  elements.tabRaw.style.display = tab === 'raw' ? 'block' : 'none';
  elements.tabAnalysis.style.display = tab === 'analysis' ? 'block' : 'none';
  elements.tabTranscription.style.display = tab === 'transcription' ? 'block' : 'none';
  
  // Update analysis view when switching to it
  if (tab === 'analysis') {
    updateAnalysisView();
  }
  
  // Update transcription view
  if (tab === 'transcription') {
    updateTranscriptionView();
  }
}

function updateTranscriptionView() {
  if (!lastTranscription) {
    elements.transcriptionResult.innerHTML = `
      <p style="color: var(--text-secondary); text-align: center;">
        Select strokes and click "Transcribe Selected" to convert handwriting to text.
        <br><br>
        <a href="https://developer.myscript.com/" target="_blank" style="color: var(--accent);">Get MyScript API keys (free tier: 2,000 requests/month)</a>
      </p>
    `;
    return;
  }
  
  const t = lastTranscription;
  
  // Build formatted output
  let html = `
    <div style="margin-bottom: 15px;">
      <h3 style="margin: 0 0 10px 0; color: var(--accent);">Transcribed Text</h3>
      <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-size: 1.1rem; line-height: 1.6;">
        ${escapeHtml(t.text) || '<em style="color: var(--text-secondary);">No text recognized</em>'}
      </div>
    </div>
  `;
  
  // Show lines with indentation
  if (t.lines && t.lines.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Lines (${t.lines.length})</h3>
        <div style="background: var(--bg-primary); padding: 15px; border-radius: 8px; font-family: monospace; font-size: 0.9rem;">
    `;
    
    t.lines.forEach((line, i) => {
      const indent = '  '.repeat(line.indentLevel || 0);
      const indentIndicator = line.indentLevel > 0 ? `<span style="color: var(--text-secondary);">[indent ${line.indentLevel}]</span> ` : '';
      html += `<div style="padding: 3px 0;">${indentIndicator}<span style="color: var(--text-secondary);">${i + 1}.</span> ${indent}${escapeHtml(line.text)}</div>`;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show detected commands
  if (t.commands && t.commands.length > 0) {
    html += `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: var(--accent);">Detected Commands</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    
    t.commands.forEach(cmd => {
      html += `
        <div style="background: var(--bg-tertiary); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent);">
          <div style="font-weight: 600;">${escapeHtml(cmd.command)}</div>
          <div style="color: var(--text-secondary);">${escapeHtml(cmd.value)}</div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Show words with bounding boxes (collapsed by default)
  if (t.words && t.words.length > 0) {
    html += `
      <details style="margin-bottom: 15px;">
        <summary style="cursor: pointer; color: var(--accent); padding: 5px 0;">Word Details (${t.words.length} words)</summary>
        <div class="json-viewer" style="margin-top: 10px; max-height: 200px;">${JSON.stringify(t.words, null, 2)}</div>
      </details>
    `;
  }
  
  // Show raw response (collapsed)
  html += `
    <details>
      <summary style="cursor: pointer; color: var(--text-secondary); padding: 5px 0;">Raw Response</summary>
      <div class="json-viewer" style="margin-top: 10px; max-height: 300px;">${JSON.stringify(t.raw, null, 2)}</div>
    </details>
  `;
  
  elements.transcriptionResult.innerHTML = html;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleTranscribe() {
  const appKey = elements.myscriptAppKey.value.trim();
  const hmacKey = elements.myscriptHmacKey.value.trim();
  
  if (!appKey || !hmacKey) {
    log('Please enter MyScript API credentials', 'warning');
    return;
  }
  
  // Get strokes to transcribe
  const indicesToTranscribe = state.selectedStrokes.size > 0
    ? Array.from(state.selectedStrokes).sort((a, b) => a - b)
    : state.strokes.map((_, i) => i);
  
  if (indicesToTranscribe.length === 0) {
    log('No strokes to transcribe', 'warning');
    return;
  }
  
  const strokesToTranscribe = indicesToTranscribe.map(i => state.strokes[i]);
  
  // Initialize MyScript API
  if (!myscriptApi) {
    myscriptApi = new MyScriptAPI(appKey, hmacKey);
  } else {
    myscriptApi.setCredentials(appKey, hmacKey);
  }
  
  try {
    elements.btnTranscribe.disabled = true;
    elements.btnTranscribe.textContent = '⏳ Transcribing...';
    log(`Transcribing ${strokesToTranscribe.length} strokes...`, 'info');
    
    const result = await myscriptApi.recognizeWithRetry(strokesToTranscribe);
    
    lastTranscription = result;
    
    log(`Transcription complete: "${result.text?.substring(0, 50)}${result.text?.length > 50 ? '...' : ''}"`, 'success');
    
    // Switch to transcription tab
    elements.tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="transcription"]').classList.add('active');
    elements.tabStrokes.style.display = 'none';
    elements.tabRaw.style.display = 'none';
    elements.tabAnalysis.style.display = 'none';
    elements.tabTranscription.style.display = 'block';
    
    updateTranscriptionView();
    
  } catch (error) {
    log(`Transcription failed: ${error.message}`, 'error');
    console.error('Transcription error:', error);
  } finally {
    elements.btnTranscribe.disabled = false;
    elements.btnTranscribe.textContent = '✍️ Transcribe Selected';
    updateSelectionInfo();
  }
}

async function handleTestMyScript() {
  const appKey = elements.myscriptAppKey.value.trim();
  const hmacKey = elements.myscriptHmacKey.value.trim();
  
  if (!appKey || !hmacKey) {
    log('Please enter both Application Key and HMAC Key', 'warning');
    return;
  }
  
  // Initialize or update MyScript API
  if (!myscriptApi) {
    myscriptApi = new MyScriptAPI(appKey, hmacKey);
  } else {
    myscriptApi.setCredentials(appKey, hmacKey);
  }
  
  try {
    elements.btnTestMyScript.disabled = true;
    elements.btnTestMyScript.textContent = '⏳ Testing...';
    log('Testing MyScript credentials...', 'info');
    
    const result = await myscriptApi.testCredentials();
    
    console.log('Test result:', result);
    
    if (result.success) {
      log('✅ MyScript credentials valid!', 'success');
    } else {
      if (result.status === 401) {
        log(`❌ Authentication failed (401): ${result.error}`, 'error');
        log('Check: 1) Keys are correct, 2) App is activated in MyScript dashboard, 3) Text recognition is enabled', 'warning');
      } else if (result.isCorsError) {
        log(`❌ CORS error - browser blocked the request`, 'error');
        log('MyScript Cloud API may not support direct browser requests. Consider using a proxy.', 'warning');
      } else {
        log(`❌ Test failed: ${result.error}`, 'error');
      }
    }
  } catch (error) {
    log(`❌ Test error: ${error.message}`, 'error');
    console.error('Test error:', error);
  } finally {
    elements.btnTestMyScript.disabled = false;
    elements.btnTestMyScript.textContent = '🔑 Test MyScript Keys';
  }
}

// ============================================================
// Settings Persistence
// ============================================================
function saveSettings() {
  const settings = {
    myscriptAppKey: elements.myscriptAppKey.value,
    myscriptHmacKey: elements.myscriptHmacKey.value,
    logseqHost: elements.logseqHost.value,
  };
  localStorage.setItem('smartpen-bridge-settings', JSON.stringify(settings));
}

function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('smartpen-bridge-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.myscriptAppKey) elements.myscriptAppKey.value = settings.myscriptAppKey;
      if (settings.myscriptHmacKey) elements.myscriptHmacKey.value = settings.myscriptHmacKey;
      if (settings.logseqHost) elements.logseqHost.value = settings.logseqHost;
      log('Settings loaded from localStorage', 'info');
    }
  } catch (e) {
    console.warn('Failed to load saved settings:', e);
  }
}

// ============================================================
// Initialization
// ============================================================
function init() {
  // Initialize modules
  renderer = new CanvasRenderer(elements.strokeCanvas);
  analyzer = new StrokeAnalyzer();
  
  // Setup pen SDK callbacks
  setupPenCallbacks();
  
  // Bind event handlers
  elements.btnConnect.addEventListener('click', handleConnect);
  elements.btnDisconnect.addEventListener('click', handleDisconnect);
  elements.btnFetchOffline.addEventListener('click', handleFetchOffline);
  elements.btnClearCanvas.addEventListener('click', handleClearCanvas);
  elements.btnTestLogseq.addEventListener('click', handleTestLogseq);
  elements.btnSendToLogseq.addEventListener('click', handleSendToLogseq);
  elements.btnExportSvg.addEventListener('click', handleExportSvg);
  elements.btnExportJson.addEventListener('click', handleExportJson);
  elements.btnTranscribe.addEventListener('click', handleTranscribe);
  elements.btnTestMyScript.addEventListener('click', handleTestMyScript);
  
  // Load saved API keys from localStorage
  loadSavedSettings();
  
  // Save settings when changed
  elements.myscriptAppKey.addEventListener('change', saveSettings);
  elements.myscriptHmacKey.addEventListener('change', saveSettings);
  elements.logseqHost.addEventListener('change', saveSettings);
  
  // Enable/disable transcribe button when credentials change
  elements.myscriptAppKey.addEventListener('input', updateSelectionInfo);
  elements.myscriptHmacKey.addEventListener('input', updateSelectionInfo);
  
  // Zoom controls
  elements.btnZoomIn.addEventListener('click', () => renderer?.zoomIn());
  elements.btnZoomOut.addEventListener('click', () => renderer?.zoomOut());
  elements.btnFitContent.addEventListener('click', () => renderer?.fitToContent());
  elements.btnResetView.addEventListener('click', () => renderer?.resetView());
  
  elements.pageSelect.addEventListener('change', handlePageFilter);
  elements.tabs.forEach(tab => tab.addEventListener('click', handleTabSwitch));
  
  // Handle window resize
  window.addEventListener('resize', () => renderer?.resize());
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+A to select all strokes
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && state.strokes.length > 0) {
      e.preventDefault();
      state.selectedStrokes.clear();
      state.strokes.forEach((_, i) => state.selectedStrokes.add(i));
      updateStrokeList();
      updateSelectionInfo();
      highlightSelectedStrokes();
    }
    
    // Escape to clear selection
    if (e.key === 'Escape') {
      state.selectedStrokes.clear();
      state.lastSelectedIndex = null;
      updateStrokeList();
      updateSelectionInfo();
      renderer?.redraw();
    }
  });
  
  log('Bridge initialized. Click "Connect Pen" to begin.', 'info');
  log('Make sure LogSeq HTTP API is enabled in Settings > Advanced', 'info');
}

// Start the app
init();
