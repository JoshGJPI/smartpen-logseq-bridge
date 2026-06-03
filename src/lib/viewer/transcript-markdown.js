/**
 * transcript-markdown — convert PageDoc transcript lines into LogSeq-pasteable
 * outliner markdown.
 *
 * Output rules (confirmed with the user):
 *  - One `- ` bullet per line, indented with TABS by `indentLevel` so LogSeq
 *    reconstructs the outline hierarchy on paste.
 *  - Task state maps to LogSeq's native markers:
 *      checked === false → `- TODO text`
 *      checked === true  → `- DONE text`
 *      otherwise         → `- text`
 *  - LogSeq property lines (`key:: value`) are stripped — only transcript text
 *    is copied.
 *  - Blank lines are dropped.
 *
 * A line object is { text, indentLevel, checked, ... } (see page-doc.js
 * TranscriptLine). Extra fields are ignored.
 */

/** Matches a LogSeq property line, e.g. `id:: abc`, `collapsed:: true`. */
const PROPERTY_RE = /^\s*[A-Za-z0-9_-]+::/;

/**
 * @param {string} text
 * @returns {boolean} true if the line is a LogSeq property and should be stripped
 */
export function isPropertyLine(text) {
  return typeof text === 'string' && PROPERTY_RE.test(text);
}

/**
 * Format a single line as a LogSeq bullet (no trailing newline).
 * @param {{text?:string, indentLevel?:number, checked?:boolean|null}} line
 * @returns {string}
 */
export function lineToMarkdown(line) {
  const indent = '\t'.repeat(Math.max(0, line.indentLevel || 0));
  let marker = '';
  if (line.checked === false) marker = 'TODO ';
  else if (line.checked === true) marker = 'DONE ';
  return `${indent}- ${marker}${line.text ?? ''}`;
}

/**
 * Convert transcript lines into a LogSeq-pasteable markdown block.
 * @param {Array<{text?:string, indentLevel?:number, checked?:boolean|null}>} lines
 * @returns {string}
 */
export function linesToLogseqMarkdown(lines) {
  if (!Array.isArray(lines)) return '';
  return lines
    .filter(
      (l) =>
        l &&
        typeof l.text === 'string' &&
        l.text.trim() !== '' &&
        !isPropertyLine(l.text)
    )
    .map(lineToMarkdown)
    .join('\n');
}
