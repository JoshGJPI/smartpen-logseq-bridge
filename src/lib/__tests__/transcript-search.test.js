/**
 * Tests for transcript-search.js — bag-of-words search across transcriptions.
 *
 * Coverage:
 *   - tokenize: basic splitting, hyphen preservation, min-length filter,
 *               property-line filtering, case normalisation
 *   - searchPages: empty query passthrough, partial token matching,
 *                  multi-token ranking, no-transcription pages excluded
 *   - highlightMatches: HTML escaping, <mark> injection, partial matching
 */

import { describe, it, expect } from 'vitest';
import { tokenize, searchPages, highlightMatches } from '../transcript-search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function page(transcriptionText, book = 1, pageNum = 1) {
  return { book, page: pageNum, transcriptionText };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  it('returns empty Set for null/undefined/empty string', () => {
    expect(tokenize(null).size).toBe(0);
    expect(tokenize(undefined).size).toBe(0);
    expect(tokenize('').size).toBe(0);
  });

  it('lowercases all tokens', () => {
    const tokens = tokenize('Hello World');
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('world')).toBe(true);
    expect(tokens.has('Hello')).toBe(false);
  });

  it('excludes single-character words', () => {
    const tokens = tokenize('I am a developer');
    expect(tokens.has('i')).toBe(false);
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('am')).toBe(true);
  });

  it('preserves hyphens within compound words', () => {
    const tokens = tokenize('project 5444-005 is done');
    expect(tokens.has('5444-005')).toBe(true);
  });

  it('strips punctuation like commas and periods', () => {
    const tokens = tokenize('Hello, world. Goodbye.');
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('world')).toBe(true);
    // Trailing punctuation stripped; "goodbye" should appear
    expect(tokens.has('goodbye')).toBe(true);
  });

  it('filters out LogSeq property lines (key:: value format)', () => {
    const text = 'Some content\ncanonical-transcript:: hello world\nstroke-y-bounds:: 5-13\nMore content';
    const tokens = tokenize(text);
    // Property key tokens should NOT appear
    expect(tokens.has('canonical-transcript')).toBe(false);
    expect(tokens.has('stroke-y-bounds')).toBe(false);
    // But actual content tokens should be there
    expect(tokens.has('some')).toBe(true);
    expect(tokens.has('content')).toBe(true);
    expect(tokens.has('more')).toBe(true);
  });

  it('deduplicates repeated words', () => {
    const tokens = tokenize('apple apple apple');
    expect(tokens.size).toBe(1);
    expect(tokens.has('apple')).toBe(true);
  });

  it('handles text with only stopwords/short words', () => {
    const tokens = tokenize('I a');
    expect(tokens.size).toBe(0);
  });

  it('includes 2-character words', () => {
    const tokens = tokenize('to do it');
    expect(tokens.has('to')).toBe(true);
    expect(tokens.has('do')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// searchPages
// ---------------------------------------------------------------------------

describe('searchPages', () => {
  it('returns all pages when query is empty/null/whitespace', () => {
    const pages = [page('hello world'), page('foo bar')];
    expect(searchPages(pages, '')).toBe(pages);
    expect(searchPages(pages, null)).toBe(pages);
    expect(searchPages(pages, '  ')).toBe(pages);
  });

  it('excludes pages with no transcription text', () => {
    const pages = [
      { book: 1, page: 1, transcriptionText: null },
      { book: 1, page: 2, transcriptionText: '' },
      page('hello world', 1, 3)
    ];
    const result = searchPages(pages, 'hello');
    expect(result).toHaveLength(1);
    expect(result[0].page).toBe(3);
  });

  it('returns pages that contain a matching token', () => {
    const pages = [
      page('meeting notes summary'),
      page('action items done')
    ];
    const result = searchPages(pages, 'meeting');
    expect(result).toHaveLength(1);
    expect(result[0].transcriptionText).toBe('meeting notes summary');
  });

  it('uses partial matching — query token matches if page token CONTAINS it', () => {
    const pages = [page('preparing the presentation')];
    // "prepar" is a prefix of "preparing"
    const result = searchPages(pages, 'prepar');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no pages match', () => {
    const pages = [page('hello world'), page('foo bar')];
    expect(searchPages(pages, 'xyznotfound')).toHaveLength(0);
  });

  it('ranks pages by number of matching tokens', () => {
    const pages = [
      page('meeting agenda summary'),   // 1 match for "meeting"
      page('meeting action meeting'),    // 2 matches for "meeting" but deduped to 1 in token set
      page('project update notes')       // 0 matches
    ];
    // Search for two tokens
    const result = searchPages(pages, 'meeting action');
    // The page with BOTH "meeting" and "action" should rank first
    expect(result[0].transcriptionText).toBe('meeting action meeting');
  });

  it('is case-insensitive in matching', () => {
    const pages = [page('Hello World')];
    expect(searchPages(pages, 'HELLO')).toHaveLength(1);
    expect(searchPages(pages, 'hello')).toHaveLength(1);
  });

  it('includes matchScore property on results', () => {
    const pages = [page('hello world')];
    const result = searchPages(pages, 'hello');
    expect(result[0].matchScore).toBeGreaterThan(0);
  });

  it('handles query with only short/filtered tokens gracefully', () => {
    const pages = [page('hello world')];
    // Single-char query token — after tokenize it is filtered out
    const result = searchPages(pages, 'a');
    // tokenize('a') → empty set → no tokens → return all pages
    expect(result).toBe(pages);
  });
});

// ---------------------------------------------------------------------------
// highlightMatches
// ---------------------------------------------------------------------------

describe('highlightMatches', () => {
  it('returns escaped HTML when query is empty/null', () => {
    const result = highlightMatches('Hello <world>', null);
    expect(result).toBe('Hello &lt;world&gt;');
  });

  it('wraps matched tokens in <mark> tags', () => {
    const result = highlightMatches('hello world', 'hello');
    expect(result).toContain('<mark>hello</mark>');
  });

  it('is case-insensitive — matches regardless of text case', () => {
    const result = highlightMatches('Hello World', 'hello');
    expect(result.toLowerCase()).toContain('<mark>hello</mark>');
  });

  it('escapes HTML special characters before adding marks', () => {
    const result = highlightMatches('foo <bar> & baz', 'baz');
    expect(result).toContain('&lt;bar&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('<mark>baz</mark>');
  });

  it('handles partial matches — marks substrings within words', () => {
    // "meet" should match inside "meeting"
    const result = highlightMatches('the meeting is at 3pm', 'meet');
    expect(result).toContain('<mark>meet</mark>');
    expect(result).toContain('ing');
  });

  it('marks multiple occurrences of the same token', () => {
    const result = highlightMatches('apple apple pie', 'apple');
    const markCount = (result.match(/<mark>/g) || []).length;
    expect(markCount).toBe(2);
  });

  it('marks all query tokens independently', () => {
    const result = highlightMatches('hello world', 'hello world');
    expect(result).toContain('<mark>hello</mark>');
    expect(result).toContain('<mark>world</mark>');
  });

  it('returns plain escaped text when no tokens match', () => {
    const result = highlightMatches('hello world', 'xyznotfound');
    expect(result).not.toContain('<mark>');
    expect(result).toBe('hello world');
  });

  it('handles empty text input', () => {
    const result = highlightMatches('', 'hello');
    expect(result).toBe('');
  });
});
