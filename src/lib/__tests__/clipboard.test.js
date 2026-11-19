/**
 * clipboard.js — transcript markdown to the clipboard, with the log line.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyMarkdown } from '../clipboard.js';

afterEach(() => vi.unstubAllGlobals());

describe('copyMarkdown', () => {
  it('copies and logs success', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const log = vi.fn();
    expect(await copyMarkdown('- a', 'transcript B1/P2', log)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('- a');
    expect(log).toHaveBeenCalledWith('Copied transcript B1/P2 to clipboard (LogSeq format)', 'success');
  });

  it('nothing to copy: a warning, no clipboard write', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const log = vi.fn();
    expect(await copyMarkdown('', 'x', log)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(log.mock.calls[0][1]).toBe('warning');
  });

  it('a clipboard failure is logged as an error', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    const log = vi.fn();
    expect(await copyMarkdown('- a', 'x', log)).toBe(false);
    expect(log).toHaveBeenCalledWith('Failed to copy to clipboard', 'error');
  });
});
