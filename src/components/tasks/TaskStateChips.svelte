<!--
  TaskStateChips.svelte — the Open / Waiting / Done / Cancelled / All chips
  (v3.12.0): each state chip shows or hides its tasks on its own, so Open and
  Waiting can be read together; All turns every state on, or back to Open +
  Waiting when all are on. One choice (`taskStatesShown`), shared by the Tasks
  view and a tag's page. `counts` is the taskCounts() of the rows in view.
-->
<script>
  import { taskStatesShown, toggleTaskState, toggleAllTaskStates } from '$stores/tasks.js';
  import { TASK_STATE_CHIPS } from '$lib/tasks.js';

  /** `{ open, waiting, done, cancelled, all }` */
  export let counts;
  /** Smaller chips (the tag page's panel). */
  export let compact = false;

  $: shown = new Set($taskStatesShown);
  $: allOn = shown.size === TASK_STATE_CHIPS.length;
</script>

<div class="chips" class:compact role="group" aria-label="Show tasks that are">
  {#each TASK_STATE_CHIPS as c (c.id)}
    <button type="button" class="ch {c.id}" class:on={shown.has(c.state)} aria-pressed={shown.has(c.state)}
      title="{shown.has(c.state) ? 'Hide' : 'Show'} {c.label.toLowerCase()} tasks"
      on:click={() => toggleTaskState(c.state)}>{c.label} <span class="c">{counts[c.id]}</span></button>
  {/each}
  <button type="button" class="ch" class:on={allOn} aria-pressed={allOn}
    title={allOn ? 'Back to open and waiting tasks' : 'Show every task'}
    on:click={toggleAllTaskStates}>All <span class="c">{counts.all}</span></button>
</div>

<style>
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .ch {
    padding: 4px 11px;
    border: 1px solid #ddd;
    border-radius: 14px;
    background: #fff;
    color: #888;
    font-size: 12px;
    cursor: pointer;
  }
  .compact .ch { padding: 2px 8px; font-size: 11.5px; }
  .ch:hover { border-color: #bbb; color: #222; }
  .ch.on { background: #eef3ff; border-color: #4a7cf7; color: #2c56c4; font-weight: 600; }
  .ch.waiting.on { background: #f1eafe; border-color: #8b5cf6; color: #6d28d9; }
  .ch.done.on { background: #e8f5ec; border-color: #4f9d6c; color: #2f7d4f; }
  .ch.cancelled.on { background: #eef0f3; border-color: #9aa0a6; color: #5f6368; }
  .c { font-variant-numeric: tabular-nums; color: #999; font-weight: 400; }
</style>
