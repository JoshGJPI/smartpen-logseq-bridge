<!--
  TaskRow.svelte — one task in the Tasks view (v3.4.0): tick box, text, the
  line it sits under, a link to its page (opens the reader on that line), the
  date written, the project chip (left out when grouped by project, where the
  group heading names it) and the ⋯ menu that sets / clears WAITING and CANCELLED.
-->
<script>
  import { viewerDirtyPages, bookAliases } from '$stores';
  import { toggleTask, changeTask } from '$stores/tasks.js';
  import { formatBookName } from '$utils/formatting.js';
  import { dayStart } from '$lib/timeline.js';
  import { isClosedState } from '$lib/tasks.js';
  import TaskBox from './TaskBox.svelte';
  import TaskMenu from './TaskMenu.svelte';
  import TagChip from '../tags/TagChip.svelte';

  /** a buildTaskRows() row */
  export let row;
  /** Hide the project chip (the group heading shows it). */
  export let hideProject = false;
  /** (row) => void */
  export let onOpenPage = () => {};

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(day, last) {
    const d = dayStart(day);
    if (!d) return '';
    const a = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const e = last && last !== day ? dayStart(last) : null;
    const tail = e ? ` – ${MONTHS[e.getMonth()]} ${e.getDate()}` : '';
    return `${a}${tail}, ${(e || d).getFullYear()}`;
  }

  $: lock = $viewerDirtyPages.has(`${row.book}:${row.pageId}`)
    ? 'This page has unsaved transcript edits. Save or cancel them first.'
    : '';
  $: alias = formatBookName(row.book, $bookAliases, 'alias-only');
  $: where = `${alias || `B${row.book}`} · p.${row.pageId}`;
  $: when = dayLabel(row.day, row.lastDay);
</script>

<div class="row" class:done={isClosedState(row.state)}>
  <TaskBox state={row.state} {lock} onToggle={() => toggleTask(row.book, row.pageId, row.lineId)} />
  <span class="tx">{row.text}</span>
  <span class="meta">
    {#if row.state === 'waiting'}<span class="mk wait">WAITING</span>{/if}
    {#if row.state === 'done'}<span class="mk done">DONE</span>{/if}
    {#if row.state === 'cancelled'}<span class="mk cancel">CANCELLED</span>{/if}
    {#if !hideProject}
      {#each row.projects as p (p)}<TagChip tag={p} />{/each}
    {/if}
    <TaskMenu state={row.state} {lock} onSet={(s) => changeTask(row.book, row.pageId, row.lineId, s)} />
  </span>
  <span class="ctx">
    {#if row.parentText}<span class="under" title={row.parentText}>under “{row.parentText}”</span>{/if}
    <button type="button" class="pg" on:click={() => onOpenPage(row)} title="Open this page with the line marked">{where}</button>
    {#if when}<span>{when}</span>{/if}
  </span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 4px 10px;
    padding: 8px 12px;
    border-top: 1px solid #f0f0f0;
    align-items: start;
  }
  .row:first-child { border-top: 0; }
  .row:hover { background: #fafbff; }
  .tx { font-size: 13.5px; color: #222; min-width: 0; overflow-wrap: anywhere; }
  .row.done .tx { color: #999; text-decoration: line-through; }
  .meta { grid-row: 1; grid-column: 3; display: flex; gap: 6px; align-items: center; }
  .ctx {
    grid-column: 2 / 4;
    font-size: 11.5px;
    color: #999;
    display: flex;
    gap: 4px 10px;
    flex-wrap: wrap;
    align-items: center;
    min-width: 0;
  }
  .under { max-width: 46ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pg {
    padding: 0;
    border: none;
    background: none;
    color: #2c56c4;
    font: inherit;
    cursor: pointer;
  }
  .pg:hover { text-decoration: underline; }
  .mk { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; padding: 0 6px; border-radius: 4px; }
  .mk.wait { background: #f1eafe; color: #6d28d9; }
  .mk.done { background: #e8f5ec; color: #2f7d4f; }
  .mk.cancel { background: #eef0f3; color: #5f6368; }
</style>
