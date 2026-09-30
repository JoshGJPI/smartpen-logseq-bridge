/**
 * neo-backgrounds — pure helpers for Neo's printed-page backgrounds (v2.10 spike).
 *
 * Neo publishes, per notebook, an `.nproj` (XML: where every page's printable
 * rectangle sits) and a zip of one JPG per page. The app caches both under
 * `<dataRoot>/pages/_backgrounds/<ncodeBook>/` as a `manifest.json` plus
 * `P<n>.jpg` files, and the read-only views (Book View, Timeline) draw the JPG
 * behind the strokes. Nothing here touches the Editor canvas or any PageDoc.
 *
 * No DOM and no Node APIs, so it is shared by the importer script
 * (`scripts/fetch-neo-backgrounds.mjs`), the renderer stores and the tests.
 *
 * Geometry. Everything in the `.nproj` is in 72-dpi points. One Ncode unit is
 * 8×7/600 inch, which is exactly what `web_pen_sdk` divides by (NoteServer.ts
 * `point72ToNcode`), so a rectangle converts with one division. The JPG covers
 * the page rectangle MINUS `crop_margin`, so the frame the image is drawn into is
 * the rectangle inset by those margins — not the whole rectangle.
 */

/** 72-dpi points per Ncode unit: (8 × 7 / 600 in) × 72. */
export const PT_PER_NCODE = ((8 * 7) / 600) * 72;

/** Folder, under `<dataRoot>/pages/`, that holds every book's backgrounds. */
export const BACKGROUNDS_DIR = '_backgrounds';

/** The manifest format this build reads and writes. */
export const MANIFEST_VERSION = 1;

/** Frames that differ by less than this (Ncode units) are the same frame. */
const FRAME_TOLERANCE = 0.02;

const toNcode = (pt) => pt / PT_PER_NCODE;

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function tagText(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}

/**
 * Parse the parts of an `.nproj` this feature needs.
 *
 * Pages are numbered from `ncode_start_page` (falling back to `<start_page>`) in
 * document order — the same rule the SDK's `extractMarginInfo` uses — so item
 * index `i` is Ncode page `startPage + i`.
 *
 * @param {string} xml
 * @returns {{title:string, section:number, owner:number, book:number,
 *            startPage:number, pages:Array<Object>}}
 */
export function parseNproj(xml) {
  if (typeof xml !== 'string' || !xml.includes('<nproj')) {
    throw new Error('Not an .nproj document');
  }
  const seg = xml.match(/<segment_info\b[^>]*>/);
  const startPage = Number(
    (seg && attr(seg[0], 'ncode_start_page')) || tagText(xml, 'start_page') || 1
  );

  const pages = [];
  for (const m of xml.matchAll(/<page_item\b[^>]*>/g)) {
    const tag = m[0];
    const crop = (attr(tag, 'crop_margin') || '0,0,0,0').split(',').map(Number);
    pages.push({
      number: startPage + pages.length,
      x1: Number(attr(tag, 'x1')),
      y1: Number(attr(tag, 'y1')),
      x2: Number(attr(tag, 'x2')),
      y2: Number(attr(tag, 'y2')),
      crop: { l: crop[0], t: crop[1], r: crop[2], b: crop[3] },
      rotate: Number(attr(tag, 'rotate_angle') || 0)
    });
  }

  return {
    title: tagText(xml, 'title'),
    section: Number(tagText(xml, 'section')),
    owner: Number(tagText(xml, 'owner')),
    book: Number(tagText(xml, 'code')),
    startPage,
    pages
  };
}

/**
 * The rectangle, in Ncode units, that a page's JPG covers.
 * @param {{x1:number,y1:number,x2:number,y2:number,crop:{l:number,t:number,r:number,b:number}}} item
 * @returns {{x0:number,y0:number,x1:number,y1:number}}
 */
export function frameOfPageItem(item) {
  return {
    x0: toNcode(item.x1 + item.crop.l),
    y0: toNcode(item.y1 + item.crop.t),
    x1: toNcode(item.x2 - item.crop.r),
    y1: toNcode(item.y2 - item.crop.b)
  };
}

const sameFrame = (a, b) =>
  Math.abs(a.x0 - b.x0) < FRAME_TOLERANCE && Math.abs(a.y0 - b.y0) < FRAME_TOLERANCE &&
  Math.abs(a.x1 - b.x1) < FRAME_TOLERANCE && Math.abs(a.y1 - b.y1) < FRAME_TOLERANCE;

