/**
 * delete-lines — deleting transcript lines by hand (v3.20.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md A.2), shared by the Editor's Edit
 * Transcription dialog (TranscriptionEditorModal) and Library Edit
 * (TranscriptPane). Pure: every function returns new arrays.
 *
 *   Delete line   the line goes; its children move up one level
 *   Delete block  the line and every line under it go
 *
 * Ticked lines are each deleted alone (Delete line). A line with children asks
 * which; deleting a task asks first and names it, because its state goes with
 * it. What happens to the deleted lines' ink is lib/deleted-ink.js.
 */

import { taskStateOf } from '$lib/tasks.js';

const level = (l) => Math.max(0, Number(l && l.indentLevel) || 0);

/** Index just past line i's block (i and every following deeper line). */
export function blockEnd(lines, i) {
  let j = i + 1;
  while (j < lines.length && level(lines[j]) > level(lines[i])) j++;
  return j;
}

/** Does line i have children (is the next line deeper)? */
export function hasChildren(lines, i) {
  return i >= 0 && i + 1 < (lines || []).length && level(lines[i + 1]) > level(lines[i]);
}

/** Valid, distinct indices of `lines`, ascending. */
function cleanIndices(lines, indices) {
  return [...new Set(indices || [])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < (lines || []).length)
    .sort((a, b) => a - b);
}

/**
 * The lines with those at `indices` deleted. Without `block`, each deleted
 * line's children (and theirs) move up one level per deleted ancestor; with
 * `block`, everything under a deleted line goes too.
 *
 * @template {{indentLevel?: number}} T
 * @param {T[]} lines
 * @param {number[]} indices
 * @param {{ block?: boolean }} [opts]
 * @returns {{ lines: T[], removed: T[], outdented: number[] }}
 *   `removed` in page order; `outdented`: indices into the new `lines` whose
 *   indent changed (the caller marks them edited)
 */
export function deleteLines(lines, indices, { block = false } = {}) {
  const src = lines || [];
  const del = new Set(cleanIndices(src, indices));
  if (block) {
    for (const i of [...del]) for (let j = i + 1; j < blockEnd(src, i); j++) del.add(j);
  }
  const out = [];
  const removed = [];
  const outdented = [];
  const stack = []; // ancestors of the current line: { level, deleted }
  src.forEach((l, i) => {
    const lv = level(l);
    while (stack.length && stack[stack.length - 1].level >= lv) stack.pop();
    const deletedAbove = stack.reduce((n, e) => n + (e.deleted ? 1 : 0), 0);
    stack.push({ level: lv, deleted: del.has(i) });
    if (del.has(i)) {
      removed.push(l);
      return;
    }
    if (deletedAbove > 0) {
      out.push({ ...l, indentLevel: Math.max(0, lv - deletedAbove) });
      outdented.push(out.length - 1);
    } else {
      out.push(l);
    }
  });
  return { lines: out, removed, outdented };
}

/** The texts of the task lines among `lines` (TODO, DONE, WAITING, CANCELLED). */
export function taskTexts(lines) {
  return (lines || []).filter((l) => l && taskStateOf(l)).map((l) => (l.text || '').trim());
}

const quote = (t) => `'${t.length > 60 ? t.slice(0, 57) + '…' : t}'`;

/**
 * The confirm naming the tasks a delete takes, or '' when there are none:
 * "Delete the task 'schedule coord. meeting w/ Tom'?" (same rule as Claude's
 * `task_ok`: a task's state goes with its line).
 * @param {string[]} texts
 */
export function taskConfirmText(texts) {
  const t = texts || [];
  if (t.length === 0) return '';
  if (t.length === 1) return `Delete the task ${quote(t[0])}?`;
  const shown = t.slice(0, 3).map(quote).join(', ');
  return `Delete ${t.length} tasks (${shown}${t.length > 3 ? ', …' : ''})?`;
}

/**
 * What to ask before deleting the lines at `indices` (ticked lines, else the
 * focused one), or null to delete straight away.
 *   - one line with children, unless `ticked`: Delete line or Delete block
 *     (`askBlock`), with the tasks each choice would take,
 *   - otherwise, only when tasks would go: a confirm naming them. Ticked
 *     lines are each deleted alone (their children move up a level).
 *
 * @param {Array<{text?: string, indentLevel?: number, checked?: boolean|null}>} lines
 * @param {number[]} indices
 * @param {{ ticked?: boolean }} [opts]  the indices are ticked lines
 * @returns {null | { indices: number[], askBlock: boolean, text: string, childCount: number,
 *   lineTasks: string[], blockTasks: string[] }}
 */
export function deletePrompt(lines, indices, { ticked = false } = {}) {
  const idx = cleanIndices(lines, indices);
  if (idx.length === 0) return null;
  const askBlock = !ticked && idx.length === 1 && hasChildren(lines, idx[0]);
  const lineTasks = taskTexts(idx.map((i) => lines[i]));
  const blockTasks = askBlock ? taskTexts(lines.slice(idx[0], blockEnd(lines, idx[0]))) : lineTasks;
  if (!askBlock && lineTasks.length === 0) return null;
  return {
    indices: idx,
    askBlock,
    text: idx.length === 1 ? (lines[idx[0]].text || '').trim() : `${idx.length} lines`,
    childCount: askBlock ? blockEnd(lines, idx[0]) - idx[0] - 1 : 0,
    lineTasks,
    blockTasks
  };
}
