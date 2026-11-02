/**
 * Decorative stroke detection
 * Finds underlines, ovals and boxes drawn around text so "Deselect Decorative" can leave them out of
 * MyScript transcription, which reads them as letters, brackets or emoji.
 *
 * Detection types:
 *   1. Underlines — straight, near-horizontal strokes, measured along their own axis so a slope or a
 *      wobble doesn't matter. 10 mm or longer always counts; 5-10 mm only with writing sitting on it
 *      (so hyphens and t-bars stay). A line through writing is a strike-through and stays selected,
 *      so MyScript still sees the word crossed out.
 *   2. Loops — one stroke that closes on itself (overshoot allowed), follows its convex outline and
 *      has a stroke mostly inside it: ovals round dates, circled numbers, boxes drawn in one go.
 *   3. Multi-stroke boxes — 2-4 strokes drawn back to back that trace all four sides of a rectangle
 *      round something (project numbers, scripture references).
 *
 * Task boxes (☐ / ☑: small, square, ink in the corners) are never decorative: task-markers.js turns
 * them into TODO / DONE. Detection runs per page: pages share Ncode coordinates, so a box on one page
 * must not "contain" another page's ink.
 *
 * Thresholds were tuned against the whole data folder (Oct 2026); see CHANGELOG, "Deselect Decorative".
 */

// ============================================================================
// TUNABLE PARAMETERS (mm unless noted)
// ============================================================================

// Underlines
const UNDERLINE_MIN_LENGTH = 10;        // always an underline from here
const UNDERLINE_SHORT_LENGTH = 5;       // 5..10 mm only with writing on it
const UNDERLINE_MAX_SLOPE_DEG = 10;
const UNDERLINE_MAX_WOBBLE = 0.8;       // off its own axis (or 4% of its length, if more)
const UNDERLINE_MAX_PATH_RATIO = 1.2;   // path length / axis length
const UNDERLINE_MIN_DOTS = 6;

// Loops and boxes
const ENCLOSURE_MIN_SIZE = 2.5;         // circled single digits are ~3 mm
const MULTI_BOX_MIN_SIZE = 4;           // smaller 2-4 stroke "boxes" are letters (4, D, be)
const ENCLOSURE_MAX_WIDTH = 120;
const ENCLOSURE_MAX_HEIGHT = 60;
const ENCLOSURE_MAX_ASPECT = 14;        // long boxed scripture references reach ~9:1
const LOOP_MIN_DOTS = 8;
const OUTLINE_MIN_PATH_RATIO = 0.85;    // path length / convex-hull perimeter
const OUTLINE_MAX_PATH_RATIO = 2.3;     // a box traced twice is ~1.9
const OUTLINE_MIN_ON_HULL = 0.85;       // fraction of dots on the outline (cursive words fail)
const CONTENT_MIN_INSIDE = 0.7;         // fraction of a stroke's dots inside to count as content
const MULTI_BOX_MAX_STROKES = 4;
const MULTI_BOX_MAX_MS = 8000;          // first to last stroke of one box
const MULTI_BOX_SIDE_COVERAGE = 0.6;    // each side drawn along at least this much of its length
const CHECKBOX_MAX_SIZE = 7.5;          // a task box is smaller than this and square-ish

// Ncode to MM conversion (from pen SDK)
const NCODE_TO_MM = 2.371;              // 1 Ncode unit × 2.371 = 1mm

// ============================================================================
// GEOMETRY
// ============================================================================

/**
 * Measure a stroke once: points in mm, bounds, path length, time.
 * @param {Object} stroke - Stroke with dotArray
 * @param {number} index - Position in the caller's array
 * @returns {Object|null} null for strokes with fewer than 2 dots
 */
function measure(stroke, index) {
  const dots = stroke.dotArray;
  if (!dots || dots.length < 2) return null;
  const pts = dots.map(d => ({ x: d.x * NCODE_TO_MM, y: d.y * NCODE_TO_MM }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, length = 0;
  pts.forEach((p, k) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (k) length += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y);
  });
  return {
    index, pts, minX, maxX, minY, maxY,
    w: maxX - minX, h: maxY - minY, length,
    t: stroke.startTime ?? index
  };
}

