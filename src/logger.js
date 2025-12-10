/**
 * Logging Utility
 */

import { elements } from './elements.js';

export function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-${level}">${message}</span>`;
  elements.messageLog.insertBefore(entry, elements.messageLog.firstChild);
  
  // Keep only last 50 entries
  while (elements.messageLog.children.length > 50) {
    elements.messageLog.removeChild(elements.messageLog.lastChild);
  }
  
  console.log(`[${level.toUpperCase()}] ${message}`);
}
