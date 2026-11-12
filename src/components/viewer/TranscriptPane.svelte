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
                the merged-away lines' strokes follow on save). Ticked lines
                move together (v3.17.0, lib/move-lines.js): Alt+↑ / Alt+↓ or a
                ticked row's arrows step the group, Top / Bottom gather it. Long lines wrap
                (TranscriptEditRow); the buttons are TranscriptEditToolbar and the
                line maths lib/viewer/transcript-draft.js. Task state isn't edited here: typing `TODO`,
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
  import { log, markViewerDirtyPage, clearViewerDirtyPage, viewerDirtyPages, transcriptEditorHold } from '$stores';
  import { linesToLogseqMarkdown, subtreeLines } from '$lib/viewer/transcript-markdown.js';
  import { saveTranscriptLines } from '$lib/viewer/save-transcript.js';
  import { mergeTranscriptLines } from '$lib/editor-lines.js';
  import { moveLines, moveLinesToEdge } from '$lib/move-lines.js';
  import {
    blankLine, cloneLines, indentAt, outdentAt, swapAt, siblingSlot, insertAt, removeAt, mergeIndices, tickedIndices
  } from '$lib/viewer/transcript-draft.js';
  import TranscriptLines from '../transcription/TranscriptLines.svelte';
  import TranscriptEditRow from './TranscriptEditRow.svelte';
  import TranscriptEditToolbar from './TranscriptEditToolbar.svelte';

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

  /* ---- edit operations (the line maths is lib/viewer/transcript-draft.js) ---- */
  /** Take a new draft (null = no change), mark dirty, then focus line `focusAt`. */
  async function apply(next, focusAt = null) {
    if (!next) return false;
    draft = next;
    setDirty(true);
    await tick();
    if (focusAt != null) inputEls[focusAt]?.focus();
    return true;
  }
  const indentLine = (i) => apply(indentAt(draft, i));
  const outdentLine = (i) => apply(outdentAt(draft, i));
  /** Ticked lines as one group: a step (dir -1 / 1) or to an edge ('top' / 'bottom'). */
  async function moveTicked(how) {
    const sel = tickedIndices(draft, selectedIds);
    const r = typeof how === 'number' ? moveLines(draft, sel, how) : moveLinesToEdge(draft, sel, how);
    if (!r) return;
    const focusId = activeIndex >= 0 ? draft[activeIndex]?.id : null;
    await apply(r.lines);
    const at = focusId ? draft.findIndex((l) => l.id === focusId) : -1;
    if (at >= 0) inputEls[at]?.focus();
    inputEls[r.selected[0]]?.scrollIntoView?.({ block: 'nearest' });
  }
  // A ticked line's own move takes the whole ticked group with it.
  const movesGroup = (i) => selectedIds.size > 1 && selectedIds.has(draft[i]?.id);
  function moveLine(i, dir) {
    if (movesGroup(i)) return moveTicked(dir);
    return apply(swapAt(draft, i, dir), i + dir);
  }
  const addLineBelow = (i) => apply(insertAt(draft, i + 1, blankLine(draft[i]?.indentLevel || 0)), i + 1);
  // Toolbar Add: a sibling after the focused line's subtree, else at the end.
  function addBlock() {
    const slot = siblingSlot(draft, activeIndex);
    return apply(insertAt(draft, slot.at, blankLine(slot.indentLevel)), slot.at);
  }
  function deleteLine(i) {
    if (selectedIds.has(draft[i]?.id)) toggleSelect(draft[i].id);
    return apply(removeAt(draft, i), Math.max(0, i - 1));
  }
  function toggleSelect(id) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedIds = next;
  }
  // The merged line keeps the first line's id and indent (mergeTranscriptLines).
  function merge() {
    const indices = mergeIndices(draft, selectedIds, activeIndex);
    if (indices.length < 2) return;
    selectedIds = new Set();
    return apply(mergeTranscriptLines(draft, indices), indices[0]);
  }
  $: canMerge = mergeIndices(draft, selectedIds, activeIndex).length >= 2;

  function onKey(e, i) {
    // Mid-IME, Enter / Backspace belong to the composition.
    if (e.isComposing) return;
    if ((e.key === 'j' || e.key === 'J') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      merge();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      moveLine(i, e.key === 'ArrowUp' ? -1 : 1);
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
  // While Edit is open (dirty or not) Claude's edits are refused on this page:
  // the draft would write its copy back over them (v3.18.0).
  const editorHold = transcriptEditorHold();
  $: editorHold.set(pageKey, editing);

  onDestroy(() => {
    editorHold.release();
    if (editing) onEditingChange(false);
  });
</script>

<div class="transcript-pane">
  <div class="tp-toolbar">
    <span class="tp-title">Transcript</span>
    <div class="tp-actions">
      {#if editing}
        <TranscriptEditToolbar {activeIndex} lineCount={draft.length} ticked={selectedIds.size} {canMerge} {saving}
          onAdd={addBlock} onDelete={() => deleteLine(activeIndex)} onMerge={merge} onMove={moveTicked}
          onCopy={copy} onSave={save} onCancel={cancel} />
      {:else}
        <button class="tp-btn" on:click={copy} disabled={!hasContent}
          title={hasContent ? 'Copy the whole transcript as LogSeq markdown' : 'Nothing to copy: the transcript is empty'}>Copy all</button>
        <button class="tp-btn" on:click={startEdit} title="Edit the transcript's lines">Edit</button>
      {/if}
    </div>
  </div>

  <div class="tp-body">
    {#if editing}
      <div class="tp-edit-hint">Tab / Shift+Tab to indent · Alt+↑ / Alt+↓ to reorder (ticked lines move together) · Enter for a new line · tick lines and Merge (Ctrl+J) to join them</div>
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
          onMoveUp={() => moveLine(i, -1)}
          onMoveDown={() => moveLine(i, 1)}
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

  /* Global under .tp-actions: TranscriptEditToolbar's buttons share these. */
  .tp-actions :global(.tp-btn) {
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
  .tp-actions :global(.tp-btn:hover:not(:disabled)) { background: #f2f2f2; border-color: #ccc; }
  .tp-actions :global(.tp-btn.primary) { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  .tp-actions :global(.tp-btn.primary:hover:not(:disabled)) { background: #3a6ce7; }
  .tp-actions :global(.tp-btn.muted) { color: #999; }
  .tp-actions :global(.tp-btn.danger) { color: #c0392b; }
  .tp-actions :global(.tp-btn.danger:hover:not(:disabled)) { background: #fdeaea; border-color: #e6b0aa; }
  .tp-actions :global(.tp-btn:disabled) { opacity: 0.5; cursor: not-allowed; }

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
