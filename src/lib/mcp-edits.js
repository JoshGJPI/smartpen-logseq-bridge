/**
 * mcp-edits — the transcript edits Claude makes through the running app
 * (v3.18.0, docs/MCP-WRITE-SPEC.md). Pure: no stores, no IO.
 *
 * Claude addresses lines by their stored number (`#n`, 1-based, as
 * `check_transcript` and `get_transcript` print them) plus the text expected
 * there (a task's own label in front, as get_transcript prints it, is allowed). Every number refers to the transcript BEFORE the call: `planEdits()`
 * resolves each one to a line id first (checking `expect`), then applies the
 * operations in order by id, so an insert or a move earlier in the list never
 * shifts the line a later op means. A call is all-or-nothing: any error and
 * nothing is returned but the error.
 *
 *   set_text    { line, expect, text }              new wording, one line, non-empty
 *   set_indent  { line, expect, level, with_children = true }
 *   move        { lines: [n…], expect_first, to: 'top' | 'bottom' | { after: n } }
 *   insert      { after, expect?, level, text }      after: 0 = first line
 *   delete      { line, expect, task_ok? }           children kept, outdented one level
 *
 * Sketch lines (v3.24.0, any `kind`): a sketch may be renamed (set_text on its
 * label) and moved or indented; it is never deleted or inserted by an edit (it
 * stands for ink), never made a task, and another kind's text is never edited.
 *
 * What never changes: task state (a typed box in front of a PLAIN line's new
 * text makes it a task, as Library Edit does; on a task line it stays text),
 * ink links (an inserted line has none; a deleted line's strokes are unlinked
 * by the save's scrub), and every line no op touched (`untouchedChanged()`
 * checks it field by field before anything is saved).
 */
import { taskStateOf, stateLabel, markerOf } from './tasks.js';
import { parseTaskMarker } from './task-markers.js';
import { isKindLine, isSketchLine, lineScanText } from './line-kinds.js';

export const MAX_OPS = 60;
export const MAX_LEVEL = 8;
export const OPS = ['set_text', 'set_indent', 'move', 'insert', 'delete'];

/** A leading word that would read as a state the app sets only by hand. */
const STATE_WORD = /^(WAITING|CANCELLED|CANCELED|DOING|NOW|LATER)(?=$|[\s:])/;

/** The fields a line is compared on (parentId is re-derived from indents on save). */
const LINE_FIELDS = ['id', 'text', 'indentLevel', 'checked', 'marker', 'yBounds', 'kind'];

const levelOf = (l) => Math.max(0, l.indentLevel || 0);

function fail(msg) {
  const e = new Error(msg);
  e.mcpEdit = true;
  throw e;
}

/** Text for a line: one line, trimmed, non-empty, no state word in front. */
function cleanText(raw, where) {
  if (typeof raw !== 'string') fail(`${where}: text must be a string`);
  const text = raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!text) fail(`${where}: text is empty (use delete to remove a line)`);
  if (STATE_WORD.test(text)) {
    fail(`${where}: text starts with "${text.match(STATE_WORD)[1]}"; task states are set in the app, not by edits`);
  }
  return text;
}

function cleanLevel(raw, where) {
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_LEVEL) fail(`${where}: level must be a whole number 0–${MAX_LEVEL}`);
  return raw;
}

/** `#n` (1-based, original transcript) → line, checking the expected text. */
function lineAt(original, n, expect, where, { needExpect = true } = {}) {
  if (!Number.isInteger(n) || n < 1 || n > original.length) {
    fail(`${where}: there is no line #${n} (the transcript has ${original.length})`);
  }
  const line = original[n - 1];
  if (expect == null) {
    if (needExpect) fail(`${where}: expect (the text now on #${n}) is required`);
  } else if (typeof expect !== 'string' || withoutOwnLabel(line, withoutKindLabel(line, expect)).trim() !== (line.text || '').trim()) {
    fail(`${where}: #${n} reads "${line.text}", not "${expect}"; the transcript changed, read it again`);
  }
  return line;
}

/**
 * `raw` without a leading state label that matches the line's own state
 * ("TODO call Brad" on a TODO line → "call Brad"). get_transcript prints tasks
 * with their label in front, so text copied from it would otherwise compare
 * unequal (expect) or keep the label as text (set_text). Any other leading word
 * is left alone: this never changes, or implies, a state.
 */
