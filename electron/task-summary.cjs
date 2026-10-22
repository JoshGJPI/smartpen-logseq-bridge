/**
 * Task summary for the metadata-only scan (v3.4.0), the main-process half.
 * Pure: no fs, no Electron.
 *
 * MIRRORS `buildTaskSummary()` in src/lib/tasks.js (main is CommonJS and can't
 * import the ESM module, the same reason buildTranscriptionText mirrors the
 * renderer). The two must agree: src/lib/__tests__/task-summary.test.js runs
 * both over one fixture. src/lib/tasks.js is the authority.
 *
 * One entry per transcript line with `checked` set:
 *   { id, text, checked, marker: 'WAITING'|null, parentText: string|null }
 * Scalar-small on purpose (text clipped); never strokes.
 */
'use strict';

const WAITING = 'WAITING';
const TASK_TEXT_MAX = 300;
const TASK_PARENT_MAX = 120;

function clip(s, max) {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function buildTaskSummary(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const byId = new Map();
  for (const l of lines) if (l && typeof l.id === 'string') byId.set(l.id, l);
  const out = [];
  const stack = [];
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const level = Math.max(0, Number(l.indentLevel) || 0);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if ((l.checked === true || l.checked === false) && typeof l.id === 'string' && l.id) {
      const named = l.parentId != null ? byId.get(l.parentId) : null;
      let parent = named && named !== l && typeof named.text === 'string' && named.text.trim() ? named.text : null;
      if (!parent && stack.length) parent = stack[stack.length - 1].text;
      out.push({
        id: l.id,
        text: clip(l.text, TASK_TEXT_MAX),
        checked: l.checked,
        marker: l.checked === false && l.marker === WAITING ? WAITING : null,
        parentText: parent ? clip(parent, TASK_PARENT_MAX) : null
      });
    }
    if (typeof l.text === 'string' && l.text.trim()) stack.push({ level, text: l.text });
  }
  return out;
}

module.exports = { buildTaskSummary };
