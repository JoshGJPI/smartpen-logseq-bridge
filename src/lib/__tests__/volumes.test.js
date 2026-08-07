import { describe, it, expect } from 'vitest';
import {
  makeBookKey,
  parseBookKey,
  isBookKey,
  toBookKey,
  ncodeBookOf,
  volumeOf,
  withVolume,
  isSameNcodeBook,
  compareBookKeys,
  bookDirName,
  parseBookDirName,
  bookKeyFromPageInfo,
  pageInfoWithBookKey,
  pageInfoForDisk,
  volumeSuffix,
  volumeBadge,
  BOOK_KEY_FRAGMENT
} from '../volumes.js';

describe('makeBookKey', () => {
  it('omits the suffix for volume 1 so it spells like the old bare id', () => {
    expect(makeBookKey(388)).toBe('388');
    expect(makeBookKey(388, 1)).toBe('388');
    expect(makeBookKey('388', 1)).toBe('388');
  });

  it('appends v{n} from volume 2 up', () => {
    expect(makeBookKey(388, 2)).toBe('388v2');
    expect(makeBookKey(388, 17)).toBe('388v17');
  });

  it('rejects nonsense', () => {
    expect(makeBookKey(388, 0)).toBeNull();
    expect(makeBookKey(388, -1)).toBeNull();
    expect(makeBookKey(388, 1.5)).toBeNull();
    expect(makeBookKey(-1, 2)).toBeNull();
    expect(makeBookKey(388.2, 2)).toBeNull();
    expect(makeBookKey('abc', 2)).toBeNull();
    expect(makeBookKey(null)).toBeNull();
  });
});

describe('parseBookKey', () => {
  it('reads both forms', () => {
    expect(parseBookKey('388')).toEqual({ ncodeBook: 388, volume: 1 });
    expect(parseBookKey('388v2')).toEqual({ ncodeBook: 388, volume: 2 });
    expect(parseBookKey('388v17')).toEqual({ ncodeBook: 388, volume: 17 });
  });

  it('accepts a bare number (pre-volume call sites)', () => {
    expect(parseBookKey(388)).toEqual({ ncodeBook: 388, volume: 1 });
  });

  // Two spellings of one volume would mean two directories holding the same
  // page — the exact collision this module exists to prevent.
  it('rejects non-canonical spellings', () => {
    expect(parseBookKey('388v1')).toBeNull();   // volume 1 must be bare
    expect(parseBookKey('388v0')).toBeNull();
    expect(parseBookKey('388v02')).toBeNull();  // leading zero in volume
    expect(parseBookKey('0388')).toBeNull();    // leading zero in book
  });

  it('rejects malformed input', () => {
    expect(parseBookKey('388v')).toBeNull();
    expect(parseBookKey('v2')).toBeNull();
    expect(parseBookKey('388v2v3')).toBeNull();
    expect(parseBookKey('388.2')).toBeNull();
    expect(parseBookKey('388-2')).toBeNull();
    expect(parseBookKey('B388')).toBeNull();
    expect(parseBookKey('')).toBeNull();
    expect(parseBookKey(null)).toBeNull();
    expect(parseBookKey(undefined)).toBeNull();
  });

  it('round-trips with makeBookKey', () => {
    for (const [book, vol] of [[388, 1], [388, 2], [3017, 9], [0, 3], [151, 100]]) {
      const key = makeBookKey(book, vol);
      expect(parseBookKey(key)).toEqual({ ncodeBook: book, volume: vol });
    }
  });
});

describe('isBookKey / toBookKey', () => {
  it('isBookKey mirrors parseBookKey', () => {
    expect(isBookKey('388v2')).toBe(true);
    expect(isBookKey('388v1')).toBe(false);
  });

  it('toBookKey normalises bare numbers', () => {
    expect(toBookKey(388)).toBe('388');
    expect(toBookKey('388')).toBe('388');
    expect(toBookKey('388v2')).toBe('388v2');
    expect(toBookKey(null)).toBeNull();
    expect(toBookKey('nope')).toBeNull();
  });
});

describe('accessors', () => {
  it('ncodeBookOf / volumeOf', () => {
    expect(ncodeBookOf('388')).toBe(388);
    expect(volumeOf('388')).toBe(1);
    expect(ncodeBookOf('388v2')).toBe(388);
    expect(volumeOf('388v2')).toBe(2);
    expect(volumeOf('bogus')).toBeNull();
  });

  it('withVolume is the reassignment primitive', () => {
    expect(withVolume('388', 2)).toBe('388v2');
    expect(withVolume('388v2', 1)).toBe('388');
    expect(withVolume('388v2', 3)).toBe('388v3');
    expect(withVolume('bogus', 2)).toBeNull();
    expect(withVolume('388', 0)).toBeNull();
  });

  it('isSameNcodeBook ignores the volume', () => {
    expect(isSameNcodeBook('388', '388v2')).toBe(true);
    expect(isSameNcodeBook('388v2', '388v3')).toBe(true);
    expect(isSameNcodeBook('388', '389')).toBe(false);
    expect(isSameNcodeBook('388', 'bogus')).toBe(false);
  });
});

