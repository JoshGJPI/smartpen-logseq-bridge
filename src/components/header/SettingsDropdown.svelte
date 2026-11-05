<!--
  SettingsDropdown.svelte - Settings panel dropdown for the header.

  v3.14.0: sections fold (SettingsSection) and are ordered by how often they
  change: Pen, Notebooks, Data folder, Publish to LogSeq, Handwriting
  recognition (MyScript keys, set once), Maintenance. Each heading carries a
  one-line status, so a folded section still says whether it is set. Rescan
  is under Data folder (also the Library home's ⋯ menu); Convert task boxes…, a
  one-off, is under Maintenance with the Activity Log.
-->
<script>
  import {
    hasMyScriptCredentials,
    logMessages,
    openActivityLogDialog,
    autoPickPen,
    rememberedPen,
    isScanning
  } from '$stores';
  import ActivityLogDialog from '../dialog/ActivityLogDialog.svelte';
  import ConvertTaskBoxesDialog from '../dialog/ConvertTaskBoxesDialog.svelte';
  import DataFolderSettings from '../settings/DataFolderSettings.svelte';
  import GraphFolderSettings from '../settings/GraphFolderSettings.svelte';
  import MyScriptSettings from '../settings/MyScriptSettings.svelte';
  import SettingsSection from '../settings/SettingsSection.svelte';
  import BooksTab from '../books/BooksTab.svelte';
  import { dataRoot, dataFolderReady, graphFolderReady } from '$stores/settings.js';
  import { rescanLibrary } from '$lib/storage/rescan.js';

  let isOpen = false;
  let convertBoxesOpen = false;

  function toggleDropdown() {
    isOpen = !isOpen;
  }

  function closeDropdown() {
    isOpen = false;
  }

  /** Errors and warnings are what the log is opened for, so the button counts them. */
  $: logProblemCount = $logMessages.filter(
    e => e.level === 'error' || e.level === 'warning'
  ).length;

  $: penName = $rememberedPen?.deviceName || ($rememberedPen?.deviceId ? 'a pen' : '');
  $: folderName = ($dataRoot || '').split(/[\\/]/).filter(Boolean).pop() || '';

  function handleConvertTaskBoxes() {
    convertBoxesOpen = true;
    isOpen = false;  // the dialog is modal
  }

  function handleShowActivityLog() {
    openActivityLogDialog();
    isOpen = false;  // Close settings dropdown — the dialog is modal
  }

  // Close dropdown when clicking outside
  function handleClickOutside(event) {
    if (isOpen && !event.target.closest('.settings-dropdown')) {
      closeDropdown();
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="settings-dropdown">
  <!-- Icon only: the header is one slim row. The dot appears only when the data
       folder is not ready, the one setting without which nothing can be read or
       saved; its details are under Data folder below. -->
  <button
    class="settings-btn"
    on:click|stopPropagation={toggleDropdown}
    title={$dataFolderReady ? 'Settings' : 'Settings — the data folder is not ready'}
    aria-label="Settings"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M23 12h-6m-6 0H1m13.2 5.2l-4.2-4.2m0-6l-4.2-4.2"/>
    </svg>
    {#if !$dataFolderReady}
      <span class="warn-dot" aria-hidden="true"></span>
    {/if}
  </button>

  {#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="dropdown-panel" on:click|stopPropagation>
      <div class="panel-header">
        <h3>Settings</h3>
        <button class="close-btn" on:click={closeDropdown} aria-label="Close settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Skip the Bluetooth picker for the pen used last time -->
      <SettingsSection title="Pen" storageKey="smartpen-settings-open-pen" defaultOpen
        status={penName ? `remembers ${penName}` : 'no pen remembered'}>
        <label class="check">
          <input type="checkbox" bind:checked={$autoPickPen} />
          Connect straight to my last pen
        </label>
        <p class="help-text">
          {#if penName}
            Turn the pen on, then click Connect: {penName} is picked automatically.
            If it isn't found within a few seconds, the picker opens.
          {:else}
            Connect once from the picker and the app will remember that pen.
          {/if}
        </p>
        {#if $rememberedPen}
          <button class="btn" on:click={() => ($rememberedPen = null)}>Forget {penName || 'remembered pen'}</button>
        {/if}
      </SettingsSection>

      <!-- Notebook names and volume routing (was the left panel's Books tab).
           Keeps its old open-state key. -->
      <SettingsSection title="Notebooks" storageKey="settingsNotebooksOpen" status="names and volumes">
        <BooksTab />
      </SettingsSection>

      <SettingsSection title="Data folder" storageKey="smartpen-settings-open-data" defaultOpen={!$dataFolderReady}
        status={$dataFolderReady ? folderName : 'not set'} warn={!$dataFolderReady}>
        <DataFolderSettings />
        <button class="btn" on:click={rescanLibrary} disabled={$isScanning || !$dataFolderReady}
          title="Read every page in the data folder again (after copying pages in from elsewhere)">
          {$isScanning ? 'Scanning…' : 'Rescan data folder'}
        </button>
      </SettingsSection>

      <!-- Publish to LogSeq graph (mirror saved pages as plugin assets) -->
      <SettingsSection title="Publish to LogSeq" storageKey="smartpen-settings-open-graph"
        status={$graphFolderReady ? 'graph folder set' : 'off'}>
        <GraphFolderSettings />
      </SettingsSection>

      <SettingsSection title="Handwriting recognition" storageKey="smartpen-settings-open-myscript"
        defaultOpen={!$hasMyScriptCredentials}
        status={$hasMyScriptCredentials ? '✓ MyScript keys set' : 'MyScript keys needed'} warn={!$hasMyScriptCredentials}>
        <MyScriptSettings />
      </SettingsSection>

      <!-- One-offs and diagnostics -->
      <SettingsSection title="Maintenance" storageKey="smartpen-settings-open-maint"
        status={logProblemCount ? `${logProblemCount} ${logProblemCount === 1 ? 'problem' : 'problems'} in the log` : ''}
        warn={logProblemCount > 0}>
        <button class="btn tool-btn" on:click={handleShowActivityLog}>
          <span class="button-text">Activity Log</span>
          {#if logProblemCount > 0}
            <span class="badge problems">{logProblemCount}</span>
          {/if}
        </button>
        <p class="help-text">
          A running record of what the app has done this session — open it when
          something did not behave as expected.
        </p>

        <!-- One-off: pages transcribed before v3.3.0 kept MyScript's ☐ / ☑ as text -->
        <button class="btn tool-btn" on:click={handleConvertTaskBoxes} disabled={!$dataFolderReady}>
          <span class="button-text">Convert task boxes…</span>
        </button>
        <p class="help-text">
          Older transcripts keep a drawn box as text (☐ Call Troy). This shows which lines would become
          TODO / DONE, and changes nothing until you confirm.
        </p>
      </SettingsSection>
    </div>
  {/if}
</div>

<!-- The dialogs are mounted outside the {#if isOpen} block so they survive the
     dropdown closing behind them. -->
<ActivityLogDialog />
<ConvertTaskBoxesDialog bind:open={convertBoxesOpen} />

<style>
  .settings-dropdown {
    position: relative;
  }

  .settings-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.15s;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid transparent;
  }

  .settings-btn:hover {
    background: var(--bg-secondary);
    border-color: var(--border);
    color: var(--text-primary);
  }

  .warn-dot {
    position: absolute;
    top: 3px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warning);
    box-shadow: 0 0 6px rgba(251, 191, 36, 0.8);
  }

  .dropdown-panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    min-width: 400px;
    max-width: 500px;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid var(--border);
  }

  .panel-header h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn {
    width: 100%;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .btn:hover:not(:disabled) {
    background: var(--border);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .help-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
    margin-top: 10px;
  }

  /* "Open a tool" button: Activity Log. */
  .tool-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .tool-btn .button-text {
    flex: 1;
    text-align: left;
  }

  .tool-btn .badge.problems {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: rgba(251, 191, 36, 0.15);
    color: var(--warning);
  }

  /* Scrollbar styling */
  .dropdown-panel::-webkit-scrollbar {
    width: 8px;
  }

  .dropdown-panel::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .dropdown-panel::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  .dropdown-panel::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
