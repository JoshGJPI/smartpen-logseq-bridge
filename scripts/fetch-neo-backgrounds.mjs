#!/usr/bin/env node
/**
 * fetch-neo-backgrounds.mjs
 *
 * Caches Neo's printed-page backgrounds for one or more notebooks into the data
 * folder, where Book View and the Timeline draw them behind the strokes.
 *
 * Usage:
 *   node scripts/fetch-neo-backgrounds.mjs <data-root> <section_owner_book>...
 *
 * Example (Study Notes 2 = COLLEGE_Mint, and the Lamy digital paper):
 *   node scripts/fetch-neo-backgrounds.mjs "C:\Users\joshg\Documents\stroke-data" 3_27_388 3_1012_3017
 *
 * The "section_owner_book" triple is what the pen reports for the notebook — it
 * is the `section`/`owner`/`book` of any PageDoc's `pageInfo`.
 *
 * Writes, per book:
 *   <data-root>/pages/_backgrounds/<book>/manifest.json
 *   <data-root>/pages/_backgrounds/<book>/P<n>.jpg        (one per page)
 *
 * - Read-only against Neo: two GETs per book, from the same public storage
 *   bucket `web_pen_sdk` (NoteServer.ts) uses for its own page images.
 * - Idempotent: re-running overwrites. Existing PageDocs are never touched.
 * - Refuses a book whose pages are not all one size, or are rotated, rather than
 *   drawing paper that would not line up with the ink.
 * - Needs `jszip`, which ships in node_modules as a dependency of web_pen_sdk.
 *
 * Neo's images are Neo's. These are cached for personal display in your own
 * copy of the app; do not commit or redistribute them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  BACKGROUNDS_DIR,
  parseNproj,
  summarizeNproj,
  buildManifest,
  pageFromZipEntryName,
  backgroundFileName
} from '../src/lib/neo-backgrounds.js';

const require = createRequire(import.meta.url);
let JSZip;
try {
  JSZip = require('jszip');
} catch {
  console.error('jszip not found. Run `npm install` in the project first (it is a dependency of web_pen_sdk).');
  process.exit(1);
}

const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/neonotes2-d0880.appspot.com/o/';
const SOB_RE = /^(\d+)_(\d+)_(\d+)$/;

async function fetchObject(objectPath) {
  const metaUrl = BUCKET + encodeURIComponent(objectPath);
  const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(30000) });
  if (metaRes.status === 404) throw new Error(`Neo has no ${objectPath}`);
  if (!metaRes.ok) throw new Error(`${objectPath}: HTTP ${metaRes.status}`);
  const meta = await metaRes.json();
  const res = await fetch(`${metaUrl}?alt=media&token=${meta.downloadTokens}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${objectPath}: download failed, HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function importBook(dataRoot, sob) {
  const m = sob.match(SOB_RE);
  if (!m) throw new Error(`"${sob}" is not section_owner_book (e.g. 3_27_388)`);
  const book = Number(m[3]);

  console.log(`\n${sob}`);
  const parsed = parseNproj((await fetchObject(`nproj/${sob}.nproj`)).toString('utf8'));
  if (parsed.book !== book) throw new Error(`.nproj says book ${parsed.book}, expected ${book}`);

  const summary = summarizeNproj(parsed);
  if (!summary.frame) throw new Error('.nproj lists no pages');
  if (!summary.uniform) throw new Error('pages are not all one size; this spike only handles uniform books');
  if (summary.rotated) throw new Error('rotated pages are not supported yet');
  console.log(`  ${parsed.title}: ${summary.pageCount} pages (${summary.firstPage}-${summary.lastPage})`);

  const zip = await JSZip.loadAsync(await fetchObject(`png/${sob}.zip`));
  const dir = path.join(dataRoot, 'pages', BACKGROUNDS_DIR, String(book));
  fs.mkdirSync(dir, { recursive: true });

  let written = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const page = pageFromZipEntryName(entry.name);
    if (page === null) continue;
    writeAtomic(path.join(dir, backgroundFileName(page)), await entry.async('nodebuffer'));
    written++;
  }
  if (written === 0) throw new Error('the image zip contained no page images');
  if (written !== summary.pageCount) console.warn(`  note: ${written} images for ${summary.pageCount} pages; pages without an image show no background`);

  // Manifest last, so a half-finished import never advertises images it lacks.
  writeAtomic(path.join(dir, 'manifest.json'), JSON.stringify(buildManifest(parsed, summary), null, 2));
  console.log(`  wrote ${written} images + manifest.json -> ${dir}`);
}

const [dataRoot, ...sobs] = process.argv.slice(2);
if (!dataRoot || sobs.length === 0) {
  console.error('Usage: node scripts/fetch-neo-backgrounds.mjs <data-root> <section_owner_book>...');
  process.exit(1);
}
if (!fs.existsSync(path.join(dataRoot, 'pages'))) {
  console.error(`${dataRoot} has no pages/ folder — is that the data root?`);
  process.exit(1);
}

let failed = 0;
for (const sob of sobs) {
  try {
    await importBook(dataRoot, sob);
  } catch (err) {
    failed++;
    console.error(`  FAILED ${sob}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
