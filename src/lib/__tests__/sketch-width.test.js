/**
 * Tests for sketch-width.js — the pressure → line thickness mapping.
 *
 * Coverage:
 *   - normalizeProfile (defaults, sanitising swapped/degenerate values)
 *   - profileFromPreset / profileKey (preset lookup, cache-key identity)
 *   - pressureToUnit (calibration band, clamping, NaN for missing data)
 *   - widthForPressure (min/max endpoints, gamma character, flat fallback)
 *   - smoothSeries (symmetry, window sizes, spike attenuation)
 *   - limitSlew (bidirectional rate cap)
 *   - widthsForPressures (full pipeline, gap filling, all-missing → flatWidth)
 *   - strokePressures / hasPressureData (legacy constant-pressure detection)
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SKETCH_PROFILE,
  SKETCH_PRESETS,
  normalizeProfile,
  profileFromPreset,
  profileKey,
  pressureToUnit,
  widthForPressure,
  smoothSeries,
  limitSlew,
  widthsForPressures,
  strokePressures,
  hasPressureData,
} from '../sketch-width.js';

/** Profile with every softening feature off, so a test sees the raw mapping. */
const RAW = normalizeProfile({
  minWidth: 1,
  maxWidth: 3,
  gamma: 1,
  pressureFloor: 0,
  pressureCeil: 100,
  smoothing: 0,
  slewLimit: 0,
  flatWidth: 9,
});

describe('normalizeProfile', () => {
  it('fills every field from the defaults', () => {
    expect(normalizeProfile()).toEqual(DEFAULT_SKETCH_PROFILE);
    expect(normalizeProfile(null)).toEqual(DEFAULT_SKETCH_PROFILE);
    expect(normalizeProfile({})).toEqual(DEFAULT_SKETCH_PROFILE);
  });

  it('keeps supplied values and defaults the rest', () => {
    const p = normalizeProfile({ minWidth: 0.1, gamma: 2 });
    expect(p.minWidth).toBe(0.1);
    expect(p.gamma).toBe(2);
    expect(p.maxWidth).toBe(DEFAULT_SKETCH_PROFILE.maxWidth);
  });

  it('swaps inverted width bounds rather than producing a negative span', () => {
    const p = normalizeProfile({ minWidth: 3, maxWidth: 1 });
    expect(p.minWidth).toBe(1);
    expect(p.maxWidth).toBe(3);
  });

  it('forces a non-zero pressure band so normalisation cannot divide by zero', () => {
    expect(normalizeProfile({ pressureFloor: 500, pressureCeil: 500 }).pressureCeil).toBe(501);
    expect(normalizeProfile({ pressureFloor: 500, pressureCeil: 100 }).pressureCeil).toBe(501);
  });

  it('clamps gamma above zero — zero or negative inverts the curve', () => {
    expect(normalizeProfile({ gamma: 0 }).gamma).toBeGreaterThan(0);
    expect(normalizeProfile({ gamma: -4 }).gamma).toBeGreaterThan(0);
  });

  it('rejects non-numeric input per field instead of propagating NaN', () => {
    const p = normalizeProfile({ minWidth: 'wide', gamma: null, smoothing: undefined });
    expect(p.minWidth).toBe(DEFAULT_SKETCH_PROFILE.minWidth);
    expect(p.gamma).toBe(DEFAULT_SKETCH_PROFILE.gamma);
    expect(p.smoothing).toBe(DEFAULT_SKETCH_PROFILE.smoothing);
  });

  it('rounds the smoothing window to whole dots and clamps negatives', () => {
    expect(normalizeProfile({ smoothing: 4.4 }).smoothing).toBe(4);
    expect(normalizeProfile({ smoothing: -3 }).smoothing).toBe(0);
  });

  it('never yields a zero or negative width', () => {
    const p = normalizeProfile({ minWidth: 0, maxWidth: -5, flatWidth: 0 });
    expect(p.minWidth).toBeGreaterThan(0);
    expect(p.maxWidth).toBeGreaterThan(0);
    expect(p.flatWidth).toBeGreaterThan(0);
  });
});

