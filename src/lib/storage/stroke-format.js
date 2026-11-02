/**
 * stroke-format — the in-memory pen stroke (`dotArray`) → StoredStroke
 * conversion, with no imports, so pure code outside the save path (Print
 * selection, lib/print/print-selection.js) uses the exact same conversion.
 * save-page.js re-exports both functions.
 */

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a pen-format stroke (with dotArray) to v2 StoredStroke shape.
 *
 * Point tuples are variable length — `[x, y]`, `[x, y, ts]`, or
 * `[x, y, ts|null, force]` — so that pressure can ride along without disturbing
 * files or readers that predate it. Force is written whenever the dot has one,
 * regardless of whether the stroke is flagged as a sketch: see the StoredStroke
 * typedef for why that has to be unconditional.
 *
 * @param {Object} stroke - { startTime, endTime, blockUuid?, sketch?, dotArray: [{x,y,f?,timestamp?}] }
 * @returns {import('./page-doc.js').StoredStroke}
 */
export function strokeToStored(stroke) {
  const points = (stroke.dotArray || []).map(d => {
    const x = round2(d.x);
    const y = round2(d.y);
    const hasTs = typeof d.timestamp === 'number';
    // Pen force arrives as a 16-bit integer; keep it integral so the extra
    // column costs ~4 characters per point rather than a full float.
    const f = (d.f === null || d.f === undefined || typeof d.f === 'boolean')
      ? NaN
      : Number(d.f);
    if (!Number.isFinite(f)) {
      return hasTs ? [x, y, d.timestamp] : [x, y];
    }
    // Force must keep a fixed index, so an unrecorded timestamp becomes an
    // explicit null placeholder rather than shifting force into slot 2.
    return [x, y, hasTs ? d.timestamp : null, Math.round(f)];
  });

  const stored = {
    id: `s${stroke.startTime}`,
    startTime: stroke.startTime,
    endTime: stroke.endTime,
    lineId: stroke.blockUuid || stroke.lineId || null
  };
  // Omitted when false so handwriting pages serialize exactly as they did before
  // sketch strokes existed.
  if (stroke.sketch) stored.sketch = true;
  stored.points = points;
  return stored;
}
