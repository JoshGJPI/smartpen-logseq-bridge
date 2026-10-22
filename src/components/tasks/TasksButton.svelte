<!--
  TasksButton.svelte — the header's Tasks entry (v3.4.0) with the open-task
  count. Opens Library › Tasks (openLibraryView, which asks first when that
  would drop an unsaved transcript draft).
-->
<script>
  import { openLibraryView, libraryView, destination, viewerSelection } from '$stores';
  import { openTaskCount } from '$stores/tasks.js';

  $: here = $destination === 'library' && !$viewerSelection && $libraryView && $libraryView.kind === 'tasks';
  $: title = $openTaskCount ? `Tasks: ${$openTaskCount} open` : 'Tasks';
</script>

<button type="button" class="tasks-btn" class:here aria-pressed={here} {title} on:click={() => openLibraryView({ kind: 'tasks' })}>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>
  Tasks
  {#if $openTaskCount}<span class="badge">{$openTaskCount}</span>{/if}
</button>

<style>
  .tasks-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .tasks-btn:hover { filter: brightness(1.15); }
  .tasks-btn.here { border-color: #4a7cf7; }
  .badge {
    min-width: 18px;
    padding: 0 6px;
    border-radius: 99px;
    background: #b45309;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    line-height: 17px;
  }
</style>
