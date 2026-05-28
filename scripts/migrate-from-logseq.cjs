#!/usr/bin/env node
/**
 * migrate-from-logseq.cjs
 *
 * One-shot migration: reads the user's LogSeq export of "Smartpen Data" pages
 * (`Smartpen Data___B{book}___P{page}.md`) and writes v2.0 PageDoc files
 * (`pages/B{book}/P{page}.json`).
 *
 * Usage:
 *   node scripts/migrate-from-logseq.cjs <input-jpi-folder> <output-data-root>
 *
 * Example:
 *   node scripts/migrate-from-logseq.cjs \
 *     "C:\Users\joshg\Documents\stroke-data\jpi" \
 *     "C:\Users\joshg\Documents\stroke-data"
 *
 * - Idempotent: re-running overwrites the target .json files.
 * - Non-destructive: source .md files are never modified or deleted.
 * - Preserves all existing line IDs and stroke→line associations, so no
 *   re-transcription is required.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PAGE_DOC_VERSION = '2.0';

// ---------------------------------------------------------------------------
// Outliner parser
// ---------------------------------------------------------------------------

/**
 * Parse a single LogSeq outliner .md file into a tree of nodes.
 *
 * Node shape:
 *   {
 *     content: string,
 *     indent: number,        // tab-depth of the bullet
 *     properties: { [k]: string },
 *     codeBlocks: string[],
 *     children: Node[]
 *   }
 *
 * The returned `roots` array holds top-level nodes; the page-level properties
 * (book::, page::, section::, owner::) appear in `pageProps`.
 */
