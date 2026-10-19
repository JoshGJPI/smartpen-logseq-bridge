/**
 * ink-text — Book View's Ink + text mode: which pages may link a transcript
 * line to its ink, and which ink that is (reading-first package D). Pure.
 *
 * WHY THE LINK IS THE STORED lineId, NOT A FRESH yBounds MATCH. A line's
 * `yBounds` are MyScript millimetres from the top of the batch that was SENT,
 * and that batch origin (`originNcodeY`) lives only in the in-memory
 * transcription entry: it is never written to the PageDoc. A page topped up in
 * several batches has several origins, so after the fact the yBounds cannot be
 * put back on the page exactly. The stroke `lineId`s are the result of exactly
 * that conversion (`yBoundsToNcode` with the real origin, tolerance
 * LINE_MATCH_TOLERANCE_NCODE, most-overlap wins) made at save time, so on a page
 * matched by the fixed code they ARE the line → ink answer.
 *
 * WHICH PAGES. Before the fix (Aug 2026, see CHANGELOG "Stroke→line matching")
 * the save compared raw millimetre yBounds with Ncode stroke Y directly, with a
 * 5-unit tolerance, so on those pages EVERY linked stroke overlaps its line's
 * raw yBounds ± 5. On pages matched by the fixed code that is a coincidence for
 * some strokes only (4–67% across the Oct 2026 corpus; 100% on all 56 older
 * pages). A date alone is not enough: the fix reached the data on 2026-08-26
 * (pages from that morning are still old-style), and a transcript edited in
 * Book View gets a fresh `lastTranscribed` while keeping its old links. So a
 * page is trusted when it was transcribed in or after Aug 2026, has links, and
 * its links do not carry the old signature. A wrong "no" only loses the hover;
 * a wrong "yes" would light the wrong ink, so the test leans to "no".
 *
 * Tested in `src/lib/__tests__/ink-text.test.js`.
 */

/** Pages last transcribed before this cannot have been matched by the fixed code. */
export const TRUST_SINCE = '2026-08-01';

/** The pre-fix matcher's tolerance, in the mixed units it compared (mm vs Ncode). */
export const PRE_FIX_TOLERANCE = 5;

/** Share of links fitting the pre-fix rule at or above which a page is treated as pre-fix. */
export const PRE_FIX_SIGNATURE = 0.9;

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

/**
 * Can this page's lines be linked to its ink?
 *
 * @param {{transcript?: {lastTranscribed?: string|null, lines?: Array}, strokes?: Array}|null} doc
 * @returns {boolean}
 */
export function isTrustworthyTranscript(doc) {
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
 * Strokes per transcript line, by stored `lineId`. Lines with no ink are left
 * out; a link to a line that no longer exists is ignored.
 *
 * @param {Array<{lineId?: string|null}>} strokes
 * @param {Array<{id: string}>} lines
 * @returns {Map<string, Array<Object>>}
 */
export function strokesByLine(strokes, lines) {
  const ids = new Set((lines || []).map((l) => l && l.id).filter(Boolean));
  const out = new Map();
  for (const s of strokes || []) {
    if (!s || !s.lineId || !ids.has(s.lineId)) continue;
    const list = out.get(s.lineId);
    if (list) list.push(s);
    else out.set(s.lineId, [s]);
  }
  return out;
}
