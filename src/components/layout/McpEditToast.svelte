<!--
  McpEditToast.svelte — "Claude edited B3017/P180: 2 changed, 1 inserted" after
  Claude applies (or undoes) a transcript edit through the app (v3.18.0,
  stores/mcp-edits.js). Mounted once in App, so it shows in every destination.
  Dry runs show nothing; the Activity log keeps the line.
-->
<script>
  import { onDestroy } from 'svelte';
  import { lastMcpEdit } from '$stores/mcp-edits.js';

  const SHOW_MS = 6000;
  let shown = null;
  let timer = null;

  $: show($lastMcpEdit);

  function show(e) {
    clearTimeout(timer);
    shown = e;
    if (e) timer = setTimeout(() => { if (shown === e) shown = null; }, SHOW_MS);
  }

  onDestroy(() => clearTimeout(timer));
</script>

{#if shown}
  <div class="toast" role="status">
    <span>{shown.label}</span>
    <button type="button" on:click={() => (shown = null)} aria-label="Dismiss">✕</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 60;
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 12px 8px 14px;
    border-radius: 8px;
    background: #262650;
    color: #fff;
    font-size: 12.5px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    max-width: min(520px, calc(100vw - 32px));
  }
  button {
    padding: 0;
    border: none;
    background: none;
    color: #9db8ff;
    font: inherit;
    cursor: pointer;
  }
</style>
