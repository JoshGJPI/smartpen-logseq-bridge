/**
 * Tests for electron/retimed-sidecar.cjs: reading `_retimed.json` (missing,
 * corrupt, newer, junk entries) and recording retimes, including the chain rule
 * (the key is always the id the PEN knows).
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseRetimedFile, applyRetimes, serializeRetimedFile, emptyRetimedFile } =
  require('../../../electron/retimed-sidecar.cjs');

describe('parseRetimedFile', () => {
  it('a missing file is empty', () => {
    expect(parseRetimedFile(null)).toEqual({ file: emptyRetimedFile(), state: 'missing' });
  });

  it('a corrupt file reads as empty', () => {
    expect(parseRetimedFile('{nope').state).toBe('corrupt');
    expect(parseRetimedFile('[]').state).toBe('corrupt');
    expect(parseRetimedFile('{nope').file.pages).toEqual({});
  });

  it('reads a good file and drops malformed entries', () => {
    const text = JSON.stringify({
      version: 1,
      pages: {
        '388/41': { s1000: 's2000', bad: 's3', s5: 42 },
        '388v2/41': { s1: 's2' },      // volume keys are not page keys here
        '388/42': 'x'
      }
    });
    const { file, state } = parseRetimedFile(text);
    expect(state).toBe('ok');
    expect(file.pages).toEqual({ '388/41': { s1000: 's2000' } });
  });

  it('flags a newer version', () => {
    expect(parseRetimedFile(JSON.stringify({ version: 2, pages: {} })).state).toBe('newer');
  });

  it('keeps unknown top-level fields', () => {
    const { file } = parseRetimedFile(JSON.stringify({ version: 1, pages: {}, note: 'hi' }));
    expect(JSON.parse(serializeRetimedFile(file)).note).toBe('hi');
  });
});

describe('applyRetimes', () => {
  const empty = emptyRetimedFile();

  it('records a retime under the pen id', () => {
    const next = applyRetimes(empty, [{ page: '388/41', from: 's1000', to: 's9000' }]);
    expect(next.pages).toEqual({ '388/41': { s1000: 's9000' } });
    expect(empty.pages).toEqual({});   // not mutated
  });

  it('collapses a chain: s1 → s2 then s2 → s3 leaves s1 → s3', () => {
    const a = applyRetimes(empty, [{ page: '388/41', from: 's1', to: 's2' }]);
    const b = applyRetimes(a, [{ page: '388/41', from: 's2', to: 's3' }]);
    expect(b.pages['388/41']).toEqual({ s1: 's3' });
  });

  it('removes the entry when a stroke is retimed back to its pen time', () => {
    const a = applyRetimes(empty, [{ page: '388/41', from: 's1', to: 's2' }]);
    const b = applyRetimes(a, [{ page: '388/41', from: 's2', to: 's1' }]);
    expect(b.pages).toEqual({});
  });

  it('is idempotent', () => {
    const e = [{ page: '388/41', from: 's1', to: 's2' }];
    expect(applyRetimes(applyRetimes(empty, e), e)).toEqual(applyRetimes(empty, e));
  });

  it('ignores a no-op entry', () => {
    expect(applyRetimes(empty, [{ page: '388/41', from: 's1', to: 's1' }]).pages).toEqual({});
  });

  it('rejects the whole patch on one bad entry', () => {
    expect(() => applyRetimes(empty, [
      { page: '388/41', from: 's1', to: 's2' },
      { page: '../x', from: 's1', to: 's2' }
    ])).toThrow(/page key/);
    expect(() => applyRetimes(empty, [{ page: '388/41', from: '1', to: 's2' }])).toThrow(/stroke id/);
    expect(() => applyRetimes(empty, 'x')).toThrow();
  });
});
