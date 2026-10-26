<!--
  TaskMenu.svelte — a task's "⋯" menu (v3.4.0): the three other states it can
  take, then Not a task (lib/tasks.js taskMenuChoices). The only way to set or
  clear WAITING and CANCELLED, or to make a task a plain line again.
  OverflowMenu handles outside click, scroll and its keys (which it
  preventDefaults, so the reader behind leaves them alone).
-->
<script>
  import OverflowMenu from '../viewer/OverflowMenu.svelte';
  import { taskMenuChoices } from '$lib/tasks.js';

  /** 'todo' | 'done' | 'waiting' | 'cancelled' */
  export let state = 'todo';
  /** (state) => void */
  export let onSet = () => {};
  /** Why it can't be used, or '' */
  export let lock = '';

  $: items = taskMenuChoices(state).map((c) => ({
    label: c.label,
    disabled: !!lock,
    title: lock || null,
    onSelect: () => onSet(c.state)
  }));
</script>

<span class="tm-wrap"><OverflowMenu {items} label="Task state" /></span>

<style>
  .tm-wrap { display: inline-flex; flex-shrink: 0; }
  .tm-wrap :global(button.om-btn) { width: 24px; height: 22px; border-color: transparent; background: transparent; color: #8a8fa3; }
  .tm-wrap :global(button.om-btn:hover),
  .tm-wrap :global(button.om-btn.open) { border-color: #dcdce2; background: #fff; color: #333; }
  .tm-wrap :global(div.om-menu) { min-width: 0; }
</style>
