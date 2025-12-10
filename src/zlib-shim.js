/**
 * Zlib wrapper for browser compatibility
 * The SDK expects zlib.default.unzip, so we wrap pako to provide that interface
 */

import * as pako from 'pako';
import { Buffer } from 'buffer';

// Create a Node.js-compatible zlib interface using pako
const zlibShim = {
  unzip: function(buffer, callback) {
    try {
      // Convert input to Uint8Array if needed
      const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      // pako.inflate handles zlib/deflate compressed data
      const result = pako.inflate(input);
      // Convert to Buffer for Node.js compatibility
      const bufferResult = Buffer.from(result);
      // Call callback in async style (error, result)
      setTimeout(() => callback(null, bufferResult), 0);
    } catch (err) {
      console.error('zlib unzip error:', err);
      setTimeout(() => callback(err, null), 0);
    }
  },
  
  inflate: function(buffer, callback) {
    try {
      const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const result = pako.inflate(input);
      const bufferResult = Buffer.from(result);
      setTimeout(() => callback(null, bufferResult), 0);
    } catch (err) {
      console.error('zlib inflate error:', err);
      setTimeout(() => callback(err, null), 0);
    }
  },
  
  inflateSync: function(buffer) {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Buffer.from(pako.inflate(input));
  },
  
  unzipSync: function(buffer) {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Buffer.from(pako.inflate(input));
  },
  
  deflate: function(buffer, callback) {
    try {
      const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const result = pako.deflate(input);
      const bufferResult = Buffer.from(result);
      setTimeout(() => callback(null, bufferResult), 0);
    } catch (err) {
      setTimeout(() => callback(err, null), 0);
    }
  },
  
  deflateSync: function(buffer) {
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Buffer.from(pako.deflate(input));
  },
  
  // gunzip is often used interchangeably with unzip
  gunzip: function(buffer, callback) {
    return this.unzip(buffer, callback);
  },
  
  gunzipSync: function(buffer) {
    return this.unzipSync(buffer);
  }
};

// Export both as default and named for compatibility with different import styles
export default zlibShim;
export { zlibShim as zlib };
export const unzip = zlibShim.unzip;
export const inflate = zlibShim.inflate;
export const inflateSync = zlibShim.inflateSync;
export const unzipSync = zlibShim.unzipSync;
export const deflate = zlibShim.deflate;
export const deflateSync = zlibShim.deflateSync;
export const gunzip = zlibShim.gunzip;
export const gunzipSync = zlibShim.gunzipSync;
