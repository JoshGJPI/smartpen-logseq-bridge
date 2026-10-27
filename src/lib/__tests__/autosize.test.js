/**
 * Tests for autosize.js: a transcript line stays one line when text with
 * line breaks is pasted into its (wrapping) textarea.
 */

import { describe, it, expect } from 'vitest';
import { oneLine } from '../autosize.js';

describe('oneLine', () => {
  it('turns line breaks, and the spaces around them, into one space', () => {
    expect(oneLine('poured before\nthe rebar \r\n  was\n\ninspected')).toBe('poured before the rebar was inspected');
  });
  it('leaves text without breaks alone, and is "" for non-strings', () => {
    expect(oneLine('  two  spaces ')).toBe('  two  spaces ');
    expect(oneLine('')).toBe('');
    expect(oneLine(null)).toBe('');
    expect(oneLine(undefined)).toBe('');
  });
});
