<!--
  PenChip.svelte - Pen state in one header chip: Connect target when
  disconnected, model + battery when connected.

  Connect and Disconnect used to be buttons in ActionBar. The chip replaces them
  so the header carries the pen's state without a seven-button toolbar; the pen
  logic itself (connectPen / disconnectPen) is unchanged.

  While connected, the dot and the pen's name are one button that opens the pen
  menu: Fetch notes (offline import, formerly ActionBar's Fetch Notes), Manage
  pen memory (formerly a Settings section) and Disconnect. Everything about the
  pen opens from the pen. The transfer's progress popup stays in ActionBar.
-->
<script>
  import { penConnected, penAuthorized, penBattery, penInfo, transferProgress, log } from '$stores';
  import { connectPen, disconnectPen, fetchOfflineData } from '$lib/pen-sdk.js';
  import PenMemoryDialog from '../dialog/PenMemoryDialog.svelte';

  let isConnecting = false;
  let isFetching = false;
  let showPenMemory = false;
  let menuOpen = false;
  let rootEl;

  $: authorized = $penConnected && $penAuthorized;
  $: penModel = $penInfo?.ModelName || $penInfo?.DeviceName || 'Pen';
  $: batteryPercent = $penBattery ? parseInt($penBattery.replace('%', ''), 10) : null;
  $: fetching = isFetching || $transferProgress.active;
  $: if (!authorized) menuOpen = false;

  async function handleConnect() {
    isConnecting = true;
    try {
      await connectPen();
    } catch (error) {
      log(`Connection failed: ${error.message}`, 'error');
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    menuOpen = false;
    try {
      await disconnectPen();
    } catch (error) {
      log(`Disconnect failed: ${error.message}`, 'error');
    }
  }

  async function handleFetch() {
    menuOpen = false;
    isFetching = true;
    try {
      await fetchOfflineData();
    } catch (error) {
      log(`Failed to fetch offline data: ${error.message}`, 'error');
    } finally {
      isFetching = false;
    }
  }

  function openPenMemory() {
    menuOpen = false;
    showPenMemory = true;
  }

  function onWindowClick(e) {
    if (menuOpen && rootEl && !rootEl.contains(e.target)) menuOpen = false;
  }

  function onKey(e) {
    if (menuOpen && e.key === 'Escape') {
      menuOpen = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKey} />

<div class="pen-wrap" bind:this={rootEl}>
<div class="pen-chip" class:connected={authorized} class:connecting={$penConnected && !authorized}>
  {#if authorized}
    <button
      class="pen-identity"
      class:open={menuOpen}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      on:click={() => (menuOpen = !menuOpen)}
      title="Pen: fetch notes, manage pen memory, disconnect"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="label">
        {penModel}{#if fetching}<span class="battery"> · Fetching…</span>{:else if batteryPercent !== null && !Number.isNaN(batteryPercent)}<span
          class="battery"
          class:low={batteryPercent < 20}
        > · {batteryPercent}%</span>{/if}
      </span>
      <svg class="caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
  {:else if $penConnected}
    <span class="dot" aria-hidden="true"></span>
    <span class="label">Authorizing…</span>
  {:else}
    <span class="dot" aria-hidden="true"></span>
    <span class="label muted">Pen: not connected</span>
    <button
      class="chip-action connect"
      on:click={handleConnect}
      disabled={isConnecting}
      title="Connect to SmartPen via Bluetooth"
    >{isConnecting ? 'Connecting…' : 'Connect'}</button>
  {/if}
</div>

{#if menuOpen}
  <div class="pen-menu" role="menu" aria-label="Pen">
    <button type="button" role="menuitem" on:click={handleFetch} disabled={fetching}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>{fetching ? 'Fetching…' : 'Fetch notes'}<span class="hint">Import strokes stored on the pen</span></span>
    </button>
    <button type="button" role="menuitem" on:click={openPenMemory}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      <span>Manage pen memory…<span class="hint">Delete imported books from the pen</span></span>
    </button>
    <div class="sep" role="separator"></div>
    <button type="button" role="menuitem" on:click={handleDisconnect}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>
      </svg>
      <span>Disconnect</span>
    </button>
  </div>
{/if}
</div>

<!-- Outside the chip's {#if}: the dialog shows its own result after a delete
     even if the pen drops mid-way. -->
<PenMemoryDialog bind:visible={showPenMemory} />

<style>
  .pen-wrap {
    position: relative;
  }

  .pen-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 6px 0 11px;
    border-radius: 99px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  .pen-chip.connected {
    border-color: rgba(74, 222, 128, 0.35);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
    flex-shrink: 0;
  }

  .connected .dot {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }

  .connecting .dot {
    background: var(--warning);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .label {
    color: var(--text-primary);
  }

  /* Dot + name as one quiet button: no chrome until hovered, so the chip
     reads the same as before. The left margin pulls it back over the chip's
     padding so the hover pill fits the chip's curve. */
  .pen-identity {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: -6px;
    padding: 3px 8px 3px 6px;
    border: none;
    border-radius: 99px;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  .pen-identity:hover,
  .pen-identity.open {
    background: rgba(255, 255, 255, 0.06);
  }

  .pen-identity:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .caret {
    color: var(--text-secondary);
    margin-left: -3px;
  }

  .pen-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 60;
    min-width: 250px;
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  }

  .pen-menu button {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }

  .pen-menu button svg {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--text-secondary);
  }

  .pen-menu button:hover:not(:disabled),
  .pen-menu button:focus-visible {
    background: rgba(255, 255, 255, 0.07);
    outline: none;
  }

  .pen-menu button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .pen-menu .hint {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .pen-menu .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }

  .label.muted {
    color: var(--text-secondary);
  }

  .battery {
    color: var(--text-secondary);
  }

  .battery.low {
    color: var(--warning);
  }

  /* Text buttons inside the chip, not a second toolbar: Connect is the one
     coloured thing in the header, so the eye finds it when it is needed. */
  .chip-action {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    padding: 3px 9px;
    border-radius: 99px;
    cursor: pointer;
  }

  .chip-action:hover:not(:disabled) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.06);
  }

  .chip-action.connect {
    background: var(--accent);
    color: #fff;
  }

  .chip-action.connect:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #fff;
  }

  .chip-action:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
