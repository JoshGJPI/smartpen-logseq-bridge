/**
 * Pen Store - Manages pen connection state
 */
import { writable, derived } from 'svelte/store';

// Connection state
export const penConnected = writable(false);
export const penAuthorized = writable(false);

// Pen info (battery, model, etc.)
export const penInfo = writable(null);

// Pen controller reference (for SDK calls)
export const penController = writable(null);

// Offline transfer progress
export const transferProgress = writable({
  active: false,
  currentBook: null,
  currentBookIndex: 0,
  totalBooks: 0,
  expectedStrokes: 0,
  receivedStrokes: 0,
  elapsedSeconds: 0,
  status: '', // 'requesting', 'receiving', 'processing', 'complete', 'error'
  canCancel: false
});

// Derived: Can we use the pen?
export const penReady = derived(
  [penConnected, penAuthorized],
  ([$connected, $authorized]) => $connected && $authorized
);

// Derived: Battery level
export const penBattery = derived(penInfo, $info => {
  if (!$info) return null;
  if ($info.Battery === 128) return 'Charging';
  return `${$info.Battery}%`;
});

// Derived: Memory usage
export const penMemory = derived(penInfo, $info => {
  if (!$info) return null;
  return `${$info.UsedMem || 0}%`;
});

// Derived: Transfer percentage
export const transferPercent = derived(transferProgress, $progress => {
  if (!$progress.active || $progress.expectedStrokes === 0) return 0;
  return Math.min(100, Math.round(($progress.receivedStrokes / $progress.expectedStrokes) * 100));
});

/**
 * Set pen connected state
 * @param {boolean} connected 
 */
export function setPenConnected(connected) {
  penConnected.set(connected);
  if (!connected) {
    penAuthorized.set(false);
    penInfo.set(null);
    penController.set(null);
  }
}

/**
 * Set pen authorized
 * @param {boolean} authorized 
 */
export function setPenAuthorized(authorized) {
  penAuthorized.set(authorized);
}

/**
 * Update pen info
 * @param {Object} info 
 */
export function setPenInfo(info) {
  penInfo.set(info);
}

/**
 * Set pen controller
 * @param {Object} controller 
 */
export function setPenController(controller) {
  penController.set(controller);
}

/**
 * Update transfer progress
 * @param {Object} updates - Partial progress object
 */
export function updateTransferProgress(updates) {
  transferProgress.update(p => ({ ...p, ...updates }));
}

/**
 * Reset transfer progress to initial state
 */
export function resetTransferProgress() {
  transferProgress.set({
    active: false,
    currentBook: null,
    currentBookIndex: 0,
    totalBooks: 0,
    expectedStrokes: 0,
    receivedStrokes: 0,
    elapsedSeconds: 0,
    status: '',
    canCancel: false
  });
}
