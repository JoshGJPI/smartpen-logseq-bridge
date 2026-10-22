<!--
  TranscriptLines.svelte — a page's transcript as read (not edited) in the
  Library: indented lines with TODO/DONE/WAITING markers, or the empty state.

  With `taskBook` / `taskPageId` (v3.4.0) a task line's marker is a button
  (TaskBox: TODO ↔ DONE) with a ⋯ menu beside it (TaskMenu: set / clear
  WAITING), both writing through stores/tasks.js; `taskLock` disables them
  (the page has an unsaved draft). The state shown includes a change still
  being written (`taskOverrides`).

  Extracted from TranscriptPane (reading-first package D), which keeps the
  editor. Ink + text passes `onHoverLine` on pages whose stroke links can be
  trusted (lib/viewer/ink-text.js), and each line then lights its ink on the
  page; on other pages `linkNote` explains why there is no linking.

  Top- and second-level lines carry a copy button (shown on hover) that copies
  that line and everything nested under it (`onCopyLine(index)`).

  Empty state: "Transcribe in Editor" only when MyScript is configured
  (transcribing is an Editor action: the button loads the page there, and the
  capture bar's Transcribe does the rest); otherwise it says where to add a key.
-->
<script>
  import { hasMyScriptCredentials } from '$stores';
  import { taskOverrides, toggleTask, changeTask } from '$stores/tasks.js';
  import { taskStateOf, taskKey } from '$lib/tasks.js';
  import TaskBox from '../tasks/TaskBox.svelte';
  import TaskMenu from '../tasks/TaskMenu.svelte';

  export let lines = [];
  /** (index) => void: copy that line and its children; null hides the buttons. */
  export let onCopyLine = null;
  /** Deepest indent level that gets a copy button (0 = top, 1 = second). */
  const COPY_LEVELS = 1;
  /** (line|null) => void, or null when lines can't be linked to ink. */
  export let onHoverLine = null;
  /** Shown under the lines in Ink + text when linking is off. */
  export let linkNote = '';
  export let onAddTranscript = () => {};
  /** Loads the page into the Editor to transcribe it; null hides the button. */
  export let onTranscribe = null;
  /** A global search hit's line on a trusted page: marked and scrolled to. */
  export let focusId = null;
  /** Book key and page id that make task markers clickable; null = read only. */
  export let taskBook = null;
  export let taskPageId = null;
  /** Why task markers can't be clicked now, or ''. */
  export let taskLock = '';

  $: interactive = taskBook != null && taskPageId != null;
  $: stateOf = (line) => (interactive && $taskOverrides.get(taskKey(taskBook, taskPageId, line.id))) || taskStateOf(line);

  // After layout settles (the page's ink fits in the same frame), so the line
  // lands mid-pane rather than where it was before the pane had its height.
  function scrollTo(el, on) {
    const go = (now) => now && setTimeout(() => el.isConnected && el.scrollIntoView({ block: 'center' }), 120);
    go(on);
    return { update: go };
  }

  let hotId = null;

  $: hasContent = lines.some((l) => (l.text || '').trim() !== '');

  function markerSymbol(state) {
    if (state === 'done') return '☑';
    if (state === 'waiting') return '◷';
    if (state === 'todo') return '☐';
    return '•';
  }

  function hover(line) {
    if (!onHoverLine) return;
    hotId = line ? line.id : null;
    onHoverLine(line);
  }
</script>

{#if hasContent}
  <div class="tl" class:linked={!!onHoverLine} role="list" on:mouseleave={() => hover(null)}>
    {#each lines as line, i (line.id)}
      <div
        role="listitem"
        class="tl-line"
        class:hot={hotId === line.id}
        class:focus={focusId === line.id}
        use:scrollTo={focusId === line.id}
        style="padding-left: {(line.indentLevel || 0) * 1.5}rem"
        on:mouseenter={() => hover(line)}
      >
        {#if interactive && stateOf(line)}
          <TaskBox variant="glyph" state={stateOf(line)} lock={taskLock}
            onToggle={() => toggleTask(taskBook, taskPageId, line.id, { from: stateOf(line) })} />
        {:else}
          <span class="tl-marker" class:todo={stateOf(line) === 'todo'} class:waiting={stateOf(line) === 'waiting'}
            class:done={stateOf(line) === 'done'}>{markerSymbol(stateOf(line))}</span>
        {/if}
        <span class="tl-text" class:done={stateOf(line) === 'done'}>{#if stateOf(line) === 'waiting'}<span class="tl-wait">WAITING</span> {/if}{line.text}</span>
        {#if interactive && stateOf(line)}
          <span class="tl-task-menu">
            <TaskMenu state={stateOf(line)} lock={taskLock}
              onSet={(s) => changeTask(taskBook, taskPageId, line.id, s, { from: stateOf(line) })} />
          </span>
        {/if}
        {#if onCopyLine && (line.indentLevel || 0) <= COPY_LEVELS && (line.text || '').trim()}
          <button
            type="button"
            class="tl-copy"
            on:click={() => onCopyLine(i)}
            title="Copy this line and everything under it (LogSeq format)"
            aria-label="Copy this line and everything under it"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        {/if}
      </div>
    {/each}
    {#if linkNote}
      <p class="tl-note">{linkNote}</p>
    {/if}
  </div>
{:else}
  <div class="tl-empty">
    <p>No transcript for this page yet.</p>
    {#if $hasMyScriptCredentials}
      <div class="tl-actions">
        {#if onTranscribe}
          <button class="tl-btn primary" on:click={() => onTranscribe()}
            title="Load this page into the Editor, where Transcribe in the capture bar sends it to MyScript">Transcribe in Editor</button>
        {/if}
        <button class="tl-btn" on:click={onAddTranscript}>Type one</button>
      </div>
    {:else}
      <p class="tl-sub">To transcribe handwriting, add your MyScript keys in Settings (gear) → MyScript Configuration.</p>
      <button class="tl-btn" on:click={onAddTranscript}>Type one</button>
    {/if}
  </div>
{/if}

<style>
  .tl-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding-top: 1px;
    border-radius: 4px;
  }
  .linked .tl-line { cursor: default; }
  .linked .tl-line.hot { background: #eef3ff; }
  .tl-line.focus { background: #fff6d6; box-shadow: inset 3px 0 0 #e0b400; }
  .tl-marker {
    flex-shrink: 0;
    color: #bbb;
    font-size: 13px;
    width: 1.1em;
    text-align: center;
  }
  .tl-marker.todo { color: #e07b00; }
  .tl-marker.done { color: #2e9e54; }
  .tl-marker.waiting { color: #6d28d9; }
  .tl-wait { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; padding: 0 5px; border-radius: 4px; background: #f1eafe; color: #6d28d9; }
  /* The task menu, like the copy button, stays out of the way until hovered. */
  .tl-task-menu { flex-shrink: 0; align-self: center; opacity: 0; }
  .tl-line:hover .tl-task-menu,
  .tl-task-menu:focus-within { opacity: 1; }
  .tl-text { min-width: 0; }
  .tl-text.done { color: #999; text-decoration: line-through; }
  /* Per-node copy: out of the way until the line is hovered or the button focused. */
  .tl-copy {
    flex-shrink: 0;
    align-self: center;
    display: flex;
    padding: 3px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: #8a8fa3;
    cursor: pointer;
    opacity: 0;
  }
  .tl-line:hover .tl-copy,
  .tl-copy:focus-visible { opacity: 1; }
  .tl-copy:hover { background: #eef3ff; border-color: #c7d6fb; color: #4a7cf7; }
  .tl-note { margin: 14px 0 0; font-size: 12px; color: #999; line-height: 1.4; }

  .tl-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #999;
    padding: 32px 12px;
    text-align: center;
  }
  .tl-empty p { margin: 0; font-size: 14px; }
  .tl-empty .tl-sub { font-size: 12px; max-width: 34ch; line-height: 1.45; }
  .tl-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .tl-btn {
    padding: 4px 12px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background: #fff;
    cursor: pointer;
    font-size: 12px;
    color: #555;
  }
  .tl-btn:hover { background: #f2f2f2; border-color: #ccc; }
  .tl-btn.primary { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  .tl-btn.primary:hover { background: #3a6ce7; }
</style>
