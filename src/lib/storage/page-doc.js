/**
 * PageDoc schema — v2.0 local storage format
 *
 * One JSON file per pen page, stored at:
 *   <dataRoot>/pages/B{book}/P{page}.json
 *
 * Replaces the v1 LogSeq-backed format (chunked JSON blocks inside markdown).
 * See docs/LOCAL-STORAGE-PIVOT-SPEC.md for the full design.
 */

/**
 * Deliberately still "2.0" after the pressure/sketch additions.
 *
 * Both additions are backward- and forward-compatible: a longer point tuple is
 * ignored by readers that destructure `[x, y, ts]`, and an absent `sketch` key
 * reads as false. `validatePageDoc()` rejects any version it does not recognise,
 * so bumping this would invalidate every file already on disk for no benefit.
 */
export const PAGE_DOC_VERSION = '2.0';

/**
 * @typedef {Object} PageInfo
 * @property {number} section
 * @property {number} owner
 * @property {number} book
 * @property {number} page
 */

/**
 * @typedef {Object} Bounds
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * @typedef {Object} YBounds
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * @typedef {Object} TranscriptLine
 * @property {string} id              - Stable line ID (carries forward from v1 blockUuid)
 * @property {string} text
 * @property {number} indentLevel
 * @property {string|null} parentId
 * @property {boolean|null} checked   - null = no checkbox, true = DONE, false = TODO
 * @property {YBounds|null} yBounds
 */

/**
 * @typedef {Object} Transcript
 * @property {string|null} lastTranscribed   - ISO 8601
 * @property {TranscriptLine[]} lines
 */

/**
 * @typedef {Object} StoredStroke
 * @property {string} id                          - "s{startTime}"
 * @property {number} startTime
 * @property {number} [endTime]
 * @property {string|null} lineId                 - Transcript line this stroke belongs to
 * @property {boolean} [sketch]                   - Marked as a sketch stroke: renders with
 *                                                  pressure-varying thickness rather than a
 *                                                  uniform line. Omitted entirely when false,
 *                                                  so handwriting pages are unchanged on disk.
 * @property {Array<[number, number, (number|null)?, number?]>} points
 *   - [x, y, timestamp?, force?]
 *
 *   The 4th element is the raw pen force at that point, which drives sketch
 *   rendering. It is written for every stroke, not just sketch-flagged ones:
 *   flagging a stroke as a sketch happens long after capture, and if pressure
 *   were conditional on the flag then marking a stroke later would silently
 *   produce a flat line with no way to recover the data.
 *
 *   Tuples are variable length for backward compatibility. Pages written before
 *   pressure was persisted have 2- or 3-element tuples and read back with no
 *   force; they render at a constant width (see `sketch-width.js` flatWidth).
 *   When force is present but timestamp was not recorded, position 2 is `null`
 *   so force keeps its fixed index.
 */

/**
 * @typedef {Object} PageMetadata
 * @property {string} lastUpdated     - ISO 8601
 * @property {number} totalStrokes
 * @property {Bounds} bounds
 */

/**
 * @typedef {Object} PageDoc
 * @property {"2.0"} version
 * @property {PageInfo} pageInfo
 * @property {PageMetadata} metadata
 * @property {Transcript} transcript
 * @property {StoredStroke[]} strokes
 */

/**
 * @typedef {Object} PageMeta - Lightweight summary for the Data Explorer list.
 *   Deliberately excludes the strokes array (the bulk of a PageDoc) so the
 *   renderer never holds the full corpus resident; strokes load lazily per page.
 * @property {number} book
 * @property {number} page             - Integer NCode page number
 * @property {string} pageId           - Unique-within-book id incl. any letter suffix (e.g. "151b")
 * @property {string} suffix           - Letter suffix, or "" for plain integer pages
 * @property {number} strokeCount
 * @property {string|null} lastUpdated
 * @property {boolean} hasTranscription
 * @property {number} transcriptLineCount
 * @property {string|null} transcriptionText - 2-space-indented transcript text (small; powers search/preview)
 * @property {string} path             - Absolute path to the .json file
 */

/**
 * @typedef {Object} SaveResult
 * @property {boolean} success
 * @property {number} [strokeCount]
 * @property {number} [lineCount]
 * @property {string} [error]
 * @property {string} [path]
 */

/**
 * Build an empty PageDoc for a brand-new page.
 * @param {PageInfo} pageInfo
 * @returns {PageDoc}
 */
export function emptyPageDoc(pageInfo) {
  return {
    version: PAGE_DOC_VERSION,
    pageInfo: { ...pageInfo },
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalStrokes: 0,
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    },
    transcript: {
      lastTranscribed: null,
      lines: []
    },
    strokes: []
  };
}

/**
 * Compute bounds for a stroke array (storage format with `points`).
 * @param {StoredStroke[]} strokes
 * @returns {Bounds}
 */
export function computeBounds(strokes) {
  if (!strokes || strokes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of strokes) {
    if (!s.points) continue;
    for (const p of s.points) {
      const x = p[0], y = p[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: round2(minX),
    maxX: round2(maxX),
    minY: round2(minY),
    maxY: round2(maxY)
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Validate a PageDoc shape. Returns an array of issue strings (empty if valid).
 * @param {any} doc
 * @returns {string[]}
 */
export function validatePageDoc(doc) {
  const issues = [];
  if (!doc || typeof doc !== 'object') {
    return ['not an object'];
  }
  if (doc.version !== PAGE_DOC_VERSION) {
    issues.push(`unknown version: ${doc.version}`);
  }
  if (!doc.pageInfo || typeof doc.pageInfo.book !== 'number' || typeof doc.pageInfo.page !== 'number') {
    issues.push('missing or invalid pageInfo');
  }
  if (!Array.isArray(doc.strokes)) {
    issues.push('strokes must be an array');
  }
  if (!doc.transcript || !Array.isArray(doc.transcript.lines)) {
    issues.push('transcript.lines must be an array');
  }
  return issues;
}
