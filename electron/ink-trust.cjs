/**
 * ink-trust — is a page's transcript linked to its ink? For the capture-date
 * index (`_timeline.json` entries' `linked`), so the Library's left panel can
 * show how many pages are still to relink without the renderer reading pages.
 *
 * MIRRORS `isTrustworthyTranscript()` in src/lib/viewer/ink-text.js (main is
 * CommonJS and can't import it); change both. `ink-trust.test.js` runs both
 * over the same docs.
 *
 * `pageLinked(raw)` reads the document shell first (the hybrid serializer
 * writes "strokes" last, as extractPageMeta relies on), so a page with no
 * transcript or one last transcribed before TRUST_SINCE is answered without
 * parsing its strokes. Only the rest are parsed in full, and the index caches
 * the answer by mtime + size.
 */

const TRUST_SINCE = '2026-08-01';
const PRE_FIX_TOLERANCE = 5;
const PRE_FIX_SIGNATURE = 0.9;

function usableYBounds(yb) {
  return yb && Number.isFinite(yb.minY) && Number.isFinite(yb.maxY) && !(yb.minY === 0 && yb.maxY === 0);
}

function yRange(points) {
  let min = Infinity, max = -Infinity;
  for (const p of points || []) {
    const y = p && p[1];
    if (!Number.isFinite(y)) continue;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return min <= max ? { min, max } : null;
}

/** Mirror of ink-text.js isTrustworthyTranscript(doc). */
function isTrustworthyTranscript(doc) {
  const t = doc && doc.transcript;
  const lines = (t && t.lines) || [];
  if (!lines.length) return false;
  const when = typeof t.lastTranscribed === 'string' ? t.lastTranscribed.slice(0, 10) : '';
  if (!(when >= TRUST_SINCE)) return false;

  const yb = new Map();
  for (const l of lines) if (l && l.id && usableYBounds(l.yBounds)) yb.set(l.id, l.yBounds);

  let linked = 0, oldStyle = 0;
  for (const s of (doc && doc.strokes) || []) {
    const b = s && s.lineId ? yb.get(s.lineId) : null;
    if (!b) continue;
    const r = yRange(s.points);
    if (!r) continue;
    linked++;
    if (Math.min(r.max, b.maxY) - Math.max(r.min, b.minY) >= -PRE_FIX_TOLERANCE) oldStyle++;
  }
  return linked > 0 && oldStyle / linked < PRE_FIX_SIGNATURE;
}

/**
 * From a PageDoc's raw JSON: true / false for a page with transcript lines,
 * null for a page without (nothing to link). Throws only on unreadable JSON.
 */
function pageLinked(raw) {
  const marker = '\n  "strokes":';
  const idx = raw.lastIndexOf(marker);
  let shell = null;
  if (idx !== -1) {
    try { shell = JSON.parse(raw.slice(0, idx).replace(/,\s*$/, '') + '\n}'); } catch { shell = null; }
  }
  if (shell) {
    const t = shell.transcript;
    const lines = (t && t.lines) || [];
    if (!lines.length) return null;
    const when = typeof t.lastTranscribed === 'string' ? t.lastTranscribed.slice(0, 10) : '';
    if (!(when >= TRUST_SINCE)) return false;
  }
  const doc = JSON.parse(raw);
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  if (!lines.length) return null;
  return isTrustworthyTranscript(doc);
}

module.exports = { isTrustworthyTranscript, pageLinked, TRUST_SINCE };