/** Principal axis: centre, angle (rad), length along it, max distance off it. */
function principalAxis(m) {
  const n = m.pts.length;
  let cx = 0, cy = 0;
  for (const p of m.pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of m.pts) {
    sxx += (p.x - cx) ** 2; syy += (p.y - cy) ** 2; sxy += (p.x - cx) * (p.y - cy);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, off = 0;
  for (const p of m.pts) {
    const along = (p.x - cx) * ux + (p.y - cy) * uy;
    const across = Math.abs((p.y - cy) * ux - (p.x - cx) * uy);
    if (along < lo) lo = along;
    if (along > hi) hi = along;
    if (across > off) off = across;
  }
  const deg = Math.abs(angle * 180 / Math.PI);
  return { cx, cy, angle, length: hi - lo, off, slopeDeg: Math.min(deg, 180 - deg) };
}

/** Convex hull (monotone chain). */
function convexHull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function distToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

function hullPerimeter(hull) {
  let s = 0;
  hull.forEach((a, k) => { const b = hull[(k + 1) % hull.length]; s += Math.hypot(b.x - a.x, b.y - a.y); });
  return s;
}

function hullArea(hull) {
  let s = 0;
  hull.forEach((a, k) => { const b = hull[(k + 1) % hull.length]; s += a.x * b.y - b.x * a.y; });
  return Math.abs(s) / 2;
}

function distToHull(p, hull) {
  let d = Infinity;
  hull.forEach((a, k) => { d = Math.min(d, distToSegment(p, a, hull[(k + 1) % hull.length])); });
  return d;
}

function insideHull(p, hull) {
  let sign = 0;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k], b = hull[(k + 1) % hull.length];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
}

function boundsOf(group) {
  const b = {
    minX: Math.min(...group.map(m => m.minX)), maxX: Math.max(...group.map(m => m.maxX)),
    minY: Math.min(...group.map(m => m.minY)), maxY: Math.max(...group.map(m => m.maxY))
  };
  b.w = b.maxX - b.minX;
  b.h = b.maxY - b.minY;
  return b;
}

// ============================================================================
// SHAPE TESTS
// ============================================================================

/**
 * Writing around a line: strokes that sit on it vs strokes it cuts through.
 * Only letter-sized strokes centred over the line count.
 */
function writingAtLine(m, axis, page) {
  const slope = Math.tan(axis.angle);
  let on = 0, through = 0;
  for (const o of page) {
    if (o === m || o.h < 1.5 || o.h > 12) continue;
    const ox = (o.minX + o.maxX) / 2;
    if (ox < m.minX || ox > m.maxX) continue;
    const y = axis.cy + slope * (ox - axis.cx);
    const above = y - o.minY, below = o.maxY - y;
    if (above >= 0.3 * o.h && below >= 0.3 * o.h) through++;
    else if (o.h >= 2 && o.maxY <= y + 1 && o.maxY >= y - 5) on++;
  }
  return { on, through };
}

/**
 * Underline: straight, near-horizontal, not a strike-through.
 * @param {Object} m - Measured stroke
 * @param {Object[]} page - Measured strokes on the same page
 */
function isUnderline(m, page) {
  if (m.pts.length < UNDERLINE_MIN_DOTS) return false;
  const axis = principalAxis(m);
  if (axis.length < UNDERLINE_SHORT_LENGTH || axis.slopeDeg > UNDERLINE_MAX_SLOPE_DEG) return false;
  if (axis.off > Math.max(UNDERLINE_MAX_WOBBLE, 0.04 * axis.length)) return false;
  if (m.length > UNDERLINE_MAX_PATH_RATIO * axis.length) return false;

  const { on, through } = writingAtLine(m, axis, page);
  if (through > 0 && through > on) return false;   // strike-through: leave it for MyScript
  return axis.length >= UNDERLINE_MIN_LENGTH || on >= 2;
}

/**
 * A closed outline: points hug their convex hull and the path is about one or two trips round it.
 * @returns {{hull: Object[]}|null}
 */
function outlineOf(pts, length) {
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  const perimeter = hullPerimeter(hull);
  if (length < OUTLINE_MIN_PATH_RATIO * perimeter || length > OUTLINE_MAX_PATH_RATIO * perimeter) return null;
  // Tolerance scales with size: 0.8 mm would swallow a 3 mm letter whole
  const tol = Math.min(2.5, Math.max(0.35, 0.1 * Math.sqrt(hullArea(hull))));
  let onHull = 0;
  for (const p of pts) if (distToHull(p, hull) <= tol) onHull++;
  return onHull >= OUTLINE_MIN_ON_HULL * pts.length ? { hull, perimeter } : null;
}

/** The pen came back to where it started (an overshoot past the start still counts). */
function isClosed(m, perimeter) {
  const last = m.pts[m.pts.length - 1];
  const early = m.pts.slice(0, Math.max(3, Math.floor(m.pts.length * 0.25)));
  const gap = Math.min(...early.map(p => Math.hypot(p.x - last.x, p.y - last.y)));
  return gap <= Math.max(2.5, 0.12 * perimeter);
}

