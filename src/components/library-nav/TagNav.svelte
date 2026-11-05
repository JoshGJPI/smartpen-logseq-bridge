<!--
  TagNav.svelte — the left panel beside a tag's page, Untagged, the tag manager
  or the suggestions queue (v3.14.0): every tag, projects then keywords, with
  its page count, and Untagged; a click opens that tag's page, so moving from
  one project to the next takes no trip back to the Library home. The open
  tag is marked. Counts come from the tag store, never from a page read.
-->
<script>
  import { untaggedSummary, openLibraryView } from '$stores';
  import { tagStatsList } from '$stores/tags.js';
  import { isProjectTag, compareTags } from '$lib/tags.js';

  /** The open Library view (`libraryView`), to mark the current tag. */
  export let view = null;

  $: sorted = [...$tagStatsList].sort((a, b) => compareTags(a.tag, b.tag));
  $: projects = sorted.filter((t) => isProjectTag(t.tag));
  $: keywords = sorted.filter((t) => !isProjectTag(t.tag));
  $: current = view?.kind === 'tag' ? view.tag : view?.kind === 'untagged' ? '\u0000untagged' : null;
</script>

<div class="tn">
  {#each [['Projects', projects], ['Keywords', keywords]] as [title, list] (title)}
    {#if list.length}
      <p class="h">{title} <span>{list.length}</span></p>
      {#each list as t (t.tag)}
        <button type="button" class="row" class:on={current === t.tag} aria-current={current === t.tag ? 'page' : undefined}
          on:click={() => openLibraryView({ kind: 'tag', tag: t.tag })}
          title="{t.tag}: {t.pages} {t.pages === 1 ? 'page' : 'pages'} in {t.notebooks} {t.notebooks === 1 ? 'notebook' : 'notebooks'}">
          <span class="name" class:mono={title === 'Projects'}>{t.tag}</span>
          <span class="n">{t.pages}</span>
        </button>
      {/each}
    {/if}
  {/each}
  {#if $untaggedSummary.pageCount}
    <p class="h">Other</p>
    <button type="button" class="row" class:on={current === '\u0000untagged'} on:click={() => openLibraryView({ kind: 'untagged' })}
      title="Pages with no tag">
      <span class="name untagged">Untagged</span>
      <span class="n">{$untaggedSummary.pageCount}</span>
    </button>
  {/if}
  {#if !projects.length && !keywords.length}
    <p class="note">No tags yet. Tag a page from the reader's tag strip or a page grid's + tag.</p>
  {/if}
</div>

<style>
  .tn { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
  .h { margin: 12px 0 4px; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary); }
  .h:first-child { margin-top: 0; }
  .h span { letter-spacing: 0; opacity: 0.8; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text-primary);
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: rgba(255, 255, 255, 0.05); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .row.on { background: var(--selected-bg); box-shadow: inset 3px 0 0 var(--selected-line); border-radius: 4px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; }
  .untagged { font-style: italic; color: var(--text-secondary); }
  .n { font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .note { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
</style>
