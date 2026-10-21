/** Sidecar readers: missing, corrupt or wrongly shaped = empty, never a throw. */
import fs from 'node:fs';
import { sidecarPath } from './paths.js';
import { normalizeOrientations } from '../../src/lib/page-orientation.js';
import { normalizeTagsFile } from '../../src/lib/tags.js';
import { parseBookKey } from '../../src/lib/volumes.js';

function readJson(root, name) {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(root, name), 'utf8'));
  } catch {
    return null;
  }
}

const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** `{ "<bookKey>": "name" }` */
export function readAliases(root) {
  const raw = plain(readJson(root, '_aliases.json'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (parseBookKey(k) && typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}

/** `{ "<ncodeBook>": activeVolume }` */
export function readVolumes(root) {
  const raw = plain(plain(readJson(root, '_volumes.json')).active);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (/^\d+$/.test(k) && Number.isInteger(n) && n >= 1) out[k] = n;
  }
  return out;
}

/** `{ "<bookKey>/<pageId>": 90|180|270 }` (portrait by absence) */
export function readOrientations(root) {
  return normalizeOrientations(readJson(root, '_orientation.json'));
}

/** `{ pages: {key: [tags]}, dismissed }` */
export function readTags(root) {
  return normalizeTagsFile(readJson(root, '_tags.json'));
}
