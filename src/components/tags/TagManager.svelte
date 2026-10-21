<!--
  TagManager.svelte — the tag table (v3.1.0 page tags; mockup 7), shown in the
  Library's Manage tags view (TagManagerView, v3.2.0; it was a Settings
  dialog): every tag with how many pages and notebooks carry it (straight from
  the sidecar), and Rename, Merge into…, Delete; plus Reset dismissed
  suggestions. A tag's chip opens its pages. Click a column header to sort by
  it, again to reverse (remembered per viewer). After a rename, merge, delete
  or reset, a bar offers Undo until the next tag change (`tagUndo`).

  Renaming onto a name that already exists is a merge and asks first. Delete
  removes the label from pages and never touches a page. Every change is one
  locked write of `_tags.json` (stores/tags.js), rolled back with an Activity
  Log entry if it fails.
-->
<script>
  import { tick } from 'svelte';
  import {
    tagStatsList, dismissedTags, renameTag, mergeTags, deleteTag, resetDismissed, tagUndo, undoTagChange
  } from '$stores/tags.js';
  import { openLibraryView } from '$stores/viewer.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { normalizeTag, sortTagStats, nextTagStatSort, parseTagStatSort, TAG_MANAGER_SORT_KEY } from '$lib/tags.js';
  import { readJson, write } from '$lib/safe-storage.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';

  let editing = null;   // tag being renamed
  let draft = '';
  let merging = null;   // tag whose Merge into… list is open
  let field;

  let sort = parseTagStatSort(readJson(TAG_MANAGER_SORT_KEY, null));
  $: rows = sortTagStats($tagStatsList, sort);

  const COLUMNS = [
    { by: 'tag', label: 'Tag' },
    { by: 'pages', label: 'Pages' },
    { by: 'notebooks', label: 'Notebooks' }
  ];

  function sortBy(by) {
    sort = nextTagStatSort(sort, by);
    write(TAG_MANAGER_SORT_KEY, JSON.stringify(sort));
  }

  // Reactive, so the headers re-render when `sort` changes.
  $: ariaSort = (by) => (sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  $: dismissedCount = Object.values($dismissedTags).reduce((n, l) => n + l.length, 0);
  $: disabled = !$dataFolderReady;

  const pagesOf = (tag) => rows.find((r) => r.tag === tag)?.pages || 0;
  const n = (k) => `${k} ${plural(k, 'page')}`;

  async function startRename(tag) {
    merging = null;
    editing = tag;
    draft = tag;
    await tick();
    field && field.select();
  }

  async function commitRename() {
    const from = editing;
    const to = normalizeTag(draft);
    editing = null;
    if (!from || !to || to === from) return;
    if (rows.some((r) => r.tag === to)) {
      if (!window.confirm(`“${to}” already exists. Merge “${from}” into it? ${n(pagesOf(from))} relabelled; “${from}” is removed.`)) return;
    }
    await renameTag(from, to);
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; }
  }

  async function merge(from, into) {
    merging = null;
    if (!into || into === from) return;
    if (!window.confirm(`Merge “${from}” into “${into}”? ${n(pagesOf(from))} relabelled; “${from}” is removed.`)) return;
    await mergeTags(from, into);
  }

  async function remove(tag) {
    if (!window.confirm(`Remove “${tag}” from ${n(pagesOf(tag))}? The pages themselves are not touched.`)) return;
    await deleteTag(tag);
  }

  async function reset() {
    if (!window.confirm(`Bring back ${dismissedCount} dismissed ${plural(dismissedCount, 'suggestion')}?`)) return;
    await resetDismissed();
  }
</script>

