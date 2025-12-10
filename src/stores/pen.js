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
