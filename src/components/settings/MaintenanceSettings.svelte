<!--
  MaintenanceSettings.svelte — Settings → Maintenance (split out of
  SettingsDropdown in v3.21.0): the Activity Log and the one-offs, Convert task
  boxes…, Relink old transcripts… (v3.21.0) and Clean up duplicate strokes…,
  whose count shows in the heading. Each button closes the dropdown (`onClose`)
  and opens its dialog through MaintenanceDialogs.
-->
<script>
  import { logMessages, openActivityLogDialog } from '$stores';
  import { pagesWithDuplicateStrokes } from '$stores/duplicate-strokes.js';
  import { dataFolderReady } from '$stores/settings.js';
  import SettingsSection from './SettingsSection.svelte';
  import { maintenanceTool } from './maintenance-tool.js';

  /** Closes the settings dropdown (every tool here is a modal dialog). */
  export let onClose = () => {};

  /** Errors and warnings are what the log is opened for, so the button counts them. */
  $: logProblemCount = $logMessages.filter((e) => e.level === 'error' || e.level === 'warning').length;
  $: duplicateCount = $pagesWithDuplicateStrokes.reduce((n, p) => n + p.duplicateStrokes, 0);
  $: status = [
    duplicateCount ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'stroke' : 'strokes'}` : '',
    logProblemCount ? `${logProblemCount} ${logProblemCount === 1 ? 'problem' : 'problems'} in the log` : ''
  ].filter(Boolean).join(' · ');

  function openTool(tool) {
    maintenanceTool.set(tool);
    onClose();
  }

  function showLog() {
    openActivityLogDialog();
    onClose();
  }
</script>

<!-- One-offs and diagnostics -->
<SettingsSection title="Maintenance" storageKey="smartpen-settings-open-maint" {status}
  warn={logProblemCount > 0 || duplicateCount > 0}>
  <button class="btn" on:click={showLog}>
    <span class="button-text">Activity Log</span>
    {#if logProblemCount > 0}<span class="badge">{logProblemCount}</span>{/if}
  </button>
  <p class="help-text">
    A running record of what the app has done this session — open it when something did not behave as expected.
  </p>

  <!-- One-off: pages transcribed before v3.3.0 kept MyScript's ☐ / ☑ as text -->
  <button class="btn" on:click={() => openTool('convert')} disabled={!$dataFolderReady}>
    <span class="button-text">Convert task boxes…</span>
  </button>
  <p class="help-text">
    Older transcripts keep a drawn box as text (☐ Call Troy). This shows which lines would become
    TODO / DONE, and changes nothing until you confirm.
  </p>

  <!-- One-off: transcripts saved before the Aug 2026 line matching (v3.21.0) -->
  <button class="btn" on:click={() => openTool('relink')} disabled={!$dataFolderReady}>
    <span class="button-text">Relink old transcripts…</span>
  </button>
  <p class="help-text">
    Older transcripts can't light their ink. This lists those pages, sends them to MyScript once to find each
    line's ink, keeps the text and tasks, and changes nothing until you run it.
  </p>

  <!-- Strokes on one page sharing an id (s{startTime}); counted by the capture-date scan -->
  <button class="btn" on:click={() => openTool('duplicates')} disabled={!$dataFolderReady}>
    <span class="button-text">Clean up duplicate strokes…</span>
    {#if duplicateCount > 0}<span class="badge">{duplicateCount}</span>{/if}
  </button>
  <p class="help-text">
    Two strokes saved with the same id can't be told apart by a delete or an edit. This lists them,
    removes exact copies, keeps different ink under its own id, and changes nothing until you confirm.
  </p>
</SettingsSection>

<style>
  .btn {
    width: 100%; padding: 10px 16px; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer;
    transition: all 0.2s; display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border);
  }
  .btn:hover:not(:disabled) { background: var(--border); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .button-text { flex: 1; text-align: left; }
  .badge {
    padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;
    background: rgba(251, 191, 36, 0.15); color: var(--warning);
  }
  .help-text { font-size: 0.75rem; color: var(--text-secondary); text-align: center; margin-top: 10px; }
</style>