describe('profileFromPreset', () => {
  it('resolves a known preset and strips its label metadata', () => {
    const p = profileFromPreset('brush');
    expect(p.maxWidth).toBe(SKETCH_PRESETS.brush.maxWidth);
    expect(p).not.toHaveProperty('label');
    expect(p).not.toHaveProperty('description');
  });

  it('applies overrides on top of the preset', () => {
    expect(profileFromPreset('pen', { maxWidth: 1.5 }).maxWidth).toBe(1.5);
  });

  it('falls back to defaults for an unknown name (may come from stale storage)', () => {
    expect(profileFromPreset('quill')).toEqual(DEFAULT_SKETCH_PROFILE);
  });

  it('gives pen a narrower band than brush — the core look distinction', () => {
    const pen = profileFromPreset('pen');
    const brush = profileFromPreset('brush');
    expect(pen.maxWidth - pen.minWidth).toBeLessThan(brush.maxWidth - brush.minWidth);
  });
});

describe('profileKey', () => {
  it('matches for equivalent profiles and differs when any field changes', () => {
    expect(profileKey({ minWidth: 1 })).toBe(profileKey({ minWidth: 1 }));
    expect(profileKey({ minWidth: 1 })).not.toBe(profileKey({ minWidth: 2 }));
    expect(profileKey({ slewLimit: 0.2 })).not.toBe(profileKey({ slewLimit: 0.3 }));
  });

  it('normalises before keying, so sanitised-equal profiles share a key', () => {
    expect(profileKey({ minWidth: 3, maxWidth: 1 })).toBe(profileKey({ minWidth: 1, maxWidth: 3 }));
  });
});

describe('pressureToUnit', () => {
  it('maps the calibration band onto 0…1', () => {
    expect(pressureToUnit(0, RAW)).toBe(0);
    expect(pressureToUnit(50, RAW)).toBeCloseTo(0.5);
    expect(pressureToUnit(100, RAW)).toBe(1);
  });

  it('clamps outside the band', () => {
    expect(pressureToUnit(-20, RAW)).toBe(0);
    expect(pressureToUnit(9999, RAW)).toBe(1);
  });

  it('honours a non-zero floor', () => {
    const p = normalizeProfile({ pressureFloor: 100, pressureCeil: 300 });
    expect(pressureToUnit(100, p)).toBe(0);
    expect(pressureToUnit(200, p)).toBeCloseTo(0.5);
    expect(pressureToUnit(50, p)).toBe(0);
  });

  it('returns NaN for missing pressure — distinct from a recorded zero', () => {
    expect(pressureToUnit(undefined, RAW)).toBeNaN();
    expect(pressureToUnit(null, RAW)).toBeNaN();
    expect(pressureToUnit(NaN, RAW)).toBeNaN();
    expect(pressureToUnit(0, RAW)).toBe(0);
  });
});

describe('widthForPressure', () => {
  it('hits minWidth at the floor and maxWidth at the ceil', () => {
    expect(widthForPressure(0, RAW)).toBeCloseTo(1);
    expect(widthForPressure(100, RAW)).toBeCloseTo(3);
  });

  it('interpolates linearly at gamma 1', () => {
    expect(widthForPressure(50, RAW)).toBeCloseTo(2);
  });

  it('gamma < 1 broadens earlier than gamma > 1 (brush vs pencil)', () => {
    const brushy = widthForPressure(50, { ...RAW, gamma: 0.5 });
    const pencilly = widthForPressure(50, { ...RAW, gamma: 2 });
    expect(brushy).toBeGreaterThan(2);
    expect(pencilly).toBeLessThan(2);
  });

  it('pins the endpoints regardless of gamma', () => {
    for (const gamma of [0.5, 1, 2, 4]) {
      expect(widthForPressure(0, { ...RAW, gamma })).toBeCloseTo(1);
      expect(widthForPressure(100, { ...RAW, gamma })).toBeCloseTo(3);
    }
  });

  it('never exceeds the configured band — the anti-spike ceiling', () => {
    for (const f of [0, 1, 37, 99, 100, 5000]) {
      const w = widthForPressure(f, RAW);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(3);
    }
  });

  it('falls back to flatWidth when pressure is missing', () => {
    expect(widthForPressure(undefined, RAW)).toBe(RAW.flatWidth);
  });
});

