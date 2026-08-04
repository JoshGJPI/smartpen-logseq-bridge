/**
 * Tests for canvas-renderer.js sketch rendering.
 *
 * The behaviour under test is the thing Canvas2D makes easy to get wrong:
 * `lineWidth` is read once per stroke() call, so a width assigned inside a
 * moveTo/lineTo loop is silently ignored and the whole path renders at one
 * width. These tests drive the renderer against a recording context stub and
 * assert on the (lineWidth, vertex-count) pairs it actually receives, which is
 * the only way to tell a real taper from the no-op the old code produced.
 *
 * Coverage:
 *   - drawStroke: uniform for handwriting, multi-width for sketch strokes
 *   - selection / deletion / decorative interaction with the sketch path
 *   - strokeVariableWidth: run batching, quantisation, degenerate input
 *   - sketchWidths: caching and profile-key invalidation, legacy flat fallback
 *   - drawPastedStroke: sketch flag survives duplication
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasRenderer } from '../canvas-renderer.js';
import { profileFromPreset } from '../sketch-width.js';

const PAGE_INFO = { section: 3, owner: 1012, book: 3017, page: 42 };

/**
 * Minimal recording 2D context. Captures one entry per stroke() call:
 * the lineWidth in force and how many vertices were in that sub-path.
 */
function makeContext() {
  const calls = [];
  let vertices = 0;
  return {
    calls,
    // state the renderer sets
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    lineCap: '', lineJoin: '', font: '', textBaseline: '',
    // geometry
    beginPath() { vertices = 0; },
    moveTo() { vertices = 1; },
    lineTo() { vertices++; },
    stroke() { calls.push({ lineWidth: this.lineWidth, vertices, dash: this._dash }); },
    closePath() {},
    // everything else the renderer may touch
    _dash: [],
    setLineDash(d) { this._dash = d; },
    scale() {}, fillRect() {}, strokeRect() {}, fill() {}, arc() {},
    fillText() {}, measureText() { return { width: 10 }; },
    save() {}, restore() {},
  };
}

/** Renderer wired to a recording context, with a known viewport. */
function makeRenderer() {
  const ctx = makeContext();
  const canvas = {
    getContext: () => ctx,
    parentElement: null, // makes resize() bail out, leaving our viewport alone
    width: 0, height: 0, style: {},
  };
  const renderer = new CanvasRenderer(canvas);
  // resize() returned early, so set the viewport by hand. Generous, so nothing
  // is culled by isStrokeOffscreen().
  renderer.viewWidth = 4000;
  renderer.viewHeight = 4000;
  ctx.calls.length = 0; // drop anything the constructor's clear() recorded
  return { renderer, ctx };
}

/**
 * Canvas-format stroke. `forces` gives one pen force per dot; dots march along
 * x so the stroke has real extent.
 */
function stroke(forces, extra = {}) {
  return {
    pageInfo: PAGE_INFO,
    startTime: 1000,
    endTime: 1000 + forces.length,
    dotArray: forces.map((f, i) => ({ x: 10 + i, y: 20, f, timestamp: 1000 + i })),
    ...extra,
  };
}

/** A rising force ramp — the clearest signal that width tracks pressure. */
const RAMP = [100, 200, 300, 400, 500, 600, 700, 800];

