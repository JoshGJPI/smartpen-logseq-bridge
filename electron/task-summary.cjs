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
 *   { id, text, checked, marker: 'WAITING'|'CANCELLED'|null, parentText: string|null,
 *     projectHint: string|null }
 * Scalar-small on purpose (text clipped); never strokes.
 */
'use strict';

const WAITING = 'WAITING';
const CANCELLED = 'CANCELLED';
const TASK_TEXT_MAX = 300;
const TASK_PARENT_MAX = 120;

// PROJECT_IN_TEXT_RE / findProjectNumbers() in src/lib/tags.js.
const PROJECT_IN_TEXT_RE = /(?<![\p{L}\p{N}])([Pp]\s?)?(\d{4})[-‐-―−](\d{3})(?!\d)/gu;

function projectsIn(text) {
  if (typeof text !== 'string' || !text) return [];
  return [...text.matchAll(PROJECT_IN_TEXT_RE)].map((m) => `${m[1] ? 'P' : ''}${m[2]}-${m[3]}`);
}

function clip(s, max) {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 'WAITING' beside checked:false, 'CANCELLED' beside checked:true, else null (markerOf in tasks.js). */
function markerOf(l) {
  if (l.checked === false && l.marker === WAITING) return WAITING;
  if (l.checked === true && l.marker === CANCELLED) return CANCELLED;
  return null;
}

function buildTaskSummary(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const byId = new Map();
  for (const l of lines) if (l && typeof l.id === 'string') byId.set(l.id, l);
  const out = [];
  const stack = [];
  let lastProject = null;
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const level = Math.max(0, Number(l.indentLevel) || 0);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const own = projectsIn(l.text);
    if ((l.checked === true || l.checked === false) && typeof l.id === 'string' && l.id) {
      const named = l.parentId != null ? byId.get(l.parentId) : null;
      let parent = named && named !== l && typeof named.text === 'string' && named.text.trim() ? named.text : null;
      if (!parent && stack.length) parent = stack[stack.length - 1].text;
      let hint = own[0] || (named && named !== l ? projectsIn(named.text).pop() : null) || null;
      for (let i = stack.length - 1; !hint && i >= 0; i--) hint = stack[i].project;
      out.push({
        id: l.id,
        text: clip(l.text, TASK_TEXT_MAX),
        checked: l.checked,
        marker: markerOf(l),
        parentText: parent ? clip(parent, TASK_PARENT_MAX) : null,
        projectHint: hint || lastProject
      });
    }
    if (own.length) lastProject = own[own.length - 1];
    if (typeof l.text === 'string' && l.text.trim()) stack.push({ level, text: l.text, project: own[own.length - 1] || null });
  }
  return out;
}

module.exports = { buildTaskSummary };
