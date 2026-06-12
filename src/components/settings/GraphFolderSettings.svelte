<!--
  GraphFolderSettings.svelte — "Publish to graph" configuration.

  Picks a LogSeq graph root and toggles whether each saved page is mirrored into
  it as JPI Tools plugin assets (PageDoc + smartpen-index.json). Mirrors
  DataFolderSettings (Browse / Verify / Open in Explorer); the folder picker,
  availability check, and open-in-explorer IPC are reused as-is.
-->
<script>
  import {
    graphRoot,
    publishToGraph,
    graphFolderReady,
    graphFolderStatusText,
    setGraphFolderStatus,
    log
  } from '$stores';
  import { pickFolder, isAvailable, openInExplorer } from '$lib/storage/local-store.js';

  let isChecking = false;

  function basename(p) {
    if (!p) return '';
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || p;
  }

  async function handleBrowse() {
    try {
      const picked = await pickFolder();
      if (!picked) return;
      $graphRoot = picked;
      await handleVerify();
    } catch (err) {
      log(`Graph folder picker failed: ${err.message}`, 'error');
    }
  }

  async function handleVerify() {
    if (!$graphRoot) {
      setGraphFolderStatus(false, 'Graph: not set');
      return;
    }
    isChecking = true;
    try {
      const ok = await isAvailable($graphRoot);
      if (ok) {
        setGraphFolderStatus(true, `Graph: ${basename($graphRoot)}`);
        log(`LogSeq graph folder ready: ${$graphRoot}`, 'success');
      } else {
        setGraphFolderStatus(false, 'Graph: missing');
        log(`Graph folder not accessible: ${$graphRoot}`, 'warning');
      }
    } catch (err) {
      setGraphFolderStatus(false, 'Graph: error');
      log(`Graph verify failed: ${err.message}`, 'error');
    } finally {
      isChecking = false;
    }
  }

  async function handleOpen() {
    try {
      await openInExplorer($graphRoot);
    } catch (err) {
      log(`Open-in-Explorer failed: ${err.message}`, 'error');
    }
  }
</script>

<div class="folder-settings">
  <label class="toggle">
    <input type="checkbox" bind:checked={$publishToGraph} />
    <span>Publish to LogSeq graph on save</span>
  </label>

  <div class="input-group">
    <label for="graphRoot">LogSeq graph folder</label>
    <input
      type="text"
      id="graphRoot"
      bind:value={$graphRoot}
      placeholder="C:\Users\you\Documents\my-logseq-graph"
      on:change={handleVerify}
    />
  </div>

  <div class="status-row">
    <span class="status-dot" class:ready={$graphFolderReady} class:warn={!$graphFolderReady}></span>
    <span class="status-text">{$graphFolderStatusText}</span>
  </div>

  <div class="button-group">
    <button class="btn btn-secondary" on:click={handleBrowse}>
      📁 Browse…
    </button>
    <button class="btn btn-secondary" on:click={handleVerify} disabled={isChecking || !$graphRoot}>
      {isChecking ? 'Checking…' : '🔄 Verify'}
    </button>
    <button class="btn btn-secondary" on:click={handleOpen} disabled={!$graphFolderReady}>
      🗂️ Open in Explorer
    </button>
  </div>

  {#if $publishToGraph && !$graphFolderReady}
    <p class="hint warn-hint">
      Publishing is on but the graph folder isn’t verified — saves won’t be mirrored until you pick a valid folder.
    </p>
  {/if}

  <p class="hint">
    When on, each save also writes the page to
    <code>&lt;graph&gt;/assets/storages/logseq-plugin-jpi-tools/</code> (the PageDoc
    asset + <code>smartpen-index.json</code>) so the JPI Tools plugin can render it.
    Your <code>stroke-data</code> folder stays the working store; this is a published mirror.
  </p>
</div>

<style>
  .folder-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text-primary, #fff);
    cursor: pointer;
  }
  .toggle input {
    width: auto;
  }
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text-secondary, #a0a0a0);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #888;
    flex-shrink: 0;
  }
  .status-dot.ready { background: var(--success, #4ade80); }
  .status-dot.warn  { background: var(--accent, #e94560); }
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--text-secondary, #a0a0a0);
    margin: 0;
    line-height: 1.4;
  }
  .warn-hint {
    color: var(--accent, #e94560);
  }
  .hint code {
    background: rgba(255,255,255,0.06);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }
</style>
