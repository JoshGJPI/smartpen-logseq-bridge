<!--
  TranscriptPane.svelte — view / edit / copy a page's transcript inside Book View.

  Display mode: indented bullet list with TODO/DONE checkboxes.
  Edit mode:    inline structured editor — edit text, Tab/Shift+Tab to
                indent/outdent, click a checkbox to cycle (none → TODO → DONE),
                Enter adds a line below, Backspace on an empty line deletes it.
  Copy:         LogSeq-pasteable markdown (tab indents, - TODO/- DONE, properties
                stripped) → clipboard.

  Edits persist to the PageDoc on disk via saveTranscriptLines(); dirty state is
  tracked per page in the viewer store (separate from the canvas unsaved flag).
-->
<script>
  import { tick } from 'svelte';
  import { log, markViewerDirtyPage, clearViewerDirtyPage } from '$stores';
  import { linesToLogseqMarkdown } from '$lib/viewer/transcript-markdown.js';
  import { saveTranscriptLines } from '$lib/viewer/save-transcript.js';

  /** @type {Array<{id:string,text:string,indentLevel:number,checked:boolean|null}>} */
  export let lines = [];
  export let book;
  export let page;
  /** `${book}:${page}` — used for dirty tracking */
  export let pageKey;
  /** (book, page, lines) => void — lets the parent update the store after save */
  export let onSaved = () => {};

  let editing = false;
  let saving = false;
  let dirty = false;
  /** @type {Array<HTMLInputElement>} */
  let inputEls = [];
  /** working copy while editing */
  let draft = [];

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
    if (draft.length === 0) draft = [blankLine()];
    editing = true;
    setDirty(false);
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your transcript edits?')) return;
    editing = false;
    draft = [];
    setDirty(false);
  }

  async function save() {
    saving = true;
    try {
      const result = await saveTranscriptLines(book, page, draft);
      if (!result || result.success === false) {
        throw new Error((result && result.error) || 'save failed');
      }
      const saved = cloneLines(draft);
      editing = false;
      setDirty(false);
      onSaved(book, page, saved);
      const count = saved.filter((l) => l.text.trim() !== '').length;
      log(`Saved transcript B${book}/P${page} (${count} line${count === 1 ? '' : 's'})`, 'success');
    } catch (e) {
      log(`Transcript save failed: ${e.message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function copy() {
    const md = linesToLogseqMarkdown(editing ? draft : lines);
    if (!md) {
      log('Nothing to copy — transcript is empty', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      log(`Copied transcript B${book}/P${page} to clipboard (LogSeq format)`, 'success');
    } catch {
      log('Failed to copy to clipboard', 'error');
    }
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
  function cycleCheck(i) {
    const c = draft[i].checked;
    draft[i].checked = c === null ? false : c === false ? true : null;
    draft = draft;
    setDirty(true);
  }
  async function addLineBelow(i) {
    const lvl = i >= 0 ? draft[i].indentLevel || 0 : 0;
    draft.splice(i + 1, 0, blankLine(lvl));
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[i + 1]?.focus();
  }
  async function deleteLine(i) {
    draft.splice(i, 1);
    draft = draft;
    setDirty(true);
    await tick();
    inputEls[Math.max(0, i - 1)]?.focus();
  }
  function onKey(e, i) {
    if (e.key === 'Tab') {
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

  function markerSymbol(checked) {
    if (checked === true) return '☑';
    if (checked === false) return '☐';
    return '•';
  }

  $: hasContent = lines.some((l) => (l.text || '').trim() !== '');
</script>

<div class="transcript-pane">
  <div class="tp-toolbar">
    <span class="tp-title">Transcript</span>
    <div class="tp-actions">
      {#if editing}
        <button class="tp-btn" on:click={copy} title="Copy as LogSeq markdown">Copy</button>
        <button class="tp-btn primary" on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button class="tp-btn muted" on:click={cancel} disabled={saving}>Cancel</button>
      {:else}
        <button class="tp-btn" on:click={copy} disabled={!hasContent} title="Copy as LogSeq markdown">Copy</button>
        <button class="tp-btn" on:click={startEdit} title="Edit transcript">Edit</button>
      {/if}
    </div>
  </div>

  <div class="tp-body">
    {#if editing}
      <div class="tp-edit-hint">Tab / Shift+Tab to indent · Enter for a new line · click the box to toggle TODO/DONE</div>
      {#each draft as line, i (line.id)}
        <div class="tp-edit-row" style="margin-left: {(line.indentLevel || 0) * 1.5}rem">
          <button
            class="tp-check"
            class:todo={line.checked === false}
            class:done={line.checked === true}
            on:click={() => cycleCheck(i)}
            title="Toggle none / TODO / DONE"
          >{markerSymbol(line.checked)}</button>
          <input
            class="tp-input"
            type="text"
            bind:value={line.text}
            bind:this={inputEls[i]}
            on:input={() => setDirty(true)}
            on:keydown={(e) => onKey(e, i)}
            placeholder="(empty line)"
          />
          <div class="tp-row-actions">
            <button class="tp-icon" on:click={() => outdentLine(i)} title="Outdent (Shift+Tab)">⇤</button>
            <button class="tp-icon" on:click={() => indentLine(i)} title="Indent (Tab)">⇥</button>
            <button class="tp-icon" on:click={() => addLineBelow(i)} title="Add line below">＋</button>
            <button class="tp-icon danger" on:click={() => deleteLine(i)} title="Delete line">🗑</button>
          </div>
        </div>
      {/each}
    {:else if hasContent}
      {#each lines as line (line.id)}
        <div class="tp-line" style="padding-left: {(line.indentLevel || 0) * 1.5}rem">
          <span
            class="tp-marker"
            class:todo={line.checked === false}
            class:done={line.checked === true}
          >{markerSymbol(line.checked)}</span>
          <span class="tp-text" class:done={line.checked === true}>{line.text}</span>
        </div>
      {/each}
    {:else}
      <div class="tp-empty">
        <p>No transcript for this page yet.</p>
        <button class="tp-btn" on:click={startEdit}>Add transcript</button>
      </div>
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
  .tp-actions { display: flex; gap: 6px; }

  .tp-btn {
    padding: 4px 12px;
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
  .tp-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

  /* ---- display ---- */
  .tp-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 1px;
  }
  .tp-marker {
    flex-shrink: 0;
    color: #bbb;
    font-size: 13px;
    width: 1.1em;
    text-align: center;
  }
  .tp-marker.todo { color: #e07b00; }
  .tp-marker.done { color: #2e9e54; }
  .tp-text.done { color: #999; text-decoration: line-through; }

  /* ---- edit ---- */
  .tp-edit-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .tp-check {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fafafa;
    cursor: pointer;
    color: #bbb;
    font-size: 14px;
    line-height: 1;
  }
  .tp-check.todo { color: #e07b00; border-color: #f0c890; }
  .tp-check.done { color: #2e9e54; border-color: #a7d8b8; }
  .tp-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid #e0e0e0;
    border-radius: 5px;
    font-size: 14px;
    color: #222;
    font-family: inherit;
  }
  .tp-input:focus { outline: none; border-color: #4a7cf7; }
  .tp-row-actions { display: flex; gap: 2px; flex-shrink: 0; }
  .tp-icon {
    width: 24px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    color: #888;
    font-size: 13px;
    line-height: 1;
  }
  .tp-icon:hover { background: #f0f0f0; color: #333; }
  .tp-icon.danger:hover { background: #fdeaea; color: #c0392b; }

  .tp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #999;
    padding: 32px 0;
  }
  .tp-empty p { margin: 0; font-size: 14px; }
</style>
