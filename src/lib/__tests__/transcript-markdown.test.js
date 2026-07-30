/**
 * Tests for viewer/transcript-markdown.js — converting PageDoc transcript lines
 * into LogSeq-pasteable outliner markdown.
 *
 * Coverage:
 *   - isPropertyLine (property detection vs. normal text)
 *   - lineToMarkdown (tab indent, TODO/DONE markers)
 *   - linesToLogseqMarkdown (hierarchy, property stripping, blank lines, tasks)
 *   - indentMarkdownBlock (nesting an existing block)
 *   - textToTranscriptLines (flat-text fallback)
 *   - pagesToLogseqMarkdown (single vs. multi-page clipboard payload)
 */

import { describe, it, expect } from 'vitest';
import {
  isPropertyLine,
  lineToMarkdown,
  linesToLogseqMarkdown,
  indentMarkdownBlock,
  textToTranscriptLines,
  pagesToLogseqMarkdown,
} from '../viewer/transcript-markdown.js';

const line = (text, indentLevel = 0, checked = null) => ({ text, indentLevel, checked });

describe('isPropertyLine', () => {
  it('detects LogSeq property lines', () => {
    expect(isPropertyLine('id:: abc-123')).toBe(true);
    expect(isPropertyLine('collapsed:: true')).toBe(true);
    expect(isPropertyLine('  tags:: meeting')).toBe(true);
  });

  it('does not flag normal prose', () => {
    expect(isPropertyLine('Meeting notes')).toBe(false);
    expect(isPropertyLine('the ratio is 3 to 4')).toBe(false);
    expect(isPropertyLine('')).toBe(false);
    expect(isPropertyLine(undefined)).toBe(false);
  });
});

describe('lineToMarkdown', () => {
  it('renders a plain bullet', () => {
    expect(lineToMarkdown(line('hello'))).toBe('- hello');
  });

  it('indents with tabs by indentLevel', () => {
    expect(lineToMarkdown(line('child', 2))).toBe('\t\t- child');
  });

  it('adds TODO / DONE markers', () => {
    expect(lineToMarkdown(line('do it', 0, false))).toBe('- TODO do it');
    expect(lineToMarkdown(line('did it', 1, true))).toBe('\t- DONE did it');
  });
});

describe('linesToLogseqMarkdown', () => {
  it('preserves hierarchy with tab indents', () => {
    const md = linesToLogseqMarkdown([
      line('Parent'),
      line('Child', 1),
      line('Grandchild', 2),
    ]);
    expect(md).toBe('- Parent\n\t- Child\n\t\t- Grandchild');
  });

  it('strips property lines', () => {
    const md = linesToLogseqMarkdown([line('Title'), line('id:: 123'), line('Body')]);
    expect(md).toBe('- Title\n- Body');
  });

  it('drops blank / whitespace-only lines', () => {
    expect(linesToLogseqMarkdown([line('a'), line('   '), line('b')])).toBe('- a\n- b');
  });

  it('mixes TODO/DONE and plain bullets', () => {
    const md = linesToLogseqMarkdown([
      line('Do X', 0, false),
      line('Did Y', 0, true),
      line('a note', 0, null),
    ]);
    expect(md).toBe('- TODO Do X\n- DONE Did Y\n- a note');
  });

  it('handles empty / invalid input', () => {
    expect(linesToLogseqMarkdown([])).toBe('');
    expect(linesToLogseqMarkdown(null)).toBe('');
    expect(linesToLogseqMarkdown(undefined)).toBe('');
  });
});

describe('indentMarkdownBlock', () => {
  it('prefixes every line with tabs', () => {
    expect(indentMarkdownBlock('- a\n\t- b', 1)).toBe('\t- a\n\t\t- b');
  });

  it('is a no-op for empty input or zero/negative levels', () => {
    expect(indentMarkdownBlock('', 2)).toBe('');
    expect(indentMarkdownBlock('- a', 0)).toBe('- a');
    expect(indentMarkdownBlock('- a', -1)).toBe('- a');
  });
});

describe('textToTranscriptLines', () => {
  it('reads indent levels from leading tabs', () => {
    expect(textToTranscriptLines('Parent\n\tChild\n\t\tGrandchild')).toEqual([
      { text: 'Parent', indentLevel: 0, checked: null },
      { text: 'Child', indentLevel: 1, checked: null },
      { text: 'Grandchild', indentLevel: 2, checked: null },
    ]);
  });

  it('falls back to two-space indentation', () => {
    expect(textToTranscriptLines('Parent\n  Child\n    Grandchild').map(l => l.indentLevel))
      .toEqual([0, 1, 2]);
  });

  it('drops blank lines and trims text', () => {
    expect(textToTranscriptLines('a\n   \n b ')).toEqual([
      { text: 'a', indentLevel: 0, checked: null },
      { text: 'b', indentLevel: 0, checked: null },
    ]);
  });

  it('handles empty / invalid input', () => {
    expect(textToTranscriptLines('')).toEqual([]);
    expect(textToTranscriptLines(null)).toEqual([]);
    expect(textToTranscriptLines(undefined)).toEqual([]);
  });

  it('round-trips through linesToLogseqMarkdown', () => {
    const md = linesToLogseqMarkdown(textToTranscriptLines('Parent\n\tChild'));
    expect(md).toBe('- Parent\n\t- Child');
  });
});

describe('pagesToLogseqMarkdown', () => {
  it('emits a bare block for a single page (no header)', () => {
    const md = pagesToLogseqMarkdown([
      { label: 'Field Notes (B3017) · P42', lines: [line('Parent'), line('Child', 1)] },
    ]);
    expect(md).toBe('- Parent\n\t- Child');
  });

  it('nests each page under a labelled bullet when there are several', () => {
    const md = pagesToLogseqMarkdown([
      { label: 'B1 · P1', lines: [line('one')] },
      { label: 'B1 · P2', lines: [line('two'), line('two-a', 1, false)] },
    ]);
    expect(md).toBe('- B1 · P1\n\t- one\n- B1 · P2\n\t- two\n\t\t- TODO two-a');
  });

  it('skips pages with nothing copyable', () => {
    const md = pagesToLogseqMarkdown([
      { label: 'B1 · P1', lines: [line('one')] },
      { label: 'B1 · P2', lines: [] },
      { label: 'B1 · P3', lines: [line('id:: 123'), line('  ')] },
    ]);
    expect(md).toBe('- one');
  });

  it('handles empty / invalid input', () => {
    expect(pagesToLogseqMarkdown([])).toBe('');
    expect(pagesToLogseqMarkdown(null)).toBe('');
    expect(pagesToLogseqMarkdown([{ lines: null }])).toBe('');
  });
});
