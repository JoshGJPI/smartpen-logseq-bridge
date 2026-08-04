/**
 * Sketch width — pressure → line thickness mapping.
 *
 * Strokes flagged as "sketch" render with a thickness that varies along their
 * length, driven by the per-dot pen force (`dot.f`). This module owns the whole
 * mapping and nothing else: it is pure, DOM-free, and shared by the capture
 * canvas (`canvas-renderer.js`), the Book View SVG (`viewer/page-svg.js`), and
 * the SVG export.
 *
 * The pipeline, in order:
 *
 *   raw pen force  →  normalise  →  smooth  →  shape  →  scale  →  slew-limit
 *
 *   1. NORMALISE. `pressureFloor`/`pressureCeil` map the pen's useful force range
 *      onto 0…1. These are user-calibrated rather than hard-coded because the
 *      pen's real force range is not documented anywhere we can trust — the SDK
 *      reads it as a 16-bit short and the historical code divided by 500 on what
 *      looks like a guess. Anything at or below the floor is 0; at or above the
 *      ceil is 1.
 *
 *   2. SMOOTH. A symmetric moving average over the force series. This is the fix
 *      for the "sudden pressure increase makes an ugly spike" problem: clamping
 *      `maxWidth` alone only caps how fat the bulge gets, it does not stop the
 *      bulge from being abrupt. Symmetric (not a trailing EMA) so the taper does
 *      not visually lag behind the pen path. Streaming callers that only have the
 *      past use `createPressureSmoother()` instead.
 *
 *   3. SHAPE. `gamma` is the brush-vs-pencil character control, applied as
 *      t ** gamma:
 *        gamma < 1  — width climbs fast at low force, so the line broadens
 *                     readily. Brush / marker feel.
 *        gamma = 1  — linear.
 *        gamma > 1  — width stays thin until you press hard. Pencil / technical
 *                     pen feel.
 *
 *   4. SCALE. Linear interpolation between `minWidth` and `maxWidth`, in Ncode mm
 *      (world units). Callers multiply by their own scale/zoom. The min/max pair
 *      is the primary "how much variation do I want at all" control: a narrow
 *      band reads as a pen, a wide band as a brush.
 *
 *   5. SLEW-LIMIT. `slewLimit` caps how much the width may change between two
 *      consecutive dots, in output width units. Belt-and-braces alongside
 *      smoothing: smoothing softens a spike's shape, the slew limit bounds its
 *      rate. Set to 0 to disable.
 *
 * Widths are in the same units as `minWidth`/`maxWidth` — Ncode mm at zoom 1.
 */

/* -----------------------------------------------------------------
 *  Profile
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} SketchProfile
 * @property {number} minWidth       - Width at zero pressure (Ncode mm)
 * @property {number} maxWidth       - Width at full pressure (Ncode mm)
 * @property {number} gamma          - Response curve exponent; <1 brush, >1 pencil
 * @property {number} pressureFloor  - Pen force mapped to 0
 * @property {number} pressureCeil   - Pen force mapped to 1
 * @property {number} smoothing      - Moving-average window in dots; <=1 disables
 * @property {number} slewLimit      - Max width delta per dot; 0 disables
 * @property {number} flatWidth      - Width used when a stroke carries no pressure
 *                                     data at all (pages saved before pressure was
 *                                     persisted). Rendering those at a varying
 *                                     width is impossible, so they get one honest
 *                                     constant instead.
 */

/** @type {SketchProfile} */
export const DEFAULT_SKETCH_PROFILE = {
  minWidth: 0.40,
  maxWidth: 2.20,
  gamma: 0.80,
  pressureFloor: 80,
  pressureCeil: 800,
  smoothing: 3,
  slewLimit: 0.30,
  flatWidth: 0.60
};

/**
 * Named starting points. `pen`/`pencil` keep a narrow band so the line reads as
 * uniform with only a hint of weight; `brush`/`marker` open the band up.
 * @type {Record<string, {label: string, description: string} & Partial<SketchProfile>>}
 */
