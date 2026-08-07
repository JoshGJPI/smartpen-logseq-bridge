/**
 * Volumes — telling apart physical notebooks that share an NCode book id.
 *
 * NCode identifies a *paper design*, not a physical object: two identical Lamy
 * notebooks emit the same `book` id and the same page numbers, so page 12 of the
 * second merges into page 12 of the first. A **volume** names the physical book.
 *
 * The whole feature is one idea: `pageInfo.book` carries a **book key** rather
 * than a bare number.
 *
 *     "388"      → book 388, volume 1   (the canonical spelling — no suffix)
 *     "388v2"    → book 388, volume 2
 *     "388v17"   → book 388, volume 17
 *
 * Volume 1 spells identically to the old bare id, so every existing page key,
 * every file on disk, and every localStorage page position is unchanged. That is
 * the entire migration story.
 *
 * ## Book keys are strings, always
 *
 * Including volume 1. A mixed number/string type was considered and rejected: it
 * doesn't remove the sites that coerce `book` numerically, it only delays finding
 * them until you actually use volume 2 — i.e. on the one notebook with the least
 * redundancy. All-strings makes those sites fail immediately, across data you can
 * verify at a glance. `pageId` is already a string throughout the app, so this is
 * an established pattern here rather than a new one.
 *
 * ## Exactly one spelling per identity
 *
 * `parseBookKey` rejects anything that isn't the canonical form — `"388v1"`,
 * `"388v0"`, `"0388"`, `"388v02"`. Two spellings of one volume would mean two
 * directories (`pages/B388/` and `pages/B388v1/`) holding the same page, which is
 * the exact failure this module exists to prevent. The check is a round-trip
 * against `makeBookKey`, so it can't drift from the writer.
 *
 * ## On disk vs. in memory
 *
 * The PageDoc keeps `pageInfo.book` a **number** and adds an optional `volume`,
 * omitted when 1 (the same convention `sketch: true` uses). So `validatePageDoc`
 * is unchanged, every existing file stays valid, and PAGE_DOC_VERSION stays
 * "2.0". `bookKeyFromPageInfo` / `pageInfoForDisk` convert at the boundary.
 *
 * Identity comes from the **directory name**, not from `pageInfo` — the same rule
 * `graph-index.js` already documents for letter-suffixed pages.
 *
 * See docs/VOLUMES-SPEC.md.
 */

/**
 * Canonical book key: digits, optionally `v` + a volume of 2 or more.
 *
 * Deliberately permissive here (it accepts `388v1` and `0388`); canonical-form
 * enforcement lives in `parseBookKey` as a round-trip check so there is one
 * source of truth for what a key looks like.
 */
export const BOOK_KEY_RE = /^(\d+)(?:v(\d+))?$/;

/** Book directory name: `B388`, `B388v2`. */
export const BOOK_DIR_RE = /^B(\d+(?:v\d+)?)$/;

/**
 * Fragment matching a book key inside a composite page key. Use this instead of
 * writing `\d+` by hand — several sites used to hardcode `B(\d+)` and silently
 * dropped (or worse, partially matched) volume keys.
 */
export const BOOK_KEY_FRAGMENT = '\\d+(?:v\\d+)?';

/**
 * Build the canonical book key for an NCode book + volume.
 * @param {number|string} ncodeBook
 * @param {number} [volume=1]
 * @returns {string|null} canonical key, or null if the inputs make no sense
 */
export function makeBookKey(ncodeBook, volume = 1) {
  // Explicit, because Number(null) and Number('') are both 0 — which would make
  // a missing book silently become book 0.
  if (ncodeBook == null || ncodeBook === '') return null;
  const n = Number(ncodeBook);
  if (!Number.isInteger(n) || n < 0) return null;
  const v = volume == null ? 1 : Number(volume);
  if (!Number.isInteger(v) || v < 1) return null;
  return v === 1 ? String(n) : `${n}v${v}`;
}

/**
 * Split a book key into its NCode book and volume.
 *
 * Rejects non-canonical spellings (see the module note) so there is exactly one
 * string per physical notebook.
 *
 * @param {string|number} bookKey
 * @returns {{ncodeBook: number, volume: number}|null}
 */
export function parseBookKey(bookKey) {
  if (bookKey == null) return null;
  const raw = String(bookKey);
  const m = raw.match(BOOK_KEY_RE);
  if (!m) return null;

  const ncodeBook = Number(m[1]);
  const volume = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isInteger(ncodeBook) || !Number.isInteger(volume) || volume < 1) return null;

  // Canonical-form check: catches "388v1", "388v0", "0388", "388v02" in one go.
  if (makeBookKey(ncodeBook, volume) !== raw) return null;

  return { ncodeBook, volume };
}

/** True if `bookKey` is a well-formed canonical book key. */
export function isBookKey(bookKey) {
  return parseBookKey(bookKey) !== null;
}

/**
 * Normalise anything book-shaped into a canonical key string.
 * Accepts the bare numbers that pre-volume data and older call sites still pass.
 * @returns {string|null}
 */
