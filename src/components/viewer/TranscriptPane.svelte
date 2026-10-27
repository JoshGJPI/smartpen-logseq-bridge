<!--
  TranscriptPane.svelte — view / edit / copy a page's transcript in the Library reader.

  Display mode: TranscriptLines (indented lines, TODO/DONE/WAITING markers,
                clickable with `tasks` (v3.4.0), the empty state, and in Ink +
                text the line → ink hover).
  Edit mode:    inline structured editor — edit text, Tab/Shift+Tab to
                indent/outdent, Enter adds a line below, Backspace on an empty
                line deletes it, Merge (Ctrl+J) joins the ticked lines (or the
                focused line and the next) into the first, for prose written
                across several lines (lib/editor-lines.js mergeTranscriptLines;
                the merged-away lines' strokes follow on save). Long lines wrap
                (TranscriptEditRow). Task state isn't edited here: typing `TODO`,
                `[ ]` or ☐ (`DONE`, `[x]`, ☑) in front of a plain line makes it a
                task on save (save-transcript.js parseTypedTasks); a task's own
                state is kept (keepDiskTaskState). Ticks, WAITING, CANCELLED,
                Not a task and Make task are display mode's ⋯ menu.
  Copy all:     the whole transcript; each top- and second-level line also has
                its own copy (that line and everything under it, subtreeLines).
                Both as LogSeq-pasteable markdown (tab indents, - TODO/- DONE, properties
                stripped) → clipboard.

  Edits persist to the PageDoc on disk via saveTranscriptLines(); dirty state is
  tracked per page in the viewer store (separate from the canvas unsaved flag).
-->
<script>
  import { tick, onDestroy } from 'svelte';
  import { log, markViewerDirtyPage, clearViewerDirtyPage, viewerDirtyPages } from '$stores';
  import { linesToLogseqMarkdown, subtreeLines } from '$lib/viewer/transcript-markdown.js';
  import { saveTranscriptLines } from '$lib/viewer/save-transcript.js';
  import { markerField } from '$lib/tasks.js';
  import { mergeTranscriptLines } from '$lib/editor-lines.js';
  import TranscriptLines from '../transcription/TranscriptLines.svelte';
  import TranscriptEditRow from './TranscriptEditRow.svelte';

  /** @type {Array<{id:string,text:string,indentLevel:number,checked:boolean|null}>} */
  export let lines = [];
  export let book;
  export let page;
  /** `${book}:${page}` — used for dirty tracking */
  export let pageKey;
  /** (book, page, lines) => void — lets the parent update the store after save */
  export let onSaved = () => {};
  /** (editing:boolean) => void — lets the reader show this page's strokes alongside while editing */
  export let onEditingChange = () => {};
  /** Ink + text, trusted page: (line|null) => void. Passed on to TranscriptLines. */
  export let onHoverLine = null;
  /** Ink + text, untrusted page: why lines aren't linked. */
  export let linkNote = '';
  /** Empty state's "Transcribe in Editor"; null hides it. */
  export let onTranscribe = null;
  /** A global search hit's line (trusted pages only), passed to TranscriptLines. */
  export let focusLineId = null;
  /** Task markers are clickable (v3.4.0): ticks write the PageDoc at once. */
  export let tasks = false;

  // A draft on this page would write the old state back over a tick.
  $: taskLock = $viewerDirtyPages.has(pageKey) ? 'This page has unsaved transcript edits. Save or cancel them first.' : '';

  let editing = false;
  let saving = false;
  let dirty = false;
  /** @type {Array<TranscriptEditRow>} */
  let inputEls = [];
  /** ids of the lines ticked for Merge */
  let selectedIds = new Set();
  /** working copy while editing */
  let draft = [];
  /** the lines Edit opened on (task state on save: keepDiskTaskState) */
  let base = [];
  /** index of the line whose input currently has focus (-1 = none selected) */
  let activeIndex = -1;

  function makeLineId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blankLine(indentLevel = 0) {
    return { id: makeLineId(), text: '', indentLevel, parentId: null, checked: null, yBounds: null };
  }

  function cloneLines(src) {
    return (src || []).map((l) => ({
      id: l.id || makeLineId(),
      text: l.text || '',
      indentLevel: Math.max(0, l.indentLevel || 0),
      parentId: l.parentId ?? null,
      checked: l.checked === true || l.checked === false ? l.checked : null,
      ...markerField(l),
      yBounds: l.yBounds ?? null,
    }));
  }

  function setDirty(v) {
    dirty = v;
    if (v) markViewerDirtyPage(pageKey);
    else clearViewerDirtyPage(pageKey);
  }

  function startEdit() {
    draft = cloneLines(lines);
    base = cloneLines(lines);
    if (draft.length === 0) draft = [blankLine()];
    editing = true;
    activeIndex = -1;
    selectedIds = new Set();
    setDirty(false);
    onEditingChange(true);
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your transcript edits?')) return;
    editing = false;
    draft = [];
    activeIndex = -1;
    setDirty(false);
    onEditingChange(false);
  }

  async function save() {
    saving = true;
    try {
      const result = await saveTranscriptLines(book, page, draft, { base });
      if (!result || result.success === false) {
        throw new Error((result && result.error) || 'save failed');
      }
      // As written: a task change made since Edit opened is kept, not the draft's copy.
      const saved = cloneLines(result.lines || draft);
      editing = false;
      setDirty(false);
      onEditingChange(false);
      onSaved(book, page, saved);
      const count = saved.filter((l) => l.text.trim() !== '').length;
      log(`Saved transcript B${book}/P${page} (${count} line${count === 1 ? '' : 's'})`, 'success');
    } catch (e) {
      log(`Transcript save failed: ${e.message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function writeClipboard(md, what) {
    if (!md) {
      log('Nothing to copy — transcript is empty', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      log(`Copied ${what} to clipboard (LogSeq format)`, 'success');
    } catch {
      log('Failed to copy to clipboard', 'error');
    }
  }

  function copy() {
    writeClipboard(linesToLogseqMarkdown(editing ? draft : lines), `transcript B${book}/P${page}`);
  }

  // One node and its children, e.g. a meeting's notes at the foot of a page.
  function copyBranch(i) {
    const branch = subtreeLines(lines, i);
    const n = branch.filter((l) => (l.text || '').trim() !== '').length;
    writeClipboard(linesToLogseqMarkdown(branch), `"${(lines[i].text || '').trim()}" (${n} line${n === 1 ? '' : 's'}) from B${book}/P${page}`);
  }

  /* ---- edit operations ---- */
  function indentLine(i) {
    const max = i > 0 ? (draft[i - 1].indentLevel || 0) + 1 : 0;
    if ((draft[i].indentLevel || 0) < max) {
      draft[i].indentLevel = (draft[i].indentLevel || 0) + 1;
      draft = draft;
      setDirty(true);
    }
  }
  function outdentLine(i) {
    if ((draft[i].indentLevel || 0) > 0) {
      draft[i].indentLevel = (draft[i].indentLevel || 0) - 1;
      draft = draft;
      setDirty(true);
    }
  }
  async function moveLineUp(i) {
    if (i <= 0) return;
    [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[i - 1]?.focus();
  }
  async function moveLineDown(i) {
    if (i >= draft.length - 1) return;
    [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]];
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[i + 1]?.focus();
  }
  async function addLineBelow(i) {
    const lvl = i >= 0 ? draft[i].indentLevel || 0 : 0;
    draft.splice(i + 1, 0, blankLine(lvl));
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[i + 1]?.focus();
  }
  // Toolbar "Add": if a block is selected, add a sibling after it (and its
  // whole subtree, so children aren't orphaned); otherwise append to the end.
  async function addBlock() {
    let insertAt, lvl;
    if (activeIndex < 0 || activeIndex >= draft.length) {
      insertAt = draft.length;
      lvl = 0;
    } else {
      lvl = draft[activeIndex].indentLevel || 0;
      let j = activeIndex + 1;
      while (j < draft.length && (draft[j].indentLevel || 0) > lvl) j++;
      insertAt = j;
    }
    draft.splice(insertAt, 0, blankLine(lvl));
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[insertAt]?.focus();
  }
  async function deleteLine(i) {
    if (selectedIds.has(draft[i]?.id)) toggleSelect(draft[i].id);
    draft.splice(i, 1);
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[Math.max(0, i - 1)]?.focus();
  }
  function toggleSelect(id) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedIds = next;
  }
  // Ticked lines (two or more), else the focused line and the one after it.
  // The merged line keeps the first line's id and indent (mergeTranscriptLines).
  async function merge() {
    const indices = selectedIds.size >= 2
      ? draft.map((l, i) => (selectedIds.has(l.id) ? i : -1)).filter((i) => i >= 0)
      : activeIndex >= 0 && activeIndex < draft.length - 1 ? [activeIndex, activeIndex + 1] : [];
    if (indices.length < 2) return;
    draft = mergeTranscriptLines(draft, indices);
    selectedIds = new Set();
    setDirty(true);
    await tick();
    inputEls[indices[0]]?.focus();
  }
  $: canMerge = selectedIds.size >= 2 || (activeIndex >= 0 && activeIndex < draft.length - 1);

  function onKey(e, i) {
    if ((e.key === 'j' || e.key === 'J') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      merge();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      e.key === 'ArrowUp' ? moveLineUp(i) : moveLineDown(i);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? outdentLine(i) : indentLine(i);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addLineBelow(i);
    } else if (e.key === 'Backspace' && draft[i].text === '' && draft.length > 1) {
      e.preventDefault();
      deleteLine(i);
    }
  }

  $: hasContent = lines.some((l) => (l.text || '').trim() !== '');

  // If this pane is torn down while still editing (e.g. the spread is
  // reconfigured), let Book View drop the paired strokes view.
  onDestroy(() => {
    if (editing) onEditingChange(false);
  });
</script>

<div class="transcript-pane">
  <div class="tp-toolbar">
    <span class="tp-title">Transcript</span>
    <div class="tp-actions">
      {#if editing}
        <button
          class="tp-btn"
          on:mousedown|preventDefault
          on:click={addBlock}
          title="Add a sibling block after the selected line, or append to the end"
        >＋ Add</button>
        <button
          class="tp-btn danger"
          on:mousedown|preventDefault
          on:click={() => deleteLine(activeIndex)}
          disabled={activeIndex < 0 || draft.length <= 1}
          title="Delete the selected block"
        >🗑 Delete</button>
        <button
          class="tp-btn"
          on:mousedown|preventDefault
          on:click={merge}
          disabled={!canMerge}
          title={selectedIds.size >= 2 ? 'Join the ticked lines into one, in the first one\'s place (Ctrl+J)' : 'Join the selected line with the next one, or tick lines to join (Ctrl+J)'}
        >Merge{selectedIds.size >= 2 ? ` (${selectedIds.size})` : ''}</button>
        <span class="tp-toolbar-divider"></span>
        <button class="tp-btn" on:click={copy} title="Copy the whole transcript as LogSeq markdown">Copy all</button>
        <button class="tp-btn primary" on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button class="tp-btn muted" on:click={cancel} disabled={saving}>Cancel</button>
      {:else}
        <button class="tp-btn" on:click={copy} disabled={!hasContent} title="Copy the whole transcript as LogSeq markdown">Copy all</button>
        <button class="tp-btn" on:click={startEdit} title="Edit transcript">Edit</button>
      {/if}
    </div>
  </div>

  <div class="tp-body">
    {#if editing}
      <div class="tp-edit-hint">Tab / Shift+Tab to indent · Alt+↑ / Alt+↓ to reorder · Enter for a new line · tick lines and Merge (Ctrl+J) to join them</div>
      {#each draft as line, i (line.id)}
        <TranscriptEditRow
          bind:text={line.text}
          bind:this={inputEls[i]}
          indentLevel={line.indentLevel}
          selected={selectedIds.has(line.id)}
          isFirst={i === 0}
          isLast={i === draft.length - 1}
          onEdit={() => setDirty(true)}
          onKey={(e) => onKey(e, i)}
          onFocus={() => (activeIndex = i)}
          onBlur={() => { if (activeIndex === i) activeIndex = -1; }}
          onToggleSelect={() => toggleSelect(line.id)}
          onMoveUp={() => moveLineUp(i)}
          onMoveDown={() => moveLineDown(i)}
          onOutdent={() => outdentLine(i)}
          onIndent={() => indentLine(i)}
        />
      {/each}
    {:else}
      <TranscriptLines {lines} onCopyLine={copyBranch} {onHoverLine} {linkNote} {onTranscribe} onAddTranscript={startEdit} focusId={focusLineId}
        taskBook={tasks ? book : null} taskPageId={tasks ? page : null} {taskLock} />
    {/if}
  </div>
</div>

<style>
  .transcript-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #fff;
  }

  .tp-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid #ececec;
    flex-shrink: 0;
  }
  .tp-title {
    font-weight: 600;
    font-size: 13px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  /* Edit mode's buttons wrap onto a second row in a half-width spread page. */
  .tp-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }

  .tp-btn {
    padding: 4px 12px;
    white-space: nowrap;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
    transition: all 0.15s;
  }
  .tp-btn:hover:not(:disabled) { background: #f2f2f2; border-color: #ccc; }
  .tp-btn.primary { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  .tp-btn.primary:hover:not(:disabled) { background: #3a6ce7; }
  .tp-btn.muted { color: #999; }
  .tp-btn.danger { color: #c0392b; }
  .tp-btn.danger:hover:not(:disabled) { background: #fdeaea; border-color: #e6b0aa; }
  .tp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .tp-toolbar-divider { width: 1px; align-self: stretch; background: #e6e6e6; margin: 2px 2px; }

  .tp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.6;
    color: #222;
  }

  .tp-edit-hint {
    font-size: 11px;
    color: #999;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #eee;
  }

</style>
