// @vitest-environment node
/**
 * The write tools (v3.18.0) as a client sees them: absent without
 * SMARTPEN_MCP_WRITES, present with write annotations with it; "app not
 * running" when there is no endpoint; a dry run then an apply against a fake
 * app behind the real endpoint (electron/mcp-endpoint.cjs); a stale revision;
 * and the app-client's endpoint lookup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writePage } from '../__fixtures__/app-side.js';
import { endpointCandidates, findEndpoint, AppError } from '../core/app-client.js';
import { createWriteTools } from '../core/write-tools.js';

const require = createRequire(import.meta.url);
const { createForwarder, startEndpoint, endpointFilePath } = require('../../electron/mcp-endpoint.cjs');

const validate = { requireBookKey: (b) => b, requirePageId: (p) => p };

let root, userData, ep, seen;
const app = { revision: 'r1', saved: 0 };

async function connect(env) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, '../server.js')],
    env: { ...process.env, SMARTPEN_DATA_ROOT: root, ...env },
    stderr: 'ignore',
  }));
  return client;
}
const textOf = (r) => r.content.map((c) => c.text).join('\n');

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-writes-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-writes-app-'));
  writePage(root, '3017', '180', [], [
    { id: 'a', text: 'Brad Russell, AlA', indentLevel: 0, parentId: null, checked: null, yBounds: null },
  ]);
  // A fake app: answers like stores/mcp-edits.js does.
  seen = [];
  const forwarder = createForwarder({
    send: ({ reqId, payload }) => {
      seen.push(payload);
      let result;
      if (payload.action === 'undo') result = { ok: true, text: 'Restored' };
      else if (payload.dry_run) result = { ok: true, revision: app.revision, text: `Dry run; revision "${app.revision}"` };
      else if (payload.revision !== app.revision) result = { ok: false, error: 'The page changed since the dry run; run it again' };
      else {
        app.saved++;
        app.revision = `r${app.saved + 1}`;
        result = { ok: true, revision: app.revision, text: 'Saved B3017/P180 (1 changed)' };
      }
      setTimeout(() => forwarder.receive(reqId, result), 1);
    },
  });
  forwarder.setReady(true);
  ep = await startEndpoint({ userDataDir: userData, version: 'test', forwarder, validate });
}, 30_000);

afterAll(async () => {
  await ep?.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('write tools', () => {
  it('are not registered without SMARTPEN_MCP_WRITES=1', async () => {
    const client = await connect({ SMARTPEN_MCP_WRITES: '' });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain('edit_transcript');
      expect(tools.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('with it: registered as writes; dry run, apply, stale revision, undo', async () => {
    const client = await connect({ SMARTPEN_MCP_WRITES: '1', SMARTPEN_APP_ENDPOINT: endpointFilePath(userData) });
    try {
      const { tools } = await client.listTools();
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      for (const name of ['edit_transcript', 'undo_transcript_edit']) {
        expect(byName[name].annotations).toEqual({
          readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
        });
      }
      expect(tools).toHaveLength(13);

      const edits = [{ op: 'set_text', line: 1, expect: 'Brad Russell, AlA', text: 'Brad Russell, AIA' }];
      const dry = await client.callTool({ name: 'edit_transcript', arguments: { book: '3017', page: '180', edits } });
      expect(dry.isError).toBeFalsy();
      expect(textOf(dry)).toBe('Dry run; revision "r1"');
      expect(seen.at(-1)).toEqual({
        action: 'edit', book: '3017', page: '180', data_root: root, edits, dry_run: true,
      });

      const apply = await client.callTool({ name: 'edit_transcript', arguments: { book: '3017', page: '180', edits, dry_run: false, revision: 'r1' } });
      expect(textOf(apply)).toMatch(/^Saved/);

      const stale = await client.callTool({ name: 'edit_transcript', arguments: { book: '3017', page: '180', edits, dry_run: false, revision: 'r1' } });
      expect(stale.isError).toBe(true);
      expect(textOf(stale)).toMatch(/changed since the dry run/);

      const undo = await client.callTool({ name: 'undo_transcript_edit', arguments: { book: '3017', page: '180' } });
      expect(textOf(undo)).toBe('Restored');
      expect(seen.at(-1)).toEqual({ action: 'undo', book: '3017', page: '180', data_root: root });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('says the app is not running when there is no endpoint', async () => {
    const client = await connect({ SMARTPEN_MCP_WRITES: '1', SMARTPEN_APP_ENDPOINT: path.join(userData, 'missing.json') });
    try {
      const r = await client.callTool({ name: 'edit_transcript', arguments: { book: '3017', page: '180', edits: [{ op: 'delete', line: 1, expect: 'x' }] } });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/app isn't running with Claude edits turned on/);
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe('createWriteTools', () => {
  it('a bad book or page is a tool error, and nothing is posted', async () => {
    const posts = [];
    const wt = createWriteTools('C:/data', { post: async (b) => { posts.push(b); return { ok: true }; } });
    const r = await wt.edit_transcript({ book: '../x', page: '1', edits: [] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Invalid book key/);
    expect((await wt.undo_transcript_edit({ book: '3017', page: 'P1' })).isError).toBe(true);
    expect(posts).toEqual([]);
  });
});

describe('app-client', () => {
  it('looks in the app\'s userData folder, or SMARTPEN_APP_ENDPOINT', () => {
    const win = endpointCandidates({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'win32', 'C:\\Users\\x');
    expect(win.map((p) => p.replace(/\\/g, '/'))).toEqual([
      'C:/Users/x/AppData/Roaming/smartpen-logseq-bridge/mcp-endpoint.json',
      'C:/Users/x/AppData/Roaming/Smartpen LogSeq Bridge/mcp-endpoint.json',
    ]);
    expect(endpointCandidates({ SMARTPEN_APP_ENDPOINT: '/tmp/e.json' })).toEqual([path.resolve('/tmp/e.json')]);
  });

  it('skips an endpoint file left by a crashed app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ep-'));
    const file = path.join(dir, 'mcp-endpoint.json');
    fs.writeFileSync(file, JSON.stringify({ port: 1, token: 't', pid: 999999 }));
    try {
      expect(() => findEndpoint({ env: { SMARTPEN_APP_ENDPOINT: file }, alive: () => false })).toThrow(AppError);
      expect(findEndpoint({ env: { SMARTPEN_APP_ENDPOINT: file }, alive: () => true })).toMatchObject({ port: 1, file });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
