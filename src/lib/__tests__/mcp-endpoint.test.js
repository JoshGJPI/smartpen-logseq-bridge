/**
 * @vitest-environment node
 *
 * Tests for electron/mcp-endpoint.cjs (the local HTTP endpoint Claude's
 * transcript edits come in through) and electron/mcp-edit-log.cjs (their undo
 * log), without Electron: a real http server on 127.0.0.1 with a fake
 * renderer behind the forwarder, and a temp userData folder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createForwarder, startEndpoint, tokenMatches, checkBody, endpointFilePath, ROUTE
} = require('../../../electron/mcp-endpoint.cjs');
const editLog = require('../../../electron/mcp-edit-log.cjs');

const validate = {
  requireBookKey: (b) => { if (!/^\d+(v\d+)?$/.test(b)) throw new Error(`Invalid book key: ${b}`); return b; },
  requirePageId: (p) => { if (!/^\d+[a-z]?$/i.test(p)) throw new Error(`Invalid page id: ${p}`); return p; },
};

const body = (extra = {}) => ({ book: '3017', page: '180', data_root: 'C:\\data', edits: [], ...extra });

let dir;
let ep;
let sent;
let forwarder;

async function start({ timeoutMs = 1000, answer = (m) => ({ ok: true, echo: m.payload }) } = {}) {
  sent = [];
  forwarder = createForwarder({
    timeoutMs,
    send: (m) => {
      sent.push(m);
      const a = answer(m);
      if (a !== undefined) setTimeout(() => forwarder.receive(m.reqId, a), 5);
    },
  });
  forwarder.setReady(true);
  ep = await startEndpoint({ userDataDir: dir, version: '9.9.9', forwarder, validate });
}

async function post(payload, { token = ep.token, route = ROUTE, method = 'POST', raw } = {}) {
  const res = await fetch(`http://127.0.0.1:${ep.port}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? (raw ?? JSON.stringify(payload)) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-endpoint-'));
});
afterEach(async () => {
  if (ep) await ep.close();
  ep = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('mcp-endpoint', () => {
  it('writes the endpoint file and removes it on close', async () => {
    await start();
    const info = JSON.parse(fs.readFileSync(endpointFilePath(dir), 'utf8'));
    expect(info).toEqual({ port: ep.port, token: ep.token, pid: process.pid, version: '9.9.9' });
    expect(ep.token).toMatch(/^[0-9a-f]{64}$/);
    await ep.close();
    ep = null;
    expect(fs.existsSync(endpointFilePath(dir))).toBe(false);
  });

  it('forwards a valid request to the renderer and returns its answer', async () => {
    await start();
    const r = await post(body({ dry_run: false, revision: 'r1', edits: [{ op: 'set_text' }] }));
    expect(r.status).toBe(200);
    expect(r.json.echo).toEqual({
      action: 'edit', book: '3017', page: '180', data_root: 'C:\\data', edits: [{ op: 'set_text' }], dry_run: false, revision: 'r1'
    });
    expect(sent[0].reqId).toBeTruthy();
    // dry_run defaults to true
    expect((await post(body())).json.echo.dry_run).toBe(true);
  });

  it('needs the token', async () => {
    await start();
    expect((await post(body(), { token: null })).status).toBe(401);
    expect((await post(body(), { token: 'x'.repeat(64) })).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('has one route, POST only', async () => {
    await start();
    expect((await post(body(), { route: '/other' })).status).toBe(404);
    expect((await post(null, { method: 'GET' })).status).toBe(405);
  });

  it('refuses a body over the limit, bad JSON and a bad shape', async () => {
    await start();
    expect((await post(null, { raw: JSON.stringify(body({ edits: [{ text: 'x'.repeat(300 * 1024) }] })) })).status).toBe(413);
    expect((await post(null, { raw: '{nope' })).json.error).toMatch(/not valid JSON/);
    expect((await post(body({ book: '../etc' }))).json.error).toMatch(/Invalid book key/);
    expect((await post(body({ page: '1/2' }))).status).toBe(400);
    expect((await post(body({ data_root: '' }))).json.error).toMatch(/data_root/);
    expect((await post(body({ action: 'tick' }))).json.error).toMatch(/Unknown action/);
    expect(sent).toHaveLength(0);
  });

  it('503 while the renderer is not ready', async () => {
    await start();
    forwarder.setReady(false);
    const r = await post(body());
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/starting/);
  });

  it('504 when the renderer does not answer in time, and a late answer is ignored', async () => {
    await start({ timeoutMs: 50, answer: () => undefined });
    const r = await post(body());
    expect(r.status).toBe(504);
    expect(r.json.error).toMatch(/did not answer within .* may still have been applied/);
    expect(forwarder.receive(sent[0].reqId, { ok: true })).toBe(false);
    expect(forwarder.pendingCount()).toBe(0);
  });

  it('a reload fails what is pending', async () => {
    await start({ answer: () => undefined });
    const p = post(body());
    await new Promise((r) => setTimeout(r, 30));
    forwarder.setReady(false);
    expect((await p).status).toBe(503);
  });

  it('undo carries no edits', () => {
    expect(checkBody({ action: 'undo', book: '3017', page: '180', data_root: 'd', edits: [1] }, validate))
      .toEqual({ action: 'undo', book: '3017', page: '180', data_root: 'd' });
  });

  it('tokenMatches is strict', () => {
    expect(tokenMatches('Bearer abc', 'abc')).toBe(true);
    expect(tokenMatches('bearer abc', 'abc')).toBe(false);
    expect(tokenMatches('Bearer abcd', 'abc')).toBe(false);
    expect(tokenMatches(undefined, 'abc')).toBe(false);
  });
});

describe('mcp-edit-log', () => {
  const key = '3017-180';

  it('append, finish, last, pop', () => {
    expect(editLog.handle(dir, 'last', key)).toBeNull();
    editLog.handle(dir, 'append', key, { time: 't1', transcript: { lines: [] } });
    editLog.handle(dir, 'finish', key, { revisionAfter: 'r1' });
    expect(editLog.handle(dir, 'last', key)).toEqual({ time: 't1', transcript: { lines: [] }, revisionAfter: 'r1' });
    expect(fs.existsSync(path.join(dir, 'mcp-edits', '3017-180.jsonl'))).toBe(true);
    expect(editLog.handle(dir, 'pop', key).time).toBe('t1');
    expect(editLog.handle(dir, 'last', key)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'mcp-edits', '3017-180.jsonl'))).toBe(false);
  });

  it('drop removes an unfinished entry', () => {
    editLog.handle(dir, 'append', key, { time: 'a' });
    editLog.handle(dir, 'finish', key, { revisionAfter: 'r' });
    editLog.handle(dir, 'append', key, { time: 'b' });
    editLog.handle(dir, 'drop', key);
    expect(editLog.handle(dir, 'last', key).time).toBe('a');
  });

  it('keeps the last 20 entries and skips a corrupt line', () => {
    for (let i = 0; i < 25; i++) editLog.handle(dir, 'append', key, { i });
    const entries = editLog.readEntries(dir, key);
    expect(entries.map((e) => e.i)).toEqual(Array.from({ length: 20 }, (_, k) => k + 5));
    fs.appendFileSync(editLog.logFile(dir, key), '{broken\n');
    expect(editLog.readEntries(dir, key)).toHaveLength(20);
  });

  it('keys are book-page only', () => {
    expect(() => editLog.handle(dir, 'last', '../x')).toThrow(/Invalid edit-log key/);
    expect(editLog.handle(dir, 'last', '388v2-151b')).toBeNull();
  });
});
