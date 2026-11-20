<!--
  MentionedPages.svelte — "Mentioned, not tagged" on a Person tag's page
  (v3.23.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md D.2): pages whose transcript names
  the person (display name or alias, whole word, case-sensitive) but don't carry
  the tag, each with the line that names them and *Tag page*. Suggestions only:
  nothing is tagged without that click (decision 5). From the scan records' text
  (lib/tag-scope.js mentionedNotTagged), no page reads.
-->
<script>
  import { savedPages, bookAliases } from '$stores';
  import { pageTags, tagInfo, addTagToPages } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { mentionedNotTagged } from '$lib/tag-scope.js';
  import { tagLabel } from '$lib/tags.js';
  import { formatBookName } from '$utils/formatting.js';
  import { plural } from '$lib/plural.js';

  export let tag;
  /** (record) => void: open the page */
  export let onOpen = () => {};

  const FIRST = 10;
  let all = false;

  $: list = mentionedNotTagged($savedPages, tag, $tagInfo, $pageTags);
  $: shown = all ? list : list.slice(0, FIRST);
  $: name = tagLabel(tag, $tagInfo);

  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
  $: where = (r) => `${formatBookName(r.book, $bookAliases, 'alias-only') || `B${r.book}`} · p.${idOf(r)}`;
</script>

{#if list.length}
  <section class="mp" aria-label="Mentioned, not tagged">
    <h3>Mentioned, not tagged <span class="n">{list.length} {plural(list.length, 'page')}</span></h3>
    <ul>
      {#each shown as m (m.key)}
        <li>
          <button type="button" class="pg" on:click={() => onOpen(m.record)} title="Open this page">{where(m.record)}</button>
          <span class="ln" title={m.line}>{m.line}</span>
          <button type="button" class="tag" disabled={!$dataFolderReady} on:click={() => addTagToPages([m.key], tag)}
            title="Add {name} to this page">Tag page</button>
        </li>
      {/each}
    </ul>
    {#if list.length > FIRST}
      <button type="button" class="more" on:click={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>
    {/if}
  </section>
{/if}

<style>
  .mp { margin-top: 22px; max-width: 980px; }
  h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.06em; }
  .n { color: #999; font-weight: 400; letter-spacing: 0; text-transform: none; }
  ul { list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #e3e3e3; border-radius: 8px; overflow: hidden; }
  li { display: flex; align-items: center; gap: 10px; padding: 7px 12px; font-size: 12.5px; }
  li + li { border-top: 1px solid #f0f0f0; }
  .pg { flex-shrink: 0; padding: 0; border: none; background: none; color: #2c56c4; font: inherit; cursor: pointer; }
  .pg:hover { text-decoration: underline; }
  .ln { flex: 1; min-width: 0; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag { flex-shrink: 0; padding: 2px 10px; border: 1px solid #d9ccf5; border-radius: 6px; background: #f6f1ff; color: #6d28d9; font-size: 12px; cursor: pointer; }
  .tag:hover:not(:disabled) { background: #ede3ff; }
  .tag:disabled { opacity: 0.5; cursor: default; }
  .more { margin-top: 6px; padding: 0; border: none; background: none; color: #2c56c4; font-size: 12px; cursor: pointer; }
  .more:hover { text-decoration: underline; }
</style>
