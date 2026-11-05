<!--
  TaskGroupNav.svelte — the left panel beside Library › Tasks (v3.14.0): the
  groups the Tasks view is showing (project, day written or notebook, as Group
  by says), each with its task count; a click scrolls the view to that group.
  Reads the same store as the view (shownTaskGroups), so chips and the find box
  change both.
-->
<script>
  import { bookAliases } from '$stores';
  import { shownTaskGroups, taskGroupBy } from '$stores/tasks.js';
  import { taskGroupDomId, TASK_GROUPS } from '$lib/tasks.js';
  import { dayStart } from '$lib/timeline.js';
  import { formatBookName } from '$utils/formatting.js';

  $: groups = $shownTaskGroups;
  $: heading = (TASK_GROUPS.find((g) => g.id === $taskGroupBy) || TASK_GROUPS[0]).label;

  function label(g) {
    if (g.kind === 'book') return formatBookName(g.id, $bookAliases, 'alias-only');
    if (g.kind === 'date' && g.id) {
      return dayStart(g.id)?.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) || g.id;
    }
    return g.label;
  }

  function jump(g) {
    document.getElementById(taskGroupDomId(g))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
</script>

<div class="tgn">
  <p class="h">By {heading.toLowerCase()} · tasks shown</p>
  {#each groups as g (g.kind + ':' + g.id)}
    <button type="button" class="row" class:none={!g.id} on:click={() => jump(g)} title="Scroll to {label(g)}">
      <span class="name" class:mono={g.kind === 'project' && g.id}>{label(g)}</span>
      <span class="n">{g.rows.length}</span>
    </button>
  {:else}
    <p class="note">No tasks in the states shown.</p>
  {/each}
</div>

<style>
  .tgn { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
  .h { margin: 0 0 6px; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 6px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text-primary);
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: rgba(255, 255, 255, 0.05); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .row.none .name { color: var(--text-secondary); font-style: italic; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; }
  .n { font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .note { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
</style>
