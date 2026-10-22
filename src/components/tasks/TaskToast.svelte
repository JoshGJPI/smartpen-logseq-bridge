<!--
  TaskToast.svelte — "Marked DONE · B3017 p.142  Undo" after a task change
  (v3.4.0), for the Tasks view and the reader alike (mounted once in
  BookViewer). Shows the last undoable change (`taskUndo`) for a few seconds;
  Undo puts it back. A failed write clears `taskUndo`, which hides it.
-->
<script>
  import { onDestroy } from 'svelte';
  import { taskUndo, undoTaskChange } from '$stores/tasks.js';

  const SHOW_MS = 6000;
  let shown = null;
  let timer = null;

  $: show($taskUndo);

  function show(u) {
    clearTimeout(timer);
    shown = u;
    if (u) timer = setTimeout(() => { if (shown === u) shown = null; }, SHOW_MS);
  }

  function undo() {
    shown = null;
    undoTaskChange();
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if shown}
  <div class="toast" role="status">
    <span>{shown.label}</span>
    <button type="button" on:click={undo}>Undo</button>
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 8px 14px;
    border-radius: 8px;
    background: #262650;
    color: #fff;
    font-size: 12.5px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
  }
  button {
    padding: 0;
    border: none;
    background: none;
    color: #9db8ff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { text-decoration: underline; }
</style>
