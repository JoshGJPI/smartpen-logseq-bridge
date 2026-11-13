/**
 * mcp-edit-log — the undo log for Claude's transcript edits (v3.18.0):
 * `<userData>/mcp-edits/<bookKey>-<pageId>.jsonl`, one JSON entry per line,
 * oldest first, the last MAX_ENTRIES kept. Never in the data folder.
 *
 * An entry is appended BEFORE the edit is saved, holding the page's previous
 * `transcript` and the stroke links the save will scrub; once the save lands
 * the renderer stamps it with the revision it wrote (`finish`), and a failed
 * save drops it. Undo restores only from a finished entry whose revision is
 * still the page's, then pops it.
 *
 * Pure Node (tested from Vitest with a temp dir); `handle()` is the one IPC
 * entry point main wires to 'mcp:editLog'.
 */
const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 20;
const KEY_RE = /^\d+(?:v\d+)?-\d+[a-zA-Z]?$/;

function logDir(userDataDir) {
  return path.join(userDataDir, 'mcp-edits');
}

function logFile(userDataDir, key) {
  if (!KEY_RE.test(String(key))) throw new Error(`Invalid edit-log key: ${key}`);
  // Lowercase: Windows file names ignore case, so 151b and 151B are one file anyway.
  return path.join(logDir(userDataDir), `${String(key).toLowerCase()}.jsonl`);
}

/** Entries, oldest first. A corrupt line is skipped, not fatal. */
function readEntries(userDataDir, key) {
  let text;
  try {
    text = fs.readFileSync(logFile(userDataDir, key), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/**
 * Rename with a few short retries: on Windows a file just written can be held
 * for a moment by the indexer or antivirus (EPERM / EBUSY / EACCES).
 */
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
    }
  }
}

function writeEntries(userDataDir, key, entries) {
  const file = logFile(userDataDir, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!entries.length) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    return;
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, entries.slice(-MAX_ENTRIES).map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  renameRetry(tmp, file);
}

/**
 * @param {string} userDataDir
 * @param {'append'|'finish'|'drop'|'last'|'pop'} action
 * @param {string} key  `<bookKey>-<pageId>`
 * @param {object} [payload]  append: the entry; finish: fields to merge into the last entry
 * @returns {object|null} last: the last entry or null; others: the entry acted on, or null
 */
function handle(userDataDir, action, key, payload) {
  const entries = readEntries(userDataDir, key);
  const last = entries.length ? entries[entries.length - 1] : null;
  switch (action) {
    case 'append':
      if (!payload || typeof payload !== 'object') throw new Error('append needs an entry');
      writeEntries(userDataDir, key, [...entries, payload]);
      return payload;
    case 'finish':
      if (!last) return null;
      entries[entries.length - 1] = { ...last, ...(payload || {}) };
      writeEntries(userDataDir, key, entries);
      return entries[entries.length - 1];
    case 'drop':
    case 'pop':
      if (!last) return null;
      writeEntries(userDataDir, key, entries.slice(0, -1));
      return last;
    case 'last':
      return last;
    default:
      throw new Error(`Unknown edit-log action: ${action}`);
  }
}

module.exports = { renameRetry, MAX_ENTRIES, logDir, logFile, readEntries, handle };
