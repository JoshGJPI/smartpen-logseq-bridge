/**
 * Button Click Handlers
 */

import { PenHelper } from 'web_pen_sdk';
import { state, modules } from './state.js';
import { elements } from './elements.js';
import { log } from './logger.js';
import { LogSeqAPI } from './logseq-api.js';
import { MyScriptAPI } from './myscript-api.js';
import { 
  updateStrokeList, 
  updateJsonViewer, 
  updatePageSelect,
  updateSelectionInfo,
  updateAnalysisView,
  highlightSelectedStrokes
} from './ui-updates.js';
import { updateTranscriptionView } from './transcription-view.js';

export async function handleConnect() {
  try {
    log('Scanning for pen...', 'info');
    await PenHelper.scanPen();
  } catch (error) {
    log(`Connection failed: ${error.message}`, 'error');
    console.error('Connection error:', error);
  }
}

export function handleDisconnect() {
  if (state.controller) {
    PenHelper.disconnect(state.controller);
  }
}

export function handleFetchOffline() {
  if (!state.controller) {
    log('No pen connected', 'error');
    return;
  }
  
  log('Requesting offline note list...', 'info');
  state.controller.RequestOfflineNoteList(0, 0); // 0,0 = all notes
}

export function handleClearCanvas() {
  state.strokes = [];
  state.pages.clear();
  state.selectedStrokes.clear();
  state.lastSelectedIndex = null;
  
  modules.renderer?.clear();
  updateStrokeList();
  updateJsonViewer();
  updatePageSelect();
  updateSelectionInfo();
  elements.shapePreview.style.display = 'none';
  elements.btnSendToLogseq.disabled = true;
  
  log('Canvas cleared', 'info');
}

export async function handleTestLogseq() {
  const host = elements.logseqHost.value;
  const token = elements.logseqToken.value;
  
  modules.logseqApi = new LogSeqAPI(host, token);
  
  try {
    const connected = await modules.logseqApi.testConnection();
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

export async function handleSendToLogseq() {
  if (state.strokes.length === 0) {
    log('No strokes to send', 'warning');
    return;
  }
  
  if (!modules.logseqApi) {
    log('Test LogSeq connection first', 'warning');
    return;
  }
  
  try {
    // Generate SVG from strokes
    const svg = modules.renderer.exportSVG();
    
    // Prepare data for LogSeq
    const data = {
      strokes: state.strokes,
      svg: svg,
      pages: Array.from(state.pages.keys()),
      timestamp: new Date().toISOString()
    };
    
    await modules.logseqApi.sendHandwrittenNote(data);
    log('Sent to LogSeq!', 'success');
  } catch (error) {
    log(`Failed to send: ${error.message}`, 'error');
  }
}

export function handleExportSvg() {
  if (!modules.renderer) return;
  
  const svg = modules.renderer.exportSVG();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartpen-export-${Date.now()}.svg`;
  a.click();
  
  URL.revokeObjectURL(url);
  log('SVG exported', 'success');
}

export function handleExportJson() {
  // Export selected strokes or all if none selected
  const indicesToExport = state.selectedStrokes.size > 0
    ? Array.from(state.selectedStrokes).sort((a, b) => a - b)
    : state.strokes.map((_, i) => i);
  
  const strokesData = indicesToExport.map(index => {
    const stroke = state.strokes[index];
    const analysis = modules.analyzer.analyzeStroke(stroke);
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
    lineAnalysis: modules.analyzer.analyzeLines(state.strokes),
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

export function handlePageFilter() {
  const pageKey = elements.pageSelect.value;
  
  if (pageKey && state.pages.has(pageKey)) {
    // Filter to specific page
    modules.renderer?.clear();
    const dots = state.pages.get(pageKey);
    dots.forEach(dot => modules.renderer?.addDot(dot));
  } else {
    // Show all
    modules.renderer?.clear();
    state.pages.forEach(dots => {
      dots.forEach(dot => modules.renderer?.addDot(dot));
    });
  }
}

export function handleTabSwitch(e) {
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

export async function handleTranscribe() {
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
  if (!modules.myscriptApi) {
    modules.myscriptApi = new MyScriptAPI(appKey, hmacKey);
  } else {
    modules.myscriptApi.setCredentials(appKey, hmacKey);
  }
  
  try {
    elements.btnTranscribe.disabled = true;
    elements.btnTranscribe.textContent = '⏳ Transcribing...';
    log(`Transcribing ${strokesToTranscribe.length} strokes...`, 'info');
    
    const result = await modules.myscriptApi.recognizeWithRetry(strokesToTranscribe);
    
    state.lastTranscription = result;
    
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

export async function handleTestMyScript() {
  const appKey = elements.myscriptAppKey.value.trim();
  const hmacKey = elements.myscriptHmacKey.value.trim();
  
  if (!appKey || !hmacKey) {
    log('Please enter both Application Key and HMAC Key', 'warning');
    return;
  }
  
  // Initialize or update MyScript API
  if (!modules.myscriptApi) {
    modules.myscriptApi = new MyScriptAPI(appKey, hmacKey);
  } else {
    modules.myscriptApi.setCredentials(appKey, hmacKey);
  }
  
  try {
    elements.btnTestMyScript.disabled = true;
    elements.btnTestMyScript.textContent = '⏳ Testing...';
    log('Testing MyScript credentials...', 'info');
    
    const result = await modules.myscriptApi.testCredentials();
    
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

export function handleKeyboardShortcuts(e) {
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
    modules.renderer?.redraw();
  }
}
