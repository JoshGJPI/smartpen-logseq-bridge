/**
 * Pen SDK Callbacks and Message Processing
 */

import { PenHelper, PenMessageType } from 'web_pen_sdk';
import { state, modules } from './state.js';
import { elements } from './elements.js';
import { log } from './logger.js';
import { 
  updatePenStatus, 
  updatePenInfo, 
  updateStrokeList, 
  updateJsonViewer,
  updatePageSelect,
  updateShapePreview,
  updateSelectionInfo
} from './ui-updates.js';

export function setupPenCallbacks() {
  // Dot callback - receives individual dots as you write
  PenHelper.dotCallback = async (mac, dot) => {
    processDot(dot);
  };
  
  // Message callback - pen events
  PenHelper.messageCallback = async (mac, type, args) => {
    processMessage(mac, type, args);
  };
}

export function processDot(dot) {
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
    const analysis = modules.analyzer.analyzeStroke(currentStroke);
    if (analysis.isRectangle) {
      log(`Detected rectangle at stroke #${state.strokes.length}`, 'success');
      updateShapePreview();
    }
    
    updateStrokeList();
    updateJsonViewer();
  }
  
  // Render to canvas
  if (modules.renderer) {
    modules.renderer.addDot(dot);
  }
  
  // Enable send button if we have data
  elements.btnSendToLogseq.disabled = state.strokes.length === 0;
}

export function processMessage(mac, type, args) {
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
      stroke.Dots.forEach(dot => modules.renderer?.addDot(dot));
    }
  });
  
  updateStrokeList();
  updateJsonViewer();
  updatePageSelect();
  updateSelectionInfo(); // Enable transcribe button
  elements.btnSendToLogseq.disabled = state.strokes.length === 0;
  
  // Run shape detection and line analysis
  updateShapePreview();
  
  // Calculate and log line height
  const lineAnalysis = modules.analyzer.analyzeLines(state.strokes);
  if (lineAnalysis.lineCount > 1) {
    log(`Detected ${lineAnalysis.lineCount} lines, height: ${lineAnalysis.detectedLineHeight?.toFixed(2)} units`, 'info');
    modules.analyzer.setLineHeight(lineAnalysis.detectedLineHeight);
  }
  
  // Auto-fit canvas to show all content
  setTimeout(() => modules.renderer?.fitToContent(), 100);
}