<div class="tm">
  {#if $tagUndo && !disabled}
    <div class="undo" role="status">
      <span class="undo-msg">{$tagUndo.label}.</span>
      <button type="button" class="undo-btn" on:click={undoTagChange}>Undo</button>
      <button type="button" class="undo-x" aria-label="Dismiss" title="Dismiss" on:click={() => tagUndo.set(null)}>×</button>
    </div>
  {/if}
  {#if disabled}
    <p class="help">Choose a data folder to manage tags.</p>
  {:else if !rows.length}
    <p class="help">No tags yet. Tag a page beside it in the reader, or Select pages in a notebook's grid and add a tag to all of them.</p>
  {:else}
    <table>
      <thead>
        <tr>
          {#each COLUMNS as c (c.by)}
            <th aria-sort={ariaSort(c.by)}>
              <button type="button" class="sort" class:on={sort.by === c.by} on:click={() => sortBy(c.by)} title="Sort by {c.label.toLowerCase()}">
                {c.label}<span class="arrow" aria-hidden="true">{sort.by === c.by ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
              </button>
            </th>
          {/each}
          <th><span class="sr">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.tag)}
          <tr>
            <td class="name">
              {#if editing === r.tag}
                <input bind:this={field} bind:value={draft} aria-label="New name for {r.tag}" on:keydown={onKey} on:blur={commitRename} />
              {:else}
                <TagChip tag={r.tag} onClick={() => openLibraryView({ kind: 'tag', tag: r.tag })} title="Show the pages tagged {r.tag}" />
              {/if}
            </td>
            <td>{r.pages}</td>
            <td>{r.notebooks}</td>
            <td class="acts">
              {#if merging === r.tag}
                <select aria-label="Merge {r.tag} into" on:change={(e) => merge(r.tag, e.currentTarget.value)} on:blur={() => (merging = null)}>
                  <option value="">Merge into…</option>
                  {#each rows.filter((x) => x.tag !== r.tag) as o (o.tag)}<option value={o.tag}>{o.tag}</option>{/each}
                </select>
              {:else}
                <button type="button" on:click={() => startRename(r.tag)}>Rename</button>
                <button type="button" disabled={rows.length < 2} on:click={() => { editing = null; merging = r.tag; }}>Merge into…</button>
                <button type="button" class="del" on:click={() => remove(r.tag)}>Delete</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if !disabled}
    <div class="foot">
      <button type="button" disabled={!dismissedCount} on:click={reset}>Reset dismissed suggestions{dismissedCount ? ` (${dismissedCount})` : ''}</button>
    </div>
    <p class="help">Tags are kept in pages/_tags.json beside your pages; they never change a page's ink or transcript.</p>
  {/if}
</div>

<style>
  .tm { font-size: 13px; color: #333; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e6e6e6; border-radius: 8px; }
  th, td { padding: 7px 10px; border-bottom: 1px solid #eee; text-align: left; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  th { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #999; }
  td { font-variant-numeric: tabular-nums; }
  th button.sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  th button.sort:hover { background: none; color: #444; }
  th button.sort.on { color: #2c56c4; }
  .arrow { display: inline-block; width: 8px; font-size: 8px; }
  td.name { max-width: 260px; }
  .acts { text-align: right; white-space: nowrap; }
  button, select, input {
    padding: 3px 9px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    color: #555;
    font-size: 12px;
    cursor: pointer;
  }
  .acts button + button { margin-left: 4px; }
  button:hover:not(:disabled) { background: #f0f0f0; color: #222; }
  button:disabled { opacity: 0.45; cursor: default; }
  button.del:hover:not(:disabled) { border-color: #c0392b; background: #fdecea; color: #a32e22; }
  input { width: 100%; cursor: text; color: #222; }
  input:focus, select:focus { outline: none; border-color: #4a7cf7; }
  .foot { margin-top: 12px; }
  .undo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    padding: 7px 10px 7px 14px;
    border: 1px solid #c9d7fb;
    border-radius: 8px;
    background: #eef3ff;
    color: #2c3e70;
  }
  .undo-msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .undo-btn { border-color: #4a7cf7; color: #2c56c4; font-weight: 600; }
  .undo-btn:hover:not(:disabled) { background: #dfe8ff; color: #2c56c4; }
  .undo-x { border: none; background: none; color: #7a86a8; font-size: 16px; line-height: 1; padding: 0 4px; }
  .undo-x:hover:not(:disabled) { background: none; color: #222; }
  .help { margin: 10px 0 0; font-size: 12px; color: #888; line-height: 1.5; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
