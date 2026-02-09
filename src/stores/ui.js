/**
 * UI Store - UI state management
 */
import { writable, derived } from 'svelte/store';

// Active tab in data explorer
export const activeTab = writable('strokes'); // 'strokes' | 'raw' | 'analysis' | 'transcription'

// Sidebar collapsed state
export const sidebarCollapsed = writable(false);

// Canvas zoom level
export const canvasZoom = writable(1);

// Show line guides overlay
export const showLineGuides = writable(false);

// Show filtered decorative strokes
export const showFilteredStrokes = writable(false);

// Log messages
export const logMessages = writable([]);

// Book selection dialog state
export const bookSelectionDialog = writable({
  isOpen: false,
  books: [],
  onConfirm: () => {},
  onCancel: () => {}
});

// Search transcripts dialog state
export const showSearchTranscriptsDialog = writable(false);

// SVG export dialog state
export const svgExportDialog = writable({
  isOpen: false,
  strokes: [],
  pageGroups: []
});

// Bluetooth device picker state
export const bluetoothPicker = writable({
  isOpen: false,
  devices: [],
  selectedDeviceId: null,
  status: 'scanning', // 'scanning' | 'connecting' | 'connected' | 'error'
  error: null
});

// Maximum log entries to keep
const MAX_LOG_ENTRIES = 50;

// Counter for unique log IDs (Date.now() alone can produce duplicates)
let logIdCounter = 0;

/**
 * Add a log message
 * @param {string} message 
 * @param {'info' | 'success' | 'warning' | 'error'} level 
 */
export function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  // Combine timestamp with counter to guarantee unique IDs
  const entry = { time, message, level, id: `${Date.now()}-${logIdCounter++}` };
  
  logMessages.update(logs => {
    const newLogs = [entry, ...logs];
    // Keep only MAX_LOG_ENTRIES
    return newLogs.slice(0, MAX_LOG_ENTRIES);
  });
  
  // Also log to console
  console.log(`[${level.toUpperCase()}] ${message}`);
}

/**
 * Switch to a specific tab
 * @param {string} tab 
 */
export function setActiveTab(tab) {
  activeTab.set(tab);
}

/**
 * Toggle sidebar
 */
export function toggleSidebar() {
  sidebarCollapsed.update(v => !v);
}

/**
 * Set canvas zoom
 * @param {number} level 
 */
export function setCanvasZoom(level) {
  canvasZoom.set(Math.max(0.25, Math.min(10, level)));
}

/**
 * Toggle line guides
 */
export function toggleLineGuides() {
  showLineGuides.update(v => !v);
}

/**
 * Toggle filtered strokes visualization
 */
export function toggleFilteredStrokes() {
  showFilteredStrokes.update(v => !v);
}

/**
 * Clear log messages
 */
export function clearLog() {
  logMessages.set([]);
}

/**
 * Open search transcripts dialog
 */
export function openSearchTranscriptsDialog() {
  showSearchTranscriptsDialog.set(true);
}

/**
 * Close search transcripts dialog
 */
export function closeSearchTranscriptsDialog() {
  showSearchTranscriptsDialog.set(false);
}

/**
 * Open book selection dialog
 * @param {Array} books - Array of book objects from pen
 * @returns {Promise<Array>} Promise that resolves with selected books or rejects if cancelled
 */
export function openBookSelectionDialog(books) {
  return new Promise((resolve, reject) => {
    bookSelectionDialog.set({
      isOpen: true,
      books,
      onConfirm: (selectedBooks) => {
        bookSelectionDialog.set({
          isOpen: false,
          books: [],
          onConfirm: () => {},
          onCancel: () => {}
        });
        resolve(selectedBooks);
      },
      onCancel: () => {
        bookSelectionDialog.set({
          isOpen: false,
          books: [],
          onConfirm: () => {},
          onCancel: () => {}
        });
        reject(new Error('User cancelled'));
      }
    });
  });
}

/**
 * Open Bluetooth device picker dialog
 */
export function openBluetoothPicker() {
  bluetoothPicker.set({
    isOpen: true,
    devices: [],
    selectedDeviceId: null,
    status: 'scanning',
    error: null
  });
}

/**
 * Update Bluetooth picker devices
 * @param {Array} devices - Array of discovered devices
 */
export function updateBluetoothDevices(devices) {
  bluetoothPicker.update(state => ({
    ...state,
    devices
  }));
}

/**
 * Set Bluetooth picker status
 * @param {'scanning' | 'connecting' | 'connected' | 'error'} status
 * @param {string|null} error - Error message if status is 'error'
 */
export function setBluetoothStatus(status, error = null) {
  bluetoothPicker.update(state => ({
    ...state,
    status,
    error
  }));
}

/**
 * Close Bluetooth device picker
 */
export function closeBluetoothPicker() {
  bluetoothPicker.set({
    isOpen: false,
    devices: [],
    selectedDeviceId: null,
    status: 'scanning',
    error: null
  });
}

/**
 * Open SVG export dialog with strokes grouped by page
 * @param {Array} strokeList - Strokes to export
 */
export function openSvgExportDialog(strokeList) {
  // Group strokes by book-page
  const groupMap = new Map();
  strokeList.forEach(stroke => {
    const pi = stroke.pageInfo;
    if (!pi || pi.book === undefined || pi.page === undefined) return;
    const key = `${pi.book}-${pi.page}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { book: pi.book, page: pi.page, key, strokes: [] });
    }
    groupMap.get(key).strokes.push(stroke);
  });

  const pageGroups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.book !== b.book) return a.book - b.book;
    return a.page - b.page;
  });

  svgExportDialog.set({ isOpen: true, strokes: strokeList, pageGroups });
}

/**
 * Close SVG export dialog
 */
export function closeSvgExportDialog() {
  svgExportDialog.set({ isOpen: false, strokes: [], pageGroups: [] });
}
