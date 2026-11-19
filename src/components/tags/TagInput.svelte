<!--
  TagInput.svelte — a page's tags as chips plus a field with type-ahead
  (v3.1.0 page tags; mockup 1). Used by the reader's strip, the thumbnail's
  "+ tag" popover and (without chips) the bulk bar.

  The popover lists existing tags containing what is typed (in the tag, its
  label or an alias), most-used first with page counts (from the sidecar:
  tagStatsList), then rows for a new one: a project number (p2026-141 →
  P2026-141), or a keyword's "Add as Topic" and "Add as Person" (v3.22.0; the
  person's label is the text as typed, capitals kept).
  ↑ ↓ choose, Enter adds the chosen row or else exactly what was typed, as a
  Topic (the exact tag is listed first), Esc closes the list (then leaves the field),
  Backspace on an empty field removes the last chip (one per press, not on
  auto-repeat). Escape is
  preventDefault()-ed so the reader behind leaves it alone; every other
  window shortcut already stands down while typing (isTypingTarget).
-->
<script>
  import { tagStatsList, tagInfo, setTagType } from '$stores/tags.js';
  import { tagOptions, createRows, normalizeTag, tagEnterChoice, backspaceRemovesTag } from '$lib/tags.js';
  import { plural } from '$lib/plural.js';
  import TagChip from './TagChip.svelte';

  /** The page's tags (chips). */
  export let tags = [];
  /** (tag) => void, tag already normalized */
  export let onAdd = () => {};
  /** (tag) => void; null hides the chips' × */
  export let onRemove = null;
  export let showChips = true;
  /** Tags to leave out of the list (defaults to `tags`). */
  export let exclude = null;
  export let disabled = false;
  export let placeholder = 'Add tag…';
  export let label = 'Add tag';
  /** Dark surface (the bulk bar). */
  export let dark = false;
  /** Open the list above the field (a bar at the bottom of the pane). */
  export let dropUp = false;

  let input;
  let text = '';
  let open = false;
  let hi = 0;
  let navigated = false;
  const listId = `tag-list-${Math.random().toString(36).slice(2, 9)}`;

  export function focus() {
    input && input.focus();
  }

  // A press anywhere outside the field closes the list and leaves the field.
  // Blur alone isn't enough: the Editor canvas preventDefaults its mousedown
  // (so a drag doesn't select text), which keeps focus here and the list open.
  // Capture phase, so a handler that stops propagation can't hide the press.
  let box;
  function onWindowPointer(e) {
    if (!box || box.contains(e.target)) return;
    if (open) open = false;
    if (input && document.activeElement === input) input.blur();
  }

  $: res = tagOptions(text, $tagStatsList, exclude || tags, 6, $tagInfo);
  $: items = [...res.options, ...createRows(res.create, text)];
  $: if (hi >= items.length) hi = Math.max(0, items.length - 1);
  $: showList = open && !disabled && items.length > 0;

  function add(tag) {
    const t = normalizeTag(tag);
    if (!t) return;
    if (!tags.includes(t)) onAdd(t);
    text = '';
    hi = 0;
    navigated = false;
  }

  /** A row: "Add as Person" stores the type and typed label first (its own locked write), then adds. */
  function choose(o) {
    if (o.create === 'person') setTagType(o.tag, 'person', o.label);
    add(o.tag);
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      navigated = true;
      if (items.length) hi = (hi + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (navigated && items[hi]) choose(items[hi]);
      else {
        const t = tagEnterChoice(items, hi, false, text);
        if (t) add(t);
      }
    } else if (backspaceRemovesTag(e, text) && showChips && onRemove && tags.length) {
      onRemove(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showList) open = false;
      else input.blur();
    }
  }
</script>

<svelte:window on:pointerdown|capture={onWindowPointer} />

<div class="tagbox" bind:this={box} class:dark class:disabled on:click={() => !disabled && input.focus()} role="presentation">
  {#if showChips}
    {#each tags as t (t)}
      <TagChip tag={t} {disabled} onRemove={onRemove ? () => onRemove(t) : null} />
    {/each}
  {/if}
  <input
    bind:this={input}
    bind:value={text}
    type="text"
    {placeholder}
    {disabled}
    aria-label={label}
    autocomplete="off"
    spellcheck="false"
    role="combobox"
    aria-expanded={showList}
    aria-controls={listId}
    aria-autocomplete="list"
    on:focus={() => (open = true)}
    on:blur={() => (open = false)}
    on:input={() => { open = true; hi = 0; navigated = false; }}
    on:keydown={onKey}
  />
  {#if showList}
    <div class="pop" class:up={dropUp} id={listId} role="listbox" tabindex="-1" on:mousedown|preventDefault>
      <div class="hd">{text.trim() ? 'Matching tags' : 'Your tags'}</div>
      {#each items as o, i (o.create ? `+${o.create}:${o.tag}` : o.tag)}
        <button
          type="button"
          role="option"
          aria-selected={i === hi}
          class="it"
          class:hi={i === hi}
          on:mousemove={() => (hi = i)}
          on:click|stopPropagation={() => choose(o)}
        >
          {#if o.create === 'project'}
            <span>Create <b>“{o.tag}”</b></span><small>project number</small>
          {:else if o.create === 'topic'}
            <span>Add <b>“{o.tag}”</b> as Topic</span><small>Enter</small>
          {:else if o.create === 'person'}
            <span>Add <b class="person">“{o.label}”</b> as Person</span><small>new person</small>
          {:else}
            <TagChip tag={o.tag} /><small>{o.pages} {plural(o.pages, 'page')}</small>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tagbox {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    min-height: 34px;
    padding: 5px 6px;
    border: 1px solid #ddd;
    border-radius: 7px;
    background: #fff;
    cursor: text;
  }
  .tagbox:focus-within { border-color: #4a7cf7; box-shadow: 0 0 0 2px rgba(74, 124, 247, 0.2); }
  .tagbox.disabled { background: #f6f6f6; cursor: default; }
  .tagbox.dark { min-height: 30px; padding: 2px 6px; border-color: #fff; }
  input {
    flex: 1;
    min-width: 90px;
    padding: 2px 4px;
    border: 0;
    outline: 0;
    background: transparent;
    color: #222;
    font: inherit;
    font-size: 12px;
  }
  .pop {
    position: absolute;
    left: -1px;
    right: -1px;
    top: calc(100% + 4px);
    z-index: 50;
    min-width: 200px;
    padding: 4px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: #fff;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }
  .pop.up { top: auto; bottom: calc(100% + 4px); }
  .hd { padding: 4px 8px 2px; font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: #999; }
  .it {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: #222;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .it.hi { background: #eef3ff; }
  .it small { color: #999; white-space: nowrap; }
  .it b.person { color: #6a3fa8; }
</style>
