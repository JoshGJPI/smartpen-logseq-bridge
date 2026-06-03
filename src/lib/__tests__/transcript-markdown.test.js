/**
 * Tests for viewer/transcript-markdown.js — converting PageDoc transcript lines
 * into LogSeq-pasteable outliner markdown.
 *
 * Coverage:
 *   - isPropertyLine (property detection vs. normal text)
 *   - lineToMarkdown (tab indent, TODO/DONE markers)
 *   - linesToLogseqMarkdown (hierarchy, property stripping, blank lines, tasks)
 */

import { describe, it, expect } from 'vitest';
import {
  isPropertyLine,
  lineToMarkdown,
  linesToLogseqMarkdown,
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
