// @vitest-environment node
/**
 * server.js over stdio, as a client sees it: it starts, registers every tool
 * read-only, and a list_tasks call round-trips (synthetic folder).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writePage } from '../__fixtures__/app-side.js';

let root, client;
const ms = new Date(2026, 9, 15, 9, 0).getTime();

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-server-'));
  writePage(root, '388', '1', [{ id: `s${ms}`, startTime: ms, endTime: ms + 400, lineId: null, points: [[5, 5], [9, 6]] }], [
    { id: 'a', text: 'call supplier', indentLevel: 0, parentId: null, checked: false, marker: 'WAITING', yBounds: null }
  ]);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, '../server.js')],
    env: { ...process.env, SMARTPEN_DATA_ROOT: root },
    stderr: 'ignore'
  }));
}, 30_000);
afterAll(async () => {
  await client?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('stdio server', () => {
  it('registers every tool read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'days_summary', 'get_transcript', 'list_notebooks', 'list_pages', 'list_tags', 'list_tasks', 'render_days', 'render_page', 'search'
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });
  it('answers list_tasks', async () => {
    const res = await client.callTool({ name: 'list_tasks', arguments: { state: 'waiting' } });
    const [head, body] = res.content[0].text.split('\n');
    expect(head).toMatch(/^1 waiting task/);
    expect(JSON.parse(body)[0]).toMatchObject({ state: 'WAITING', text: 'call supplier', book: '388', page: '1' });
  });
});
