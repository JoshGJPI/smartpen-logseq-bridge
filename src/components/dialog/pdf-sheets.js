/**
 * pdf-sheets — draws the Print dialog's preview PDF onto a canvas with pdf.js
 * (v3.9.0). pdf.js is loaded on first use, so it costs nothing until a preview
 * is shown; its worker is bundled by Vite (`?url`) and runs from the app's own
 * files in the packaged build too.
 *
 * DOM code (canvas), so it lives beside the component rather than in src/lib.
 */

let lib = null;

async function pdfjs() {
  if (!lib) {
    const [m, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    lib = m;
  }
  return lib;
}

/**
 * Open PDF bytes. The caller destroys the document when done with it.
 * @param {Uint8Array} bytes  (transferred to the worker: don't reuse them)
 */
export async function openPdf(bytes) {
  const m = await pdfjs();
  return m.getDocument({ data: bytes, isEvalSupported: false }).promise;
}

/**
 * Draw sheet `n` (1-based) as large as fits `maxW` × `maxH` CSS pixels, sharp on
 * high-DPI screens. It renders off screen and copies across when done, so the
 * old sheet stays up meanwhile (no white flash while options change).
 * `isStale()` is asked before copying; a stale draw leaves the canvas alone.
 */
export async function drawSheet(doc, n, canvas, maxW, maxH, isStale = () => false) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.max(0.05, Math.min(maxW / base.width, maxH / base.height));
  const dpr = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: fit * dpr });
  const off = document.createElement('canvas');
  off.width = Math.floor(vp.width);
  off.height = Math.floor(vp.height);
  await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
  if (isStale()) return;
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.style.width = `${Math.floor(off.width / dpr)}px`;
  canvas.style.height = `${Math.floor(off.height / dpr)}px`;
  canvas.getContext('2d').drawImage(off, 0, 0);
}