/**
 * Reduce a parsed `.nproj` to one frame per book.
 *
 * A spike simplification, deliberately checked rather than assumed: every
 * notebook inspected so far (387, 388, 390, 3017) has one rectangle for all its
 * pages. `uniform` is false the moment that stops being true, and the importer
 * refuses such a book instead of guessing which frame applies where.
 *
 * @param {ReturnType<typeof parseNproj>} parsed
 * @returns {{frame:Object|null, uniform:boolean, rotated:boolean, firstPage:number,
 *            lastPage:number, pageCount:number}}
 */
export function summarizeNproj(parsed) {
  const pages = parsed.pages || [];
  if (pages.length === 0) {
    return { frame: null, uniform: false, rotated: false, firstPage: parsed.startPage, lastPage: parsed.startPage - 1, pageCount: 0 };
  }
  const frames = pages.map(frameOfPageItem);
  return {
    frame: frames[0],
    uniform: frames.every((f) => sameFrame(f, frames[0])),
    rotated: pages.some((p) => p.rotate !== 0),
    firstPage: pages[0].number,
    lastPage: pages[pages.length - 1].number,
    pageCount: pages.length
  };
}

/**
 * The `manifest.json` written next to a book's images.
 * @param {ReturnType<typeof parseNproj>} parsed
 * @param {ReturnType<typeof summarizeNproj>} summary
 */
export function buildManifest(parsed, summary) {
  return {
    version: MANIFEST_VERSION,
    source: 'neo',
    sob: `${parsed.section}_${parsed.owner}_${parsed.book}`,
    title: parsed.title,
    frame: summary.frame,
    firstPage: summary.firstPage,
    lastPage: summary.lastPage,
    ext: 'jpg'
  };
}

/**
 * Validate a manifest read back from disk. Returns null for anything the views
 * could not safely draw — a bad manifest must mean "no background", never a
 * thrown error inside a render.
 *
 * @param {any} raw
 * @returns {{version:number, source:string, sob:string, title:string,
 *            frame:{x0:number,y0:number,x1:number,y1:number},
 *            firstPage:number, lastPage:number, ext:string}|null}
 */
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw.frame;
  if (!f || ![f.x0, f.y0, f.x1, f.y1].every(Number.isFinite)) return null;
  if (!(f.x1 > f.x0) || !(f.y1 > f.y0)) return null;
  const firstPage = Number(raw.firstPage);
  const lastPage = Number(raw.lastPage);
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || lastPage < firstPage) return null;
  return {
    version: Number(raw.version) || MANIFEST_VERSION,
    source: String(raw.source || 'neo'),
    sob: String(raw.sob || ''),
    title: String(raw.title || ''),
    frame: { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 },
    firstPage,
    lastPage,
    ext: raw.ext === 'png' ? 'png' : 'jpg'
  };
}

/**
 * The Ncode page number a pageId refers to. A letter-suffixed page (`151b`) is a
 * user-made variant of NCode page 151, so it shares that page's paper.
 * @returns {number|null}
 */
export function pageNumberOfId(pageId) {
  const m = String(pageId ?? '').match(/^(\d+)[a-zA-Z]?$/);
  return m ? Number(m[1]) : null;
}

/** True when the manifest has an image for this Ncode page. */
export function manifestCoversPage(manifest, pageNumber) {
  return !!manifest && Number.isInteger(pageNumber) &&
    pageNumber >= manifest.firstPage && pageNumber <= manifest.lastPage;
}

/** File name of a page's image inside its book folder. */
export function backgroundFileName(pageNumber, ext = 'jpg') {
  return `P${pageNumber}.${ext}`;
}

/** Ncode page number from a zip entry such as `/3_27_388_11.jpg`, else null. */
export function pageFromZipEntryName(name) {
  const m = String(name).match(/_(\d+)\.(jpg|jpeg|png)$/i);
  return m ? Number(m[1]) : null;
}

/**
 * The frame a view should lay a page out on when a background is present, as
 * `{minX,minY,maxX,maxY}` — the shape `computeStrokeBounds()` returns, so it can
 * stand in for stroke bounds wherever a view fits its page to the pane.
 */
export function frameToBounds(frame) {
  return { minX: frame.x0, minY: frame.y0, maxX: frame.x1, maxY: frame.y1 };
}
