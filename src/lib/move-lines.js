/**
 * move-lines — reorder transcript lines as a group (v3.17.0). Pure; used by the
 * Library reader's Edit mode (TranscriptPane) and the Editor's Edit
 * Transcription dialog (TranscriptionEditorModal), which keep their selection
 * as ids and as indices respectively.
 *
 * A group of ticked lines moves together: one step up or down steps the whole
 * group past the next unticked line, and gaps between ticked lines stay as
 * they are (the lines that move are the ones next to an unticked line). Top /
 * Bottom gather the ticked lines, in page order, at the start or end. Text,
 * indent and task state never change; a moved line's parent is worked out again
 * from indents on save.
 *
 * The case it is for: ink transcribed later is appended at the end of a page's
 * transcript (3017/180's 11/6 meeting, written at the top), so the user ticks
 * those lines and moves them to where they are on the page.
 */

/** @param {Iterable<number>} sel @param {number} n @returns {number[]} sorted, in range, unique */
function indicesOf(sel, n) {
  return [...new Set(sel || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
}

/**
 * Move the lines at `selected` one step up (dir -1) or down (dir 1).
 * @template T
 * @param {T[]} lines
 * @param {Iterable<number>} selected
 * @param {-1|1} dir
 * @returns {{ lines: T[], selected: number[] } | null} null when nothing can move (the group is at that end)
 */
export function moveLines(lines, selected, dir) {
  const list = lines || [];
  const idx = indicesOf(selected, list.length);
  if (!idx.length || (dir !== -1 && dir !== 1)) return null;
  // The group stops at the end: moving up from line 0 would break its shape.
  if (dir === -1 ? idx[0] === 0 : idx[idx.length - 1] === list.length - 1) return null;
  // Nearest-first: each ticked line swaps with what is next to it by then, so
  // the unticked line passes the whole run and the group keeps its shape.
  const out = [...list];
  for (const i of dir === -1 ? idx : [...idx].reverse()) {
    [out[i], out[i + dir]] = [out[i + dir], out[i]];
  }
  return { lines: out, selected: idx.map((i) => i + dir) };
}

/**
 * Gather the lines at `selected`, in page order, at the top or the bottom.
 * @template T
 * @param {T[]} lines
 * @param {Iterable<number>} selected
 * @param {'top'|'bottom'} edge
 * @returns {{ lines: T[], selected: number[] } | null} null when they are there already
 */
export function moveLinesToEdge(lines, selected, edge) {
  const list = lines || [];
  const idx = indicesOf(selected, list.length);
  if (!idx.length) return null;
  const sel = new Set(idx);
  const picked = idx.map((i) => list[i]);
  const rest = list.filter((_, i) => !sel.has(i));
  const out = edge === 'top' ? [...picked, ...rest] : [...rest, ...picked];
  if (out.every((l, i) => l === list[i])) return null;
  const start = edge === 'top' ? 0 : rest.length;
  return { lines: out, selected: picked.map((_, k) => start + k) };
}
