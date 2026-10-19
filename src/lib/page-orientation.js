/**
 * Page orientation — showing a page that was written with the notebook turned
 * sideways the right way up (pure).
 *
 * Stroke points are raw Ncode coordinates off the paper and are never rewritten
 * for this. A page's rotation is a display setting, stored per page in the
 * `pages/_orientation.json` sidecar (see electron/main.cjs), and every view turns
 * the page by applying ONE transform built here — an SVG `<g transform>` in Book
 * View and the Timeline, a per-page affine in the Editor's canvas projection.
 *
 * ## Rotations
 *
 * `rotation` is the clockwise turn, in degrees, that brings the page upright:
 *
 *     0    portrait (as written on the page — the default, recorded by absence)
 *     90   "Landscape ↻": the page image turns a quarter clockwise
 *     270  "Landscape ↺": a quarter counter-clockwise
 *     180  upside down
 *
 * ## Frames
 *
 * A page is turned within a FRAME — the paper's rectangle `{x0, y0, x1, y1}` —
 * and the turned frame keeps the same top-left corner, with width and height
 * swapped for a quarter turn. So the rotated page occupies
 * `[x0, x0 + h] × [y0, y0 + w]` and a view lays it out at that aspect ratio.
 *
 * The frame must be the PAPER (the Neo background's frame, or a fixed nominal
 * sheet), not the ink's bounds. A rotation is a rigid turn plus a translation
 * that depends on the frame; with an ink-derived frame, every new stroke would
 * move the frame and so shift every stroke already drawn.
 *
 * Views that lay a page out by its ink bounds (the Editor) cancel the
 * translation anyway, so for them any fixed frame does — `NOMINAL_FRAME`.
 */

/** Allowed rotations, clockwise degrees. */
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);

/**
 * The nominal sheet a page is turned within when nothing better is known (the
 * Editor, transcription). Matches timeline-feed.js PAGE_MIN_WIDTH/HEIGHT, the
 * common notebook's printed area. Only the translation depends on it.
 */
export const NOMINAL_FRAME = Object.freeze({ x0: 0, y0: 0, x1: 66, y1: 92 });

/** Sidecar format version. */
export const ORIENTATION_VERSION = 1;

import { BOOK_KEY_FRAGMENT, isBookKey } from './volumes.js';

/** Page ids are digits plus an optional single letter: "42", "151b". */
const PAGE_ID_RE = /^\d+[a-zA-Z]?$/;

/** `"<bookKey>/<pageId>"`, the book part built from BOOK_KEY_FRAGMENT. */
const KEY_RE = new RegExp(`^(${BOOK_KEY_FRAGMENT})/(\\d+[a-zA-Z]?)$`);

/**
 * Coerce anything into one of ROTATIONS. Unknown values (including non-right
 * angles and garbage from a hand-edited sidecar) read as 0: portrait is how the
 * page looked before this feature existed.
 * @returns {0|90|180|270}
 */
export function normalizeRotation(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 0;
  const r = ((n % 360) + 360) % 360;
  return ROTATIONS.includes(r) ? r : 0;
}

/** Turn a quarter: `dir` +1 clockwise, -1 counter-clockwise. */
export function rotateBy(rotation, dir) {
  return normalizeRotation(normalizeRotation(rotation) + (dir < 0 ? -90 : 90));
}

/** True for a quarter turn (width and height swap). */
export function isQuarterTurn(rotation) {
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270;
}

/** Human label for a rotation. */
export function rotationLabel(rotation) {
  switch (normalizeRotation(rotation)) {
    case 90: return 'Landscape ↻';
    case 270: return 'Landscape ↺';
    case 180: return 'Upside down';
    default: return 'Portrait';
  }
}

/* ============================================================
 *  Sidecar keys and normalisation
 * ============================================================ */

/**
 * The sidecar key for a page: `"<bookKey>/<pageId>"` — `"388/12"`,
 * `"388v2/151b"`. The same shape as the capture-date index's page keys.
 * Book keys are validated by volumes.js's canonical form, never by a
 * hand-written `\d+` (which would accept "388v1" or split "388v2").
 *
 * @returns {string|null} null when either half is not a valid key
 */
export function orientationKey(bookKey, pageId) {
  if (bookKey == null || pageId == null) return null;
  const book = String(bookKey);
  const page = String(pageId);
  if (!isBookKey(book) || !PAGE_ID_RE.test(page)) return null;
  return `${book}/${page}`;
}

/**
 * Split a sidecar key. `"388v2/151b"` → `{ book: "388v2", pageId: "151b" }`.
 * @returns {{book: string, pageId: string}|null}
 */
export function parseOrientationKey(key) {
  const m = String(key ?? '').match(KEY_RE);
  if (!m || !isBookKey(m[1])) return null;
  return { book: m[1], pageId: m[2] };
}

/**
 * Whatever was read from `_orientation.json` → `{ "<key>": rotation }` holding
 * only valid keys and non-zero rotations. Missing, corrupt or wrongly shaped
 * input is an empty map — every page portrait — never a thrown error.
 *
 * Accepts the versioned file shape `{ version, pages: {...} }`.
 *
 * @param {any} raw
 * @returns {Record<string, 90|180|270>}
 */
export function normalizeOrientations(raw) {
  const out = {};
  const pages = raw && typeof raw === 'object' && raw.pages && typeof raw.pages === 'object'
    ? raw.pages
    : null;
  if (!pages || Array.isArray(pages)) return out;
  for (const key of Object.keys(pages)) {
    const parsed = parseOrientationKey(key);
    if (!parsed) continue;
    const r = normalizeRotation(pages[key]);
    if (r !== 0) out[`${parsed.book}/${parsed.pageId}`] = r;
  }
  return out;
}

