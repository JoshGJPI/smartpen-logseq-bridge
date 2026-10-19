import { describe, it, expect } from 'vitest';
import {
  ROTATIONS,
  NOMINAL_FRAME,
  normalizeRotation,
  rotateBy,
  isQuarterTurn,
  rotationLabel,
  orientationKey,
  parseOrientationKey,
  normalizeOrientations,
  rotationFor,
  rotateFrame,
  rotationMatrix,
  svgRotationTransform,
  rotatePoint,
  unrotatePoint,
  rotateBox,
  rotateStoredPoints,
  rotateCanvasStrokes
} from '../page-orientation.js';

const frame = { x0: 2, y0: 3, x1: 62, y1: 93 }; // 60 wide, 90 tall, off-origin
const close = (a, b) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('normalizeRotation', () => {
  it('keeps the four right angles', () => {
    for (const r of ROTATIONS) expect(normalizeRotation(r)).toBe(r);
  });
  it('wraps negative and >360 values', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation('180')).toBe(180);
  });
  it('reads anything else as portrait', () => {
    for (const bad of [45, 89.5, NaN, null, undefined, 'x', {}, [], Infinity]) {
      expect(normalizeRotation(bad)).toBe(0);
    }
  });
});

describe('rotateBy / labels', () => {
  it('steps a quarter each way and wraps', () => {
    expect(rotateBy(0, 1)).toBe(90);
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(270, 1)).toBe(0);
    expect(rotateBy(180, -1)).toBe(90);
  });
  it('knows quarter turns', () => {
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(270)).toBe(true);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(0)).toBe(false);
  });
  it('labels each rotation', () => {
    expect(rotationLabel(0)).toBe('Portrait');
    expect(rotationLabel(90)).toBe('Landscape ↻');
    expect(rotationLabel(270)).toBe('Landscape ↺');
    expect(rotationLabel(180)).toBe('Upside down');
  });
});

describe('orientationKey / parseOrientationKey', () => {
  it('builds keys for plain, volume and suffixed pages', () => {
    expect(orientationKey('388', '12')).toBe('388/12');
    expect(orientationKey('388v2', '151b')).toBe('388v2/151b');
    expect(orientationKey(3017, 42)).toBe('3017/42');
  });
  it('rejects non-canonical books and bad page ids', () => {
    expect(orientationKey('388v1', '12')).toBeNull();
    expect(orientationKey('0388', '12')).toBeNull();
    expect(orientationKey('388', '12bc')).toBeNull();
    expect(orientationKey('388', '../x')).toBeNull();
    expect(orientationKey(null, '1')).toBeNull();
    expect(orientationKey('388', null)).toBeNull();
  });
  it('round-trips', () => {
    for (const [b, p] of [['388', '1'], ['388v2', '151b'], ['3017', '42']]) {
      expect(parseOrientationKey(orientationKey(b, p))).toEqual({ book: b, pageId: p });
    }
  });
  it('does not split a volume key on its digits', () => {
    expect(parseOrientationKey('388v2/7')).toEqual({ book: '388v2', pageId: '7' });
    expect(parseOrientationKey('388v1/7')).toBeNull();
    expect(parseOrientationKey('B388/P7')).toBeNull();
    expect(parseOrientationKey('388/7/8')).toBeNull();
  });
});

