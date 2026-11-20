<!--
  PersonItems.svelte — "Open items" on a Person tag's page (v3.23.0,
  docs/TRANSCRIPT-STRUCTURE-SPEC.md D.2), where other tags show TagTasksPanel:
  open tasks (TODO, WAITING) inside the person's blocks on any page carrying the
  tag, plus WAITING tasks anywhere whose text names them (lib/tasks.js
  personOpenItems). Rows are the Tasks view's TaskRow: a tick or the ⋯ menu goes
  through stores/tasks.js changeTask(), the one task write path.

  Copy agenda: the same items as indented markdown (`TODO` / `WAITING`, grouped
  under their project), to the clipboard only (lib/clipboard.js). The app
  writes nothing to LogSeq.
-->
<script>
  import { log } from '$stores';
  import { taskRows } from '$stores/tasks.js';
  import { tagInfo } from '$stores/tags.js';
  import { personOpenItems, agendaMarkdown } from '$lib/tasks.js';
  import { tagLabel } from '$lib/tags.js';
  import { copyMarkdown } from '$lib/clipboard.js';
  import TaskRow from '../tasks/TaskRow.svelte';

  export let tag;

  $: items = personOpenItems($taskRows, tag, $tagInfo);
  $: name = tagLabel(tag, $tagInfo);

  function copy() {
    copyMarkdown(agendaMarkdown(items), `the open items for ${name}`, log);
  }
</script>

<aside class="pi" aria-label="Open items for {name}">
  <div class="pi-head">
    <h3>Open items <span class="n">{items.length}</span></h3>
    <button type="button" class="copy" disabled={!items.length} on:click={copy}
      title="Copy the open items as a markdown list (TODO / WAITING), for a meeting or a LogSeq page">Copy agenda</button>
  </div>
  {#if items.length}
    <div class="rows">
      {#each items as row (row.key)}
        <TaskRow {row} hidePeople />
      {/each}
    </div>
  {:else}
    <p class="empty">Nothing open for {name}. Open tasks in blocks that name them, and WAITING tasks that name them, show here.</p>
  {/if}
</aside>

<style>
  .pi { flex: 1 1 340px; max-width: 460px; min-width: 0; }
  .pi-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  h3 { margin: 0; font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.06em; }
  .n { color: #999; font-weight: 400; letter-spacing: 0; }
  .copy { padding: 3px 10px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #444; font-size: 12px; cursor: pointer; }
  .copy:hover:not(:disabled) { background: #f2f2f4; }
  .copy:disabled { opacity: 0.5; cursor: default; }
  .rows { background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  .empty { padding: 20px 8px; margin: 0; text-align: center; color: #999; font-size: 12.5px; }
</style>
