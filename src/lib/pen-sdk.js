/**
 * Pen SDK Wrapper for Svelte
 * Wraps the web_pen_sdk and updates Svelte stores
 */

import { PenHelper, PenMessageType } from 'web_pen_sdk';
import { 
  addStroke, 
  updateLastStroke, 
  addOfflineStrokes,
  currentPageInfo 
} from '$stores/strokes.js';
import { 
  setPenConnected, 
  setPenAuthorized, 
  setPenInfo, 
  setPenController,
  penController 
} from '$stores/pen.js';
import { log } from '$stores/ui.js';

// Local state for tracking current stroke
let currentStrokeData = null;
let canvasRenderer = null;

/**
 * Initialize pen SDK callbacks
 */
export function initializePenSDK() {
  // Dot callback - receives individual dots as you write
  PenHelper.dotCallback = async (mac, dot) => {
    processDot(dot);
  };
  
  // Message callback - pen events
  PenHelper.messageCallback = async (mac, type, args) => {
    processMessage(mac, type, args);
  };
  
  log('Pen SDK initialized', 'info');
}

/**
 * Set canvas renderer for real-time drawing
 * @param {Object} renderer - CanvasRenderer instance
 */
export function setCanvasRenderer(renderer) {
  canvasRenderer = renderer;
}

/**
 * Connect to a pen via Bluetooth
 */
export async function connectPen() {
  try {
    log('Scanning for pens...', 'info');
    await PenHelper.scanPen();
    
    // The connection success/failure is handled via messageCallback
    return true;
  } catch (error) {
    log(`Connection error: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Disconnect from the pen
 */
export async function disconnectPen() {
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (controller) {
    try {
      controller.Disconnect();
      setPenConnected(false);
      log('Disconnected from pen', 'info');
    } catch (error) {
      log(`Disconnect error: ${error.message}`, 'error');
      throw error;
    }
  }
}

/**
 * Fetch offline data from pen
 */
export async function fetchOfflineData() {
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (!controller) {
    log('No pen connected', 'warning');
    return [];
  }
  
  try {
    log('Requesting offline note list...', 'info');
    controller.RequestOfflineNoteList();
    // The actual data will come via messageCallback
    return [];
  } catch (error) {
    log(`Failed to fetch offline data: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Process individual dots from pen
 */
function processDot(dot) {
  // Update current page info store
  currentPageInfo.set(dot.pageInfo);
  
  // Handle stroke building based on dot type
  switch (dot.dotType) {
    case 0: // Pen down - start new stroke
      currentStrokeData = {
        pageInfo: { ...dot.pageInfo },
        startTime: dot.timeStamp,
        dotArray: [{ x: dot.x, y: dot.y, f: dot.f, timestamp: dot.timeStamp }]
      };
      break;
      
    case 1: // Pen move - add to current stroke
      if (currentStrokeData) {
        currentStrokeData.dotArray.push({ 
          x: dot.x, 
          y: dot.y, 
          f: dot.f, 
          timestamp: dot.timeStamp 
        });
      }
      break;
      
    case 2: // Pen up - finalize stroke
      if (currentStrokeData) {
        currentStrokeData.endTime = dot.timeStamp;
        addStroke(currentStrokeData);
        currentStrokeData = null;
      }
      break;
  }
  
  // Render to canvas if available
  if (canvasRenderer) {
    canvasRenderer.addDot(dot);
  }
}

/**
 * Process pen messages
 */
function processMessage(mac, type, args) {
  console.log('Pen message:', { mac, type, args });
  
  switch (type) {
    case PenMessageType.PEN_CONNECTION_SUCCESS:
      handleConnectionSuccess(mac);
      break;
      
    case PenMessageType.PEN_SETTING_INFO:
      handleSettingInfo(mac, args);
      break;
      
    case PenMessageType.PEN_AUTHORIZED:
      handleAuthorized(mac);
      break;
      
    case PenMessageType.PEN_DISCONNECTED:
      handleDisconnected();
      break;
      
    case PenMessageType.PEN_PASSWORD_REQUEST:
      handlePasswordRequest(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_NOTE_LIST:
      handleOfflineNoteList(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_START:
      log('Receiving offline data...', 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_STATUS:
      log(`Offline sync: ${args}%`, 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_SUCCESS:
      handleOfflineDataReceived(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_FAILURE:
      log('Failed to receive offline data', 'error');
      break;
      
    case PenMessageType.EVENT_DOT_PUI:
      log(`PUI touched: ${JSON.stringify(args)}`, 'info');
      break;
      
    default:
      // Log unknown events
      console.log(`Unknown pen event ${type}:`, args);
  }
}

function handleConnectionSuccess(mac) {
  setPenConnected(true);
  log('Pen connected!', 'success');
}

function handleSettingInfo(mac, args) {
  const controller = PenHelper.pens.find(c => c.info.MacAddress === mac);
  setPenController(controller);
  setPenInfo(args);
  log(`Pen settings received: Battery ${args.Battery}%`, 'info');
}

function handleAuthorized(mac) {
  setPenAuthorized(true);
  log('Pen authorized successfully', 'success');
  
  // Request real-time data for all papers
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (controller) {
    controller.RequestAvailableNotes([0], [0], null);
    controller.SetHoverEnable(true);
  }
}

function handleDisconnected() {
  setPenConnected(false);
  log('Pen disconnected', 'warning');
}

function handlePasswordRequest(args) {
  const password = prompt(
    `Enter pen password (4 digits)\nAttempts: ${args.RetryCount}/10\n⚠️ Data will be reset after 10 failed attempts`
  );
  
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (password && password.length === 4 && controller) {
    controller.InputPassword(password);
  }
}

function handleOfflineNoteList(noteList) {
  if (!noteList || noteList.length === 0) {
    log('No offline notes found', 'warning');
    return;
  }
  
  log(`Found ${noteList.length} offline note(s)`, 'info');
  
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  // Show what we found
  const noteInfo = noteList.map(n => `S${n.Section}/O${n.Owner}/B${n.Note}`).join(', ');
  const download = confirm(`Found offline notes:\n${noteInfo}\n\nDownload all?`);
  
  if (download && controller) {
    noteList.forEach(note => {
      controller.RequestOfflineData(
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
  
  const convertedStrokes = [];
  
  // Process offline strokes
  data.forEach(stroke => {
    if (stroke.Dots && Array.isArray(stroke.Dots)) {
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
        _raw: stroke
      };
      
      convertedStrokes.push(convertedStroke);
      
      // Render dots to canvas
      if (canvasRenderer) {
        stroke.Dots.forEach(dot => canvasRenderer.addDot(dot));
      }
    }
  });
  
  // Add all strokes to store
  addOfflineStrokes(convertedStrokes);
  log(`Received ${convertedStrokes.length} offline strokes`, 'success');
}