describe('smoothSeries', () => {
  it('returns a copy unchanged for a disabled window', () => {
    const input = [1, 9, 1];
    expect(smoothSeries(input, 0)).toEqual(input);
    expect(smoothSeries(input, 1)).toEqual(input);
    expect(smoothSeries(input, 3)).not.toBe(input);
  });

  it('handles empty and very short series', () => {
    expect(smoothSeries([], 3)).toEqual([]);
    expect(smoothSeries([5], 3)).toEqual([5]);
    expect(smoothSeries([5, 7], 3)).toEqual([5, 7]);
  });

  it('leaves a constant series untouched', () => {
    expect(smoothSeries([4, 4, 4, 4, 4], 3)).toEqual([4, 4, 4, 4, 4]);
  });

  it('averages symmetrically — the peak stays put rather than lagging', () => {
    // A single spike should spread evenly to both neighbours, not just forward.
    const out = smoothSeries([0, 0, 3, 0, 0], 3);
    expect(out[1]).toBeCloseTo(1);
    expect(out[3]).toBeCloseTo(1);
    expect(out[2]).toBeCloseTo(1);
  });

  it('attenuates a spike, and attenuates it more with a wider window', () => {
    const spike = [0, 0, 0, 10, 0, 0, 0];
    const narrow = smoothSeries(spike, 3);
    const wide = smoothSeries(spike, 5);
    expect(narrow[3]).toBeLessThan(10);
    expect(wide[3]).toBeLessThan(narrow[3]);
  });

  it('preserves the series mean in the interior', () => {
    const out = smoothSeries([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(3);
  });

  it('averages over the available window at the edges', () => {
    // First element has no left neighbour: mean of [1, 2] only.
    expect(smoothSeries([1, 2, 3, 4, 5], 3)[0]).toBeCloseTo(1.5);
  });
});

describe('limitSlew', () => {
  it('returns a copy unchanged when disabled', () => {
    const input = [1, 5, 1];
    expect(limitSlew(input, 0)).toEqual(input);
    expect(limitSlew(input, -1)).toEqual(input);
    expect(limitSlew(input, 0)).not.toBe(input);
  });

  it('handles empty input', () => {
    expect(limitSlew([], 1)).toEqual([]);
  });

  it('caps the step size between consecutive values', () => {
    const out = limitSlew([0, 10, 10, 10], 1);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('bounds both flanks of a spike, not just the leading edge', () => {
    const out = limitSlew([0, 0, 8, 0, 0], 1);
    // Backward pass pulls the pre-spike value up, so the rise is gradual on both sides.
    expect(out[2]).toBeLessThan(8);
    for (let i = 1; i < out.length; i++) {
      expect(Math.abs(out[i] - out[i - 1])).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('leaves a series already within the limit alone', () => {
    const gentle = [1, 1.2, 1.4, 1.3];
    expect(limitSlew(gentle, 1)).toEqual(gentle);
  });
});

describe('widthsForPressures', () => {
  it('returns one width per input pressure', () => {
    expect(widthsForPressures([0, 50, 100], RAW)).toHaveLength(3);
  });

  it('handles empty / invalid input', () => {
    expect(widthsForPressures([], RAW)).toEqual([]);
    expect(widthsForPressures(null, RAW)).toEqual([]);
  });

  it('varies width along the stroke rather than applying one width throughout', () => {
    // The whole point of the feature: a rising press must produce rising widths.
    const widths = widthsForPressures([0, 25, 50, 75, 100], RAW);
    expect(new Set(widths).size).toBeGreaterThan(1);
    expect(widths[4]).toBeGreaterThan(widths[0]);
  });

  it('stays inside the width band at every point', () => {
    const widths = widthsForPressures([0, 100, 0, 100, 0, 100], RAW);
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(RAW.minWidth - 1e-9);
      expect(w).toBeLessThanOrEqual(RAW.maxWidth + 1e-9);
    }
  });

  it('suppresses a sudden pressure spike relative to no smoothing', () => {
    const spike = [0, 0, 0, 100, 0, 0, 0];
    const unsmoothed = widthsForPressures(spike, { ...RAW, smoothing: 0, slewLimit: 0 });
    const smoothed = widthsForPressures(spike, { ...RAW, smoothing: 5, slewLimit: 0.2 });
    expect(unsmoothed[3]).toBeCloseTo(RAW.maxWidth);
    expect(smoothed[3]).toBeLessThan(unsmoothed[3]);
  });

  it('respects the slew limit between consecutive dots', () => {
    const widths = widthsForPressures([0, 100, 0, 100], { ...RAW, smoothing: 0, slewLimit: 0.25 });
    for (let i = 1; i < widths.length; i++) {
      expect(Math.abs(widths[i] - widths[i - 1])).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it('returns a constant flatWidth when no pressure was recorded at all', () => {
    // Pages saved before pressure was persisted — honest flat line, not a hairline.
    const widths = widthsForPressures([NaN, NaN, NaN], RAW);
    expect(widths).toEqual([RAW.flatWidth, RAW.flatWidth, RAW.flatWidth]);
  });

  it('fills isolated gaps from neighbours instead of collapsing them', () => {
    const widths = widthsForPressures([100, NaN, 100], { ...RAW, smoothing: 0, slewLimit: 0 });
    expect(widths[1]).toBeCloseTo(RAW.maxWidth);
  });

  it('fills a leading gap by looking backward from the first known value', () => {
    const widths = widthsForPressures([NaN, NaN, 100], { ...RAW, smoothing: 0, slewLimit: 0 });
    expect(widths[0]).toBeCloseTo(RAW.maxWidth);
  });

  it('produces a near-uniform line for a pen profile and a varied one for brush', () => {
    const pressures = [50, 200, 400, 700, 900];
    const pen = widthsForPressures(pressures, profileFromPreset('pen'));
    const brush = widthsForPressures(pressures, profileFromPreset('brush'));
    const spread = (a) => Math.max(...a) - Math.min(...a);
    expect(spread(pen)).toBeLessThan(spread(brush));
  });
});

describe('strokePressures / hasPressureData', () => {
  const dots = (fs) => ({ dotArray: fs.map((f) => ({ x: 0, y: 0, f })) });

  it('pulls f off each dot', () => {
    expect(strokePressures(dots([10, 20, 30]))).toEqual([10, 20, 30]);
  });

  it('reads the legacy `dots` key as well as dotArray', () => {
    expect(strokePressures({ dots: [{ f: 7 }] })).toEqual([7]);
  });

  it('reports NaN for dots with no numeric force', () => {
    const out = strokePressures({ dotArray: [{ f: 5 }, {}, { f: null }] });
    expect(out[0]).toBe(5);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
  });

  it('handles a missing stroke or empty dot array', () => {
    expect(strokePressures(null)).toEqual([]);
    expect(strokePressures({ dotArray: [] })).toEqual([]);
  });

  it('detects real pressure data only when the series actually varies', () => {
    expect(hasPressureData(dots([100, 250, 400]))).toBe(true);
    // Legacy load injected one constant force for every dot — not real data.
    expect(hasPressureData(dots([100, 100, 100]))).toBe(false);
    expect(hasPressureData(dots([512, 512]))).toBe(false);
    expect(hasPressureData({ dotArray: [] })).toBe(false);
  });
});
