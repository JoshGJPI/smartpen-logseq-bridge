<!--
  TasksView.svelte — Library › Tasks (v3.4.0): every transcript line with a
  TODO / DONE / WAITING / CANCELLED state, across notebooks, shown by state
  (toggle chips with counts, v3.12.0: TaskStateChips) and grouped by project
  tag, date written or notebook. A project group's heading opens that tag's
  page in the Library (v3.12.0), which lists the same tasks beside its pages.
  The head (chips, search, Group by) stays at the top while the list scrolls. Opened from the Library home's Tasks card or the header's Tasks
  button (`libraryView: { kind: 'tasks' }`); the breadcrumb's Library goes back.

  Rows come from the scan (stores/tasks.js), never from reading a page. A tick
  writes that one line of its PageDoc (lib/viewer/task-state.js); the toast
  (TaskToast, in BookViewer) offers Undo.
-->
<script>
  import { onMount } from 'svelte';
  import { savedPages, isScanning, bookAliases, openPageInLibrary, focusReaderLineId, ensureTimelineLoaded, openLibraryView } from '$stores';
  import { dataFolderReady } from '$stores/settings.js';
  import { taskRows, taskCountsStore, taskStatesShown, taskGroupBy, setTaskGroupBy, taskQuery, shownTaskGroups } from '$stores/tasks.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { rowsInStates, stateLabel, taskGroupDomId, TASK_GROUPS, NO_PROJECT } from '$lib/tasks.js';
  import { dayStart } from '$lib/timeline.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';
  import TaskRow from './TaskRow.svelte';
  import TagChip from '../tags/TagChip.svelte';
  import TaskStateChips from './TaskStateChips.svelte';

  let stuck = false;
  // The groups come from the store (v3.14.0) so the left panel lists the same ones.
  $: query = $taskQuery;
  $: byState = rowsInStates($taskRows, $taskStatesShown);
  $: groups = $shownTaskGroups;
  $: shown = groups.flatMap((g) => g.rows);
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

  $: shownWords = $taskStatesShown.map(stateLabel).join(' / ');
  $: emptyText = !$taskRows.length
    ? 'No tasks yet. Boxes you draw (☐) become tasks when a page is transcribed.'
    : !$taskStatesShown.length
      ? 'Every status is turned off. Pick one above to see its tasks.'
      : `No ${shownWords} tasks.`;

  onMount(() => {
    if ($dataFolderReady && $savedPages.length === 0 && !$isScanning) scanLocalPages();
    ensureTimelineLoaded();
  });
</script>

<div class="tv" on:scroll={(e) => (stuck = e.currentTarget.scrollTop > 0)}>
  <div class="tv-head" class:stuck>
    <h2>Tasks</h2>
    <TaskStateChips {counts} />
    <input class="q" type="search" placeholder="Find in tasks, notebook, page, tag, date…" aria-label="Find tasks"
      bind:value={$taskQuery} on:keydown={(e) => { if (e.key === 'Escape' && $taskQuery) { $taskQuery = ''; e.preventDefault(); } }} />
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
    <div class="empty">{query.trim() && byState.length ? `No ${shownWords} tasks match “${query.trim()}”.` : emptyText}</div>
  {:else}
    {#each groups as g (g.kind + ':' + g.id)}
      <section class="grp" id={taskGroupDomId(g)}>
        <h3>
          {#if g.kind === 'project' && g.id}
            <button type="button" class="tag-link" title="Open {g.id}: its pages and tasks"
              on:click={() => openLibraryView({ kind: 'tag', tag: g.id })}><TagChip tag={g.id} /></button>
          {:else}{groupLabel(g)}{/if}
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
  /* Sticky (v3.12.0): the chips, search and Group by stay in reach while the list scrolls. The
     negative margin pulls it over .tv's top padding so rows don't show above it. */
  .tv-head {
    position: sticky;
    top: -18px;
    z-index: 2;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin: -18px -24px 16px;
    padding: 18px 24px 10px;
    background: #f5f5f5;
    border-bottom: 1px solid transparent;
  }
  .tv-head.stuck { border-bottom-color: #e3e3e3; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04); }
  .tv-head h2 { margin: 0; font-size: 18px; font-weight: 600; color: #222; }
  .grow { flex: 1; }
  .tag-link { padding: 0; border: none; background: none; font: inherit; cursor: pointer; border-radius: 99px; }
  .tag-link:hover :global(.tg) { text-decoration: underline; filter: brightness(0.95); }
  .tag-link:focus-visible { outline: 2px solid #4a7cf7; outline-offset: 1px; }
  .c { font-variant-numeric: tabular-nums; color: #999; font-weight: 400; }
  .q { flex: 0 1 320px; min-width: 160px; font: inherit; font-size: 12px; padding: 5px 9px; border: 1px solid #ddd; border-radius: 14px; background: #fff; }
  .q:focus { outline: none; border-color: #4a7cf7; }
  .sel { font-size: 12px; color: #666; display: inline-flex; align-items: center; gap: 6px; }
  .sel select { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 6px; background: #fff; }

  /* scroll-margin: a jump from the left panel lands below the sticky head. */
  .grp { margin-bottom: 16px; max-width: 980px; scroll-margin-top: 64px; }
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
