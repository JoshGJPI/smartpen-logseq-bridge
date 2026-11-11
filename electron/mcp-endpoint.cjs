/**
 * mcp-endpoint — the local HTTP endpoint the smartpen-bridge MCP server uses to
 * ask the RUNNING app to edit a page's transcript (v3.18.0,
 * docs/MCP-WRITE-SPEC.md). Main does no PageDoc logic here: it checks the
 * caller and the request's shape, hands the request to the renderer (which
 * runs the guards and saves through the app's one write path), and returns
 * the renderer's answer.
 *
 *   127.0.0.1 only, port chosen by the OS; `Authorization: Bearer <token>`,
 *   32 random bytes, new each start; one route, POST /transcript-edit, JSON
 *   body ≤ 256 KB. `<userData>/mcp-endpoint.json` = { port, token, pid, version },
 *   written owner-only and deleted on stop.
 *
 * Started only while Settings → Data folder → "Allow Claude to edit
 * transcripts" is on (the renderer turns it on and off). Pure Node: the handler,
 * the forwarder and the file are tested from Vitest without Electron.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { renameRetry } = require('./mcp-edit-log.cjs');

const ROUTE = '/transcript-edit';
const MAX_BODY = 256 * 1024;
const TIMEOUT_MS = 30000;
const ENDPOINT_FILE = 'mcp-endpoint.json';

/** An error carrying the HTTP status to answer with. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Constant-time token check; false for anything malformed. */
function tokenMatches(header, token) {
  const m = /^Bearer (\S+)$/.exec(header || '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Request ids and timeouts between main and the renderer.
 * @param {{ send: (msg: {reqId: string, payload: object}) => void, timeoutMs?: number }} opts
 */
function createForwarder({ send, timeoutMs = TIMEOUT_MS }) {
  const pending = new Map();
  let ready = false;
  let seq = 0;
  return {
    setReady(v) {
      ready = !!v;
      if (!ready) {
        // The page reloaded or went away: nobody will answer what was sent.
        for (const [id, p] of pending) {
          clearTimeout(p.timer);
          p.reject(httpError(503, 'The app reloaded before answering; try again'));
          pending.delete(id);
        }
      }
    },
    isReady: () => ready,
    pendingCount: () => pending.size,
    /** @returns {Promise<object>} the renderer's result */
    forward(payload) {
      if (!ready) return Promise.reject(httpError(503, 'The smartpen-bridge app is starting; try again in a moment'));
      const reqId = `${Date.now().toString(36)}-${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(reqId);
          reject(httpError(504, `The app did not answer within ${Math.round(timeoutMs / 1000)} s. `
            + 'An edit may still have been applied: check with get_transcript before trying again'));
        }, timeoutMs);
        pending.set(reqId, { resolve, reject, timer });
        try {
          send({ reqId, payload });
        } catch (e) {
          clearTimeout(timer);
          pending.delete(reqId);
          reject(httpError(503, `Could not reach the app window: ${e.message}`));
        }
      });
    },
    /** The renderer's reply. Unknown or late ids are ignored. */
    receive(reqId, result) {
      const p = pending.get(reqId);
      if (!p) return false;
      clearTimeout(p.timer);
      pending.delete(reqId);
      p.resolve(result);
      return true;
    },
  };
}

/**
 * Check a request body's shape. Paths are made only by main's own storage
 * handlers, but the book and page are checked here too so nothing odd reaches
 * the renderer.
 * @param {object} body
 * @param {{ requireBookKey: (b: string) => string, requirePageId: (p: string) => string }} validate
 */
function checkBody(body, { requireBookKey, requirePageId }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Body must be a JSON object');
  const action = body.action || 'edit';
  if (action !== 'edit' && action !== 'undo') throw httpError(400, `Unknown action "${action}"`);
  let book; let page;
  try {
    book = requireBookKey(String(body.book ?? ''));
    page = requirePageId(String(body.page ?? ''));
  } catch (e) {
    throw httpError(400, e.message);
  }
  if (typeof body.data_root !== 'string' || !body.data_root) throw httpError(400, 'data_root is required');
  const out = { action, book, page, data_root: body.data_root };
  if (action === 'edit') {
    if (!Array.isArray(body.edits)) throw httpError(400, 'edits must be an array');
    out.edits = body.edits;
    out.dry_run = body.dry_run !== false;
    if (body.revision != null) out.revision = String(body.revision);
  }
  return out;
}

function send(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

/**
 * The HTTP request handler.
 * @param {{ token: string, forward: (payload: object) => Promise<object>,
 *           validate: { requireBookKey: Function, requirePageId: Function }, maxBody?: number }} opts
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => void}
 */
function createRequestHandler({ token, forward, validate, maxBody = MAX_BODY }) {
  return (req, res) => {
    if (!tokenMatches(req.headers.authorization, token)) {
      req.resume();
      return send(res, 401, { ok: false, error: 'Unauthorized' });
    }
    const url = (req.url || '').split('?')[0];
    if (url !== ROUTE) {
      req.resume();
      return send(res, 404, { ok: false, error: `No route ${url}` });
    }
    if (req.method !== 'POST') {
      req.resume();
      return send(res, 405, { ok: false, error: 'POST only' });
    }
    const declared = Number(req.headers['content-length']);
    if (declared > maxBody) {
      req.resume();
      return send(res, 413, { ok: false, error: `Body over ${maxBody} bytes` });
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBody) {
        done = true;
        send(res, 413, { ok: false, error: `Body over ${maxBody} bytes` });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (done) return;
      done = true;
      let payload;
      try {
        payload = checkBody(JSON.parse(Buffer.concat(chunks).toString('utf8')), validate);
      } catch (e) {
        return send(res, e.status || 400, { ok: false, error: e instanceof SyntaxError ? 'Body is not valid JSON' : e.message });
      }
      try {
        const result = await forward(payload);
        send(res, 200, result && typeof result === 'object' ? result : { ok: false, error: 'Empty answer from the app' });
      } catch (e) {
        send(res, e.status || 500, { ok: false, error: e.message || String(e) });
      }
    });
    req.on('error', () => { done = true; });
  };
}

function endpointFilePath(userDataDir) {
  return path.join(userDataDir, ENDPOINT_FILE);
}

/** Write the endpoint file, owner-only where the OS supports it (atomic). */
function writeEndpointFile(userDataDir, info) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = endpointFilePath(userDataDir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2), { mode: 0o600 });
  renameRetry(tmp, file);
  return file;
}

/** Delete the endpoint file only if it is still ours (another instance may have replaced it). */
function removeEndpointFile(userDataDir, token) {
  const file = endpointFilePath(userDataDir);
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cur && cur.token === token) fs.unlinkSync(file);
  } catch { /* gone or unreadable: nothing to do */ }
}

/**
 * Start the endpoint.
 * @param {{ userDataDir: string, version: string, forwarder: ReturnType<typeof createForwarder>,
 *           validate: object, host?: string }} opts
 * @returns {Promise<{ port: number, token: string, file: string, close: () => Promise<void> }>}
 */
function startEndpoint({ userDataDir, version, forwarder, validate, host = '127.0.0.1' }) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(createRequestHandler({ token, forward: forwarder.forward, validate }));
  server.requestTimeout = TIMEOUT_MS + 10000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      let file;
      try {
        file = writeEndpointFile(userDataDir, { port, token, pid: process.pid, version });
      } catch (e) {
        server.close();
        reject(e);
        return;
      }
      resolve({
        port, token, file,
        close: () => new Promise((r) => {
          removeEndpointFile(userDataDir, token);
          server.close(() => r());
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = {
  ROUTE, MAX_BODY, TIMEOUT_MS, ENDPOINT_FILE,
  createForwarder, createRequestHandler, checkBody, tokenMatches,
  endpointFilePath, writeEndpointFile, removeEndpointFile, startEndpoint,
};
