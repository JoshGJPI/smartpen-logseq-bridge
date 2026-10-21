#!/usr/bin/env node
/**
 * Dev driver: start the server over stdio like a real client and call one tool.
 *
 *   node mcp/drive.mjs                              list the tools
 *   node mcp/drive.mjs <tool> '<json args>' [outDir]
 *
 * Uses SMARTPEN_DATA_ROOT (SMARTPEN_MCP_SERVER points at another server.js, to
 * compare builds). Text blocks print to stdout (images are summarised: size and
 * PNG dimensions); with outDir, image blocks are also written there as PNGs.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [tool, argJson = '{}', outDir] = process.argv.slice(2);
const server = process.env.SMARTPEN_MCP_SERVER || path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js');
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env }, stderr: 'ignore' });
const client = new Client({ name: 'drive', version: '0' });
await client.connect(transport);

if (!tool) {
  console.log((await client.listTools()).tools.map((t) => t.name).join('\n'));
} else {
  const t0 = Date.now();
  const res = await client.callTool({ name: tool, arguments: JSON.parse(argJson) });
  const ms = Date.now() - t0;
  let imgs = 0, bytes = 0, b64 = 0, textChars = 0;
  const dims = [];
  for (const c of res.content) {
    if (c.type === 'text') { textChars += c.text.length; console.log(c.text.length > 6000 ? c.text.slice(0, 6000) + '\n…[truncated]' : c.text); }
    else if (c.type === 'image') {
      imgs++;
      const buf = Buffer.from(c.data, 'base64');
      bytes += buf.length; b64 += c.data.length;
      dims.push(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}/${Math.round(buf.length / 1024)}KB`);
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${tool}-${imgs}.png`), buf);
      }
    }
  }
  console.log(`\n--- ${tool}: ${ms} ms, ${textChars} text chars, ${imgs} image(s) ${dims.join(' ')}; `
    + `${Math.round(bytes / 1024)} KB PNG (${Math.round(b64 / 1024)} KB base64)${res.isError ? ', ERROR' : ''}`);
}
await client.close();
