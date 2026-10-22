/**
 * Data-root handling and the path guard (read-only server).
 *
 * The guard mirrors requireBookKey()/requirePageId() in electron/main.cjs: a
 * book key and a page id are validated by shape BEFORE they touch a path, and
 * the resolved path is checked to still sit inside <root>/pages.
 */
import path from 'node:path';
import fs from 'node:fs';
import { parseBookKey } from '../../src/lib/volumes.js';

/** Page ids are digits plus an optional single letter: "42", "151b". */
const PAGE_ID_RE = /^\d+[a-zA-Z]?$/;

export function requireBookKey(book) {
  const s = String(book ?? '');
  if (!parseBookKey(s)) throw new Error(`Invalid book key: ${s}`);
  return s;
}

export function requirePageId(page) {
  const s = String(page ?? '');
  if (!PAGE_ID_RE.test(s)) throw new Error(`Invalid page id: ${s}`);
  return s;
}

export function pagesDir(root) {
  return path.join(root, 'pages');
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Absolute path of one PageDoc; throws on anything that is not a plain book key + page id. */
export function pagePath(root, book, page) {
  const dir = pagesDir(root);
  const p = path.join(dir, `B${requireBookKey(book)}`, `P${requirePageId(page)}.json`);
  if (!inside(dir, p)) throw new Error('Path escapes the data folder');
  return p;
}

export function sidecarPath(root, name) {
  if (!/^_[a-z]+\.json$/.test(name)) throw new Error(`Invalid sidecar: ${name}`);
  return path.join(pagesDir(root), name);
}

/**
 * Data root from `--data-root <dir>` / `--data-root=<dir>` or SMARTPEN_DATA_ROOT.
 * Throws when it is missing or has no pages/ folder.
 */
export function resolveDataRoot(argv = process.argv.slice(2), env = process.env) {
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-root') root = argv[i + 1];
    else if (argv[i].startsWith('--data-root=')) root = argv[i].slice('--data-root='.length);
  }
  root = root || env.SMARTPEN_DATA_ROOT;
  if (!root) throw new Error('No data folder: set SMARTPEN_DATA_ROOT or pass --data-root <dir>');
  root = path.resolve(root);
  if (!fs.existsSync(pagesDir(root))) throw new Error(`No pages/ folder under ${root}`);
  return root;
}

/** `<root>/pages/_backgrounds/<ncodeBook>/manifest.json` (geometry only; the JPGs are never read). */
export function manifestPath(root, ncodeBook) {
  const s = String(ncodeBook ?? '');
  if (!/^\d+$/.test(s)) throw new Error(`Invalid NCode book: ${s}`);
  return path.join(pagesDir(root), '_backgrounds', s, 'manifest.json');
}