function sizeOk(b, minSize) {
  return b.w >= minSize && b.h >= minSize && b.w <= ENCLOSURE_MAX_WIDTH && b.h <= ENCLOSURE_MAX_HEIGHT &&
    Math.max(b.w / b.h, b.h / b.w) <= ENCLOSURE_MAX_ASPECT;
}

/** Corners of the bounds with ink near them: a drawn box has 3-4, a circle 0 (it never gets nearer than 0.21 × its size). */
function inkedCorners(pts, b) {
  const r = 0.12 * Math.min(b.w, b.h) + 0.2;
  const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  return corners.filter(([cx, cy]) => pts.some(p => Math.hypot(p.x - cx, p.y - cy) <= r)).length;
}

/** ☐ / ☑ — kept so task-markers.js can read it. */
function isTaskBox(pts, b) {
  const aspect = b.w / b.h;
  return b.w <= CHECKBOX_MAX_SIZE && b.h <= CHECKBOX_MAX_SIZE && aspect >= 0.6 && aspect <= 1.7 &&
    inkedCorners(pts, b) >= 3;
}

/** Strokes (other than `exclude`) with most of their dots inside the hull. */
function strokesInside(page, hull, b, exclude) {
  return page.filter(o => {
    if (exclude.has(o) || o.maxX < b.minX || o.minX > b.maxX || o.maxY < b.minY || o.minY > b.maxY) return false;
    let inside = 0;
    for (const p of o.pts) if (insideHull(p, hull)) inside++;
    return inside >= CONTENT_MIN_INSIDE * o.pts.length;
  });
}

/** A small loop must be filled by what's in it (a circled digit), not just hold a stray dot. */
function fillsLoop(contents, b) {
  if (Math.min(b.w, b.h) >= 5) return true;
  const c = boundsOf(contents);
  return c.h >= 0.4 * b.h && c.w * c.h >= 0.08 * b.w * b.h;
}

/** Points near each side of the bounds over at least MULTI_BOX_SIDE_COVERAGE of its length. */
function tracesAllSides(pts, b, tol) {
  return ['top', 'bottom', 'left', 'right'].every(side => {
    const horizontal = side === 'top' || side === 'bottom';
    const bins = new Set();
    for (const p of pts) {
      const d = side === 'top' ? p.y - b.minY : side === 'bottom' ? b.maxY - p.y
        : side === 'left' ? p.x - b.minX : b.maxX - p.x;
      if (d <= tol) bins.add(Math.floor(10 * (horizontal ? (p.x - b.minX) / b.w : (p.y - b.minY) / b.h)));
    }
    return bins.size >= 10 * MULTI_BOX_SIDE_COVERAGE;
  });
}

// ============================================================================
// DETECTION (one page)
// ============================================================================

function detectLoops(page, found) {
  for (const m of page) {
    if (found.has(m.index) || m.pts.length < LOOP_MIN_DOTS || !sizeOk(m, ENCLOSURE_MIN_SIZE)) continue;
    const outline = outlineOf(m.pts, m.length);
    if (!outline || !isClosed(m, outline.perimeter) || isTaskBox(m.pts, m)) continue;
    const contents = strokesInside(page, outline.hull, m, new Set([m]));
    if (contents.length && fillsLoop(contents, m)) {
      found.set(m.index, inkedCorners(m.pts, m) >= 3 ? 'box' : 'circle');
    }
  }
}

function detectMultiStrokeBoxes(page, found) {
  const byTime = [...page].sort((a, b) => a.t - b.t);
  for (let k = 0; k < byTime.length; k++) {
    for (let n = MULTI_BOX_MAX_STROKES; n >= 2; n--) {
      const group = byTime.slice(k, k + n);
      if (group.length < n) continue;
      if (group.some(m => found.has(m.index)) || group[n - 1].t - group[0].t > MULTI_BOX_MAX_MS) continue;
      const b = boundsOf(group);
      if (!sizeOk(b, MULTI_BOX_MIN_SIZE)) continue;
      if (group.some(m => m.w < 0.3 * b.w && m.h < 0.3 * b.h)) continue;   // every piece spans a side

      // Every stroke lies on the edge, so a letter written inside straight after never joins the box
      const tol = Math.max(0.8, Math.min(1.5, 0.15 * Math.min(b.w, b.h)));
      const onEdge = p => Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y) <= tol;
      if (group.some(m => m.pts.filter(onEdge).length < OUTLINE_MIN_ON_HULL * m.pts.length)) continue;
      const pts = group.flatMap(m => m.pts);
      if (!tracesAllSides(pts, b, tol)) continue;
      const outline = outlineOf(pts, group.reduce((s, m) => s + m.length, 0));
      if (!outline || isTaskBox(pts, b)) continue;

      if (strokesInside(page, outline.hull, b, new Set(group)).length) {
        for (const m of group) found.set(m.index, 'box');
        break;
      }
    }
  }
}