export function toBookKey(value) {
  if (value == null) return null;
  const parsed = parseBookKey(value);
  if (parsed) return String(value);
  // A bare number that isn't canonical as a string (e.g. the number 388 arriving
  // as 388.0, or a numeric string with a stray space) still has an obvious key.
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return String(n);
  return null;
}

/** The NCode book id behind a key. `"388v2"` → `388`. */
export function ncodeBookOf(bookKey) {
  const parsed = parseBookKey(bookKey);
  return parsed ? parsed.ncodeBook : null;
}

/** The volume behind a key. `"388v2"` → `2`, `"388"` → `1`. */
export function volumeOf(bookKey) {
  const parsed = parseBookKey(bookKey);
  return parsed ? parsed.volume : null;
}

/**
 * Same key with a different volume. The reassignment primitive.
 * @param {string|number} bookKey
 * @param {number} volume
 * @returns {string|null}
 */
export function withVolume(bookKey, volume) {
  const parsed = parseBookKey(bookKey);
  if (!parsed) return null;
  return makeBookKey(parsed.ncodeBook, volume);
}

/** True if two keys name volumes of the same physical NCode book. */
export function isSameNcodeBook(a, b) {
  const pa = parseBookKey(a);
  const pb = parseBookKey(b);
  return !!pa && !!pb && pa.ncodeBook === pb.ncodeBook;
}

/**
 * Sort comparator for book keys: NCode book first, then volume.
 *
 * Required wherever books are ordered. A naive string sort puts "388v2" after
 * "3880", and the old numeric `a.book - b.book` yields NaN for any volume key.
 * Unparseable keys sort last, in string order, so a bad value is visible at the
 * end of a list rather than scrambling the rest.
 */
export function compareBookKeys(a, b) {
  const pa = parseBookKey(a);
  const pb = parseBookKey(b);
  if (!pa && !pb) return String(a).localeCompare(String(b));
  if (!pa) return 1;
  if (!pb) return -1;
  return (pa.ncodeBook - pb.ncodeBook) || (pa.volume - pb.volume);
}

/* ============================================================
 *  Filesystem naming
 * ============================================================ */

/** `"388v2"` → `"B388v2"`. */
export function bookDirName(bookKey) {
  const key = toBookKey(bookKey);
  return key === null ? null : `B${key}`;
}

/** `"B388v2"` → `"388v2"`. Returns null for anything else. */
export function parseBookDirName(dirName) {
  if (!dirName) return null;
  const m = String(dirName).match(BOOK_DIR_RE);
  if (!m) return null;
  return parseBookKey(m[1]) ? m[1] : null;
}

/* ============================================================
 *  PageDoc boundary
 * ============================================================ */

/**
 * Compose the in-memory book key from a PageDoc's `pageInfo`.
 *
 * Note this is a *fallback* only — page identity properly comes from the
 * directory name. Use it when reading a doc whose path you no longer have.
 */
export function bookKeyFromPageInfo(pageInfo) {
  if (!pageInfo) return null;
  return makeBookKey(pageInfo.book, pageInfo.volume || 1);
}

/**
 * In-memory pageInfo for a book key — what strokes carry on the canvas.
 * `ncodeBook`/`volume` ride along so nothing downstream has to re-parse.
 */
export function pageInfoWithBookKey(pageInfo, bookKey) {
  const parsed = parseBookKey(bookKey);
  if (!parsed) return pageInfo;
  return {
    ...pageInfo,
    book: bookKey,
    ncodeBook: parsed.ncodeBook,
    volume: parsed.volume
  };
}

/**
 * The on-disk `pageInfo` shape: `book` numeric, `volume` present only when > 1.
 *
 * Omitting volume 1 is what keeps existing files byte-identical and keeps
 * `validatePageDoc`'s `typeof book === 'number'` check satisfied.
 *
 * @param {{section?: number, owner?: number, page: number}} base
 * @param {string|number} bookKey
 * @param {number|string} page
 */
export function pageInfoForDisk(base, bookKey, page) {
  const parsed = parseBookKey(bookKey) || { ncodeBook: Number(bookKey) || 0, volume: 1 };
  const out = {
    section: base?.section || 0,
    owner: base?.owner || 0,
    book: parsed.ncodeBook,
    page: typeof page === 'number' ? page : parseInt(page, 10) || 0
  };
  if (parsed.volume > 1) out.volume = parsed.volume;
  return out;
}

/* ============================================================
 *  Display
 * ============================================================ */

/**
 * Human suffix for a book key. `"388v2"` → `" · Vol 2"`, `"388"` → `""`.
 * Volume 1 renders as nothing so single-volume books read exactly as before.
 */
export function volumeSuffix(bookKey) {
  const v = volumeOf(bookKey);
  return v && v > 1 ? ` · Vol ${v}` : '';
}

/** Short form for tight spots (canvas page labels): `"388v2"` → `"v2"`. */
export function volumeBadge(bookKey) {
  const v = volumeOf(bookKey);
  return v && v > 1 ? `v${v}` : '';
}
