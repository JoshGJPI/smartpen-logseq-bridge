<!--
  TasksView.svelte — Library › Tasks (v3.4.0): every transcript line with a
  TODO / DONE / WAITING state, across notebooks, filtered by state (Open /
  Waiting / Done / All, with counts) and grouped by project tag, date written
  or notebook. Opened from the Library home's Tasks card or the header's Tasks
  button (`libraryView: { kind: 'tasks' }`); the breadcrumb's Library goes back.

  Rows come from the scan (stores/tasks.js), never from reading a page. A tick
  writes that one line of its PageDoc (lib/viewer/task-state.js); the toast
  (TaskToast, in BookViewer) offers Undo.
-->
<script>
  import { onMount } from 'svelte';
  import { savedPages, isScanning, bookAliases, openPageInLibrary, focusReaderLineId, ensureTimelineLoaded } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { taskRows, taskCountsStore, taskFilter, setTaskFilter, taskGroupBy, setTaskGroupBy } from '$stores/tasks.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { filterTaskRows, searchTaskRows, groupTaskRows, TASK_FILTERS, TASK_GROUPS, NO_PROJECT } from '$lib/tasks.js';
  import { dayStart } from '$lib/timeline.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';
  import TaskRow from './TaskRow.svelte';
  import TagChip from '../tags/TagChip.svelte';

  let query = '';
  $: byState = filterTaskRows($taskRows, $taskFilter);
  $: shown = searchTaskRows(byState, query, (b) => formatBookName(b, $bookAliases, 'full'));
  $: groups = groupTaskRows(shown, $taskGroupBy);
  $: counts = $taskCountsStore;

  function groupLabel(g) {
    if (g.kind === 'book') return formatBookName(g.id, $bookAliases, 'full');
    if (g.kind === 'date' && g.id) {
      return dayStart(g.id).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    return g.label;
  }

  function openPage(row) {
    if (openPageInLibrary(row.book, row.pageId) === 'cancelled') return;
    focusReaderLineId(row.book, row.pageId, row.lineId);
  }

  const emptyText = {
    open: 'No open tasks. Boxes you draw (☐) become tasks when a page is transcribed.',
    waiting: 'Nothing is waiting. Use a task’s ⋯ menu to mark it WAITING.',
    done: 'No finished tasks yet.',
    cancelled: 'Nothing is cancelled. Use a task’s ⋯ menu to mark it CANCELLED.',
    all: 'No tasks yet. Boxes you draw (☐) become tasks when a page is transcribed.'
  };

  onMount(() => {
    if ($dataFolderReady && $savedPages.length === 0 && !$isScanning) scanLocalPages();
    ensureTimelineLoaded();
  });
</script>

<div class="tv">
  <div class="tv-head">
    <h2>Tasks</h2>
    <div class="chips" role="group" aria-label="Show">
      {#each TASK_FILTERS as f (f.id)}
        <button type="button" class="ch" class:on={$taskFilter === f.id} aria-pressed={$taskFilter === f.id}
          on:click={() => setTaskFilter(f.id)}>{f.label} <span class="c">{counts[f.id]}</span></button>
      {/each}
    </div>
    <input class="q" type="search" placeholder="Find in tasks, notebook, page, tag, date…" aria-label="Find tasks"
      bind:value={query} on:keydown={(e) => { if (e.key === 'Escape' && query) { query = ''; e.preventDefault(); } }} />
    <span class="grow"></span>
    <label class="sel">Group by
      <select value={$taskGroupBy} on:change={(e) => setTaskGroupBy(e.currentTarget.value)}>
        {#each TASK_GROUPS as g (g.id)}<option value={g.id}>{g.label}</option>{/each}
      </select>
    </label>
  </div>

  {#if !$dataFolderReady}
    <div class="empty">Choose the folder your pages are saved in (Settings → Data Folder) to see their tasks.</div>
  {:else if $isScanning && !$taskRows.length}
    <div class="empty">Reading your notebooks…</div>
  {:else if !shown.length}
    <div class="empty">{query.trim() && byState.length ? `No ${$taskFilter === 'all' ? '' : $taskFilter + ' '}tasks match “${query.trim()}”.` : emptyText[$taskFilter]}</div>
  {:else}
    {#each groups as g (g.kind + ':' + g.id)}
      <section class="grp">
        <h3>
          {#if g.kind === 'project' && g.id}<TagChip tag={g.id} />{:else}{groupLabel(g)}{/if}
          <span class="c">{g.rows.length} {plural(g.rows.length, 'task')}</span>
        </h3>
        <div class="rows">
          {#each g.rows as row (row.key)}
            <TaskRow {row} hideProject={g.kind === 'project'} onOpenPage={openPage} />
          {/each}
        </div>
      </section>
    {/each}
    {#if $taskGroupBy === 'project' && groups.length && !groups[groups.length - 1].id}
      <p class="note">“{NO_PROJECT}”: tag a page with its project number (Library, the reader’s tag strip) and its tasks move under it.</p>
    {/if}
  {/if}
</div>

<style>
  .tv { flex: 1; overflow-y: auto; padding: 18px 24px 24px; }
  .tv-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 16px; }
  .tv-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .grow { flex: 1; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .ch {
    padding: 4px 11px;
    border: 1px solid #ddd;
    border-radius: 14px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
  }
  .ch:hover { border-color: #bbb; color: #222; }
  .ch.on { background: #eef3ff; border-color: #4a7cf7; color: #2c56c4; font-weight: 600; }
  .c { font-variant-numeric: tabular-nums; color: #999; font-weight: 400; }
  .q { flex: 0 1 320px; min-width: 160px; font: inherit; font-size: 12px; padding: 5px 9px; border: 1px solid #ddd; border-radius: 14px; background: #fff; }
  .q:focus { outline: none; border-color: #4a7cf7; }
  .sel { font-size: 12px; color: #666; display: inline-flex; align-items: center; gap: 6px; }
  .sel select { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 6px; background: #fff; }

  .grp { margin-bottom: 16px; max-width: 980px; }
  .grp h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .grp h3 .c { text-transform: none; letter-spacing: 0; }
  .rows { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  .empty { padding: 40px 12px; text-align: center; color: #999; font-size: 13px; }
  .note { max-width: 980px; font-size: 12px; color: #999; margin: 4px 0 0; }
</style>
