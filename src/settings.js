/**
 * Settings Persistence (LocalStorage)
 */

import { elements } from './elements.js';
import { log } from './logger.js';

export function saveSettings() {
  const settings = {
    myscriptAppKey: elements.myscriptAppKey.value,
    myscriptHmacKey: elements.myscriptHmacKey.value,
    logseqHost: elements.logseqHost.value,
  };
  localStorage.setItem('smartpen-bridge-settings', JSON.stringify(settings));
}

export function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('smartpen-bridge-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.myscriptAppKey) elements.myscriptAppKey.value = settings.myscriptAppKey;
      if (settings.myscriptHmacKey) elements.myscriptHmacKey.value = settings.myscriptHmacKey;
      if (settings.logseqHost) elements.logseqHost.value = settings.logseqHost;
      log('Settings loaded from localStorage', 'info');
    }
  } catch (e) {
    console.warn('Failed to load saved settings:', e);
  }
}
