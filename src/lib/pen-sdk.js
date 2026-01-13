/**
 * Pen SDK Wrapper for Svelte
 * Wraps the web_pen_sdk and updates Svelte stores
 */

import { PenHelper, PenMessageType } from 'web_pen_sdk';
import { 
  addStroke, 
  updateLastStroke, 
  addOfflineStrokes,
  currentPageInfo,
  startBatchMode,
  endBatchMode
} from '$stores/strokes.js';
import { 
  setPenConnected, 
  setPenAuthorized, 
  setPenInfo, 
  setPenController,
  penController,
  updateTransferProgress,
  resetTransferProgress
} from '$stores/pen.js';
import { log, openBookSelectionDialog } from '$stores/ui.js';

// Local state for tracking current stroke
let currentStrokeData = null;
let canvasRenderer = null;

// ===== DELETION MODE STATE =====
// Deletion mode flag
let isDeletionMode = false;
let deletionBooks = [];  // Track which books are being deleted

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
 * @param {number} timeoutMs - Connection timeout in milliseconds (default 15s)
 */
export async function connectPen(timeoutMs = 15000) {
  try {
    log('Scanning for pens...', 'info');
    log('💡 Make sure your pen is awake (tap on paper or press button)', 'info');
    
    // Create a promise that races between connection and timeout
    const connectionPromise = PenHelper.scanPen();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout - pen did not respond')), timeoutMs)
    );
    
    await Promise.race([connectionPromise, timeoutPromise]);
    
    // The connection success/failure is handled via messageCallback
    // This just ensures we don't hang forever
    return true;
  } catch (error) {
    let errorMessage = `Connection error: ${error.message}`;
    
    // Add troubleshooting tips for timeout errors
    if (error.message.includes('timeout')) {
      log(errorMessage, 'error');
      log('💡 Troubleshooting tips:', 'warning');
      log('1. Make sure pen is awake (tap on Ncode paper or press button)', 'info');
      log('2. Remove and reinsert pen cap to reset', 'info');
      log('3. Try disconnecting other Bluetooth devices', 'info');
      log('4. Refresh the page and try again', 'info');
    } else {
      log(errorMessage, 'error');
    }
    
    // Try to clean up connection state
    setPenConnected(false);
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
      PenHelper.disconnect(controller);
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
  // More detailed logging for connection-related messages
  const messageTypeNames = {
    1: 'PEN_CONNECTION_SUCCESS',
    2: 'PEN_SETTING_INFO',
    3: 'PEN_AUTHORIZED',
    4: 'PEN_DISCONNECTED',
    5: 'PEN_PASSWORD_REQUEST',
    6: 'OFFLINE_DATA_NOTE_LIST',
    18: 'PEN_SETTING_CHANGE_RESPONSE',
    26: 'AVAILABLE_NOTE_RESPONSE',
    49: 'OFFLINE_DATA_RESPONSE',
    50: 'OFFLINE_DATA_SEND_START',
    51: 'OFFLINE_DATA_SEND_STATUS',
    52: 'OFFLINE_DATA_SEND_SUCCESS',
    53: 'OFFLINE_DATA_SEND_FAILURE'
  };
  
  const typeName = messageTypeNames[type] || `UNKNOWN(${type})`;
  console.log(`Pen message [${typeName}]:`, { mac, type, args });
  
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
    
    case 49: // OFFLINE_DATA_RESPONSE - pen tells us how much data to expect
      handleOfflineDataResponse(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_START:
      console.log('%c🚀 OFFLINE_DATA_SEND_START received', 'background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px;');
      log('Receiving offline data...', 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_STATUS:
      // Only log every 25% to reduce noise
      if (args % 25 < 5 || args > 95) {
        console.log(`📊 Progress: ${Math.round(args)}%`);
      }
      log(`Offline sync: ${Math.round(args)}%`, 'info');
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_SUCCESS:
      console.log('%c✅ OFFLINE_DATA_SEND_SUCCESS - Processing data...', 'background: #2196F3; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;');
      handleOfflineDataReceived(args);
      break;
      
    case PenMessageType.OFFLINE_DATA_SEND_FAILURE:
      console.log('%c❌ OFFLINE_DATA_SEND_FAILURE', 'background: #f44336; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;');
      log('Failed to receive offline data', 'error');
      // Resolve the pending transfer with failure so we can move to the next book
      if (offlineTransferResolver) {
        offlineTransferResolver({ failed: true });
      }
      break;
      
    case PenMessageType.EVENT_DOT_PUI:
      log(`PUI touched: ${JSON.stringify(args)}`, 'info');
      break;
    
    case 26: // AVAILABLE_NOTE_RESPONSE - confirmation that note set was configured
      if (args?.Result) {
        console.log('Note set configured successfully');
      }
      break;
    
    case 18: // PEN_SETTING_CHANGE_RESPONSE - confirmation of setting change (e.g., hover enable)
      if (args?.result) {
        console.log('Pen setting updated:', args.SettingType);
      }
      break;
      
    default:
      // Log unknown events for debugging
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

async function handleAuthorized(mac) {
  setPenAuthorized(true);
  log('Pen authorized successfully', 'success');
  
  // Request real-time data for all papers
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (controller) {
    // GATT operations must be serialized - add delays between commands
    try {
      // Request ALL sections and owners (null means all)
      controller.RequestAvailableNotes(null, null, null);
      // Wait for GATT operation to complete before next command
      await new Promise(resolve => setTimeout(resolve, 300));
      controller.SetHoverEnable(true);
      log('Pen ready for real-time capture (all notebooks)', 'info');
    } catch (error) {
      console.warn('GATT setup warning:', error);
      // Non-fatal - pen may still work
    }
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

// Track ongoing offline data transfers
let pendingOfflineTransfer = null;  // String - normalized book ID
let offlineTransferResolver = null;
let receivedStrokesTotal = 0;        // Total strokes across all books
let lastDataReceivedTime = null;     // Track when last data chunk arrived
let dataReceivedForCurrentTransfer = false;  // Track if we've received ANY data
let transferStartTime = null;        // Track when transfer started for timing info
let transferCancelled = false;       // Flag to cancel transfer
let elapsedTimerInterval = null;     // Timer to update elapsed seconds

// Configuration for timeouts (can be adjusted based on experience)
const TRANSFER_CONFIG = {
  IDLE_TIMEOUT_MS: 10000,      // 10 seconds of no data = complete (no global timeout!)
  IDLE_CHECK_INTERVAL_MS: 1000, // Check idle status every second
  INTER_BOOK_DELAY_MS: 1000,   // Wait 1 second between books
};

/**
 * Cancel the current offline transfer
 * @returns {boolean} True if a transfer was cancelled
 */
export function cancelOfflineTransfer() {
  if (pendingOfflineTransfer && offlineTransferResolver) {
    console.log('%c❌ Transfer cancelled by user', 'background: #f44336; color: white; padding: 2px 6px; border-radius: 3px;');
    transferCancelled = true;
    offlineTransferResolver({ cancelled: true });
    return true;
  }
  return false;
}

/**
 * Delete books from pen memory
 * Uses pseudo-deletion: re-imports with delete flag, discards data
 * @param {Array} books - Array of book objects to delete (from note list)
 * @returns {Promise<Object>} Deletion results
 */
export async function deleteBooksFromPen(books) {
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  if (!controller) {
    throw new Error('No pen connected');
  }
  
  if (!books || books.length === 0) {
    return { success: true, deletedBooks: [] };
  }
  
  console.log('%c🗑️ DELETION MODE ACTIVATED', 
    'background: #f59e0b; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold; font-size: 14px;');
  console.log(`📋 Books to delete: ${books.length}`);
  
  log(`🗑️ Deleting ${books.length} book(s) from pen memory...`, 'warning');
  
  // Enable deletion mode globally
  isDeletionMode = true;
  deletionBooks = books.map(b => normalizeBookId(b.Note));
  
  const results = {
    success: true,
    deletedBooks: [],
    failedBooks: [],
    totalBooks: books.length
  };
  
  try {
    // Process each book sequentially
    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const bookId = normalizeBookId(book.Note);
      
      console.log(`%c🗑️ Deleting book ${i + 1}/${books.length}: B${bookId}`, 
        'color: #f59e0b; font-weight: bold;');
      log(`🗑️ Deleting Book ${bookId}...`, 'info');
      
      try {
        // Create promise that resolves when this deletion completes
        const deletionComplete = new Promise((resolve, reject) => {
          pendingOfflineTransfer = bookId;
          offlineTransferResolver = resolve;
          
          // Timeout for deletion (should be quick)
          const timeout = setTimeout(() => {
            console.warn(`⏰ Deletion timeout for book ${bookId}`);
            reject(new Error(`Timeout deleting book ${bookId}`));
          }, 20000);  // 20 second timeout per book
          
          // Clear timeout when resolved
          const originalResolve = resolve;
          resolve = (value) => {
            clearTimeout(timeout);
            originalResolve(value);
          };
        });
        
        // Request data WITH deletion flag
        // Data will be received but immediately discarded
        controller.RequestOfflineData(
          book.Section,
          book.Owner,
          book.Note,
          true,  // ← DELETE FLAG = TRUE
          []     // All pages
        );
        
        // Wait for deletion to complete
        const result = await deletionComplete;
        
        if (result?.deleted || result?.empty) {
          console.log(`✅ Book ${bookId} deleted from pen`);
          log(`✅ Book ${bookId} deleted`, 'success');
          results.deletedBooks.push(book);
        } else if (result?.failed) {
          console.error(`❌ Failed to delete book ${bookId}`);
          log(`❌ Failed to delete Book ${bookId}`, 'error');
          results.failedBooks.push(book);
          results.success = false;
        }
        
        // Reset transfer state
        pendingOfflineTransfer = null;
        offlineTransferResolver = null;
        
        // Brief delay between deletions for BLE stability
        if (i < books.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
        
      } catch (error) {
        console.error(`❌ Exception deleting book ${bookId}:`, error);
        log(`❌ Failed to delete Book ${bookId}: ${error.message}`, 'error');
        results.failedBooks.push(book);
        results.success = false;
        
        // Reset state and continue to next book
        pendingOfflineTransfer = null;
        offlineTransferResolver = null;
      }
    }
    
  } finally {
    // Always reset deletion mode
    isDeletionMode = false;
    deletionBooks = [];
    
    console.log('%c🗑️ DELETION MODE DEACTIVATED', 
      'background: #10b981; color: white; padding: 3px 8px; border-radius: 3px; font-weight: bold;');
  }
  
  // Log final results
  if (results.success) {
    console.log(`✅ Successfully deleted ${results.deletedBooks.length} books from pen`);
    log(`✅ Successfully deleted ${results.deletedBooks.length} books from pen memory`, 'success');
  } else {
    console.warn(`⚠️ Deleted ${results.deletedBooks.length} books, ${results.failedBooks.length} failed`);
    log(`⚠️ Deleted ${results.deletedBooks.length} books, ${results.failedBooks.length} failed`, 'warning');
  }
  
  return results;
}

/**
 * Normalize book ID to string for consistent comparison
 * @param {*} bookId - Book ID from note list or stroke data
 * @returns {string} Normalized book ID as string
 */
function normalizeBookId(bookId) {
  if (bookId === null || bookId === undefined) {
    return 'unknown';
  }
  return String(bookId);
}

/**
 * Handle OFFLINE_DATA_RESPONSE (message type 49)
 * This tells us the pen is ready to send data (we don't rely on stroke count)
 */
function handleOfflineDataResponse(args) {
  console.log('%c📋 OFFLINE_DATA_RESPONSE received', 'background: #9C27B0; color: white; padding: 2px 6px; border-radius: 3px;', args);
  
  if (pendingOfflineTransfer) {
    const strokeCount = args?.stroke;
    const byteCount = args?.bytes;
    
    console.log(`📊 Book ${pendingOfflineTransfer}: Pen reports ${strokeCount || 0} strokes (${byteCount || 'unknown'} bytes)`);
    
    // Update status to receiving
    updateTransferProgress({
      status: 'receiving'
    });
    
    // If stroke count is 0, resolve immediately
    if (strokeCount === 0) {
      console.log(`📋 Book ${pendingOfflineTransfer} has 0 strokes - resolving immediately`);
      if (offlineTransferResolver) {
        offlineTransferResolver({ empty: true });
      }
    }
  } else {
    console.warn('⚠️ Received OFFLINE_DATA_RESPONSE but no pending transfer');
  }
}

async function handleOfflineNoteList(noteList) {
  console.log('%c===== OFFLINE NOTE LIST RECEIVED =====', 'background: #222; color: #bada55; font-size: 14px; padding: 4px;');
  console.log('📚 Note list:', noteList);
  
  // NEW: Check if this is for deletion dialog
  if (window.__pendingNoteListResolver) {
    console.log('📋 Routing note list to deletion dialog');
    window.__pendingNoteListResolver(noteList);
    window.__pendingNoteListResolver = null;
    return;
  }
  
  if (!noteList || noteList.length === 0) {
    log('No offline notes found', 'warning');
    return;
  }
  
  log(`Found ${noteList.length} offline note(s)`, 'info');
  
  let controller;
  const unsubscribe = penController.subscribe(c => controller = c);
  unsubscribe();
  
  // Show what we found with type info for debugging
  const noteInfo = noteList.map(n => {
    const bookId = normalizeBookId(n.Note);
    return `S${n.Section}/O${n.Owner}/B${bookId}`;
  }).join(', ');
  
  console.log('📚 Note details with types:', noteList.map(n => ({
    Section: n.Section,
    Owner: n.Owner,
    Note: n.Note,
    NoteType: typeof n.Note,
    PageCount: n.PageCount
  })));
  
  // Show book selection dialog
  let selectedBooks;
  try {
    selectedBooks = await openBookSelectionDialog(noteList);
  } catch (error) {
    console.log('❌ Download cancelled by user');
    return;
  }
  
  if (selectedBooks && selectedBooks.length > 0 && controller) {
    console.log('%c📥 Requesting offline data sequentially (waiting for each to complete)...', 'color: #4CAF50; font-weight: bold;');
    
    // Initialize transfer progress
    transferCancelled = false;
    receivedStrokesTotal = 0;
    transferStartTime = Date.now();
    
    updateTransferProgress({
      active: true,
      currentBook: 0,
      totalBooks: selectedBooks.length,
      receivedStrokes: 0,
      elapsedSeconds: 0,
      status: 'requesting',
      canCancel: true
    });
    
    // Start elapsed timer
    if (elapsedTimerInterval) clearInterval(elapsedTimerInterval);
    elapsedTimerInterval = setInterval(() => {
      if (transferStartTime) {
        updateTransferProgress({
          elapsedSeconds: Math.round((Date.now() - transferStartTime) / 1000)
        });
      }
    }, 1000);
    
    // CRITICAL: Request one book at a time and wait for its transfer to complete
    for (let i = 0; i < selectedBooks.length; i++) {
      // Check for cancellation
      if (transferCancelled) {
        console.log('❌ Transfer cancelled - stopping');
        log('Transfer cancelled', 'warning');
        break;
      }
      
      const note = selectedBooks[i];
      const normalizedBookId = normalizeBookId(note.Note);
      
      console.log(`%c📖 Requesting note ${i + 1}/${selectedBooks.length}: S${note.Section}/O${note.Owner}/B${normalizedBookId}`, 'color: #2196F3; font-weight: bold;', {
        Section: note.Section,
        Owner: note.Owner,
        Book: note.Note,
        BookType: typeof note.Note,
        NormalizedBookId: normalizedBookId,
        PageCount: note.PageCount || 'unknown'
      });
      
      // Reset per-transfer state
      dataReceivedForCurrentTransfer = false;
      lastDataReceivedTime = null;
      
      // Update progress for this book
      updateTransferProgress({
        currentBook: i + 1,
        status: 'requesting'
      });
      
      // Create a promise that resolves when this transfer completes
      const transferComplete = new Promise((resolve, reject) => {
        pendingOfflineTransfer = normalizedBookId;
        offlineTransferResolver = resolve;
        
        // Enable batch mode to pause canvas updates during import
        startBatchMode();
        console.log(`📊 Batch mode enabled for book ${normalizedBookId}`);
        
        // Only use idle detection - no global timeout!
        // Transfer completes when no new data for IDLE_TIMEOUT_MS
        const idleCheckInterval = setInterval(() => {
          // Check for cancellation
          if (transferCancelled) {
            clearInterval(idleCheckInterval);
            return;
          }
          
          if (pendingOfflineTransfer !== normalizedBookId) {
            clearInterval(idleCheckInterval);
            return;
          }
          
          if (dataReceivedForCurrentTransfer && lastDataReceivedTime) {
            const idleTime = Date.now() - lastDataReceivedTime;
            
            // Log progress periodically (every 2-3 seconds of idle)
            if (idleTime > 2000 && idleTime < 3000) {
              const elapsed = Math.round((Date.now() - transferStartTime) / 1000);
              console.log(`📊 Transfer status: ${receivedStrokesTotal} strokes, ${elapsed}s elapsed, idle ${Math.round(idleTime/1000)}s`);
            }
            
            if (idleTime > TRANSFER_CONFIG.IDLE_TIMEOUT_MS) {
              const elapsed = Math.round((Date.now() - transferStartTime) / 1000);
              console.log(`📋 No new data for ${Math.round(idleTime/1000)}s - book transfer complete`);
              clearInterval(idleCheckInterval);
              resolve({ idleTimeout: true });
            }
          }
        }, TRANSFER_CONFIG.IDLE_CHECK_INTERVAL_MS);
      });
      
      // Request the data
      controller.RequestOfflineData(
        note.Section, 
        note.Owner, 
        note.Note,  // Use original value for SDK call
        false, // Don't delete after download
        []     // All pages
      );
      
      // Wait for this transfer to complete before requesting the next one
      try {
        const result = await transferComplete;
        
        if (result?.cancelled) {
          console.log(`❌ Book ${normalizedBookId} transfer was cancelled`);
          updateTransferProgress({ status: 'cancelled' });
        } else if (result?.failed) {
          console.error(`❌ Book ${normalizedBookId} transfer reported failure`);
          updateTransferProgress({ status: 'error' });
        } else if (result?.empty) {
          console.log(`📋 Book ${normalizedBookId} was empty`);
        } else if (result?.idleTimeout) {
          console.log(`✅ Book ${normalizedBookId} completed`);
        } else {
          console.log(`✅ Book ${normalizedBookId} transfer completed normally`);
        }
        
        // Disable batch mode to trigger canvas update
        endBatchMode();
        console.log(`🎨 Batch mode disabled - canvas updating`);
        
        // Longer delay between books to ensure BLE connection stabilizes
        if (i < selectedBooks.length - 1 && !transferCancelled) {
          updateTransferProgress({ status: 'waiting' });
          console.log(`⏳ Waiting ${TRANSFER_CONFIG.INTER_BOOK_DELAY_MS}ms before next request...`);
          await new Promise(resolve => setTimeout(resolve, TRANSFER_CONFIG.INTER_BOOK_DELAY_MS));
        }
      } catch (error) {
        console.error(`❌ Transfer failed for book ${normalizedBookId}:`, error);
        
        // Disable batch mode even on failure
        endBatchMode();
        updateTransferProgress({ status: 'error' });
        // Continue to next book even if this one failed
      }
    }
    
    // Stop elapsed timer
    if (elapsedTimerInterval) {
      clearInterval(elapsedTimerInterval);
      elapsedTimerInterval = null;
    }
    
    // Reset transfer state
    pendingOfflineTransfer = null;
    offlineTransferResolver = null;
    dataReceivedForCurrentTransfer = false;
    lastDataReceivedTime = null;
    transferCancelled = false;
    
    // Log final stats
    const totalElapsed = Math.round((Date.now() - transferStartTime) / 1000);
    console.log(`✅ All offline data transfers completed: ${receivedStrokesTotal} strokes in ${totalElapsed}s`);
    
    // Clear progress after a short delay so user can see "complete" status
    updateTransferProgress({ status: 'complete', canCancel: false });
    setTimeout(() => {
      resetTransferProgress();
    }, 2000);
  } else {
    console.log('❌ Download cancelled by user');
  }
  console.log('%c===== END OFFLINE NOTE LIST PROCESSING =====', 'background: #222; color: #bada55; font-size: 14px; padding: 4px;');
}

function handleOfflineDataReceived(data) {
  const receiveTime = Date.now();
  
  // ========================================
  // DELETION MODE CHECK - HIGHEST PRIORITY
  // ========================================
  if (isDeletionMode) {
    console.log('%c🗑️ DELETION MODE - Discarding received data', 
      'background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px;');
    
    // Count strokes for logging
    const strokeCount = Array.isArray(data) ? data.length : 0;
    console.log(`📦 Discarding ${strokeCount} strokes from deleted book`);
    
    // Resolve the pending transfer (deletion successful)
    if (offlineTransferResolver) {
      offlineTransferResolver({ deleted: true });
    }
    
    // CRITICAL: Return early - do NOT add to stores
    return;
  }
  
  // ========================================
  // NORMAL IMPORT MODE - EXISTING LOGIC
  // ========================================
  
  const timeSinceStart = transferStartTime ? Math.round((receiveTime - transferStartTime) / 1000) : 0;
  const timeSinceLast = lastDataReceivedTime ? Math.round((receiveTime - lastDataReceivedTime) / 1000) : 0;
  
  console.log('%c===== OFFLINE DATA RECEIVED =====', 'background: #FF9800; color: white; font-size: 14px; padding: 4px;');
  console.log(`⏱️ Timing: ${timeSinceStart}s since start${timeSinceLast > 0 ? `, ${timeSinceLast}s since last chunk` : ''}`);
  console.log('📦 Raw data type:', Array.isArray(data) ? 'array' : typeof data);
  console.log('📦 Raw data length:', Array.isArray(data) ? data.length : 'N/A');
  
  // Update timing for idle detection
  lastDataReceivedTime = Date.now();
  dataReceivedForCurrentTransfer = true;
  
  if (!Array.isArray(data)) {
    console.error('❌ Data is not an array!', data);
    return;
  }
  
  const convertedStrokes = [];
  const bookStats = {}; // Track strokes per book
  const pageStats = {};  // Track strokes per page
  let skippedCount = 0;
  let detectedBook = null;
  let detectedBookRaw = null;  // Keep raw value for debugging
  
  // Process offline strokes
  data.forEach((stroke, index) => {
    if (stroke.Dots && Array.isArray(stroke.Dots)) {
      const firstDot = stroke.Dots[0];
      const pageInfo = firstDot?.pageInfo || {};
      const bookIdRaw = pageInfo.book;
      const bookId = normalizeBookId(bookIdRaw);
      
      // Track which book this batch belongs to
      if (!detectedBook) {
        detectedBook = bookId;
        detectedBookRaw = bookIdRaw;
      }
      
      // Track which books we're seeing
      if (!bookStats[bookId]) {
        bookStats[bookId] = 0;
      }
      bookStats[bookId]++;
      
      // Track which pages we're seeing
      const pageKey = `B${bookId}/P${pageInfo.page || 0}`;
      if (!pageStats[pageKey]) {
        pageStats[pageKey] = 0;
      }
      pageStats[pageKey]++;
      
      // Log first stroke from each book for debugging
      if (bookStats[bookId] === 1) {
        console.log(`%c📖 First stroke from book B${bookId}`, 'color: #9C27B0; font-weight: bold;', {
          strokeIndex: index,
          section: pageInfo.section,
          owner: pageInfo.owner,
          book: bookIdRaw,
          bookType: typeof bookIdRaw,
          normalizedBook: bookId,
          page: pageInfo.page,
          dotCount: stroke.Dots.length
        });
      }
      
      const convertedStroke = {
        pageInfo: pageInfo,
        startTime: firstDot?.timeStamp || 0,
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
      
      // Skip canvas rendering during batch mode - will update once at the end
      // Only render in real-time mode
      if (canvasRenderer && !pendingOfflineTransfer) {
        stroke.Dots.forEach(dot => canvasRenderer.addDot(dot));
      }
    } else {
      skippedCount++;
      if (skippedCount <= 5) {
        console.warn(`⚠️ Stroke ${index} has no Dots array (${skippedCount} total skipped so far)`);
      }
    }
  });
  
  // Log final skipped count if more than 5
  if (skippedCount > 5) {
    console.warn(`⚠️ Total strokes skipped (no Dots array): ${skippedCount}`);
  }
  
  console.log('%c📊 Book Statistics:', 'color: #00BCD4; font-weight: bold; font-size: 13px;', bookStats);
  console.log('%c📄 Page Statistics:', 'color: #00BCD4; font-weight: bold; font-size: 13px;', pageStats);
  console.log(`✅ Total converted strokes: ${convertedStrokes.length} across ${Object.keys(pageStats).length} pages${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`);
  
  // Debug: Log comparison values
  console.log('%c🔍 Transfer Matching Debug:', 'color: #FF5722; font-weight: bold;', {
    detectedBook,
    detectedBookRaw,
    detectedBookType: typeof detectedBookRaw,
    pendingOfflineTransfer,
    pendingType: typeof pendingOfflineTransfer,
    match: detectedBook === pendingOfflineTransfer
  });
  
  // Add all strokes to store
  addOfflineStrokes(convertedStrokes);
  
  const elapsed = transferStartTime ? Math.round((Date.now() - transferStartTime) / 1000) : 0;
  const rate = elapsed > 0 ? Math.round(convertedStrokes.length / elapsed) : convertedStrokes.length;
  log(`Received ${convertedStrokes.length} strokes from ${Object.keys(bookStats).length} book(s) (${elapsed}s, ~${rate} strokes/sec)`, 'success');
  console.log('%c===== END OFFLINE DATA PROCESSING =====', 'background: #FF9800; color: white; font-size: 14px; padding: 4px;');
  
  // Track progress - running stroke total
  if (detectedBook && pendingOfflineTransfer && detectedBook === pendingOfflineTransfer) {
    // Add to running stroke total
    receivedStrokesTotal += convertedStrokes.length;
    
    // Update progress store
    updateTransferProgress({
      receivedStrokes: receivedStrokesTotal,
      status: 'receiving'
    });
    
    console.log(`📊 Progress: ${receivedStrokesTotal} strokes total`);
  } else if (detectedBook && pendingOfflineTransfer && detectedBook !== pendingOfflineTransfer) {
    // This is a problem - data doesn't match what we're waiting for
    console.warn('%c⚠️ BOOK ID MISMATCH!', 'background: #f44336; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;');
    console.warn(`   Received data for book: ${detectedBook} (raw: ${detectedBookRaw}, type: ${typeof detectedBookRaw})`);
    console.warn(`   But waiting for book: ${pendingOfflineTransfer} (type: ${typeof pendingOfflineTransfer})`);
    console.warn(`   Data was still added to store - but transfer tracking may be broken`);
    
    // Even though there's a mismatch, data was received, so update the idle timer
    // The idle detection will eventually complete the transfer
  }
}
