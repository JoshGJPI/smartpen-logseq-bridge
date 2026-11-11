/**
 * app-client — how the MCP reaches the RUNNING smartpen-bridge app to edit a
 * transcript (v3.18.0, docs/MCP-WRITE-SPEC.md). The MCP never writes a page:
 * it posts the edit to the app's localhost endpoint (electron/mcp-endpoint.cjs),
 * and the app saves it through its own write path.
 *
 * The endpoint file `<userData>/mcp-endpoint.json` ({ port, token, pid,
 * version }) exists only while the app runs with Settings → Data folder →
 * "Allow Claude to edit transcripts" on. It is found at SMARTPEN_APP_ENDPOINT,
 * else in the app's userData folder: `smartpen-logseq-bridge` (the dev and the
 * installed build both use it), with the product name as a fallback.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENDPOINT_FILE = 'mcp-endpoint.json';
const APP_DIRS = ['smartpen-logseq-bridge', 'Smartpen LogSeq Bridge'];
const TIMEOUT_MS = 40000; // a little over the app's own 30 s, so its answer arrives first

/** An error whose message is fit to show Claude as is. */
export class AppError extends Error {}

/** Where Electron keeps userData on this OS. */
function appDataDir(env, platform, home) {
  if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

/** Endpoint files to try, in order. */
export function endpointCandidates(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.SMARTPEN_APP_ENDPOINT) return [path.resolve(env.SMARTPEN_APP_ENDPOINT)];
  const base = appDataDir(env, platform, home);
  return APP_DIRS.map((d) => path.join(base, d, ENDPOINT_FILE));
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // alive, just not ours to signal
  }
}

const NOT_RUNNING = 'The smartpen-bridge app isn\'t running with Claude edits turned on. '
  + 'Ask Josh to open it and turn on Settings → Data folder → "Allow Claude to edit transcripts", then try again.';

/**
 * The running app's endpoint.
 * @returns {{ port: number, token: string, pid: number, version?: string, file: string }}
 * @throws {AppError}
 */
export function findEndpoint({ env = process.env, platform = process.platform, home = os.homedir(), alive = pidAlive } = {}) {
  for (const file of endpointCandidates(env, platform, home)) {
    let info;
    try {
      info = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!info || !Number.isInteger(info.port) || typeof info.token !== 'string') continue;
    if (!alive(info.pid)) continue; // left behind by a crash
    return { ...info, file };
  }
  throw new AppError(NOT_RUNNING);
}

/**
 * Post one request to the app.
 * @param {object} body  { action, book, page, data_root, edits?, dry_run?, revision? }
 * @param {{ endpoint?: object, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<object>} the app's answer: { ok, text?, error?, revision? }
 * @throws {AppError}
 */
export async function postToApp(body, { endpoint, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, ...find } = {}) {
  const ep = endpoint || findEndpoint(find);
  let res;
  try {
    res = await fetchImpl(`http://127.0.0.1:${ep.port}/transcript-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new AppError('The app did not answer in time. An edit may still have been applied: check with get_transcript');
    }
    throw new AppError(NOT_RUNNING);
  }
  let json = null;
  try {
    json = await res.json();
  } catch { /* not JSON */ }
  if (res.status === 401) throw new AppError('The app refused the request (token mismatch); restart the app and try again');
  if (!res.ok) throw new AppError((json && json.error) || `The app answered ${res.status}`);
  if (!json || typeof json !== 'object') throw new AppError('The app sent an empty answer');
  return json;
}
