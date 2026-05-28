/**
 * PageDoc serializer — hybrid pretty/compact format.
 *
 * Fully pretty-printing a PageDoc expands every point of every stroke onto its
 * own line:
 *   [
 *     6.56,
 *     37.25,
 *     1765313505107
 *   ]
 * For a 1,700-stroke page that's ~140k lines of indent whitespace — ~60% of
 * the file is structural noise.
 *
 * This serializer keeps the document shell (version, pageInfo, metadata,
 * transcript) pretty-printed for human inspection, but renders each entry in
 * `strokes[]` as a single line. The result is:
 *  - Compact (close to minified size)
 *  - Diff-friendly (one stroke per line → git can show per-stroke changes)
 *  - Still human-scannable (top-level structure is laid out as you'd expect)
 *
 * Tested format example:
 *   {
 *     "version": "2.0",
 *     "pageInfo": { ... pretty ... },
 *     "metadata": { ... pretty ... },
 *     "transcript": { "lines": [ ... pretty ... ] },
 *     "strokes": [
 *       {"id":"s1","startTime":1,"endTime":2,"lineId":null,"points":[[1,2,3],[4,5,6]]},
 *       {"id":"s2","startTime":3,"endTime":4,"lineId":"abc","points":[[7,8,9]]}
 *     ]
 *   }
 */

/**
 * Serialize a PageDoc with hybrid pretty/compact formatting.
 * @param {import('./page-doc.js').PageDoc} doc
 * @returns {string}
 */
export function serializePageDoc(doc) {
  // Pretty-print everything *except* the strokes array
  const { strokes, ...shell } = doc || {};
  const shellPretty = JSON.stringify(shell, null, 2);

  // Insert "strokes" key with compact one-stroke-per-line representation.
  // The shell ends with "}" — we strip it, add the strokes key, then re-close.
  // Handle the case where shell already had no other keys (edge case): we
  // always have `version` at minimum, so shell is a non-empty object.

  const closingBrace = shellPretty.lastIndexOf('}');
  const head = shellPretty.slice(0, closingBrace).trimEnd();
  // head currently ends with the last shell entry, no trailing comma. Add one.
  const headWithComma = head.endsWith(',') ? head : head + ',';

  const strokeLines = (strokes || []).map(s => '    ' + JSON.stringify(s));
  const strokesBlock = strokeLines.length === 0
    ? '  "strokes": []'
    : '  "strokes": [\n' + strokeLines.join(',\n') + '\n  ]';

  return headWithComma + '\n' + strokesBlock + '\n}\n';
}

/**
 * Parse — just JSON.parse. Exposed for symmetry / easy mock in tests.
 * @param {string} text
 * @returns {any}
 */
export function deserializePageDoc(text) {
  return JSON.parse(text);
}
