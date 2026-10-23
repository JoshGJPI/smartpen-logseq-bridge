// @vitest-environment node
/**
 * Day boundaries across US daylight-saving changes, in a fixed zone so the test
 * means the same thing on every machine. Timestamps are written in UTC so the
 * local wall time is unambiguous (01:30 happens twice on the fall-back day).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayKey, rangeBoundsMs } from '../../src/lib/timeline.js';
import { createTools } from '../core/tools.js';

const prevTZ = process.env.TZ;
let root;
const Z = (s) => Date.parse(s);   // ISO with Z

// America/Chicago, 2026: spring forward Sun Mar 8 (02:00 CST → 03:00 CDT), fall back Sun Nov 1 (02:00 CDT → 01:00 CST).
const FALL = {
  '00:30 CDT': Z('2026-11-01T05:30:00Z'),
  '01:30 CDT': Z('2026-11-01T06:30:00Z'),
  '01:30 CST': Z('2026-11-01T07:30:00Z'),
  '23:59:59 CST': Z('2026-11-02T05:59:59Z'),
  'Nov 2 00:00 CST': Z('2026-11-02T06:00:00Z')
};
const SPRING = {
  '01:59 CST': Z('2026-03-08T07:59:00Z'),
  '03:00 CDT': Z('2026-03-08T08:00:00Z'),
  '23:59:59 CDT': Z('2026-03-09T04:59:59Z'),
  'Mar 9 00:00 CDT': Z('2026-03-09T05:00:00Z')
};

const stroke = (ms, x) => ({ id: `s${ms}`, startTime: ms, endTime: ms + 300, lineId: null, points: [[x, 10, ms, 200], [x + 5, 12, ms + 100, 200]] });
function writePage(book, id, times) {
  const dir = path.join(root, 'pages', `B${book}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `P${id}.json`), JSON.stringify({
    version: '2.0', pageInfo: { section: 3, owner: 1, book: Number(book), page: Number(id) },
    metadata: { lastUpdated: '2026-01-01T00:00:00Z', totalStrokes: times.length, bounds: {} },
    transcript: { lastTranscribed: null, lines: [] },
    strokes: times.map((ms, i) => stroke(ms, 5 + i * 8))
  }));
}

beforeAll(() => {
  process.env.TZ = 'America/Chicago';
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-dst-'));
  writePage('388', '1', Object.values(FALL));
  writePage('388', '2', Object.values(SPRING));
});
afterAll(() => {
  if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  fs.rmSync(root, { recursive: true, force: true });
});

const summary = (from, to) => JSON.parse(createTools(root).days_summary({ from, to }).content[0].text);

describe('DST-change days (America/Chicago)', () => {
  it('the zone is in force for the app\'s dayKey', () => {
    expect(dayKey(FALL['01:30 CST'])).toBe('2026-11-01');
    expect(dayKey(FALL['Nov 2 00:00 CST'])).toBe('2026-11-02');
  });
  it('fall-back day is 25 hours, spring-forward day 23', () => {
    const fall = rangeBoundsMs('2026-11-01', '2026-11-01');
    const spring = rangeBoundsMs('2026-03-08', '2026-03-08');
    expect((fall.endMs - fall.startMs) / 3.6e6).toBe(25);
    expect((spring.endMs - spring.startMs) / 3.6e6).toBe(23);
  });
  it('both 01:30s and 23:59:59 sit on Nov 1; local midnight starts Nov 2', () => {
    expect(summary('2026-11-01', '2026-11-02').map((d) => [d.day, d.strokes])).toEqual([['2026-11-01', 4], ['2026-11-02', 1]]);
  });
  it('spring-forward: 01:59 and 03:00 are one day; the next local midnight is not', () => {
    expect(summary('2026-03-08', '2026-03-09').map((d) => [d.day, d.strokes])).toEqual([['2026-03-08', 3], ['2026-03-09', 1]]);
  });
  it('render_days uses the same half-open local day', () => {
    const tools = createTools(root);
    expect(tools.render_days({ from: '2026-11-01' }).content[0].text).toMatch(/p\.1: 4 of 5 strokes in range/);
    expect(tools.render_days({ from: '2026-11-02' }).content[0].text).toMatch(/p\.1: 1 of 5 strokes in range/);
    expect(tools.render_days({ from: '2026-10-31' }).content[0].text).toMatch(/^No ink written/);
  });
});
