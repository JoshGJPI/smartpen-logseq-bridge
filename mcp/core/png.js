/**
 * Grayscale PNG encoder for rendered pages (no dependencies beyond node:zlib).
 *
 * resvg emits 8-bit RGBA. Ink renders are line art on white, so colour and alpha
 * carry nothing: a grayscale PNG is a quarter of the raw bytes, and at 4 bits per
 * pixel (16 grey levels, enough for antialiased edges and the context halftone)
 * an eighth. Each row gets the PNG filter with the smallest sum of absolute
 * residuals (the libpng heuristic), then one deflate pass.
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGBA (composited on white) → one luminance byte per pixel. */
export function rgbaToGray(rgba, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const a = rgba[i + 3] / 255;
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    out[j] = Math.round(y * a + 255 * (1 - a));
  }
  return out;
}

/** Pack 8-bit grey into rows of `bits` per pixel (8, 4 or 2). */
function packRows(gray, width, height, bits) {
  const levels = (1 << bits) - 1;
  const rowBytes = Math.ceil((width * bits) / 8);
  const rows = new Uint8Array(rowBytes * height);
  const per = 8 / bits;
  for (let y = 0; y < height; y++) {
    const o = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const v = bits === 8 ? gray[y * width + x] : Math.round((gray[y * width + x] * levels) / 255);
      if (bits === 8) rows[o + x] = v;
      else rows[o + Math.floor(x / per)] |= v << (8 - bits * ((x % per) + 1));
    }
  }
  return { rows, rowBytes };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filter every row with the cheapest of the five PNG filters. */
function filterRows(rows, rowBytes, height, bpp) {
  const out = Buffer.alloc((rowBytes + 1) * height);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(rowBytes));
  for (let y = 0; y < height; y++) {
    const cur = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev = y ? rows.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const d = i >= bpp && prev ? prev[i - bpp] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, d);
        const v = (cur[i] - pred) & 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    // A candidate stops early only once it has lost, so the winner's row is complete.
    const o = y * (rowBytes + 1);
    out[o] = best;
    out.set(cand[best], o + 1);
  }
  return out;
}

/**
 * Encode 8-bit grey pixels as a grayscale PNG.
 * @param {Uint8Array} gray  width*height luminance bytes
 * @param {number} width
 * @param {number} height
 * @param {8|4|2} [bits]  bits per pixel (default 4: 16 grey levels)
 * @returns {Buffer}
 */
export function encodeGrayPng(gray, width, height, bits = 4) {
  if (![2, 4, 8].includes(bits)) throw new Error(`Unsupported bit depth ${bits}`);
  const { rows, rowBytes } = packRows(gray, width, height, bits);
  const filtered = filterRows(rows, rowBytes, height, 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bits;   // bit depth
  ihdr[9] = 0;      // colour type 0: greyscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
