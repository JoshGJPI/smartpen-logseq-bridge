<!--
  GraphFolderSettings.svelte — LogSeq graph target for stroke export.

  Picks the LogSeq graph root that "Export to LogSeq" publishes into as JPI Tools
  plugin assets (PageDoc + smartpen-index.json). Mirrors DataFolderSettings
  (Browse / Verify / Open in Explorer); the folder picker, availability check,
  and open-in-explorer IPC are reused as-is.

  There is deliberately no "publish on save" toggle: export is an explicit,
  additive, per-selection action so the graph stays a curated book of sketches
  rather than a full mirror of the notebook.
-->
<script>
  import {
    graphRoot,
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

  <p class="hint">
    Target for <strong>Export to LogSeq</strong>. Exported strokes are written to
    <code>&lt;graph&gt;/assets/storages/logseq-plugin-jpi-tools/</code> (a PageDoc
    asset per page + <code>smartpen-index.json</code>) so the JPI Tools plugin can
    render them.
  </p>
  <p class="hint">
    Export is additive — each export adds to what that page already has in the
    graph, so you can publish sketches one at a time. Transcript text is never
    exported. Your <code>stroke-data</code> folder stays the complete notebook;
    the graph only gets what you send it.
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