/**
 * Rotation for a page from a normalised map. Falls back from a letter-suffixed
 * page to nothing (a variant is its own page with its own setting); callers on
 * the Editor canvas, where suffixes have already collapsed onto the integer
 * page, pass the integer.
 */
export function rotationFor(map, bookKey, pageId) {
  const key = orientationKey(bookKey, pageId);
  if (!key || !map) return 0;
  return normalizeRotation(map[key]);
}

/* ============================================================
 *  Geometry
 * ============================================================ */

/**
 * The frame after turning: same top-left, width and height swapped for a
 * quarter turn.
 * @param {{x0:number,y0:number,x1:number,y1:number}} frame
 * @param {number} rotation
 */
export function rotateFrame(frame, rotation) {
  const w = frame.x1 - frame.x0;
  const h = frame.y1 - frame.y0;
  return isQuarterTurn(rotation)
    ? { x0: frame.x0, y0: frame.y0, x1: frame.x0 + h, y1: frame.y0 + w }
    : { x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 };
}

/**
 * The affine `[a, b, c, d, e, f]` taking a page point to its upright position:
 *
 *     x' = a·x + c·y + e
 *     y' = b·x + d·y + f
 *
 * — the argument order of SVG `matrix()` and Canvas2D `transform()`. With
 * `scale`, both sides are in units of `scale` per Ncode unit (the views draw at
 * `x × NCODE_SCALE`), so the matrix can wrap already-scaled content directly.
 *
 * @param {number} rotation
 * @param {{x0:number,y0:number,x1:number,y1:number}} frame  in Ncode units
 * @param {number} [scale=1]
 * @returns {number[]}
 */
export function rotationMatrix(rotation, frame, scale = 1) {
  const { x0, y0, x1, y1 } = frame;
  switch (normalizeRotation(rotation)) {
    // x' = x0 + (y1 - y),  y' = y0 + (x - x0)
    case 90: return [0, 1, -1, 0, (x0 + y1) * scale, (y0 - x0) * scale];
    // x' = x0 + (x1 - x),  y' = y0 + (y1 - y)
    case 180: return [-1, 0, 0, -1, (x0 + x1) * scale, (y0 + y1) * scale];
    // x' = x0 + (y - y0),  y' = y0 + (x1 - x)
    case 270: return [0, -1, 1, 0, (x0 - y0) * scale, (y0 + x1) * scale];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** SVG `transform` attribute value for a rotation, or '' when there is none. */
export function svgRotationTransform(rotation, frame, scale = 1) {
  if (normalizeRotation(rotation) === 0) return '';
  const m = rotationMatrix(rotation, frame, scale).map((v) => +v.toFixed(4));
  return `matrix(${m.join(' ')})`;
}

/**
 * One point to its upright position.
 * @returns {[number, number]}
 */
export function rotatePoint(x, y, rotation, frame) {
  const [a, b, c, d, e, f] = rotationMatrix(rotation, frame);
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * Inverse of rotatePoint: an upright position back to page coordinates.
 * @returns {[number, number]}
 */
export function unrotatePoint(x, y, rotation, frame) {
  const r = normalizeRotation(rotation);
  return rotatePoint(x, y, r === 0 ? 0 : 360 - r, rotateFrame(frame, r));
}

/**
 * An axis-aligned box turned with the page. A right-angle turn maps a box to a
 * box, so this is exact.
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} box
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export function rotateBox(box, rotation, frame) {
  if (normalizeRotation(rotation) === 0) {
    return { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY };
  }
  const [ax, ay] = rotatePoint(box.minX, box.minY, rotation, frame);
  const [bx, by] = rotatePoint(box.maxX, box.maxY, rotation, frame);
  return {
    minX: Math.min(ax, bx), minY: Math.min(ay, by),
    maxX: Math.max(ax, bx), maxY: Math.max(ay, by)
  };
}

/**
 * Storage-format point tuples (`[x, y, ts?, force?]`) turned upright, with every
 * other column kept. For one-off work on a copy — sending a page to MyScript,
 * the transcript preview — never for drawing (draw with the matrix) and never
 * for anything written back to disk.
 */
export function rotateStoredPoints(points, rotation, frame = NOMINAL_FRAME) {
  if (!Array.isArray(points)) return [];
  if (normalizeRotation(rotation) === 0) return points;
  const [a, b, c, d, e, f] = rotationMatrix(rotation, frame);
  return points.map((p) => {
    const out = p.slice();
    out[0] = a * p[0] + c * p[1] + e;
    out[1] = b * p[0] + d * p[1] + f;
    return out;
  });
}

/**
 * Canvas-format strokes (`dotArray: [{x, y, ...}]`) turned upright, as COPIES:
 * every stroke and dot field is kept (ids, times, pageInfo, force), only x/y
 * change. The input is not touched — strokes on the canvas own raw Ncode.
 */
export function rotateCanvasStrokes(strokes, rotation, frame = NOMINAL_FRAME) {
  if (!Array.isArray(strokes)) return [];
  if (normalizeRotation(rotation) === 0) return strokes;
  const [a, b, c, d, e, f] = rotationMatrix(rotation, frame);
  return strokes.map((s) => ({
    ...s,
    dotArray: (s.dotArray || []).map((dot) => ({
      ...dot,
      x: a * dot.x + c * dot.y + e,
      y: b * dot.x + d * dot.y + f
    }))
  }));
}
