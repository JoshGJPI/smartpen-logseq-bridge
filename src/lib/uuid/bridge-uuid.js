/**
 * SmartPen-LogSeq Bridge UUID Generator
 * 
 * Generates custom UUIDs for transcription blocks to prevent collisions
 * when creating multiple blocks rapidly via LogSeq's HTTP API.
 * 
 * Format: Uses LogSeq's random UUID generation but replaces the first
 * 4 characters of the last segment with 'b12d' (LEET for "bridge").
 * 
 * Example:
 *   Standard: 67892abc-4d3e-f21a-8f2e-3a7b9c4e1d5f
 *   Custom:   67892abc-4d3e-f21a-8f2e-b12d9c4e1d5f
 *                                       ^^^^
 *                                       Bridge ID
 */

/**
 * Generate a random UUID string (client-side fallback)
 * Uses crypto.randomUUID() if available, otherwise generates manually
 * @returns {string} UUID string
 */
function generateRandomUUID() {
  // Try browser's crypto API first
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback: Manual generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a custom UUID for SmartPen-LogSeq Bridge blocks
 * 
 * @returns {string} UUID with 'b12d' prefix in last segment
 */
export function generateBridgeUUID() {
  // Generate base UUID
  const baseUUID = generateRandomUUID();
  
  // Split into segments
  const parts = baseUUID.split('-');
  
  // Replace first 4 characters of last segment with 'b12d'
  // Keep the remaining 8 characters for randomness
  parts[4] = 'b12d' + parts[4].slice(4);
  
  return parts.join('-');
}

/**
 * Extract bridge ID from a custom UUID
 * 
 * @param {string} uuid - UUID to check
 * @returns {string|null} 'b12d' if custom bridge UUID, null otherwise
 */
export function extractBridgeId(uuid) {
  if (!uuid || typeof uuid !== 'string') return null;
  
  const parts = uuid.split('-');
  if (parts.length !== 5) return null;
  
  const lastSegment = parts[4];
  if (lastSegment.startsWith('b12d')) {
    return 'b12d';
  }
  
  return null;
}

/**
 * Check if a UUID is a bridge-generated UUID
 * 
 * @param {string} uuid - UUID to check
 * @returns {boolean} True if bridge UUID
 */
export function isBridgeUUID(uuid) {
  return extractBridgeId(uuid) !== null;
}

/**
 * Generate multiple unique UUIDs for batch operations
 * 
 * @param {number} count - Number of UUIDs to generate
 * @returns {string[]} Array of unique UUIDs
 */
export function generateBridgeUUIDs(count) {
  const uuids = new Set();
  
  while (uuids.size < count) {
    uuids.add(generateBridgeUUID());
  }
  
  return Array.from(uuids);
}

/**
 * Debug function to log UUID format
 * Useful for verifying the custom format
 */
export function debugBridgeUUID() {
  const uuid = generateBridgeUUID();
  console.log('=== Bridge UUID Debug ===');
  console.log('Generated UUID:', uuid);
  console.log('Bridge ID:', extractBridgeId(uuid));
  console.log('Is Bridge UUID:', isBridgeUUID(uuid));
  console.log('Format: xxxxxxxx-xxxx-xxxx-xxxx-b12dxxxxxxxx');
  console.log('                                ^^^^');
  console.log('                                Bridge prefix');
  return uuid;
}

// Make debug function available globally in development
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.debugBridgeUUID = debugBridgeUUID;
}
