<!--
  PrintListButton.svelte — the header's Print entry (v3.8.0). Opens the Print
  dialog on the print list, where pages from any notebook are picked (left
  panel), reordered and printed together; the badge counts the list's pages.
-->
<script>
  import { printList, openPrintList } from '$stores/print.js';

  $: n = $printList.length;
</script>

<button type="button" class="pl-btn" title={n ? `Print list: ${n} ${n === 1 ? 'page' : 'pages'}` : 'Print pages from any notebook'} on:click={openPrintList}>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7"/>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
    <rect x="6" y="14" width="12" height="8"/>
  </svg>
  Print
  {#if n}<span class="badge">{n}</span>{/if}
</button>

<style>
  .pl-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.8125rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .pl-btn:hover { filter: brightness(1.15); }
  .badge {
    min-width: 18px;
    padding: 0 6px;
    border-radius: 99px;
    background: var(--selected-line);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    line-height: 17px;
  }
</style>