function parseOutliner(text) {
  const lines = text.split(/\r?\n/);
  const pageProps = {};
  const roots = [];
  /** @type {Node[]} Stack of open ancestors keyed by indent depth */
  const stack = [];
  let current = null;

  // Pre-scan: page properties live before the first bullet.
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-\s/.test(line)) break;
    const m = line.match(/^([a-zA-Z][\w-]*?)::\s*(.*)$/);
    if (m) {
      pageProps[m[1]] = m[2].trim();
    }
    // ignore everything else in the preamble
  }

  // Now parse bullets + their properties + code blocks.
  let inCodeBlock = false;
  let codeBuf = [];

  while (i < lines.length) {
    const raw = lines[i];
    i++;

    if (inCodeBlock) {
      if (/^\s*```\s*$/.test(raw)) {
        // End of code block — attach to current node
        if (current) current.codeBlocks.push(codeBuf.join('\n'));
        codeBuf = [];
        inCodeBlock = false;
      } else {
        // Strip leading indentation that LogSeq adds to code lines
        // (typically tabs + two spaces); preserve relative content.
        codeBuf.push(raw.replace(/^\t*  /, ''));
      }
      continue;
    }

    // Detect opening of a fenced code block (with or without language)
    const openFence = raw.match(/^\s*```(\w+)?\s*$/);
    if (openFence) {
      inCodeBlock = true;
      continue;
    }

    // Bullet line
    const bullet = raw.match(/^(\t*)-\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1].length;          // number of leading tabs
      const content = bullet[2];

      // LogSeq sometimes writes a code fence as the bullet content itself:
      //   "\t\t- ```json"
      // Treat that as a bullet with no content that opens a code block.
      const fenceInBullet = content.match(/^```(\w+)?\s*$/);

      const node = {
        content: fenceInBullet ? '' : content,
        indent,
        properties: {},
        codeBlocks: [],
        children: []
      };

      // Trim the ancestor stack to the appropriate depth
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
      current = node;

      if (fenceInBullet) {
        inCodeBlock = true;
      }
      continue;
    }

    // Property continuation (LogSeq writes "\t*  key:: value" beneath a bullet)
    const propMatch = raw.match(/^\t*  ([a-zA-Z][\w-]*?)::\s*(.*)$/);
    if (propMatch && current) {
      current.properties[propMatch[1]] = propMatch[2].trim();
      continue;
    }

    // Multi-line content continuation: "\t*  some text" with no `::`
    const contMatch = raw.match(/^\t*  (.*)$/);
    if (contMatch && current && raw.trim() !== '') {
      // Treat as additional content if it doesn't look like a property
      // (this is rare but happens with wrapped bullets)
      current.content += '\n' + contMatch[1];
      continue;
    }

    // Blank lines / unrecognized — ignore
  }

  return { pageProps, roots };
}

// ---------------------------------------------------------------------------
// Transcript extraction
// ---------------------------------------------------------------------------

function findHeading(roots, headingPredicate) {
  return roots.find(n => headingPredicate(n.content)) || null;
}

function parseYBounds(str) {
  if (!str) return null;
  const m = str.match(/^([\d.+-]+)-([\d.+-]+)$/);
  if (!m) return null;
  const minY = parseFloat(m[1]);
  const maxY = parseFloat(m[2]);
  if (!isFinite(minY) || !isFinite(maxY)) return null;
  return { minY, maxY };
}

function extractTextAndCheckbox(content) {
  // Strip leading TODO / DONE markers (v2.0 transcript format used these)
  let checked = null;
  let text = content;
  const todo = text.match(/^(TODO|DONE)\s+(.*)$/);
  if (todo) {
    checked = todo[1] === 'DONE';
    text = todo[2];
  }
  return { text: text.trim(), checked };
}

/**
 * Recursively walk a "Transcribed Content" subtree into flat lines with parentId.
 */
function flattenTranscriptTree(rootNode) {
  const lines = [];
  if (!rootNode) return lines;

  function walk(node, parentId, indentLevel) {
    const { text, checked } = extractTextAndCheckbox(node.content);
    const id = node.properties.id || cryptoRandomId();
    const yBounds = parseYBounds(node.properties['stroke-y-bounds']);

    lines.push({
      id,
      text,
      indentLevel,
      parentId,
      checked,
      yBounds
    });

    for (const child of node.children) {
      walk(child, id, indentLevel + 1);
    }
  }

  // Don't include the H2 itself — only its children become lines.
  for (const child of rootNode.children) {
    walk(child, null, 0);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Stroke extraction
// ---------------------------------------------------------------------------

/**
 * Pull all stroke chunks out of a "## Raw Stroke Data" subtree.
 * First child holds metadata; subsequent children hold stroke chunks.
 */
function extractStrokes(strokeRootNode) {
  if (!strokeRootNode) return { strokes: [], pageInfo: null, bounds: null };

  const blocks = [];
  for (const child of strokeRootNode.children) {
    for (const code of child.codeBlocks) {
      try {
        blocks.push(JSON.parse(code));
      } catch (err) {
        console.warn(`  ! Failed to parse stroke JSON block:`, err.message);
      }
    }
  }

  if (blocks.length === 0) return { strokes: [], pageInfo: null, bounds: null };

  let pageInfo = null;
  let bounds = null;
  const allStrokes = [];

  for (const block of blocks) {
    if (block.metadata && block.pageInfo) {
      // Metadata block
      pageInfo = block.pageInfo;
      bounds = block.metadata.bounds || null;
    } else if (Array.isArray(block.strokes)) {
      // Chunk block (chunkIndex + strokes)
      for (const s of block.strokes) {
        // Normalize: stored strokes already have id/startTime/points
        allStrokes.push({
          id: s.id || `s${s.startTime}`,
          startTime: s.startTime,
          endTime: s.endTime,
          // Carry forward blockUuid as lineId (preserves stroke→line linkage)
          lineId: s.blockUuid || s.lineId || null,
          points: s.points
        });
      }
    }
  }

  // Sort by startTime to be safe
  allStrokes.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

  return { strokes: allStrokes, pageInfo, bounds };
}

// ---------------------------------------------------------------------------
// File-name → (book, page)
// ---------------------------------------------------------------------------

function parseFilename(filename) {
  // "Smartpen Data___B3017___P42.md"
  const m = filename.match(/^Smartpen Data___B(\d+)___P(\d+)\.md$/i);
  if (!m) return null;
  return { book: parseInt(m[1], 10), page: parseInt(m[2], 10) };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function cryptoRandomId() {
  // RFC 4122-ish v4 without external deps
  const bytes = require('crypto').randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function writeFileAtomic(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, contents, 'utf8');
  await fsp.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Per-file migration
// ---------------------------------------------------------------------------

async function migrateOne(srcPath, outRoot) {
  const filename = path.basename(srcPath);
  const ids = parseFilename(filename);
  if (!ids) return { skipped: true, reason: 'filename does not match Smartpen Data___B*___P*.md' };

  const text = await fsp.readFile(srcPath, 'utf8');
  const { pageProps, roots } = parseOutliner(text);

  // Locate the two top-level headings
  const transcriptRoot = findHeading(roots, c => /##\s+Transcribed Content/i.test(c));
  const strokesRoot = findHeading(roots, c => /##\s+Raw Stroke Data/i.test(c));

  const transcriptLines = flattenTranscriptTree(transcriptRoot);
  const { strokes, pageInfo: strokesPageInfo, bounds } = extractStrokes(strokesRoot);

  // Build pageInfo with the most reliable source for each field
  const pageInfo = {
    section: Number(pageProps.section ?? strokesPageInfo?.section ?? 0),
    owner:   Number(pageProps.owner   ?? strokesPageInfo?.owner   ?? 0),
    book:    Number(pageProps.book    ?? strokesPageInfo?.book    ?? ids.book),
    page:    Number(pageProps.page    ?? strokesPageInfo?.page    ?? ids.page)
  };

  const doc = {
    version: PAGE_DOC_VERSION,
    pageInfo,
    metadata: {
      lastUpdated: new Date().toISOString(),
      totalStrokes: strokes.length,
      bounds: bounds || { minX: 0, maxX: 0, minY: 0, maxY: 0 }
    },
    transcript: {
      lastTranscribed: transcriptLines.length ? new Date().toISOString() : null,
      lines: transcriptLines
    },
    strokes
  };

  const outPath = path.join(outRoot, 'pages', `B${ids.book}`, `P${ids.page}.json`);
  await writeFileAtomic(outPath, JSON.stringify(doc, null, 2));

  return {
    skipped: false,
    book: ids.book,
    page: ids.page,
    strokeCount: strokes.length,
    lineCount: transcriptLines.length,
    outPath
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , inputDir, outputRoot] = process.argv;
  if (!inputDir || !outputRoot) {
    console.error('Usage: node migrate-from-logseq.cjs <input-jpi-folder> <output-data-root>');
    process.exit(1);
  }

  const absIn = path.resolve(inputDir);
  const absOut = path.resolve(outputRoot);

  console.log(`Reading from:  ${absIn}`);
  console.log(`Writing to:    ${absOut}`);
  console.log();

  const entries = await fsp.readdir(absIn, { withFileTypes: true });
  const mdFiles = entries
    .filter(e => e.isFile() && /^Smartpen Data___B\d+___P\d+\.md$/i.test(e.name))
    .map(e => path.join(absIn, e.name));

  console.log(`Found ${mdFiles.length} candidate file(s).`);
  console.log();

  let ok = 0, skipped = 0, failed = 0;
  let totalStrokes = 0, totalLines = 0;

  for (const file of mdFiles) {
    try {
      const result = await migrateOne(file, absOut);
      if (result.skipped) {
        console.log(`SKIP  ${path.basename(file)}  (${result.reason})`);
        skipped++;
        continue;
      }
      console.log(`OK    B${result.book}/P${result.page}  strokes=${result.strokeCount}  lines=${result.lineCount}`);
      ok++;
      totalStrokes += result.strokeCount;
      totalLines += result.lineCount;
    } catch (err) {
      console.error(`FAIL  ${path.basename(file)}: ${err.message}`);
      failed++;
    }
  }

  console.log();
  console.log(`=== Summary ===`);
  console.log(`  Migrated:   ${ok}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Strokes:    ${totalStrokes}`);
  console.log(`  Lines:      ${totalLines}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
