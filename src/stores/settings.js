/**
 * Settings Store - User settings with localStorage persistence
 */
import { writable, derived, get } from 'svelte/store';

const STORAGE_KEY = 'smartpen-bridge-settings';

/**
 * Load a setting from localStorage
 * @param {string} key 
 * @param {any} defaultValue 
 */
function loadSetting(key, defaultValue) {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const settings = JSON.parse(stored);
      return settings[key] !== undefined ? settings[key] : defaultValue;
    }
  } catch (e) {
    console.warn('Failed to load setting:', key, e);
  }
  return defaultValue;
}

/**
 * Save all settings to localStorage
 * @param {Object} settings 
 */
function saveAllSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

/**
 * Create a persisted store that auto-saves to localStorage
 * @param {string} key - Setting key
 * @param {any} defaultValue - Default value
 */
function createPersistedStore(key, defaultValue) {
  const store = writable(loadSetting(key, defaultValue));
  
  store.subscribe(value => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const allSettings = stored ? JSON.parse(stored) : {};
        allSettings[key] = value;
        saveAllSettings(allSettings);
      } catch (e) {
        console.warn('Failed to persist setting:', key, e);
      }
    }
  });
  
  return store;
}

// MyScript API settings
export const myscriptAppKey = createPersistedStore('myscriptAppKey', '');
export const myscriptHmacKey = createPersistedStore('myscriptHmacKey', '');

// v2.0 Local-folder storage settings
export const dataRoot = createPersistedStore('dataRoot', '');           // absolute path
export const dataFolderReady = writable(false);                          // updated at boot / on folder change
export const dataFolderStatusText = writable('Folder: not set');

// Derived store: Check if MyScript credentials are configured
export const hasMyScriptCredentials = derived(
  [myscriptAppKey, myscriptHmacKey],
  ([$appKey, $hmacKey]) => {
    return !!($appKey && $appKey.trim() && $hmacKey && $hmacKey.trim());
  }
);

/**
 * Get current MyScript credentials (one-time read)
 * Useful for API calls
 */
export function getMyScriptCredentials() {
  return {
    appKey: (get(myscriptAppKey) || '').trim(),
    hmacKey: (get(myscriptHmacKey) || '').trim()
  };
}

/**
 * Update local data-folder status
 * @param {boolean} ready
 * @param {string} [statusText]
 */
export function setDataFolderStatus(ready, statusText) {
  dataFolderReady.set(ready);
  if (statusText) dataFolderStatusText.set(statusText);
}

/**
 * Get current data folder path (one-time read).
 * @returns {string} Absolute path or empty string if unset.
 */
export function getDataRoot() {
  return get(dataRoot) || '';
}
