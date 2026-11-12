<!--
  CanvasPageTags.svelte — the Editor toolbar's Tags button and its popover
  (v3.19.0). Tag the pages on the canvas without leaving the Editor.

  Which pages (lib/canvas-page-targets.js tagTargetPages): the selection's
  pages when strokes are selected, else every page shown, one PageTagsInline
  row each, capped at MAX_TAG_TARGETS. Suggestions come from each page's saved
  transcript (scan record, no page read) plus any unsaved MyScript result.

  Tags save as they change, straight to _tags.json (stores/tags.js): not an
  unsaved edit, nothing to Save, no PageDoc written. A page that was never
  saved keeps its tags waiting in the sidecar until it is.

  Keys: the popover's keys never reach the canvas behind it (Delete or
  Backspace on a focused chip must not delete the selected strokes). Escape
  closes the tag list first, then the popover.
-->
<script>
  import { tick } from 'svelte';
  import { pageTags } from '$stores/tags.js';
  import { savedPages } from '$stores/saved-pages.js';
  import { pageTranscriptions } from '$stores/transcription.js';
  import { tagKey } from '$lib/tags.js';
  import { tagTargetPages, suggestionLinesFor } from '$lib/canvas-page-targets.js';
  import PageTagsInline from '../tags/PageTagsInline.svelte';

  /** `"<book>/<page>"` ids of the selected strokes' pages. */
  export let selectionIds = [];
  /** `"<book>/<page>"` ids of the pages shown on the canvas. */
  export let shownIds = [];
  export let hasSelection = false;

  let open = false;
  let btnEl;
  let popEl;
  let pos = { top: 0, left: 0 };

  $: target = tagTargetPages(selectionIds, shownIds, hasSelection);
  $: enabled = target.pages.length > 0;
  $: tagCount = new Set(target.pages.flatMap((p) => $pageTags[tagKey(p.book, p.pageId)] || [])).size;
  $: if (!enabled && open) open = false;

  // Unsaved MyScript lines per page id, from the canvas-keyed transcription map.
  $: pending = pendingLinesByPage($pageTranscriptions);
  function pendingLinesByPage(map) {
    const out = new Map();
    for (const t of map?.values?.() || []) {
      const pi = t?.pageInfo;
      if (!pi || pi.book == null || pi.page == null) continue;
      out.set(`${pi.book}/${pi.page}`, t.lines || []);
    }
    return out;
  }

  $: rows = target.pages.map((p) => ({
    ...p,
    id: `${p.book}/${p.pageId}`,
    lines: suggestionLinesFor(p, $savedPages, pending.get(`${p.book}/${p.pageId}`))
  }));

  $: title = !enabled
    ? 'Load a page onto the canvas to tag it'
    : target.pages.length === 1
      ? `Tags for B${target.pages[0].book}/P${target.pages[0].pageId} (saved at once, nothing to Save)`
      : `Tags for the ${target.pages.length}${target.more ? '+' : ''} ${target.fromSelection ? 'pages of the selection' : 'pages shown'}`;

  async function toggle() {
    if (open) { open = false; return; }
    if (!enabled) return;
    const r = btnEl.getBoundingClientRect();
    const width = Math.min(460, window.innerWidth - 16);
    pos = { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width };
    open = true;
    await tick();
    popEl?.querySelector('input:not(:disabled)')?.focus();
  }

  function close(focusButton = true) {
    open = false;
    if (focusButton) btnEl?.focus();
  }

  function onWindowPointer(e) {
    if (!open) return;
    if (btnEl?.contains(e.target) || popEl?.contains(e.target)) return;
    open = false;
  }

  // Capture phase: Escape is the popover's unless a tag list is open (TagInput
  // closes that itself), and preventDefault keeps the canvas's Escape (clear
  // selection) from also running.
  function onWindowKey(e) {
    if (!open || e.key !== 'Escape' || e.isComposing) return;
    const t = e.target;
    if (popEl?.contains(t) && t?.getAttribute?.('aria-expanded') === 'true') return;
    e.preventDefault();
    close();
  }

  function onWindowScroll(e) {
    if (open && !popEl?.contains(e.target)) open = false;
  }
</script>

<svelte:window
  on:pointerdown={onWindowPointer}
  on:keydown|capture={onWindowKey}
  on:scroll|capture={onWindowScroll}
  on:resize={() => (open = false)}
/>

<button
  type="button"
  class="tb-btn cpt-btn"
  class:open
  bind:this={btnEl}
  on:click|stopPropagation={toggle}
  disabled={!enabled}
  {title}
  aria-haspopup="dialog"
  aria-expanded={open}
>
  <span aria-hidden="true">🏷</span> Tags{#if tagCount > 0}<span class="cpt-count">{tagCount}</span>{/if}
</button>

{#if open}
  <!-- Keys typed or pressed in here stay here: the canvas listens on the window. -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="cpt-pop"
    bind:this={popEl}
    style="top: {pos.top}px; left: {pos.left}px; width: {pos.width}px;"
    role="dialog"
    aria-label="Page tags"
    on:keydown|stopPropagation
    on:click|stopPropagation
  >
    <div class="cpt-hd">
      <span>{target.fromSelection ? 'Selected pages' : target.pages.length === 1 ? 'Page tags' : 'Pages shown'}</span>
      <span class="cpt-note">Saved as you change them</span>
    </div>
    {#each rows as r (r.id)}
      <div class="cpt-row">
        <PageTagsInline book={r.book} pageId={r.pageId} lines={r.lines} heading={`B${r.book} / P${r.pageId}`} />
      </div>
    {/each}
    {#if target.more > 0}
      <p class="cpt-more">
        +{target.more} more {target.more === 1 ? 'page' : 'pages'}. Select strokes on a page, or untick pages in the page list, to tag {target.more === 1 ? 'it' : 'them'} here.
      </p>
    {/if}
  </div>
{/if}

<style>
  /* .tb-btn's look comes from StrokeCanvas's toolbar; repeated here because
     Svelte scopes styles per component. */
  .cpt-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: 500;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  .cpt-btn:hover:not(:disabled),
  .cpt-btn.open {
    border-color: var(--text-secondary);
    background: var(--bg-secondary);
  }
  .cpt-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: transparent;
    color: var(--text-secondary);
  }
  .cpt-count {
    min-width: 1.4em;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--accent);
    color: #fff;
    font-size: 0.6875rem;
    line-height: 1.5;
    text-align: center;
  }

  .cpt-pop {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    background: var(--bg-secondary, #fff);
    border: 1px solid var(--border, #dcdce2);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(20, 20, 40, 0.16);
  }
  .cpt-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .cpt-note { font-weight: 400; color: var(--text-secondary); font-size: 0.6875rem; }
  .cpt-row { padding-top: 6px; border-top: 1px solid var(--border, #e6e6ea); }
  .cpt-more { margin: 0; font-size: 0.6875rem; color: var(--text-secondary); }
</style>
