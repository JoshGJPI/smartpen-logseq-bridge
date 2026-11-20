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
 *     projectHint: string|null, heads: [{ id, text }] }   (heads: v3.23.0, nearest 3 ancestors, outermost first)
 * Scalar-small on purpose (text clipped); never strokes.
 *
 * Lines with a `kind` (v3.24.0, a sketch, spec E.4 / E.7) are skipped
 * altogether: never a task, never a head, and their label never gives a task a
 * project.
 *
 * Also the scan's sketch summary and a line's scan text (v3.24.0), MIRRORING
 * `buildSketchSummary()` / `lineScanText()` in src/lib/line-kinds.js.
 */
'use strict';

const WAITING = 'WAITING';
const CANCELLED = 'CANCELLED';
const TASK_TEXT_MAX = 300;
const TASK_PARENT_MAX = 120;
const TASK_HEADS_MAX = 3;
const TASK_HEAD_MAX = 80;

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
    if (!l || typeof l !== 'object' || isKindLine(l)) continue;
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
        projectHint: hint || lastProject,
        heads: stack.slice(-TASK_HEADS_MAX).map((h) => ({ id: h.id, text: clip(h.text, TASK_HEAD_MAX) }))
      });
    }
    if (own.length) lastProject = own[own.length - 1];
    if (typeof l.text === 'string' && l.text.trim()) stack.push({ level, id: typeof l.id === 'string' && l.id ? l.id : null, text: l.text, project: own[own.length - 1] || null });
  }
  return out;
}

const SKETCH = 'sketch';
const SKETCH_DEFAULT_LABEL = 'Sketch';
const SKETCH_SUMMARY_MAX = 20;
const SKETCH_LABEL_MAX = 80;

function isKindLine(l) {
  return !!(l && typeof l === 'object' && typeof l.kind === 'string' && l.kind);
}

function sketchLabel(raw) {
  const t = typeof raw === 'string' ? raw.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  return t || SKETCH_DEFAULT_LABEL;
}

/** A line as `transcriptionText` writes it: `[sketch] label`, `[kind] text`, or the text (line-kinds.js lineScanText). */
function lineScanText(l) {
  const text = String((l && l.text) || '').replace(/^ +/, '');
  if (!isKindLine(l)) return text;
  return `[${l.kind}] ${l.kind === SKETCH ? sketchLabel(text) : text}`;
}

/** The scan's `sketches`: `[{ id, label, lineIndex }]`, at most 20 (line-kinds.js buildSketchSummary). */
function buildSketchSummary(lines) {
  const out = [];
  if (!Array.isArray(lines)) return out;
  for (let i = 0; i < lines.length && out.length < SKETCH_SUMMARY_MAX; i++) {
    const l = lines[i];
    if (!isKindLine(l) || l.kind !== SKETCH || typeof l.id !== 'string' || !l.id) continue;
    const label = sketchLabel(l.text);
    out.push({ id: l.id, label: label.length > SKETCH_LABEL_MAX ? `${label.slice(0, SKETCH_LABEL_MAX - 1)}…` : label, lineIndex: i });
  }
  return out;
}

module.exports = { buildTaskSummary, buildSketchSummary, lineScanText };
