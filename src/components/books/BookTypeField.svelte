<!--
  BookTypeField.svelte — one notebook's type in the Books tab (v3.15.0).

  Free text with the types already in use offered as suggestions; saved on
  Enter or when the field loses focus (empty clears it), Escape puts it back.
  A volume with no type of its own shows volume 1's as the placeholder, which is
  the type it has until it gets one (lib/book-types.js `bookTypeOf`).
-->
<script>
  import { bookTypes, bookTypeNames, setNotebookType } from '$stores/book-types.js';
  import { bookTypeOf, isInheritedType, MAX_TYPE_LENGTH } from '$lib/book-types.js';

  /** The notebook's book key ("388", "388v2"). */
  export let bookKey;

  $: listId = `book-type-names-${bookKey}`;

  $: own = $bookTypes[bookKey] || '';
  $: inherited = isInheritedType(bookKey, $bookTypes) ? bookTypeOf(bookKey, $bookTypes) : null;
  let draft = '';
  let focused = false;
  $: if (!focused) draft = own;

  async function commit() {
    if (draft.trim() === own) { draft = own; return; }
    await setNotebookType(bookKey, draft);
    draft = $bookTypes[bookKey] || '';
  }

  function onKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      draft = own;
      e.currentTarget.blur();
    }
  }
</script>

<input
  class="type-input"
  class:set={!!own}
  type="text"
  list={listId}
  maxlength={MAX_TYPE_LENGTH}
  bind:value={draft}
  placeholder={inherited ? `${inherited} (from v1)` : 'Type…'}
  title={own ? `Notebook type: ${own} (clear the field to remove it)` : 'Notebook type, e.g. Work or Personal'}
  aria-label="Notebook type for B{bookKey}"
  on:focus={() => (focused = true)}
  on:blur={() => { focused = false; commit(); }}
  on:keydown={onKeydown}
/>

<!-- The types in use, as suggestions. One list per field: cheap at notebook counts. -->
<datalist id={listId}>
  {#each $bookTypeNames as n (n)}
    <option value={n}></option>
  {/each}
</datalist>

<style>
  .type-input {
    flex: 0 0 92px;
    width: 92px;
    min-width: 0;
    padding: 2px 6px;
    font-size: 0.7rem;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 10px;
    color: var(--text-primary);
  }
  .type-input::placeholder { color: var(--text-secondary); font-style: italic; }
  .type-input.set { border-style: solid; background: rgba(74, 124, 247, 0.12); border-color: rgba(74, 124, 247, 0.45); }
  .type-input:focus { outline: none; border-style: solid; border-color: var(--accent); background: var(--bg-primary); }
</style>
