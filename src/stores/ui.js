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
