<!--
  BookTypeFilterSelect.svelte — "Show: All types | Work | Personal | No type"
  (v3.15.0). One store (`bookTypeFilter`), so the Library home and the date
  features (Dates tab, Timeline, date loads) always show the same notebooks.
  Renders nothing until some notebook has a type, unless a filter is still set.
-->
<script>
  import { bookTypeNames, bookTypeFilter, setBookTypeFilter } from '$stores/book-types.js';
  import { NO_TYPE, typeId } from '$lib/book-types.js';

  export let theme = 'light'; // 'light' | 'dark'
  /** Text before the select; '' for none. */
  export let label = 'Type';

  $: names = $bookTypeNames;
  $: filter = $bookTypeFilter;
  // A filter naming a type no notebook has any more stays listed, so it can be seen and cleared.
  $: stale = filter && filter !== NO_TYPE && !names.some((n) => typeId(n) === typeId(filter));
  $: value = filter && filter !== NO_TYPE ? (names.find((n) => typeId(n) === typeId(filter)) || filter) : (filter || '');
</script>

{#if names.length || filter}
  <label class="bt {theme}" class:on={!!filter} title="Show only notebooks of one type (Books tab sets each notebook's type)">
    {#if label}<span class="bt-label">{label}</span>{/if}
    <select {value} on:change={(e) => setBookTypeFilter(e.currentTarget.value || null)}>
      <option value="">All types</option>
      {#each names as n (n)}
        <option value={n}>{n}</option>
      {/each}
      {#if stale}<option value={filter}>{filter} (none)</option>{/if}
      <option value={NO_TYPE}>No type</option>
    </select>
  </label>
{/if}

<style>
  .bt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
  .bt-label { white-space: nowrap; }
  select {
    height: 26px;
    padding: 0 6px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    max-width: 160px;
  }

  .light .bt-label { color: #62626e; }
  .light select { background: #fff; border: 1px solid #dcdce2; color: #45454f; }
  .light.on select { color: #2f5fd8; border-color: #c7d6fb; background: #eef3ff; font-weight: 600; }

  .dark .bt-label { color: var(--text-secondary); }
  .dark select { background: var(--bg-tertiary); border: 1px solid var(--border); color: var(--text-primary); }
  .dark.on select { border-color: var(--accent); font-weight: 600; }
</style>
