<!--
  TagBlockDialog.svelte — "Tag this block…" from a transcript line's ⋯ menu in
  the Library reader (v3.23.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md D.4). Picks a
  Person or Project tag (the page's own first, then every other person, or a
  typed project number or new person) and makes the line a root of that tag's
  block: stores/tags.js tagBlock() adds the tag to the page when it is missing
  and the `add` root in ONE write to _tags.json (a new person's type too).
  Topics have no block scope, so they are not offered. Opened through
  stores/tag-scope.js tagBlockDialog; one instance, in App.
-->
<script>
  import { tick } from 'svelte';
  import { pageTags, tagInfo, tagStatsList, tagBlock } from '$stores/tags.js';
  import { tagBlockDialog, closeTagBlockDialog } from '$stores/tag-scope.js';
  import { tagKey, normalizeTag, isProjectTag, tagTypeOf, tagAnswersTo, tagLabel, compareTags } from '$lib/tags.js';
  import { rootMatcher } from '$lib/tag-scope.js';
  import TagChip from './TagChip.svelte';

  let text = '';
  let field;

  $: d = $tagBlockDialog;
  $: key = d ? tagKey(d.book, d.pageId) : null;
  $: onPage = (key && $pageTags[key]) || [];
  $: known = [...new Set([...$tagStatsList.map((s) => s.tag), ...Object.keys($tagInfo)])];
  $: scoped = (t) => isProjectTag(t) || tagTypeOf(t, $tagInfo) === 'person';
  $: q = text.trim();
  $: matches = (t) => !q || tagAnswersTo(t, $tagInfo, q) || t.includes(normalizeTag(q) || '\u0000')
    || tagLabel(t, $tagInfo).toLowerCase().includes(q.toLowerCase());
  $: first = onPage.filter(scoped).filter(matches).sort(compareTags);
  $: people = known.filter((t) => !onPage.includes(t) && tagTypeOf(t, $tagInfo) === 'person' && !isProjectTag(t))
    .filter(matches).sort(compareTags).slice(0, 12);
  $: typed = normalizeTag(q);
  $: newRow = typed && !known.includes(typed) && !onPage.includes(typed)
    ? (isProjectTag(typed) ? { tag: typed, typeAs: null, label: `Add project ${typed}` } : { tag: typed, typeAs: { tag: typed, type: 'person', label: q }, label: `Add “${q}” as a person` })
    : null;
  $: projectOnly = typed && known.includes(typed) && isProjectTag(typed) && !onPage.includes(typed)
    ? { tag: typed, typeAs: null, label: `Add project ${typed}` } : null;

  $: if (d) focusField();
  async function focusField() {
    await tick();
    field && field.focus();
  }

  async function pick(tag, typeAs = null) {
    if (!d) return;
    const info = typeAs ? { ...$tagInfo, [tag]: { type: 'person', label: typeAs.label } } : $tagInfo;
    const match = rootMatcher(tag, info);
    const byText = !!match && match(d.text);
    const { book, pageId, lineId } = d;
    close();
    await tagBlock(book, pageId, tag, lineId, { byText, typeAs });
  }

  function close() {
    text = '';
    closeTagBlockDialog();
  }

  function onKey(e) {
    if (!d || e.key !== 'Escape') return;
    e.preventDefault();
    close();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if d}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="bd" on:click|self={close}>
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="tbd-h">
      <h2 id="tbd-h">Tag this block</h2>
      <p class="line" title={d.text}>{d.text}</p>
      <p class="sub">The line and everything indented under it go under the tag. The tag is added to the page if it isn’t there yet.</p>
      <input bind:this={field} bind:value={text} type="search" placeholder="Person or project number…" aria-label="Find a person or project" />
      <div class="opts">
        {#if first.length}<h3>On this page</h3>{/if}
        {#each first as t (t)}
          <button type="button" class="opt" on:click={() => pick(t)}><TagChip tag={t} /></button>
        {/each}
        {#if people.length}<h3>People</h3>{/if}
        {#each people as t (t)}
          <button type="button" class="opt" on:click={() => pick(t)}><TagChip tag={t} /></button>
        {/each}
        {#each [newRow || projectOnly].filter(Boolean) as r (r.tag)}
          <button type="button" class="opt new" on:click={() => pick(r.tag, r.typeAs)}>{r.label}</button>
        {/each}
        {#if !first.length && !people.length && !newRow && !projectOnly}
          <p class="none">No person or project matches. Type a name to add a person, or a project number.</p>
        {/if}
      </div>
      <div class="foot"><button type="button" on:click={close}>Cancel</button></div>
    </div>
  </div>
{/if}

<style>
  .bd { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.3); }
  .dlg { width: min(420px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border-radius: 10px; background: #fff; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25); }
  h2 { margin: 0; font-size: 15px; font-weight: 600; color: #222; }
  .line { margin: 0; padding: 4px 8px; border-left: 3px solid #c9b6ef; background: #faf8ff; font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { margin: 0; font-size: 12px; color: #888; }
  input { font: inherit; font-size: 13px; padding: 5px 9px; border: 1px solid #ddd; border-radius: 6px; }
  input:focus { outline: none; border-color: #4a7cf7; }
  .opts { overflow-y: auto; min-height: 60px; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
  h3 { margin: 6px 0 2px; font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
  .opt { padding: 2px 4px; border: none; border-radius: 6px; background: none; cursor: pointer; font: inherit; }
  .opt:hover, .opt:focus-visible { background: #f2f2f6; outline: none; }
  .opt.new { color: #2c56c4; font-size: 12.5px; }
  .none { margin: 4px 0; font-size: 12px; color: #999; }
  .foot { display: flex; justify-content: flex-end; }
  .foot button { padding: 4px 12px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 12px; cursor: pointer; }
</style>
