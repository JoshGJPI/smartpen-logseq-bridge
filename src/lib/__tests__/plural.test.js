import { describe, it, expect } from 'vitest';
import { plural } from '../plural.js';

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'day')).toBe('day');
  });

  it('uses the plural for zero and for more than one', () => {
    expect(plural(0, 'day')).toBe('days');
    expect(plural(2, 'day')).toBe('days');
    expect(plural(1000, 'stroke')).toBe('strokes');
  });

  it('accepts an irregular plural', () => {
    expect(plural(1, 'entry', 'entries')).toBe('entry');
    expect(plural(3, 'entry', 'entries')).toBe('entries');
  });
});