function withoutOwnLabel(line, raw) {
  const state = taskStateOf(line);
  if (!state || typeof raw !== 'string') return raw;
  const m = new RegExp(`^\\s*${stateLabel(state)}\\s+`).exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

/**
 * `raw` without the `[sketch] ` in front and the ` (412 strokes)` after it, on a
 * kind line (v3.24.0): get_transcript prints a sketch that way, so text copied
 * from it compares equal to the label.
 */
function withoutKindLabel(line, raw) {
  if (!isKindLine(line) || typeof raw !== 'string') return raw;
  return raw.replace(new RegExp(`^\\s*\\[${line.kind}\\]\\s*`), '').replace(/\s*\(\d+ strokes?\)\s*$/, '');
}

/**
 * The subtree under the line at index `i` of `list`: the lines after it that
 * are deeper, up to the first that isn't.
 */
function subtreeEnd(list, i) {
  const lvl = levelOf(list[i]);
  let j = i + 1;
  while (j < list.length && levelOf(list[j]) > lvl) j++;
  return j;
}

/**
 * Resolve and apply edits to a page's transcript lines.
 *
 * @param {Array<object>} original  transcript.lines as stored (not mutated)
 * @param {Array<object>} edits
 * @param {{ newId: () => string }} opts
 * @returns {{ ok: true, lines: object[], marks: Map<string, string>, deleted: Array<{n: number, line: object}>,
 *             counts: { changed: number, inserted: number, deleted: number, moved: number }, touched: Set<string> }
 *          | { ok: false, error: string }}
 */
export function planEdits(original, edits, { newId }) {
  try {
    return { ok: true, ...plan(original || [], edits, newId) };
  } catch (e) {
    if (e && e.mcpEdit) return { ok: false, error: e.message };
    throw e;
  }
}

function plan(original, edits, newId) {
  if (!Array.isArray(edits) || !edits.length) fail('No edits given');
  if (edits.length > MAX_OPS) fail(`${edits.length} edits in one call; at most ${MAX_OPS}`);
  if (!original.length) fail('The page has no transcript to edit');

  // 1. Resolve every #n against the transcript as it was.
  const resolved = edits.map((e, k) => {
    const op = e && e.op;
    const where = `edit ${k + 1} (${op || '?'})`;
    if (!OPS.includes(op)) fail(`${where}: unknown op; use one of ${OPS.join(', ')}`);
    switch (op) {
      case 'set_text': {
        const line = lineAt(original, e.line, e.expect, where);
        // A sketch's label may be renamed (v3.24.0); another kind is not text to edit (E.7).
        if (isKindLine(line) && !isSketchLine(line)) fail(`${where}: #${e.line} is a ${line.kind} line, not text; it can be moved, not edited`);
        return { op, where, id: line.id, kind: isKindLine(line), text: cleanText(withoutOwnLabel(line, withoutKindLabel(line, e.text)), where) };
      }
      case 'set_indent':
        return {
          op, where, id: lineAt(original, e.line, e.expect, where).id, level: cleanLevel(e.level, where),
          withChildren: e.with_children !== false
        };
      case 'move': {
        const ns = e.lines;
        if (!Array.isArray(ns) || !ns.length) fail(`${where}: lines must list the line numbers to move`);
        if (new Set(ns).size !== ns.length) fail(`${where}: a line is listed twice`);
        const ids = ns.map((n, i) => lineAt(original, n, i === 0 ? e.expect_first ?? e.expect : null, where,
          { needExpect: i === 0 }).id);
        let to;
        if (e.to === 'top' || e.to === 'bottom') to = e.to;
        else if (e.to && typeof e.to === 'object' && 'after' in e.to) {
          const after = lineAt(original, e.to.after, e.to.expect, where, { needExpect: false });
          if (ids.includes(after.id)) fail(`${where}: cannot move lines after #${e.to.after}, which is one of them`);
          to = { after: after.id };
        } else fail(`${where}: to must be "top", "bottom" or { "after": n }`);
        return { op, where, ids, to };
      }
      case 'insert': {
        if (!Number.isInteger(e.after) || e.after < 0) fail(`${where}: after must be a line number, or 0 for the first line`);
        const after = e.after === 0 ? null : lineAt(original, e.after, e.expect, where).id;
        return { op, where, after, level: cleanLevel(e.level, where), text: cleanText(e.text, where) };
      }
      case 'delete': {
        const line = lineAt(original, e.line, e.expect, where);
        // A sketch line stands for ink: only Josh removes one, in the app (v3.24.0).
        if (isKindLine(line)) fail(`${where}: #${e.line} is a ${line.kind} line (it stands for ink); remove it in the app, not by an edit`);
        if (taskStateOf(line) && e.task_ok !== true) {
          fail(`${where}: #${e.line} is a ${stateLabel(taskStateOf(line))} task; pass task_ok: true to delete it`);
        }
        return { op, where, id: line.id, n: e.line };
      }
    }
  });

  // 2. Apply in order. `list` holds the original objects until a line changes.
  let list = [...original];
  const touched = new Set();      // lines whose content or position an op changed
  const changed = new Set();      // text or indent changed (~)
  const moved = new Set();        // ↕
  const inserted = new Set();     // +
  const deleted = [];
  const nOf = new Map(original.map((l, i) => [l.id, i + 1]));

  const indexOf = (id, where) => {
    const i = list.findIndex((l) => l.id === id);
    if (i < 0) fail(`${where}: #${nOf.get(id)} was deleted by an earlier edit in this call`);
    return i;
  };
  const replace = (i, patch) => {
    list[i] = { ...list[i], ...patch };
    touched.add(list[i].id);
  };

  for (const r of resolved) {
    if (r.op === 'set_text') {
      const i = indexOf(r.id, r.where);
      const line = list[i];
      let patch = { text: r.text };
      // A box typed in front of a plain line makes it a task (as Library Edit's
      // save does); on a task line the text is just text.
      if (taskStateOf(line) == null && !r.kind) {
        const parsed = parseTaskMarker(r.text);
        if (parsed.checked != null) patch = { text: cleanText(parsed.text, r.where), checked: parsed.checked };
      }
      if (patch.text !== line.text || 'checked' in patch) changed.add(r.id);
      replace(i, patch);
    } else if (r.op === 'set_indent') {
      const i = indexOf(r.id, r.where);
      const delta = r.level - levelOf(list[i]);
      if (!delta) continue;
      const end = r.withChildren ? subtreeEnd(list, i) : i + 1;
      for (let j = i; j < end; j++) {
        const lvl = levelOf(list[j]) + delta;
        if (lvl > MAX_LEVEL) fail(`${r.where}: #${nOf.get(list[j].id) ?? 'new'} would go past level ${MAX_LEVEL}`);
        replace(j, { indentLevel: lvl });
        changed.add(list[j].id);
      }
    } else if (r.op === 'move') {
      const picked = r.ids.map((id) => list[indexOf(id, r.where)]);
      const set = new Set(r.ids);
      const rest = list.filter((l) => !set.has(l.id));
      let at;
      if (r.to === 'top') at = 0;
      else if (r.to === 'bottom') at = rest.length;
      else {
        const a = rest.findIndex((l) => l.id === r.to.after);
        if (a < 0) fail(`${r.where}: #${nOf.get(r.to.after)} was deleted by an earlier edit in this call`);
        at = a + 1;
      }
      list = [...rest.slice(0, at), ...picked, ...rest.slice(at)];
      for (const id of r.ids) {
        touched.add(id);
        moved.add(id);
      }
    } else if (r.op === 'insert') {
      const at = r.after == null ? 0 : indexOf(r.after, r.where) + 1;
      const parsed = parseTaskMarker(r.text);
      const text = parsed.checked == null ? r.text : cleanText(parsed.text, r.where);
      const line = { id: newId(), text, indentLevel: r.level, parentId: null, checked: parsed.checked, yBounds: null };
      list.splice(at, 0, line);
      touched.add(line.id);
      inserted.add(line.id);
    } else if (r.op === 'delete') {
      const i = indexOf(r.id, r.where);
      const end = subtreeEnd(list, i);
      for (let j = i + 1; j < end; j++) {
        replace(j, { indentLevel: levelOf(list[j]) - 1 });
        changed.add(list[j].id);
      }
      deleted.push({ n: r.n, line: original[r.n - 1] });
      list.splice(i, 1);
      touched.add(r.id);
      changed.delete(r.id);
      moved.delete(r.id);
    }
  }

  // 3. A line sits at most one level under the line above it (Library Edit's Tab
  // rule); the first line at level 0.
  // Checked where something changed: the line itself, or the line above it
  // (a different one, or one whose indent changed), so a line left behind by a
  // move or an outdent is caught too. Lines nothing changed near keep whatever
  // nesting MyScript gave them.
  const prevWas = new Map(original.map((l, i) => [l.id, i ? original[i - 1].id : null]));
  for (let i = 0; i < list.length; i++) {
    const id = list[i].id;
    const prev = i ? list[i - 1].id : null;
    const near = touched.has(id) || prevWas.get(id) !== prev || (prev != null && touched.has(prev));
    if (!near) continue;
    const max = i === 0 ? 0 : levelOf(list[i - 1]) + 1;
    if (levelOf(list[i]) > max) {
      const name = inserted.has(list[i].id) ? `the inserted line "${list[i].text}"` : `#${nOf.get(list[i].id)}`;
      fail(`After these edits ${name} would be at level ${levelOf(list[i])}, more than one deeper than the line above it `
        + `(level ${i ? levelOf(list[i - 1]) : '–'}); add a set_indent`);
    }
  }

  const marks = new Map();
  for (const l of list) {
    const m = (inserted.has(l.id) ? '+' : '') + (changed.has(l.id) ? '~' : '') + (moved.has(l.id) ? '↕' : '');
    if (m) marks.set(l.id, m);
  }
  return {
    lines: list,
    marks,
    deleted,
    touched,
    counts: { changed: [...changed].filter((id) => !inserted.has(id)).length, inserted: inserted.size, deleted: deleted.length, moved: moved.size },
  };
}

/**
 * One line's comparable fields, as a string, read the way the save normalises
 * them (save-transcript.js normaliseLine), so a stray field the save drops
 * isn't mistaken for a change.
 */
function fingerprint(l) {
  const read = {
    id: l.id,
    text: typeof l.text === 'string' ? l.text : '',
    indentLevel: levelOf(l),
    checked: l.checked === true || l.checked === false ? l.checked : null,
    marker: markerOf(l),
    yBounds: l.yBounds ?? null,
    kind: isKindLine(l) ? l.kind : null,
  };
  return JSON.stringify(LINE_FIELDS.map((k) => read[k]));
}

/**
 * Lines no op touched that differ from the original anywhere but parentId
 * (empty when all is well). Run on the planned lines and again on the lines as
 * saved, so a bug in an op can't spread to the rest of the page.
 * @param {object[]} before  original lines
 * @param {object[]} after
 * @param {Set<string>} touched
 * @returns {string[]} ids
 */
export function untouchedChanged(before, after, touched) {
  const now = new Map((after || []).map((l) => [l.id, l]));
  return (before || [])
    .filter((l) => !touched.has(l.id))
    .filter((l) => !now.has(l.id) || fingerprint(now.get(l.id)) !== fingerprint(l))
    .map((l) => l.id);
}

/**
 * The transcript after the edits, as `get_transcript` prints it, numbered as it
 * will be stored and marked: `~` changed, `+` inserted, `↕` moved; deleted lines
 * listed after it with their old numbers.
 * @param {{ lines: object[], marks: Map<string, string>, deleted: Array<{n: number, line: object}> }} plan
 * @returns {string}
 */
export function formatEditListing({ lines, marks, deleted }) {
  const bullet = (l) => {
    const state = taskStateOf(l);
    if (isKindLine(l)) return `${'  '.repeat(levelOf(l))}- ${lineScanText(l)}`;
    return `${'  '.repeat(levelOf(l))}- ${state ? `${stateLabel(state)} ` : ''}${l.text}`;
  };
  const out = lines.map((l, i) => `${(marks.get(l.id) || '').padEnd(3)}#${String(i + 1).padEnd(3)} ${bullet(l)}`);
  if (deleted.length) {
    out.push('', 'Deleted:');
    for (const d of deleted) out.push(`-  was #${d.n}  ${bullet(d.line)}`);
  }
  return out.join('\n');
}

/** "4 lines: 2 changed, 1 inserted, 1 deleted" */
export function describeCounts({ changed, inserted, deleted, moved }) {
  const parts = [[changed, 'changed'], [inserted, 'inserted'], [moved, 'moved'], [deleted, 'deleted']]
    .filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
  return parts.length ? parts.join(', ') : 'no change';
}

/**
 * Two data-folder paths the same folder? Case, slash direction and a trailing
 * slash ignored (Windows paths; the MCP and the app may spell one differently).
 */
export function sameFolder(a, b) {
  const norm = (p) => String(p || '').trim().replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * Why the app refuses to edit this page now, or null. Pure: the caller passes
 * what the stores say. Checked for dry runs too, so a refusal shows up before
 * Claude asks to apply.
 *
 * @param {{ appRoot: string, folderReady: boolean, requestRoot: string, label: string,
 *           editorOpen: boolean, draft: boolean, pendingTranscription: boolean, reset: boolean }} s
 * @returns {string|null}
 */
export function editRefusal(s) {
  if (!s.folderReady || !s.appRoot) return 'The app has no data folder set (Settings → Data folder)';
  if (!sameFolder(s.appRoot, s.requestRoot)) {
    return `The app's data folder is ${s.appRoot}, but the MCP reads ${s.requestRoot}; point both at the same folder`;
  }
  if (s.draft) return `${s.label} has unsaved transcript edits in the Library. Ask Josh to save or cancel them first`;
  if (s.editorOpen) return `${s.label} is open in a transcript editor in the app. Ask Josh to close it first`;
  if (s.reset) return `${s.label} is reset for re-transcription in the Editor; transcribe and save it (or undo the reset) first`;
  if (s.pendingTranscription) {
    return `${s.label} has an unsaved transcription in the Editor; save or discard it first (its save would merge into the transcript)`;
  }
  return null;
}
