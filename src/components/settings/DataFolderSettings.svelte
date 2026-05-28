<!--
  DataFolderSettings.svelte — v2.0 local-folder data root configuration.
  Browse, verify availability, open in Explorer. Saves to localStorage.
-->
<script>
  import { dataRoot, dataFolderReady, dataFolderStatusText, setDataFolderStatus, log } from '$stores';
  import { pickFolder, isAvailable, openInExplorer } from '$lib/storage/local-store.js';

  let isChecking = false;

  function basename(p) {
    if (!p) return '';
    const m = p.split(/[\\/]/).filter(Boolean);
    return m[m.length - 1] || p;
  }

  async function handleBrowse() {
    try {
      const picked = await pickFolder();
      if (!picked) return;
      $dataRoot = picked;
      await handleVerify();
    } catch (err) {
      log(`Folder picker failed: ${err.message}`, 'error');
    }
  }

  async function handleVerify() {
    if (!$dataRoot) {
      setDataFolderStatus(false, 'Folder: not set');
      return;
    }
    isChecking = true;
    try {
      const ok = await isAvailable($dataRoot);
      if (ok) {
        setDataFolderStatus(true, `Folder: ${basename($dataRoot)}`);
        log(`Data folder ready: ${$dataRoot}`, 'success');
      } else {
        setDataFolderStatus(false, 'Folder: missing');
        log(`Data folder not accessible: ${$dataRoot}`, 'warning');
      }
    } catch (err) {
      setDataFolderStatus(false, 'Folder: error');
      log(`Verify failed: ${err.message}`, 'error');
    } finally {
      isChecking = false;
    }
  }

  async function handleOpen() {
    try {
      await openInExplorer($dataRoot);
    } catch (err) {
      log(`Open-in-Explorer failed: ${err.message}`, 'error');
    }
  }
</script>

<div class="folder-settings">
  <div class="input-group">
    <label for="dataRoot">Data folder</label>
    <input
      type="text"
      id="dataRoot"
      bind:value={$dataRoot}
      placeholder="C:\Users\you\Documents\stroke-data"
      on:change={handleVerify}
    />
  </div>

  <div class="status-row">
    <span class="status-dot" class:ready={$dataFolderReady} class:warn={!$dataFolderReady}></span>
    <span class="status-text">{$dataFolderStatusText}</span>
  </div>

  <div class="button-group">
    <button class="btn btn-secondary" on:click={handleBrowse}>
      📁 Browse…
    </button>
    <button class="btn btn-secondary" on:click={handleVerify} disabled={isChecking || !$dataRoot}>
      {isChecking ? 'Checking…' : '🔄 Verify'}
    </button>
    <button class="btn btn-secondary" on:click={handleOpen} disabled={!$dataFolderReady}>
      🗂️ Open in Explorer
    </button>
  </div>

  <p class="hint">
    Pages are saved to <code>&lt;folder&gt;/pages/B{`{book}`}/P{`{page}`}.json</code>.
    Exports go to <code>&lt;folder&gt;/exports/</code>. The app never touches version control.
  </p>
</div>

<style>
  .folder-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  .hint code {
    background: rgba(255,255,255,0.06);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }
</style>
