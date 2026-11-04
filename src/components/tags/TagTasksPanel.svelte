<!--
  TagTasksPanel.svelte — a tag's tasks, beside its pages in the Library
  (v3.12.0). A project tag lists the tasks the Tasks view groups under it
  (lib/tasks.js taskRowsForTag); any other tag, every task on a page carrying
  it. The state chips are the Tasks view's (TaskStateChips, one shared
  choice). Rows are the same TaskRow: tick, ⋯ menu, and the page link, which
  opens the reader on that line. Built from the scan (stores/tasks.js), never
  from reading a page. Not shown when the tag has no tasks at all.
-->
<script>
  import { openPageInLibrary, focusReaderLineId } from '$stores';
  import { taskRows, taskStatesShown } from '$stores/tasks.js';
  import { tagIndex } from '$stores/tags.js';
  import { taskRowsForTag, rowsInStates, taskCounts, compareTaskRows } from '$lib/tasks.js';
  import { isProjectTag } from '$lib/tags.js';
  import TaskRow from '../tasks/TaskRow.svelte';
  import TaskStateChips from '../tasks/TaskStateChips.svelte';

  export let tag;

  $: all = taskRowsForTag($taskRows, tag, $tagIndex.get(tag) || []);
  $: counts = taskCounts(all);
  $: shown = rowsInStates(all, $taskStatesShown).sort(compareTaskRows);
  $: project = isProjectTag(tag);

  function openPage(row) {
    if (openPageInLibrary(row.book, row.pageId) === 'cancelled') return;
    focusReaderLineId(row.book, row.pageId, row.lineId);
  }
</script>

{#if all.length}
  <aside class="tt" aria-label="Tasks for {tag}">
    <div class="tt-head">
      <h3>Tasks <span class="n">{all.length}</span></h3>
      <TaskStateChips {counts} compact />
    </div>
    {#if shown.length}
      <div class="rows">
        {#each shown as row (row.key)}
          <TaskRow {row} hideProject={project} onOpenPage={openPage} />
        {/each}
      </div>
    {:else}
      <p class="empty">
        {$taskStatesShown.length ? 'No tasks for this tag in the states shown.' : 'Every status is turned off.'}
      </p>
    {/if}
  </aside>
{/if}

<style>
  .tt { flex: 1 1 340px; max-width: 460px; min-width: 0; }
  .tt-head { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .tt-head h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .n { color: #999; font-weight: 400; letter-spacing: 0; }
  .rows { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  .empty { padding: 20px 8px; margin: 0; text-align: center; color: #999; font-size: 12.5px; }
</style>
