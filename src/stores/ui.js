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

// Log messages
export const logMessages = writable([]);

// Maximum log entries to keep
const MAX_LOG_ENTRIES = 50;

/**
 * Add a log message
 * @param {string} message 
 * @param {'info' | 'success' | 'warning' | 'error'} level 
 */
export function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = { time, message, level, id: Date.now() };
  
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
 * Clear log messages
 */
export function clearLog() {
  logMessages.set([]);
}