export const SKETCH_PRESETS = {
  pen: {
    label: 'Pen',
    description: 'Very narrow to narrow — near-uniform technical line',
    minWidth: 0.35, maxWidth: 0.60, gamma: 1.00, smoothing: 3, slewLimit: 0.12, flatWidth: 0.45
  },
  pencil: {
    label: 'Pencil',
    description: 'Narrow, needs a firm press to darken',
    minWidth: 0.35, maxWidth: 0.95, gamma: 1.60, smoothing: 3, slewLimit: 0.18, flatWidth: 0.50
  },
  brush: {
    label: 'Brush',
    description: 'Narrow to broad — broadens readily with pressure',
    minWidth: 0.40, maxWidth: 2.60, gamma: 0.70, smoothing: 5, slewLimit: 0.30, flatWidth: 0.80
  },
  marker: {
    label: 'Marker',
    description: 'Broad and even, with a soft taper at the ends',
    minWidth: 1.20, maxWidth: 2.60, gamma: 0.55, smoothing: 5, slewLimit: 0.40, flatWidth: 1.60
  }
};

/**
 * Coerce a value to a number, or NaN if there is nothing usable there.
 *
 * `Number(null)` is 0 and `Number('')` is 0, so a plain Number() cast would read
 * a missing pen force as "pressed with zero force" — which renders as a hairline
 * instead of falling back to a flat width — and would turn a null profile field
 * into 0 rather than the default. Absence has to stay distinguishable from zero
 * all the way through.
 * @param {any} value
 * @returns {number} the number, or NaN
 */
