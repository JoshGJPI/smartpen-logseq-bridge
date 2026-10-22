<!--
  TasksCard.svelte — the Library home's way into Tasks (v3.4.0): counts by
  state and the three most recently written open tasks. Shown once the
  library has any task. Opens Library › Tasks.
-->
<script>
  import { openLibraryView } from '$stores';
  import { taskRows, taskCountsStore } from '$stores/tasks.js';
  import { filterTaskRows, compareTaskRows } from '$lib/tasks.js';
  import { plural } from '$lib/plural.js';

  $: c = $taskCountsStore;
  $: latest = filterTaskRows($taskRows, 'open').sort(compareTaskRows).slice(0, 3);

  const open = () => openLibraryView({ kind: 'tasks' });
</script>

{#if c.all}
  <button type="button" class="tc" on:click={open} title="Open Tasks">
    <span class="tc-head">
      <span class="tc-title">Tasks</span>
      <span class="tc-n"><b>{c.open}</b> open</span>
      {#if c.waiting}<span class="tc-n wait"><b>{c.waiting}</b> waiting</span>{/if}
      <span class="tc-n done"><b>{c.done}</b> done</span>
      {#if c.cancelled}<span class="tc-n cancel"><b>{c.cancelled}</b> cancelled</span>{/if}
      <span class="grow"></span>
      <span class="tc-go">View all {c.all} {plural(c.all, 'task')} →</span>
    </span>
    {#if latest.length}
      <span class="tc-list">
        {#each latest as r (r.key)}
          <span class="tc-item"><span class="box" aria-hidden="true"></span><span class="tc-text">{r.text}</span></span>
        {/each}
      </span>
    {/if}
  </button>
{/if}

<style>
  .tc {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 980px;
    margin: 0 0 20px;
    padding: 10px 14px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    background: #fff;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .tc:hover { border-color: #4a7cf7; }
  .tc-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .tc-title { font-size: 13px; font-weight: 600; color: #444; }
  .tc-n { font-size: 12px; color: #888; }
  .tc-n b { color: #b45309; font-weight: 700; }
  .tc-n.wait b { color: #6d28d9; }
  .tc-n.done b { color: #2f7d4f; }
  .tc-n.cancel b { color: #5f6368; }
  .grow { flex: 1; }
  .tc-go { font-size: 12px; color: #2c56c4; }
  .tc-list { display: flex; flex-direction: column; gap: 3px; }
  .tc-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #333; min-width: 0; }
  .tc-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .box { flex-shrink: 0; width: 11px; height: 11px; border: 1.5px solid #b8b8b8; border-radius: 3px; }
</style>