describe('drawStroke — handwriting (not flagged as sketch)', () => {
  let renderer, ctx;
  beforeEach(() => { ({ renderer, ctx } = makeRenderer()); });

  it('draws the whole stroke as one path at one width', () => {
    renderer.drawStroke(stroke(RAMP));
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].vertices).toBe(RAMP.length);
  });

  it('ignores pressure entirely — width does not depend on the final dot', () => {
    // The old code's bug: the last dot's force set the width for the whole line.
    renderer.drawStroke(stroke([100, 100, 100, 900]));
    const heavyEnd = ctx.calls[0].lineWidth;
    ctx.calls.length = 0;
    renderer.drawStroke(stroke([100, 100, 100, 100]));
    expect(ctx.calls[0].lineWidth).toBe(heavyEnd);
  });

  it('renders selected strokes wider than unselected', () => {
    renderer.drawStroke(stroke(RAMP), false);
    const plain = ctx.calls[0].lineWidth;
    ctx.calls.length = 0;
    renderer.drawStroke(stroke(RAMP), true);
    expect(ctx.calls[0].lineWidth).toBeGreaterThan(plain);
  });

  it('scales width with zoom', () => {
    renderer.drawStroke(stroke(RAMP));
    const atOne = ctx.calls[0].lineWidth;
    ctx.calls.length = 0;
    renderer.zoom = 4;
    renderer.drawStroke(stroke(RAMP));
    expect(ctx.calls[0].lineWidth).toBeGreaterThan(atOne);
  });

  it('skips strokes with fewer than 2 dots', () => {
    renderer.drawStroke(stroke([500]));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('drawStroke — sketch strokes', () => {
  let renderer, ctx;
  beforeEach(() => {
    ({ renderer, ctx } = makeRenderer());
    // Wide band + no smoothing/slew so the ramp shows up as distinct widths.
    renderer.setSketchProfile({
      minWidth: 0.4, maxWidth: 4, gamma: 1,
      pressureFloor: 0, pressureCeil: 1000,
      smoothing: 0, slewLimit: 0,
    });
    renderer.zoom = 2;
  });

  it('varies width along the line rather than using one width throughout', () => {
    renderer.drawStroke(stroke(RAMP, { sketch: true }));
    const widths = ctx.calls.map((c) => c.lineWidth);
    expect(widths.length).toBeGreaterThan(1);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it('increases width monotonically for a rising pressure ramp', () => {
    renderer.drawStroke(stroke(RAMP, { sketch: true }));
    const widths = ctx.calls.map((c) => c.lineWidth);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0]);
  });

  it('covers every segment exactly once across its runs', () => {
    // Runs share boundary vertices, so segment count is (vertices-1) summed.
    renderer.drawStroke(stroke(RAMP, { sketch: true }));
    const segments = ctx.calls.reduce((sum, c) => sum + (c.vertices - 1), 0);
    expect(segments).toBe(RAMP.length - 1);
  });

  it('batches equal-width segments into a single run', () => {
    // Constant pressure has one width throughout, so it should collapse to one
    // stroke() call despite going through the variable-width path.
    renderer.drawStroke(stroke([400, 400, 400, 400, 400, 400], { sketch: true }));
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].vertices).toBe(6);
  });

  it('emits fewer runs than segments — quantisation is doing work', () => {
    const forces = Array.from({ length: 60 }, (_, i) => 100 + i * 10);
    renderer.drawStroke(stroke(forces, { sketch: true }));
    expect(ctx.calls.length).toBeLessThan(forces.length - 1);
    expect(ctx.calls.length).toBeGreaterThan(1);
  });

  it('draws solid — never dashed', () => {
    renderer.drawStroke(stroke(RAMP, { sketch: true }));
    ctx.calls.forEach((c) => expect(c.dash).toEqual([]));
  });

  it('emphasises a selected sketch stroke without flattening the taper', () => {
    renderer.drawStroke(stroke(RAMP, { sketch: true }), false);
    const plain = ctx.calls.map((c) => c.lineWidth);
    ctx.calls.length = 0;
    renderer.drawStroke(stroke(RAMP, { sketch: true }), true);
    const selected = ctx.calls.map((c) => c.lineWidth);

    expect(Math.max(...selected)).toBeGreaterThan(Math.max(...plain));
    expect(new Set(selected).size).toBeGreaterThan(1);
  });

  it('falls back to the uniform dashed path for a deleted sketch stroke', () => {
    // The dash is the more important signal, and dashes restart per sub-path.
    renderer.drawStroke(stroke(RAMP, { sketch: true }), false, false, true);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].dash).toEqual([3, 3]);
  });

  it('falls back to the uniform dashed path for a decorative sketch stroke', () => {
    renderer.drawStroke(stroke(RAMP, { sketch: true }), false, true, false);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].dash).toEqual([5, 5]);
  });

  it('respects the profile — a pen profile varies less than a brush profile', () => {
    const spread = (preset) => {
      renderer.setSketchProfile(profileFromPreset(preset));
      ctx.calls.length = 0;
      renderer.drawStroke(stroke(RAMP, { sketch: true }));
      const w = ctx.calls.map((c) => c.lineWidth);
      return Math.max(...w) - Math.min(...w);
    };
    expect(spread('pen')).toBeLessThan(spread('brush'));
  });
});

