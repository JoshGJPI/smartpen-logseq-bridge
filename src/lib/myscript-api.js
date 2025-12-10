/**
 * MyScript API Wrapper for Svelte
 * Provides simple functions to interact with MyScript API
 */

import { MyScriptAPI } from '../myscript-api.js';

// Singleton instance
let apiInstance = null;

/**
 * Get or create API instance
 */
function getAPI(appKey, hmacKey) {
  if (!apiInstance) {
    apiInstance = new MyScriptAPI(appKey, hmacKey);
  } else {
    apiInstance.setCredentials(appKey, hmacKey);
  }
  return apiInstance;
}

/**
 * Test MyScript credentials
 * @param {string} appKey - Application Key
 * @param {string} hmacKey - HMAC Key
 * @returns {Promise<Object>} Test result { success, error?, status? }
 */
export async function testMyScriptCredentials(appKey, hmacKey) {
  const api = getAPI(appKey, hmacKey);
  return await api.testCredentials();
}

/**
 * Transcribe strokes to text
 * @param {Array} strokes - Array of stroke objects with dotArray
 * @param {string} appKey - Application Key
 * @param {string} hmacKey - HMAC Key
 * @param {Object} options - Recognition options
 * @returns {Promise<Object>} Transcription result with text, lines, commands, etc.
 */
export async function transcribeStrokes(strokes, appKey, hmacKey, options = {}) {
  const api = getAPI(appKey, hmacKey);
  return await api.recognizeWithRetry(strokes, options);
}

/**
 * Check if credentials are configured
 * @param {string} appKey 
 * @param {string} hmacKey 
 * @returns {boolean}
 */
export function hasCredentials(appKey, hmacKey) {
  return !!(appKey && appKey.trim() && hmacKey && hmacKey.trim());
}

// Re-export the class for advanced usage
export { MyScriptAPI };
