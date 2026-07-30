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

/**
 * Indent an already-built markdown block by whole levels (tabs), so it can be
 * nested under a parent bullet.
 * @param {string} md
 * @param {number} levels
 * @returns {string}
 */
export function indentMarkdownBlock(md, levels = 1) {
  if (!md) return '';
  const pad = '\t'.repeat(Math.max(0, levels));
  return md
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

/**
 * Last-resort conversion of a flat transcript STRING into line objects, for
 * sources that only kept the rendered text (e.g. a `savedPages` record whose
 * PageDoc couldn't be read). Leading tabs — or pairs of spaces — become
 * indent levels; blank lines are dropped by linesToLogseqMarkdown.
 * @param {string} text
 * @returns {Array<{text:string, indentLevel:number, checked:null}>}
 */
export function textToTranscriptLines(text) {
  if (typeof text !== 'string' || text === '') return [];
  return text
    .split('\n')
    .map((raw) => {
      const leading = /^[\t ]*/.exec(raw)[0];
      const tabs = (leading.match(/\t/g) || []).length;
      const indentLevel = tabs > 0 ? tabs : Math.floor(leading.length / 2);
      return { text: raw.trim(), indentLevel, checked: null };
    })
    .filter((l) => l.text !== '');
}

/**
 * Build one clipboard payload from several pages' transcripts.
 *
 * A single page copies exactly like Book View's copy (bare bullets, no header),
 * so the common case pastes clean. With more than one page each block is nested
 * under a top-level `- {label}` bullet so the pages stay distinguishable in
 * LogSeq. Pages with no copyable text are skipped.
 *
 * @param {Array<{label?:string, lines?:Array}>} pages
 * @returns {string}
 */
export function pagesToLogseqMarkdown(pages) {
  const blocks = (Array.isArray(pages) ? pages : [])
    .map((p) => ({
      label: (p && p.label) || '',
      md: linesToLogseqMarkdown(p && p.lines)
    }))
    .filter((b) => b.md !== '');

  if (blocks.length === 0) return '';
  if (blocks.length === 1) return blocks[0].md;

  return blocks
    .map((b) => `- ${b.label}\n${indentMarkdownBlock(b.md, 1)}`)
    .join('\n');
}
