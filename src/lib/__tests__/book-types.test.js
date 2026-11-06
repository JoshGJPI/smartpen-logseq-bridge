/**
 * Tests for lib/book-types.js (notebook types, v3.15.0) and the main-process
 * sidecar electron/book-types-sidecar.cjs.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  normalizeBookType, normalizeBookTypes, bookTypeOf, isInheritedType, typeNames, canonicalType,
  parseTypeFilter, matchesTypeFilter, booksOutsideType, typeFilterLabel, NO_TYPE, MAX_TYPE_LENGTH
} from '../book-types.js';

const require = createRequire(import.meta.url);
const { parseBookTypesFile, applyBookType, serializeBookTypesFile, emptyBookTypesFile } =
  require('../../../electron/book-types-sidecar.cjs');

describe('normalizeBookType', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeBookType('  Site   visits \n')).toBe('Site visits');
  });
  it('empty, non-string and the reserved filter value are no type', () => {
    expect(normalizeBookType('')).toBeNull();
    expect(normalizeBookType('   ')).toBeNull();
    expect(normalizeBookType(null)).toBeNull();
    expect(normalizeBookType(5)).toBeNull();
    expect(normalizeBookType(NO_TYPE)).toBeNull();
  });
  it('caps the length', () => {
    expect(normalizeBookType('x'.repeat(100))).toHaveLength(MAX_TYPE_LENGTH);
  });
});

describe('normalizeBookTypes', () => {
  it('keeps canonical book keys with a type', () => {
    expect(normalizeBookTypes({ books: { '388': ' Work ', '388v2': 'Personal', '388v1': 'X', 'B12': 'X', '7': '' } }))
      .toEqual({ '388': 'Work', '388v2': 'Personal' });
  });
  it('anything else is empty', () => {
    expect(normalizeBookTypes(null)).toEqual({});
    expect(normalizeBookTypes({ books: [] })).toEqual({});
    expect(normalizeBookTypes('nope')).toEqual({});
  });
});

describe('bookTypeOf', () => {
  const types = { '388': 'Work', '12v2': 'Personal' };
  it('own type first', () => {
    expect(bookTypeOf('388', types)).toBe('Work');
    expect(bookTypeOf('12v2', types)).toBe('Personal');
  });
  it('a volume without one takes volume 1’s', () => {
    expect(bookTypeOf('388v3', types)).toBe('Work');
    expect(isInheritedType('388v3', types)).toBe(true);
    expect(isInheritedType('388', types)).toBe(false);
  });
  it('volume 1 never inherits from a later volume', () => {
    expect(bookTypeOf('12', types)).toBeNull();
    expect(isInheritedType('12', types)).toBe(false);
  });
  it('no types, no type', () => {
    expect(bookTypeOf('388', null)).toBeNull();
    expect(bookTypeOf('bogus', types)).toBeNull();
  });
});

describe('typeNames and canonicalType', () => {
  const types = { '1': 'Work', '2': 'work', '3': 'Personal', '4': 'Archive' };
  it('one spelling per type, sorted', () => {
    expect(typeNames(types)).toEqual(['Archive', 'Personal', 'Work']);
    expect(typeNames({})).toEqual([]);
  });
  it('a different case joins the existing type', () => {
    expect(canonicalType('PERSONAL', types)).toBe('Personal');
    expect(canonicalType(' New one ', types)).toBe('New one');
    expect(canonicalType('', types)).toBeNull();
  });
});

describe('type filter', () => {
  const types = { '1': 'Work', '2': 'Personal', '2v2': '' };
  const books = ['1', '1v2', '2', '3'];

  it('no filter matches everything', () => {
    expect(books.every((b) => matchesTypeFilter(b, null, types))).toBe(true);
    expect(booksOutsideType(books, null, types).size).toBe(0);
  });
  it('a type matches without case, volumes included', () => {
    expect(books.filter((b) => matchesTypeFilter(b, 'work', types))).toEqual(['1', '1v2']);
    expect([...booksOutsideType(books, 'Work', types)]).toEqual(['2', '3']);
  });
  it('No type matches untyped notebooks', () => {
    expect(books.filter((b) => matchesTypeFilter(b, NO_TYPE, types))).toEqual(['3']);
  });
  it('a type nobody has matches nothing', () => {
    expect(books.filter((b) => matchesTypeFilter(b, 'Gone', types))).toEqual([]);
  });
  it('parses and labels stored values', () => {
    expect(parseTypeFilter(null)).toBeNull();
    expect(parseTypeFilter('')).toBeNull();
    expect(parseTypeFilter(NO_TYPE)).toBe(NO_TYPE);
    expect(parseTypeFilter(' Work ')).toBe('Work');
    expect(typeFilterLabel(null)).toBe('All types');
    expect(typeFilterLabel(NO_TYPE)).toBe('No type');
    expect(typeFilterLabel('Work')).toBe('Work');
  });
});

describe('book-types sidecar (main)', () => {
  const guards = {
    requireBookKey(book) {
      const s = String(book);
      if (!/^\d+(?:v([2-9]|[1-9]\d+))?$/.test(s)) throw new Error(`Invalid book: ${book}`);
      return s;
    }
  };

  it('missing, corrupt, newer', () => {
    expect(parseBookTypesFile(null)).toEqual({ file: emptyBookTypesFile(), state: 'missing' });
    expect(parseBookTypesFile('{oops').state).toBe('corrupt');
    expect(parseBookTypesFile('[]').state).toBe('corrupt');
    expect(parseBookTypesFile('{"version":2,"books":{}}').state).toBe('newer');
  });

  it('sets and clears one book, keeping the rest and unknown fields', () => {
    const { file } = parseBookTypesFile('{"version":1,"books":{"7":"Work"},"note":"keep"}');
    const set = applyBookType(file, '388v2', 'Personal', guards);
    expect(set.books).toEqual({ '7': 'Work', '388v2': 'Personal' });
    expect(set.note).toBe('keep');
    expect(file.books).toEqual({ '7': 'Work' }); // not mutated
    expect(applyBookType(set, '7', null, guards).books).toEqual({ '388v2': 'Personal' });
    expect(applyBookType(set, '7', '', guards).books).toEqual({ '388v2': 'Personal' });
    expect(JSON.parse(serializeBookTypesFile(set))).toEqual(set);
  });

  it('rejects bad keys and types', () => {
    const f = emptyBookTypesFile();
    expect(() => applyBookType(f, '../x', 'Work', guards)).toThrow();
    expect(() => applyBookType(f, '388v1', 'Work', guards)).toThrow();
    expect(() => applyBookType(f, '7', 'x'.repeat(41), guards)).toThrow();
    expect(() => applyBookType(f, '7', 'two\nlines', guards)).toThrow();
    expect(() => applyBookType(f, '7', ' padded', guards)).toThrow();
    expect(() => applyBookType(f, '7', 5, guards)).toThrow();
  });
});
