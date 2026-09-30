import { describe, it, expect } from 'vitest';
import {
  PT_PER_NCODE,
  parseNproj,
  frameOfPageItem,
  summarizeNproj,
  buildManifest,
  normalizeManifest,
  pageNumberOfId,
  manifestCoversPage,
  backgroundFileName,
  pageFromZipEntryName,
  frameToBounds
} from '../neo-backgrounds.js';

/** An .nproj shaped like Neo's real COLLEGE_Mint (book 388), trimmed to `pages` items. */
function nproj({ pages = 3, startPage = 1, item } = {}) {
  const base = item || 'x1="0" y1="0" x2="659.291" y2="840.709" crop_margin="23.5039,23.504,23.504,23.504" rotate_angle="0"';
  const items = Array.from({ length: pages }, (_, i) =>
    `<page_item number="${i}" ${typeof base === 'function' ? base(i) : base} bg_disabled="false" page_type="0"/>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<nproj version="2.31" category="simple">
  <book>
    <title>COLLEGE_Mint</title>
    <section>3</section>
    <owner>27</owner>
    <code>388</code>
    <start_page side="">${startPage}</start_page>
    <segment_info sub_code="" total_size="${pages}" size="${pages}" current_sequence="0" ncode_start_page="${startPage}" ncode_end_page="${startPage + pages - 1}"/>
  </book>
  <pages count="${pages}">
${items}
  </pages>
</nproj>`;
}

describe('PT_PER_NCODE', () => {
  it('is the SDK\'s Ncode formula: (8 × 7 / 600 in) × 72 pt', () => {
    expect(PT_PER_NCODE).toBeCloseTo(6.72, 10);
  });
});

describe('parseNproj', () => {
  it('reads identity and numbers pages from ncode_start_page', () => {
    const p = parseNproj(nproj({ pages: 3, startPage: 1 }));
    expect(p.title).toBe('COLLEGE_Mint');
    expect([p.section, p.owner, p.book]).toEqual([3, 27, 388]);
    expect(p.pages.map((x) => x.number)).toEqual([1, 2, 3]);
  });

  it('honours a start page other than 1', () => {
    const p = parseNproj(nproj({ pages: 2, startPage: 10 }));
    expect(p.startPage).toBe(10);
    expect(p.pages.map((x) => x.number)).toEqual([10, 11]);
  });

  it('reads the rectangle, crop margins (l,t,r,b) and rotation', () => {
    const [item] = parseNproj(nproj({ pages: 1 })).pages;
    expect(item).toMatchObject({ x1: 0, y1: 0, x2: 659.291, y2: 840.709, rotate: 0 });
    expect(item.crop).toEqual({ l: 23.5039, t: 23.504, r: 23.504, b: 23.504 });
  });

  it('rejects something that is not an .nproj', () => {
    expect(() => parseNproj('<html></html>')).toThrow(/nproj/);
    expect(() => parseNproj(null)).toThrow(/nproj/);
  });
});

describe('frameOfPageItem', () => {
  it('insets the page rectangle by its crop margins and converts to Ncode units', () => {
    const [item] = parseNproj(nproj({ pages: 1 })).pages;
    const f = frameOfPageItem(item);
    // These are the values the overlay of real book 388 page 11 was registered with.
    expect(f.x0).toBeCloseTo(3.498, 2);
    expect(f.y0).toBeCloseTo(3.498, 2);
    expect(f.x1).toBeCloseTo(94.61, 2);
    expect(f.y1).toBeCloseTo(121.61, 2);
  });

  it('gives the 150-dpi px-per-unit the page images turn out to have', () => {
    const [item] = parseNproj(nproj({ pages: 1 })).pages;
    const f = frameOfPageItem(item);
    // The real JPG is 1275 px wide.
    expect(1275 / (f.x1 - f.x0)).toBeCloseTo(14, 0);
  });
});

describe('summarizeNproj', () => {
  it('reports a uniform book and its page range', () => {
    const s = summarizeNproj(parseNproj(nproj({ pages: 144, startPage: 1 })));
    expect(s.uniform).toBe(true);
    expect(s.rotated).toBe(false);
    expect([s.firstPage, s.lastPage, s.pageCount]).toEqual([1, 144, 144]);
    expect(s.frame.x1).toBeCloseTo(94.61, 2);
  });

  it('tolerates the tiny margin differences real books have (3017)', () => {
    const s = summarizeNproj(parseNproj(nproj({
      pages: 4,
      item: (i) => `x1="0" y1="0" x2="458.031" y2="630.945" crop_margin="23.5039,${i % 2 ? 23.503 : 23.504},23.504,23.5039" rotate_angle="0"`
    })));
    expect(s.uniform).toBe(true);
  });

  it('flags a book whose pages are not all the same size', () => {
    const s = summarizeNproj(parseNproj(nproj({
      pages: 3,
      item: (i) => `x1="0" y1="0" x2="${i === 2 ? 500 : 659.291}" y2="840.709" crop_margin="23.5,23.5,23.5,23.5" rotate_angle="0"`
    })));
    expect(s.uniform).toBe(false);
  });

  it('flags rotated pages', () => {
    const s = summarizeNproj(parseNproj(nproj({
      pages: 2,
      item: (i) => `x1="0" y1="0" x2="659.291" y2="840.709" crop_margin="23.5,23.5,23.5,23.5" rotate_angle="${i ? 90 : 0}"`
    })));
    expect(s.rotated).toBe(true);
  });

  it('handles a document with no pages', () => {
    const s = summarizeNproj(parseNproj(nproj({ pages: 0 })));
    expect(s.frame).toBeNull();
    expect(s.pageCount).toBe(0);
  });
});

describe('manifest round trip', () => {
  const parsed = parseNproj(nproj({ pages: 144 }));
  const manifest = buildManifest(parsed, summarizeNproj(parsed));

  it('builds a manifest that names the source book', () => {
    expect(manifest).toMatchObject({ version: 1, source: 'neo', sob: '3_27_388', title: 'COLLEGE_Mint', firstPage: 1, lastPage: 144, ext: 'jpg' });
  });

  it('survives JSON and normalizes back', () => {
    const back = normalizeManifest(JSON.parse(JSON.stringify(manifest)));
    expect(back).toEqual(manifest);
  });

  it.each([
    ['null', null],
    ['no frame', { firstPage: 1, lastPage: 2 }],
    ['non-finite frame', { frame: { x0: 0, y0: 0, x1: NaN, y1: 5 }, firstPage: 1, lastPage: 2 }],
    ['empty frame', { frame: { x0: 5, y0: 0, x1: 5, y1: 5 }, firstPage: 1, lastPage: 2 }],
    ['inverted frame', { frame: { x0: 9, y0: 0, x1: 5, y1: 5 }, firstPage: 1, lastPage: 2 }],
    ['bad page range', { frame: { x0: 0, y0: 0, x1: 5, y1: 5 }, firstPage: 4, lastPage: 2 }],
    ['fractional page', { frame: { x0: 0, y0: 0, x1: 5, y1: 5 }, firstPage: 1.5, lastPage: 2 }]
  ])('rejects %s as "no background" rather than throwing', (_label, raw) => {
    expect(normalizeManifest(raw)).toBeNull();
  });

  it('falls back to jpg for an unknown extension', () => {
    const odd = normalizeManifest({ ...manifest, ext: 'bmp' });
    expect(odd.ext).toBe('jpg');
  });
});

describe('page numbers', () => {
  it('reads plain and letter-suffixed page ids', () => {
    expect(pageNumberOfId('42')).toBe(42);
    expect(pageNumberOfId(42)).toBe(42);
    expect(pageNumberOfId('151b')).toBe(151);
  });

  it.each([[''], ['b'], ['12bb'], ['1.5'], [null], [undefined], ['../1']])('refuses %j', (id) => {
    expect(pageNumberOfId(id)).toBeNull();
  });

  it('covers exactly the manifest\'s range', () => {
    const m = { firstPage: 1, lastPage: 144 };
    expect(manifestCoversPage(m, 1)).toBe(true);
    expect(manifestCoversPage(m, 144)).toBe(true);
    expect(manifestCoversPage(m, 0)).toBe(false);
    expect(manifestCoversPage(m, 145)).toBe(false);
    expect(manifestCoversPage(m, null)).toBe(false);
    expect(manifestCoversPage(null, 5)).toBe(false);
  });

  it('names files and reads zip entries', () => {
    expect(backgroundFileName(11)).toBe('P11.jpg');
    expect(backgroundFileName(11, 'png')).toBe('P11.png');
    expect(pageFromZipEntryName('/3_27_388_11.jpg')).toBe(11);
    expect(pageFromZipEntryName('3_1012_3017_192.JPG')).toBe(192);
    expect(pageFromZipEntryName('readme.txt')).toBeNull();
  });
});

describe('frameToBounds', () => {
  it('has the shape computeStrokeBounds() returns', () => {
    expect(frameToBounds({ x0: 1, y0: 2, x1: 3, y1: 4 })).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
  });
});