/**
 * @param {Object[]} page - Measured strokes of one page
 * @returns {Map<number, 'underline'|'box'|'circle'>} caller index → type
 */
function detectPage(page) {
  const found = new Map();
  detectLoops(page, found);
  // Before underlines: a box's top and bottom sides would pass as underlines and leave its sides behind
  detectMultiStrokeBoxes(page, found);
  for (const m of page) if (!found.has(m.index) && isUnderline(m, page)) found.set(m.index, 'underline');
  return found;
}

function pageKey(stroke) {
  const p = stroke.pageInfo || {};
  return `${p.section}/${p.owner}/${p.book}/${p.page}`;
}

/**
 * Detect decorative strokes, page by page.
 * @param {Array} strokes - Canvas-format strokes
 * @returns {Map<number, 'underline'|'box'|'circle'>} index → type
 */
function detectDecorative(strokes) {
  const pages = new Map();
  strokes.forEach((stroke, i) => {
    const m = measure(stroke, i);
    if (!m) return;
    const key = pageKey(stroke);
    if (!pages.has(key)) pages.set(key, []);
    pages.get(key).push(m);
  });
  const found = new Map();
  for (const page of pages.values()) {
    for (const [index, type] of detectPage(page)) found.set(index, type);
  }
  return found;
}

function countTypes(found) {
  const stats = { boxes: 0, underlines: 0, circles: 0 };
  for (const type of found.values()) stats[type === 'box' ? 'boxes' : type + 's']++;
  return stats;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Filter decorative strokes from a stroke array
 * Separates text strokes from decorative elements (underlines, boxes, circles).
 *
 * @param {Array} strokes - Array of stroke objects
 * @returns {Object} {textStrokes, decorativeStrokes, stats}
 */
export function filterDecorativeStrokes(strokes) {
  if (!strokes || strokes.length === 0) {
    return {
      textStrokes: [],
      decorativeStrokes: [],
      stats: { total: 0, text: 0, decorative: 0, boxes: 0, underlines: 0, circles: 0 }
    };
  }

  const found = detectDecorative(strokes);
  const textStrokes = [];
  const decorativeStrokes = [];
  strokes.forEach((stroke, index) => {
    if (found.has(index)) decorativeStrokes.push({ stroke, index, type: found.get(index) });
    else textStrokes.push(stroke);
  });

  return {
    textStrokes,
    decorativeStrokes,
    stats: {
      total: strokes.length,
      text: textStrokes.length,
      decorative: decorativeStrokes.length,
      ...countTypes(found)
    }
  };
}

/**
 * Detect decorative strokes and return their indices
 * Used by "Deselect Decorative" (user-controlled deselection rather than automatic filtering).
 *
 * @param {Array} strokes - Array of stroke objects
 * @returns {Object} {indices: number[], stats: {boxes, underlines, circles}}
 */
export function detectDecorativeIndices(strokes) {
  if (!strokes || strokes.length === 0) {
    return { indices: [], stats: { boxes: 0, underlines: 0, circles: 0 } };
  }
  const found = detectDecorative(strokes);
  return { indices: [...found.keys()].sort((a, b) => a - b), stats: countTypes(found) };
}

/**
 * Export configuration constants for external access/tuning
 */
export const config = {
  UNDERLINE_MIN_LENGTH,
  UNDERLINE_SHORT_LENGTH,
  UNDERLINE_MAX_SLOPE_DEG,
  UNDERLINE_MAX_WOBBLE,
  UNDERLINE_MAX_PATH_RATIO,
  UNDERLINE_MIN_DOTS,
  ENCLOSURE_MIN_SIZE,
  MULTI_BOX_MIN_SIZE,
  ENCLOSURE_MAX_WIDTH,
  ENCLOSURE_MAX_HEIGHT,
  ENCLOSURE_MAX_ASPECT,
  LOOP_MIN_DOTS,
  OUTLINE_MIN_PATH_RATIO,
  OUTLINE_MAX_PATH_RATIO,
  OUTLINE_MIN_ON_HULL,
  CONTENT_MIN_INSIDE,
  MULTI_BOX_MAX_STROKES,
  MULTI_BOX_MAX_MS,
  MULTI_BOX_SIDE_COVERAGE,
  CHECKBOX_MAX_SIZE,
  NCODE_TO_MM
};
