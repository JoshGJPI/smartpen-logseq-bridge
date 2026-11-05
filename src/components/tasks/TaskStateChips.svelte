<!--
  TaskStateChips.svelte — the Open / Waiting / Done / Cancelled chips (v3.12.0):
  each chip shows or hides its tasks on its own, so Open and Waiting can be read
  together. One choice (`taskStatesShown`), shared by the Tasks view and a tag's
  page. `counts` is the taskCounts() of the rows in view.

  v3.14.0: the All chip is gone (it toggled back to the default when everything
  was on, which was hard to predict). A Reset link appears only while the choice
  differs from Open + Waiting, and a state with no tasks is dimmed (kept in
  place, so the chips don't shift as counts change).
-->
<script>
  import { taskStatesShown, toggleTaskState, resetTaskStates } from '$stores/tasks.js';
  import { TASK_STATE_CHIPS, isDefaultShown } from '$lib/tasks.js';

  /** `{ open, waiting, done, cancelled, all }` */
  export let counts;
  /** Smaller chips (the tag page's panel). */
  export let compact = false;

  $: shown = new Set($taskStatesShown);
  $: changed = !isDefaultShown($taskStatesShown);
</script>

<div class="chips" class:compact role="group" aria-label="Show tasks that are">
  {#each TASK_STATE_CHIPS as c (c.id)}
    <button type="button" class="ch {c.id}" class:on={shown.has(c.state)} class:zero={!counts[c.id]} aria-pressed={shown.has(c.state)}
      title="{shown.has(c.state) ? 'Hide' : 'Show'} {c.label.toLowerCase()} tasks"
      on:click={() => toggleTaskState(c.state)}>{c.label} <span class="c">{counts[c.id]}</span></button>
  {/each}
  {#if changed}
    <button type="button" class="reset" title="Back to open and waiting tasks" on:click={resetTaskStates}>Reset</button>
  {/if}
</div>

<style>
  .chips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
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
  .ch.zero { opacity: 0.5; }
  .c { font-variant-numeric: tabular-nums; color: #999; font-weight: 400; }
  .reset { padding: 2px 4px; border: none; background: none; color: #2c56c4; font-size: 12px; cursor: pointer; text-decoration: underline; }
  .compact .reset { font-size: 11.5px; }
</style>
