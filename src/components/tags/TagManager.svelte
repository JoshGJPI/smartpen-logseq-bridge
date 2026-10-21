<!--
  TagManager.svelte — Settings → Tags → Manage Tags (v3.1.0 page tags; mockup 7,
  shown in TagManagerDialog): every tag
  with how many pages and notebooks carry it (straight from the sidecar), and
  Rename, Merge into…, Delete; plus Reset dismissed suggestions.

  Renaming onto a name that already exists is a merge and asks first. Delete
  removes the label from pages and never touches a page. Every change is one
  locked write of `_tags.json` (stores/tags.js), rolled back with an Activity
  Log entry if it fails.
-->
<script>
  import { tick } from 'svelte';
  import { tagStatsList, dismissedTags, renameTag, mergeTags, deleteTag, resetDismissed } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { normalizeTag } from '$lib/tags.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';

  let editing = null;   // tag being renamed
  let draft = '';
  let merging = null;   // tag whose Merge into… list is open
  let field;

  $: rows = $tagStatsList;
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
  {#if disabled}
    <p class="help">Choose a data folder to manage tags.</p>
  {:else if !rows.length}
    <p class="help">No tags yet. Tag a page beside it in the Library reader, or select pages in a notebook's grid.</p>
  {:else}
    <table>
      <thead><tr><th>Tag</th><th>Pages</th><th>Notebooks</th><th><span class="sr">Actions</span></th></tr></thead>
      <tbody>
        {#each rows as r (r.tag)}
          <tr>
            <td class="name">
              {#if editing === r.tag}
                <input bind:this={field} bind:value={draft} aria-label="New name for {r.tag}" on:keydown={onKey} on:blur={commitRename} />
              {:else}
                <TagChip tag={r.tag} />
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
  .tm { font-size: 0.8rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
  th { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
  td { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  td.name { max-width: 150px; }
  .acts { text-align: right; white-space: nowrap; }
  button, select, input {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.72rem;
    cursor: pointer;
  }
  button + button { margin-left: 3px; }
  button:hover:not(:disabled) { border-color: var(--text-secondary); }
  button:disabled { opacity: 0.45; cursor: default; }
  button.del:hover:not(:disabled) { background: var(--destructive); }
  input { width: 100%; cursor: text; }
  .foot { margin-top: 10px; }
  .help { margin: 8px 0 0; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
