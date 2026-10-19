/**
 * Tests for page rotation in the Editor canvas (canvas-renderer.js).
 *
 * A page marked landscape is shown upright: its layout box is the turned box,
 * every Ncode → screen projection turns its dots, and the inverse
 * (screenToNcode) and hit-testing agree with what is drawn. An unrotated page
 * must project exactly as the CLAUDE.md formula says.
 */

import { describe, it, expect } from 'vitest';
import { CanvasRenderer } from '../canvas-renderer.js';

const PAGE = { section: 3, owner: 1012, book: '388v2', page: 7 };
const OTHER = { section: 3, owner: 1012, book: '388', page: 8 };

function makeRenderer() {
  const noop = () => {};
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '', font: '',
    beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, closePath: noop, setLineDash: noop,
    scale: noop, fillRect: noop, strokeRect: noop, fill: noop, arc: noop, fillText: noop,
    measureText: () => ({ width: 10 }), save: noop, restore: noop
  };
  const canvas = { getContext: () => ctx, parentElement: null, width: 0, height: 0, style: {} };
  const r = new CanvasRenderer(canvas);
  r.viewWidth = 4000;
  r.viewHeight = 4000;
  return r;
}

// A sideways page: two strokes written down the page (constant x, growing y).
function strokes(pageInfo = PAGE) {
  return [
    { pageInfo, startTime: 1, endTime: 2, dotArray: [{ x: 10, y: 20, f: 400 }, { x: 10, y: 60, f: 400 }] },
    { pageInfo, startTime: 3, endTime: 4, dotArray: [{ x: 30, y: 20, f: 400 }, { x: 30, y: 60, f: 400 }] }
  ];
}

function layout(r, list, rotations = {}) {
  r.setPageRotations(rotations);
  r.calculateBounds(list);
  r.zoom = 2;
  r.panX = 15;
  r.panY = 25;
}

const keyOf = (p) => `S${p.section}/O${p.owner}/B${p.book}/P${p.page}`;

describe('unrotated pages', () => {
  it('project by the documented formula', () => {
    const r = makeRenderer();
    const list = strokes();
    layout(r, list);
    const { offsetX, offsetY, bounds } = r.pageOffsets.get(keyOf(PAGE));
    const dot = { x: 30, y: 60 };
    const s = r.ncodeToScreen(dot, PAGE);
    expect(s.x).toBeCloseTo((dot.x - bounds.minX + offsetX) * r.scale * r.zoom + r.panX, 9);
    expect(s.y).toBeCloseTo((dot.y - bounds.minY + offsetY) * r.scale * r.zoom + r.panY, 9);
  });

  it('a rotation on another page changes nothing here', () => {
    const r = makeRenderer();
    const list = strokes(OTHER);
    layout(r, list, { '388v2/7': 90 });
    const a = r.ncodeToScreen({ x: 10, y: 20 }, OTHER);
    layout(r, list, {});
    const b = r.ncodeToScreen({ x: 10, y: 20 }, OTHER);
    expect(a).toEqual(b);
  });
});

describe('rotated pages', () => {
  for (const rotation of [90, 180, 270]) {
    it(`lay out at the turned size and round-trip screen ↔ Ncode at ${rotation}°`, () => {
      const r = makeRenderer();
      layout(r, strokes(), { '388v2/7': rotation });
      const { bounds } = r.pageOffsets.get(keyOf(PAGE));
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      // Ink spans 20 × 40 Ncode units (x 10..30, y 20..60).
      if (rotation === 180) { expect(w).toBeCloseTo(20); expect(h).toBeCloseTo(40); }
      else { expect(w).toBeCloseTo(40); expect(h).toBeCloseTo(20); }

      for (const dot of [{ x: 10, y: 20 }, { x: 30, y: 60 }, { x: 17.5, y: 33.25 }]) {
        const s = r.ncodeToScreen(dot, PAGE);
        const back = r.screenToNcode(s.x, s.y, PAGE);
        expect(back.x).toBeCloseTo(dot.x, 9);
        expect(back.y).toBeCloseTo(dot.y, 9);
      }
    });
  }

  it('the page box on screen holds the turned ink', () => {
    const r = makeRenderer();
    layout(r, strokes(), { '388v2/7': 270 });
    const box = r.getPageBoundsScreen(keyOf(PAGE));
    for (const st of strokes()) {
      const b = r.getStrokeBounds(st);
      expect(b.left).toBeGreaterThanOrEqual(box.left - 1e-6);
      expect(b.right).toBeLessThanOrEqual(box.right + 1e-6);
      expect(b.top).toBeGreaterThanOrEqual(box.top - 1e-6);
      expect(b.bottom).toBeLessThanOrEqual(box.bottom + 1e-6);
    }
  });

  it('writing down a sideways page reads left to right at 270°', () => {
    const r = makeRenderer();
    layout(r, strokes(), { '388v2/7': 270 });
    const a = r.ncodeToScreen({ x: 10, y: 20 }, PAGE);
    const b = r.ncodeToScreen({ x: 10, y: 60 }, PAGE);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('hit-tests and box-selects the stroke that is drawn there', () => {
    const r = makeRenderer();
    const list = strokes();
    layout(r, list, { '388v2/7': 90 });
    // Where one of the SECOND stroke's dots is drawn (hitTest is by dot).
    const target = r.ncodeToScreen({ x: 30, y: 60 }, PAGE);
    expect(r.hitTest(target.x, target.y, list)).toBe(1);
    const box = { left: target.x - 3, right: target.x + 3, top: target.y - 3, bottom: target.y + 3 };
    expect(r.findStrokesInRect(list, box)).toEqual([1]);
  });

  it('culls by the turned box', () => {
    const r = makeRenderer();
    const list = strokes();
    layout(r, list, { '388v2/7': 90 });
    expect(r.isStrokeOffscreen(list[0], list[0].dotArray, PAGE)).toBe(false);
    r.panX = -100000;
    expect(r.isStrokeOffscreen(list[0], list[0].dotArray, PAGE)).toBe(true);
  });
});
