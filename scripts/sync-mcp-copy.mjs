#!/usr/bin/env node
/**
 * Keep the MCP server's own checkout on `main`.
 *
 * The read-only MCP server (mcp/) runs from a second git worktree of this repo,
 * `../smartpen-mcp` by default (SMARTPEN_MCP_DIR overrides), detached at `main`
 * with its own node_modules. Branch switches, reinstalls and half-finished work
 * in the development checkout then never reach the server or lock its files.
 *
 *   npm run mcp:sync            move the copy to the current `main` now
 *   node scripts/sync-mcp-copy.mjs --hook
 *                               the same, from the post-merge / post-rewrite git
 *                               hooks: only when the checkout running it is on
 *                               `main` and is not the copy itself
 *
 * It reinstalls the copy's packages (`npm ci --ignore-scripts`) only when
 * package.json or package-lock.json changed. While Claude Code runs the server,
 * Windows keeps a native module in the copy open; then the copy is left as it
 * was (still working) with a note to quit Claude Code and run
 * `npm run mcp:sync`. It never fails a merge: every path exits 0. The server
 * picks up new code when Claude Code next starts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hook = process.argv.includes('--hook');
const say = (msg) => console.log(`[mcp-sync] ${msg}`);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function main() {
  const here = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const copy = process.env.SMARTPEN_MCP_DIR || path.resolve(here, '..', 'smartpen-mcp');

  if (same(here, copy)) return; // the hooks are shared by every worktree, including the copy
  if (hook && git(here, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'main') return;

  if (!fs.existsSync(path.join(copy, '.git'))) {
    say(`no MCP copy at ${copy}; create it with: git worktree add --detach "${copy}" main`);
    return;
  }
  if (git(copy, 'status', '--porcelain')) {
    say(`${copy} has local changes; left as is. Commit or discard them there, then run npm run mcp:sync.`);
    return;
  }

  const before = git(copy, 'rev-parse', 'HEAD');
  const target = git(here, 'rev-parse', 'main');
  if (before === target) return;

  const depsChanged = git(here, 'diff', '--name-only', before, target, '--', 'package.json', 'package-lock.json') !== '';
  if (depsChanged) {
    // `npm ci` deletes node_modules before it installs, so a locked file makes it fail with most packages already
    // gone. Check first and leave the copy untouched (still working, on its old commit) when anything is locked.
    const locked = lockedNativeFile(path.join(copy, 'node_modules'));
    if (locked) {
      say(`packages changed, but ${path.relative(copy, locked)} is in use (Claude Code is running the server).`);
      say('Left the copy as it was. Quit Claude Code, then run: npm run mcp:sync');
      return;
    }
  }

  git(copy, 'checkout', '--quiet', '--detach', target);
  if (depsChanged) {
    try {
      say('packages changed; reinstalling in the copy…');
      execFileSync('npm', ['ci', '--ignore-scripts'], { cwd: copy, stdio: 'inherit', shell: true });
    } catch {
      say('reinstall failed. Quit Claude Code (and anything else running from the copy), then run: npm run mcp:sync');
      git(copy, 'checkout', '--quiet', '--detach', before); // so the next run retries the reinstall
      return;
    }
  }
  say(`MCP copy moved to ${target.slice(0, 7)}; restart Claude Code to load it.`);
}

/**
 * The first native module (`*.node`) under dir that a running process holds open, else null. Windows lets a loaded
 * module be renamed but not opened for writing (EBUSY), so opening each one read-write and closing it unchanged is
 * the test.
 */
function lockedNativeFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.node')) {
        try {
          fs.closeSync(fs.openSync(p, 'r+'));
        } catch (err) {
          if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') return p;
        }
      }
    }
  }
  return null;
}

try {
  main();
} catch (err) {
  say(`skipped: ${err.message.split('\n')[0]}`);
}