function numberOrNaN(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function finite(value, fallback) {
  const n = numberOrNaN(value);
  return Number.isNaN(n) ? fallback : n;
}

/** @see numberOrNaN — named for the pen-force call sites. */
const forceValue = numberOrNaN;

/**
 * Merge a partial profile over the defaults and coerce it into a usable shape.
 *
 * Sanitising here rather than at every call site means the render paths can
 * assume a valid profile: `maxWidth >= minWidth`, `pressureCeil > pressureFloor`
 * (a zero-width pressure band would divide by zero), and `gamma > 0` (zero or
 * negative inverts or flattens the curve into nonsense).
 *
 * @param {Partial<SketchProfile>|null|undefined} profile
 * @returns {SketchProfile}
 */
export function normalizeProfile(profile) {
  const p = { ...DEFAULT_SKETCH_PROFILE, ...(profile || {}) };

  let minWidth = Math.max(0.01, finite(p.minWidth, DEFAULT_SKETCH_PROFILE.minWidth));
  let maxWidth = Math.max(0.01, finite(p.maxWidth, DEFAULT_SKETCH_PROFILE.maxWidth));
  if (maxWidth < minWidth) {
    // Swapped bounds are a UI slip, not an error worth throwing over.
    [minWidth, maxWidth] = [maxWidth, minWidth];
  }

  const pressureFloor = Math.max(0, finite(p.pressureFloor, DEFAULT_SKETCH_PROFILE.pressureFloor));
  let pressureCeil = Math.max(0, finite(p.pressureCeil, DEFAULT_SKETCH_PROFILE.pressureCeil));
  if (pressureCeil <= pressureFloor) pressureCeil = pressureFloor + 1;

  return {
    minWidth,
    maxWidth,
    gamma: Math.max(0.05, finite(p.gamma, DEFAULT_SKETCH_PROFILE.gamma)),
    pressureFloor,
    pressureCeil,
    // Window is in dots and only odd windows are symmetric; round even values up.
    smoothing: Math.max(0, Math.round(finite(p.smoothing, DEFAULT_SKETCH_PROFILE.smoothing))),
    slewLimit: Math.max(0, finite(p.slewLimit, DEFAULT_SKETCH_PROFILE.slewLimit)),
    flatWidth: Math.max(0.01, finite(p.flatWidth, DEFAULT_SKETCH_PROFILE.flatWidth))
  };
}

/**
 * Build a profile from a preset name, optionally with overrides on top.
 * Unknown names fall back to the defaults rather than throwing — the name may
 * come from persisted localStorage written by an older build.
 * @param {string} name
 * @param {Partial<SketchProfile>} [overrides]
 * @returns {SketchProfile}
 */
export function profileFromPreset(name, overrides = {}) {
  const preset = SKETCH_PRESETS[name];
  if (!preset) return normalizeProfile(overrides);
  const { label, description, ...values } = preset;
  return normalizeProfile({ ...values, ...overrides });
}

/**
 * Stable string identity for a profile, for use as a cache key.
 *
 * The renderer caches computed width arrays on the stroke object; when the user
 * drags a thickness slider every cached array is stale. Comparing this key is
 * cheaper and less error-prone than deep-comparing profiles at each stroke.
 * @param {Partial<SketchProfile>} profile
 * @returns {string}
 */
export function profileKey(profile) {
  const p = normalizeProfile(profile);
  return [
    p.minWidth, p.maxWidth, p.gamma,
    p.pressureFloor, p.pressureCeil,
    p.smoothing, p.slewLimit, p.flatWidth
  ].join('|');
}

/* -----------------------------------------------------------------
 *  Mapping
 * ----------------------------------------------------------------- */

/**
 * Map a raw pen force onto 0…1 using the profile's calibration band.
 * Returns NaN for a non-finite force so callers can distinguish "no pressure
 * recorded" from "recorded as zero" — legacy pages have the former and must not
 * be silently rendered as hairlines.
 * @param {number} f
 * @param {SketchProfile} profile - assumed already normalised
 * @returns {number} 0…1, or NaN
 */
export function pressureToUnit(f, profile) {
  const n = forceValue(f);
  if (Number.isNaN(n)) return NaN;
  const t = (n - profile.pressureFloor) / (profile.pressureCeil - profile.pressureFloor);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Map a single raw pen force straight to a width. Convenience for the streaming
 * live-writing path, which has no series to smooth or slew-limit.
 * @param {number} f
 * @param {Partial<SketchProfile>} [profile]
 * @returns {number} width in Ncode mm
 */
export function widthForPressure(f, profile) {
  const p = normalizeProfile(profile);
  const t = pressureToUnit(f, p);
  if (Number.isNaN(t)) return p.flatWidth;
  return p.minWidth + (p.maxWidth - p.minWidth) * Math.pow(t, p.gamma);
}

/**
 * Symmetric moving average over a numeric series.
 *
 * Symmetric rather than trailing: a trailing filter delays the width response,
 * so a deliberate press would visibly fatten the line *after* the point where it
 * happened. Window edges average over whatever part of the window exists, which
 * leaves stroke ends slightly less smoothed — acceptable, and better than
 * padding with invented values.
 *
 * @param {number[]} values
 * @param {number} window - dots; <=1 returns a copy unchanged
 * @returns {number[]}
 */
export function smoothSeries(values, window) {
  const n = values.length;
  if (!n) return [];
  const w = Math.max(0, Math.round(window));
  if (w <= 1 || n < 3) return values.slice();

  const half = Math.floor(w / 2);
  const out = new Array(n);

  // Prefix sums keep this O(n) regardless of window size — a wide window on a
  // long stroke is otherwise O(n·w) and this runs per stroke per profile change.
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

/**
 * Cap the rate of change of a width series.
 *
 * Applied after mapping, in output width units, so the control means exactly
 * what the user sees: "the line may not get more than this much thicker from one
 * dot to the next". Runs forward then backward so a spike is bounded on both
 * flanks; a single forward pass would leave the leading edge of a spike sharp.
 *
 * @param {number[]} widths
 * @param {number} limit - max delta per step; <=0 returns a copy unchanged
 * @returns {number[]}
 */
export function limitSlew(widths, limit) {
  const n = widths.length;
  if (!n) return [];
  if (!(limit > 0)) return widths.slice();

  const out = widths.slice();
  for (let i = 1; i < n; i++) {
    const delta = out[i] - out[i - 1];
    if (delta > limit) out[i] = out[i - 1] + limit;
    else if (delta < -limit) out[i] = out[i - 1] - limit;
  }
  for (let i = n - 2; i >= 0; i--) {
    const delta = out[i] - out[i + 1];
    if (delta > limit) out[i] = out[i + 1] + limit;
    else if (delta < -limit) out[i] = out[i + 1] - limit;
  }
  return out;
}

/**
 * Run the full pipeline over one stroke's force series.
 *
 * This is the entry point the render paths use. Result is one width per input
 * force, in Ncode mm at zoom 1.
 *
 * A series with no usable pressure at all (every entry non-finite — i.e. a page
 * saved before pressure was persisted) yields a constant `flatWidth`. A series
 * with *some* gaps has the gaps filled from their neighbours, since a single
 * dropped force reading shouldn't punch a hole in the taper.
 *
 * @param {Array<number|null|undefined>} pressures
 * @param {Partial<SketchProfile>} [profile]
 * @returns {number[]}
 */
export function widthsForPressures(pressures, profile) {
  const p = normalizeProfile(profile);
  const n = Array.isArray(pressures) ? pressures.length : 0;
  if (n === 0) return [];

  const units = new Array(n);
  let usable = 0;
  for (let i = 0; i < n; i++) {
    const t = pressureToUnit(pressures[i], p);
    units[i] = t;
    if (!Number.isNaN(t)) usable++;
  }

  if (usable === 0) return new Array(n).fill(p.flatWidth);

  if (usable < n) {
    // Fill gaps by carrying the nearest known value forward, then backward.
    let last = NaN;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(units[i])) units[i] = last;
      else last = units[i];
    }
    last = NaN;
    for (let i = n - 1; i >= 0; i--) {
      if (Number.isNaN(units[i])) units[i] = last;
      else last = units[i];
    }
  }

  const smoothed = smoothSeries(units, p.smoothing);

  const span = p.maxWidth - p.minWidth;
  const widths = new Array(n);
  for (let i = 0; i < n; i++) {
    widths[i] = p.minWidth + span * Math.pow(smoothed[i], p.gamma);
  }

  return limitSlew(widths, p.slewLimit);
}

/**
 * Pull the force series off a canvas-format stroke (`dotArray[].f`).
 * Dots without a numeric `f` come back as NaN so `widthsForPressures` can treat
 * them as gaps.
 * @param {{dotArray?: Array<{f?: number}>, dots?: Array<{f?: number}>}} stroke
 * @returns {number[]}
 */
export function strokePressures(stroke) {
  const dots = (stroke && (stroke.dotArray || stroke.dots)) || [];
  const out = new Array(dots.length);
  for (let i = 0; i < dots.length; i++) {
    out[i] = forceValue(dots[i] && dots[i].f);
  }
  return out;
}

/**
 * Does a force series carry real pressure data?
 *
 * Pages saved before pressure was persisted come back with a constant injected
 * force on every point, which by value alone is indistinguishable from a
 * genuinely uniform press — but a *varying* series is proof of real data. Used to
 * decide whether variable-width rendering is worth attempting at all.
 *
 * @param {number[]} pressures - NaN entries count as missing
 * @returns {boolean}
 */
export function seriesHasVariation(pressures) {
  let first = NaN;
  for (const f of pressures || []) {
    if (Number.isNaN(f)) continue;
    if (Number.isNaN(first)) { first = f; continue; }
    if (f !== first) return true;
  }
  return false;
}

/**
 * Does this canvas-format stroke carry real pressure data?
 * @param {{dotArray?: Array<{f?: number}>}} stroke
 * @returns {boolean}
 */
export function hasPressureData(stroke) {
  return seriesHasVariation(strokePressures(stroke));
}

/**
 * Widths for a force series, applying the legacy fallback rule.
 *
 * The single definition of "what do we draw when there is no real pressure to
 * follow": a constant `flatWidth`, rather than whatever arbitrary width a
 * constant injected force happens to map to through the response curve. Every
 * render path (canvas, Book View SVG, SVG export) goes through here so they
 * cannot disagree about a legacy page.
 *
 * @param {number[]} pressures
 * @param {Partial<SketchProfile>} [profile]
 * @returns {number[]}
 */
export function widthsForStrokeSeries(pressures, profile) {
  const p = normalizeProfile(profile);
  const series = pressures || [];
  return seriesHasVariation(series)
    ? widthsForPressures(series, p)
    : new Array(series.length).fill(p.flatWidth);
}

/*
 * NOTE ON LIVE CAPTURE
 *
 * There is deliberately no streaming/trailing variant here. Strokes are not
 * flagged as sketches until after they are drawn, so the live-writing path
 * cannot know whether a stroke will end up rendered with a variable width — and
 * having live capture taper a line that re-renders uniform (or vice versa) is
 * the exact inconsistency this work set out to remove. Live capture draws at the
 * uniform handwriting width; flagging a stroke changes its appearance on the
 * next render, which is predictable.
 *
 * If live sketch preview is ever wanted, a trailing EMA over `pressureToUnit`
 * is the tool — but it belongs with a mode toggle, not on by default.
 */
