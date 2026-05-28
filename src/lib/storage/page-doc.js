/**
 * PageDoc schema — v2.0 local storage format
 *
 * One JSON file per pen page, stored at:
 *   <dataRoot>/pages/B{book}/P{page}.json
 *
 * Replaces the v1 LogSeq-backed format (chunked JSON blocks inside markdown).
 * See docs/LOCAL-STORAGE-PIVOT-SPEC.md for the full design.
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
 * @property {Array<[number, number, number?]>} points  - [x, y, timestamp?]
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
 * @typedef {Object} PageMeta - Lightweight summary for the Data Explorer list
 * @property {number} book
 * @property {number} page
 * @property {number} strokeCount
 * @property {string} lastUpdated
 * @property {boolean} hasTranscription
 * @property {number} transcriptLineCount
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