describe('sketchWidths', () => {
  let renderer;
  beforeEach(() => {
    ({ renderer } = makeRenderer());
    renderer.setSketchProfile({ smoothing: 0, slewLimit: 0 });
  });

  it('returns one width per dot', () => {
    expect(renderer.sketchWidths(stroke(RAMP))).toHaveLength(RAMP.length);
  });

  it('caches on the stroke and reuses while the profile is unchanged', () => {
    const s = stroke(RAMP);
    const first = renderer.sketchWidths(s);
    expect(renderer.sketchWidths(s)).toBe(first);
    expect(s._sw.key).toBe(renderer.sketchProfileKey);
  });

  it('recomputes when the profile changes', () => {
    const s = stroke(RAMP);
    const before = renderer.sketchWidths(s);
    renderer.setSketchProfile({ minWidth: 2, maxWidth: 9, smoothing: 0, slewLimit: 0 });
    const after = renderer.sketchWidths(s);
    expect(after).not.toBe(before);
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
  });

  it('uses a constant flatWidth for legacy strokes with no real pressure', () => {
    // A page saved before pressure was persisted reads back with one injected
    // constant force. That must not map through the curve into a hairline.
    renderer.setSketchProfile({ minWidth: 0.1, maxWidth: 5, flatWidth: 0.77 });
    const widths = renderer.sketchWidths(stroke([100, 100, 100, 100]));
    expect(widths).toEqual([0.77, 0.77, 0.77, 0.77]);
  });
});

describe('strokeVariableWidth — degenerate input', () => {
  let renderer, ctx;
  beforeEach(() => { ({ renderer, ctx } = makeRenderer()); });

  it('draws nothing for zero or one vertex', () => {
    renderer.strokeVariableWidth([0], [0], [1], 1);
    renderer.strokeVariableWidth([], [], [], 1);
    expect(ctx.calls).toHaveLength(0);
  });

  it('draws a single run for a two-vertex line', () => {
    renderer.strokeVariableWidth([0, 10], [0, 10], [1, 2], 1);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0].vertices).toBe(2);
  });

  it('never emits a width below the visible hairline floor', () => {
    renderer.strokeVariableWidth([0, 5, 10], [0, 0, 0], [0.0001, 0.0001, 0.0001], 0.0001);
    ctx.calls.forEach((c) => expect(c.lineWidth).toBeGreaterThanOrEqual(0.4));
  });
});

describe('drawPastedStroke', () => {
  let renderer, ctx;
  beforeEach(() => {
    ({ renderer, ctx } = makeRenderer());
    renderer.setSketchProfile({
      minWidth: 0.4, maxWidth: 4, gamma: 1,
      pressureFloor: 0, pressureCeil: 1000, smoothing: 0, slewLimit: 0,
    });
  });

  it('draws an ordinary pasted stroke as one uniform path', () => {
    renderer.drawPastedStroke({ ...stroke(RAMP), _offset: { x: 5, y: 5 } });
    expect(ctx.calls).toHaveLength(1);
  });

  it('keeps the taper on a stroke duplicated from a sketch', () => {
    renderer.drawPastedStroke({ ...stroke(RAMP, { sketch: true }), _offset: { x: 5, y: 5 } });
    const widths = ctx.calls.map((c) => c.lineWidth);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });
});