describe('normalizeOrientations (sidecar)', () => {
  it('missing or corrupt sidecar → every page portrait', () => {
    for (const raw of [null, undefined, '', 'not json', 42, [], {}, { pages: null }, { pages: [] }, { pages: 'x' }]) {
      expect(normalizeOrientations(raw)).toEqual({});
      expect(rotationFor(normalizeOrientations(raw), '388', '1')).toBe(0);
    }
  });
  it('keeps valid entries, drops invalid keys, zero and bad rotations', () => {
    const map = normalizeOrientations({
      version: 1,
      pages: {
        '388/12': 90,
        '388v2/151b': 270,
        '3017/4': '180',
        '388/13': 0,
        '388/14': 45,
        '388v1/2': 90,
        'nonsense': 90
      }
    });
    expect(map).toEqual({ '388/12': 90, '388v2/151b': 270, '3017/4': 180 });
  });
  it('looks pages up by book key and page id', () => {
    const map = { '388/12': 90, '388v2/12': 270, '388/151b': 180 };
    expect(rotationFor(map, '388', '12')).toBe(90);
    expect(rotationFor(map, '388v2', '12')).toBe(270);   // a volume is its own notebook
    expect(rotationFor(map, '388', '151b')).toBe(180);
    expect(rotationFor(map, '388', '151')).toBe(0);      // suffix is its own page
    expect(rotationFor(map, '388', 13)).toBe(0);
    expect(rotationFor(null, '388', '12')).toBe(0);
  });
});

describe('rotateFrame', () => {
  it('swaps width and height on a quarter turn, keeping the top-left', () => {
    expect(rotateFrame(frame, 90)).toEqual({ x0: 2, y0: 3, x1: 92, y1: 63 });
    expect(rotateFrame(frame, 270)).toEqual({ x0: 2, y0: 3, x1: 92, y1: 63 });
  });
  it('leaves 0 and 180 alone', () => {
    expect(rotateFrame(frame, 0)).toEqual(frame);
    expect(rotateFrame(frame, 180)).toEqual(frame);
  });
});

describe('rotatePoint corners', () => {
  const TL = [frame.x0, frame.y0], TR = [frame.x1, frame.y0];
  const BL = [frame.x0, frame.y1], BR = [frame.x1, frame.y1];
  const corners = (r) => {
    const f = rotateFrame(frame, r);
    return { TL: [f.x0, f.y0], TR: [f.x1, f.y0], BL: [f.x0, f.y1], BR: [f.x1, f.y1] };
  };

  it('0° is the identity', () => {
    close(rotatePoint(...TL, 0, frame), TL);
    close(rotatePoint(10, 20, 0, frame), [10, 20]);
  });
  it('90° (clockwise): top-left → top-right, bottom-left → top-left', () => {
    const c = corners(90);
    close(rotatePoint(...TL, 90, frame), c.TR);
    close(rotatePoint(...TR, 90, frame), c.BR);
    close(rotatePoint(...BR, 90, frame), c.BL);
    close(rotatePoint(...BL, 90, frame), c.TL);
  });
  it('270° (counter-clockwise): top-left → bottom-left', () => {
    const c = corners(270);
    close(rotatePoint(...TL, 270, frame), c.BL);
    close(rotatePoint(...TR, 270, frame), c.TL);
    close(rotatePoint(...BR, 270, frame), c.TR);
    close(rotatePoint(...BL, 270, frame), c.BR);
  });
  it('180°: corners swap diagonally', () => {
    close(rotatePoint(...TL, 180, frame), BR);
    close(rotatePoint(...BR, 180, frame), TL);
    close(rotatePoint(...TR, 180, frame), BL);
  });
  it('a line of writing across a sideways page reads top to bottom → left to right', () => {
    // Written with the notebook turned clockwise: the line runs DOWN the page
    // at constant x. Shown at 270 it should run left to right at constant y.
    const a = rotatePoint(20, 10, 270, frame);
    const b = rotatePoint(20, 50, 270, frame);
    expect(a[1]).toBeCloseTo(b[1], 9);
    expect(b[0]).toBeGreaterThan(a[0]);
  });
});

describe('round trips', () => {
  const pts = [[0, 0], [2, 3], [17.25, 44.5], [62, 93], [-5, 120]];
  for (const r of ROTATIONS) {
    it(`unrotate(rotate(p)) = p at ${r}°`, () => {
      for (const [x, y] of pts) close(unrotatePoint(...rotatePoint(x, y, r, frame), r, frame), [x, y]);
    });
  }
  it('four quarter turns are the identity', () => {
    let f = frame;
    let p = [17.25, 44.5];
    for (let i = 0; i < 4; i++) {
      p = rotatePoint(p[0], p[1], 90, f);
      f = rotateFrame(f, 90);
    }
    close(p, [17.25, 44.5]);
    expect(f).toEqual(frame);
  });
});

