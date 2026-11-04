<!--
  HistoryButtons.svelte — Back / Forward between views (v3.13.0), in the header
  beside the destination tabs. Also Alt+← / Alt+→ and a mouse's side buttons.
  Starts the view history (stores/view-history.js), which records every move of
  the right pane: a tag page, a page in the reader, the Editor, and back.
  Keys stand down while typing, mid-IME, when already handled and under a modal.
-->
<script>
  import { onMount } from 'svelte';
  import { bookAliases } from '$stores';
  import {
    canGoBack, canGoForward, backTarget, forwardTarget, goBack, goForward, startViewHistory, stopViewHistory
  } from '$stores/view-history.js';
  import { viewLabel, historyGesture } from '$lib/view-history.js';
  import { isTypingTarget, modalOpen } from '$lib/left-panel.js';
  import { formatBookName } from '$utils/formatting.js';

  const name = (b) => formatBookName(b, $bookAliases, 'full');
  $: backTitle = $backTarget ? `Back to ${viewLabel($backTarget, name)} (Alt+←)` : 'Back (Alt+←)';
  $: forwardTitle = $forwardTarget ? `Forward to ${viewLabel($forwardTarget, name)} (Alt+→)` : 'Forward (Alt+→)';

  function step(dir) {
    if (dir === 'back') goBack();
    else goForward();
  }

  function onKey(e) {
    if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target) || modalOpen()) return;
    const dir = historyGesture(e);
    if (!dir) return;
    e.preventDefault();
    step(dir);
  }

  // Side buttons: act on mouseup, and keep Chromium's own back from the mousedown.
  function onMouse(e) {
    const dir = historyGesture(e);
    if (!dir) return;
    e.preventDefault();
    if (e.type === 'mouseup' && !modalOpen()) step(dir);
  }

  onMount(() => {
    startViewHistory();
    return stopViewHistory;
  });
</script>

<svelte:window on:keydown={onKey} on:mousedown={onMouse} on:mouseup={onMouse} />

<div class="hist" role="group" aria-label="History">
  <button type="button" disabled={!$canGoBack} title={backTitle} aria-label={backTitle} on:click={() => step('back')}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
  </button>
  <button type="button" disabled={!$canGoForward} title={forwardTitle} aria-label={forwardTitle} on:click={() => step('forward')}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
  </button>
</div>

<style>
  .hist { display: inline-flex; gap: 2px; }
  button {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-secondary); border-color: var(--border); }
  button:disabled { opacity: 0.35; cursor: default; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
</style>
