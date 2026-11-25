<!--
  RelinkNewLine.svelte — the Relink review's editor for a new line made from ink
  left over (v3.30.0, Josh 2026-11-25: fix a relinked page's untranscribed part in
  the review instead of afterwards). Shown in the "Stored text" cell of a leftover
  row set to Add as new line:

    head row    the line's text (MyScript's reading to start; Tab / Shift+Tab or
                ⇤ ⇥ change its indent, shown where the save will put it),
                ⤒ merges it into the new line just above
    merged row  "part of the new line above", with Split

  State lives in the review's `decisions` (lib/relink.js addedGroups,
  setNewText, setNewIndent, setMergeUp); the indent shown comes from
  lib/relink-plan.js newLinePreview, the save's own placement.
-->
<script>
  import { setNewText, setNewIndent, setMergeUp, canMergeUp } from '$lib/relink.js';

  export let model;
  export let decisions;
  export let row;
  /** addedGroups() entry this row belongs to */
  export let group;
  /** newLinePreview() entry for the group's head: { indentLevel, max }, or undefined */
  export let place = null;
  export let disabled = false;

  $: head = group.head === row.ms;
  $: indent = place ? place.indentLevel : 0;
  $: max = place ? place.max : 0;
  $: typed = (decisions.newText || {})[group.head];
  $: value = typeof typed === 'string' ? typed : group.reading;
  $: mergeable = head && canMergeUp(model, decisions, row);

  function setIndent(n) {
    decisions = setNewIndent(decisions, group.head, Math.max(0, Math.min(n, max)));
  }

  function onKey(e) {
    if (e.key !== 'Tab' || e.isComposing) return;
    e.preventDefault();
    setIndent(indent + (e.shiftKey ? -1 : 1));
  }
</script>

{#if head}
  <span class="nl" style="padding-left: {indent * 14}px">
    <input type="text" {value} {disabled} placeholder={group.reading} aria-label="New line text"
      title="The new line's text: correct MyScript's reading here. Tab / Shift+Tab change its indent. Empty = MyScript's reading."
      on:input={(e) => (decisions = setNewText(decisions, group.head, e.currentTarget.value))}
      on:keydown={onKey} />
    <span class="tools">
      <button type="button" on:click={() => setIndent(indent - 1)} disabled={disabled || indent === 0} title="Outdent (Shift+Tab)">⇤</button>
      <button type="button" on:click={() => setIndent(indent + 1)} disabled={disabled || indent >= max} title="Indent (Tab)">⇥</button>
      {#if mergeable}
        <button type="button" {disabled} on:click={() => (decisions = setMergeUp(model, decisions, row.ms, true))}
          title="Merge into the new line above: one line, its text joined">⤒ Merge</button>
      {/if}
    </span>
  </span>
{:else}
  <span class="merged">⤒ merged into the new line above</span>
  <button type="button" class="split" {disabled} on:click={() => (decisions = setMergeUp(model, decisions, row.ms, false))}
    title="Make this its own new line again">Split</button>
{/if}

<style>
  .nl { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  input {
    flex: 1; min-width: 140px; font: inherit; font-size: 0.82rem; padding: 2px 6px; border-radius: 5px;
    border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);
  }
  input:focus { outline: none; border-color: var(--selected-line); }
  .tools { display: inline-flex; gap: 2px; }
  button {
    padding: 0 6px; font-size: 0.72rem; line-height: 1.6; border-radius: 4px; cursor: pointer;
    border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
  }
  button:hover:not(:disabled) { color: var(--text-primary); border-color: var(--selected-line); }
  button:disabled { opacity: 0.4; cursor: default; }
  .merged { color: var(--text-secondary); font-style: italic; margin-right: 6px; }
</style>
