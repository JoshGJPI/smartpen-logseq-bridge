<!--
  OverflowMenu.svelte — a "⋯" button with a short list of secondary actions
  (reading-first package C). The Timeline feed puts the deliberate, heavier
  actions here (Load into Editor, Whole page) so each card and day shows one
  plain primary action instead of a row of buttons.

  The list is position: fixed under the button: cards clip their overflow (for
  the rounded corners), and an absolutely placed menu would be cut off. It
  closes on outside click, Escape, or any scroll, since a fixed menu would
  otherwise float away from its card.
-->
<script>
  import { tick } from 'svelte';

  /** @type {Array<{label: string, onSelect: () => void, disabled?: boolean, title?: string}>} */
  export let items = [];
  export let label = 'More actions';

  let open = false;
  let btnEl;
  let menuEl;
  let pos = { top: 0, right: 0 };

  async function toggle() {
    if (open) {
      open = false;
      return;
    }
    const r = btnEl.getBoundingClientRect();
    pos = { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
    open = true;
    await tick();
    menuEl?.querySelector('button:not(:disabled)')?.focus();
  }

  function pick(item) {
    if (item.disabled) return;
    open = false;
    item.onSelect();
  }

  function onWindowPointer(e) {
    if (!open) return;
    if (btnEl?.contains(e.target) || menuEl?.contains(e.target)) return;
    open = false;
  }

  function onKey(e) {
    if (open && e.key === 'Escape') {
      open = false;
      btnEl?.focus();
    }
  }
</script>

<svelte:window
  on:pointerdown={onWindowPointer}
  on:keydown={onKey}
  on:scroll|capture={() => (open = false)}
  on:resize={() => (open = false)}
/>

<button
  type="button"
  class="om-btn"
  class:open
  bind:this={btnEl}
  on:click|stopPropagation={toggle}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-label={label}
  title={label}
>
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
</button>

{#if open}
  <div class="om-menu" role="menu" bind:this={menuEl} style:top={`${pos.top}px`} style:right={`${pos.right}px`}>
    {#each items as item}
      <button type="button" role="menuitem" disabled={item.disabled} title={item.title || null}
        on:click|stopPropagation={() => pick(item)}>{item.label}</button>
    {/each}
  </div>
{/if}

<style>
  .om-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid #dcdce2;
    border-radius: 6px;
    background: #fff;
    color: #55555f;
    cursor: pointer;
  }

  .om-btn:hover,
  .om-btn.open {
    background: #f2f2f4;
    border-color: #c8c8d0;
    color: #1f1f28;
  }

  .om-menu {
    position: fixed;
    z-index: 1000;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: #fff;
    border: 1px solid #dcdce2;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(20, 20, 40, 0.16);
  }

  .om-menu button {
    padding: 7px 10px;
    border: none;
    border-radius: 5px;
    background: none;
    color: #2b2b33;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }

  .om-menu button:hover:not(:disabled),
  .om-menu button:focus-visible {
    background: #eef3ff;
    outline: none;
  }

  .om-menu button:disabled {
    color: #9a9aa4;
    cursor: default;
  }
</style>