describe('rotationMatrix / svgRotationTransform', () => {
  it('agrees with rotatePoint, scaled', () => {
    const S = 2.371;
    for (const r of ROTATIONS) {
      const [a, b, c, d, e, f] = rotationMatrix(r, frame, S);
      const [x, y] = [17.25, 44.5];
      const want = rotatePoint(x, y, r, frame);
      close([a * x * S + c * y * S + e, b * x * S + d * y * S + f], [want[0] * S, want[1] * S]);
    }
  });
  it('is empty for portrait so unrotated pages render as before', () => {
    expect(svgRotationTransform(0, frame)).toBe('');
    expect(svgRotationTransform(90, frame)).toMatch(/^matrix\(/);
  });
});

describe('rotateBox', () => {
  it('turns a box exactly', () => {
    const box = { minX: 10, minY: 20, maxX: 30, maxY: 25 };
    for (const r of ROTATIONS) {
      const got = rotateBox(box, r, frame);
      const pts = [[10, 20], [30, 20], [10, 25], [30, 25]].map(([x, y]) => rotatePoint(x, y, r, frame));
      expect(got.minX).toBeCloseTo(Math.min(...pts.map((p) => p[0])), 9);
      expect(got.maxX).toBeCloseTo(Math.max(...pts.map((p) => p[0])), 9);
      expect(got.minY).toBeCloseTo(Math.min(...pts.map((p) => p[1])), 9);
      expect(got.maxY).toBeCloseTo(Math.max(...pts.map((p) => p[1])), 9);
    }
  });
  it('a box the full frame becomes the rotated frame', () => {
    const box = { minX: frame.x0, minY: frame.y0, maxX: frame.x1, maxY: frame.y1 };
    const f = rotateFrame(frame, 90);
    const got = rotateBox(box, 90, frame);
    expect(got.minX).toBeCloseTo(f.x0, 9);
    expect(got.minY).toBeCloseTo(f.y0, 9);
    expect(got.maxX).toBeCloseTo(f.x1, 9);
    expect(got.maxY).toBeCloseTo(f.y1, 9);
  });
});

describe('rotateStoredPoints / rotateCanvasStrokes', () => {
  it('keeps timestamp and force columns, never mutates input', () => {
    const points = [[10, 20, 1000, 300], [11, 21, null, 310], [12, 22]];
    const copy = JSON.parse(JSON.stringify(points));
    const out = rotateStoredPoints(points, 90);
    expect(points).toEqual(copy);
    expect(out[0].slice(2)).toEqual([1000, 300]);
    expect(out[1].slice(2)).toEqual([null, 310]);
    expect(out[2]).toHaveLength(2);
    close(out[0], rotatePoint(10, 20, 90, NOMINAL_FRAME));
  });
  it('returns the same array for portrait', () => {
    const points = [[1, 2]];
    expect(rotateStoredPoints(points, 0)).toBe(points);
    expect(rotateStoredPoints(null, 90)).toEqual([]);
  });
  it('copies canvas strokes with every field kept', () => {
    const pageInfo = { book: '388v2', page: 151 };
    const strokes = [{ startTime: 5, endTime: 9, pageInfo, sketch: true,
      dotArray: [{ x: 10, y: 20, f: 400, timestamp: 5, pageInfo }] }];
    const out = rotateCanvasStrokes(strokes, 270);
    expect(out[0]).not.toBe(strokes[0]);
    expect(strokes[0].dotArray[0].x).toBe(10);
    expect(out[0].startTime).toBe(5);
    expect(out[0].sketch).toBe(true);
    expect(out[0].pageInfo).toBe(pageInfo);
    expect(out[0].dotArray[0].f).toBe(400);
    close([out[0].dotArray[0].x, out[0].dotArray[0].y], rotatePoint(10, 20, 270, NOMINAL_FRAME));
    expect(rotateCanvasStrokes(strokes, 0)).toBe(strokes);
  });
});