describe('compareBookKeys', () => {
  // The case a naive string sort gets wrong: "388v2" sorts after "3880".
  it('orders by NCode book, then volume', () => {
    const sorted = ['3880', '388v2', '389', '388'].sort(compareBookKeys);
    expect(sorted).toEqual(['388', '388v2', '389', '3880']);
  });

  it('keeps volumes of one book adjacent', () => {
    const sorted = ['388v3', '389', '388', '388v2'].sort(compareBookKeys);
    expect(sorted).toEqual(['388', '388v2', '388v3', '389']);
  });

  it('sorts unparseable keys last rather than scrambling the rest', () => {
    const sorted = ['389', 'bogus', '388'].sort(compareBookKeys);
    expect(sorted).toEqual(['388', '389', 'bogus']);
  });

  it('handles bare numbers', () => {
    expect(compareBookKeys(388, 389)).toBeLessThan(0);
    expect(compareBookKeys(388, '388v2')).toBeLessThan(0);
  });
});

describe('directory naming', () => {
  it('bookDirName', () => {
    expect(bookDirName('388')).toBe('B388');
    expect(bookDirName(388)).toBe('B388');
    expect(bookDirName('388v2')).toBe('B388v2');
    expect(bookDirName('bogus')).toBeNull();
  });

  it('parseBookDirName', () => {
    expect(parseBookDirName('B388')).toBe('388');
    expect(parseBookDirName('B388v2')).toBe('388v2');
  });

  it('parseBookDirName rejects non-book directories and bad spellings', () => {
    expect(parseBookDirName('B388v1')).toBeNull();   // non-canonical
    expect(parseBookDirName('_aliases.json')).toBeNull();
    expect(parseBookDirName('P12')).toBeNull();
    expect(parseBookDirName('B')).toBeNull();
    expect(parseBookDirName('')).toBeNull();
    expect(parseBookDirName(null)).toBeNull();
  });

  it('round-trips', () => {
    for (const key of ['388', '388v2', '3017v11']) {
      expect(parseBookDirName(bookDirName(key))).toBe(key);
    }
  });
});

describe('PageDoc boundary', () => {
  it('bookKeyFromPageInfo treats a missing volume as 1', () => {
    expect(bookKeyFromPageInfo({ book: 388, page: 12 })).toBe('388');
    expect(bookKeyFromPageInfo({ book: 388, volume: 1, page: 12 })).toBe('388');
    expect(bookKeyFromPageInfo({ book: 388, volume: 2, page: 12 })).toBe('388v2');
    expect(bookKeyFromPageInfo(null)).toBeNull();
  });

  it('pageInfoWithBookKey carries ncodeBook/volume alongside', () => {
    const out = pageInfoWithBookKey({ section: 3, owner: 1012, book: 388, page: 12 }, '388v2');
    expect(out).toEqual({
      section: 3, owner: 1012, book: '388v2', ncodeBook: 388, volume: 2, page: 12
    });
  });

  it('pageInfoWithBookKey leaves pageInfo alone for a bad key', () => {
    const input = { book: 388, page: 12 };
    expect(pageInfoWithBookKey(input, 'bogus')).toBe(input);
  });

  // Omitting volume 1 is what keeps existing files byte-identical and keeps
  // validatePageDoc's `typeof book === 'number'` check satisfied.
  it('pageInfoForDisk omits volume 1 entirely', () => {
    const out = pageInfoForDisk({ section: 3, owner: 1012 }, '388', 12);
    expect(out).toEqual({ section: 3, owner: 1012, book: 388, page: 12 });
    expect('volume' in out).toBe(false);
  });

  it('pageInfoForDisk writes volume from 2 up, with a numeric book', () => {
    const out = pageInfoForDisk({ section: 3, owner: 1012 }, '388v2', 12);
    expect(out).toEqual({ section: 3, owner: 1012, book: 388, volume: 2, page: 12 });
    expect(typeof out.book).toBe('number');
  });

  it('pageInfoForDisk defaults section/owner and coerces a suffixed page', () => {
    const out = pageInfoForDisk(null, '388v2', '151b');
    expect(out).toEqual({ section: 0, owner: 0, book: 388, volume: 2, page: 151 });
  });

  it('disk → memory → disk round-trips', () => {
    const disk = { section: 3, owner: 1012, book: 388, volume: 2, page: 12 };
    const key = bookKeyFromPageInfo(disk);
    const mem = pageInfoWithBookKey(disk, key);
    expect(pageInfoForDisk(mem, mem.book, mem.page)).toEqual(disk);
  });
});

describe('display helpers', () => {
  it('volume 1 renders as nothing so single-volume books read as before', () => {
    expect(volumeSuffix('388')).toBe('');
    expect(volumeBadge('388')).toBe('');
  });

  it('volume 2+ renders', () => {
    expect(volumeSuffix('388v2')).toBe(' · Vol 2');
    expect(volumeBadge('388v2')).toBe('v2');
  });

  it('bad keys render as nothing rather than throwing', () => {
    expect(volumeSuffix('bogus')).toBe('');
    expect(volumeBadge(null)).toBe('');
  });
});

describe('BOOK_KEY_FRAGMENT', () => {
  // Several sites used to hardcode B(\d+), which either missed a volume key or
  // — unanchored — partially matched "B388" inside "B388v2" and returned 388.
  it('matches both forms inside a composite page key', () => {
    const re = new RegExp(`^B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)$`);
    expect('B388/P12'.match(re)[1]).toBe('388');
    expect('B388v2/P12'.match(re)[1]).toBe('388v2');
  });

  it('does not partially match a volume key', () => {
    const re = new RegExp(`B(${BOOK_KEY_FRAGMENT})`);
    expect('B388v2/P12'.match(re)[1]).toBe('388v2');
  });
});
