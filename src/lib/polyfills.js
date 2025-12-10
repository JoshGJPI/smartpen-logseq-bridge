/**
 * Polyfills for Node.js globals needed by web_pen_sdk
 * This file is imported before the SDK
 */

import { Buffer } from 'buffer';
import process from 'process';

// Make Buffer globally available
globalThis.Buffer = Buffer;
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.process = process;
}

// Make process globally available
globalThis.process = process;

console.log('Polyfills loaded (Buffer, process)');
