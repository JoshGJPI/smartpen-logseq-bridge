/**
 * Polyfills for Node.js globals needed by web_pen_sdk
 * This file is imported before the SDK
 */

import { Buffer } from 'buffer';
import process from 'process';

// Make Buffer globally available
globalThis.Buffer = Buffer;
window.Buffer = Buffer;

// Make process globally available
globalThis.process = process;
window.process = process;

console.log('Polyfills loaded (Buffer, process)');
console.log('zlib shim will be loaded via Vite alias');
