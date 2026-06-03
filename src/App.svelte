<!--
  App.svelte - Root Component
  SmartPen-LogSeq Bridge Application
-->
<script>
  import { onMount, onDestroy } from 'svelte';

  // Layout components
  import Header from './components/layout/Header.svelte';
  import LeftPanel from './components/layout/LeftPanel.svelte';

  // Dialog components
  import BookSelectionDialog from './components/dialog/BookSelectionDialog.svelte';
  import BluetoothDevicePicker from './components/dialog/BluetoothDevicePicker.svelte';

  // Canvas components
  import StrokeCanvas from './components/canvas/StrokeCanvas.svelte';

  // Book viewer
  import BookViewer from './components/viewer/BookViewer.svelte';

  // Stores
  import { log } from '$stores';
  import { openBluetoothPicker, updateBluetoothDevices, closeBluetoothPicker } from '$stores/ui.js';
  import { dataRoot, setDataFolderStatus, getDataRoot } from '$stores/settings.js';
  import { unsavedChanges, viewerMode, viewerDirty, setViewerMode, clearAllViewerDirty } from '$stores';
  import { isAvailable as folderIsAvailable } from '$lib/storage/local-store.js';
  import { get } from 'svelte/store';

  // Initialize pen SDK on mount
  import { initializePenSDK, disconnectAllPens } from '$lib/pen-sdk.js';

  // v2.0: Check data folder availability at boot
  async function checkDataFolder() {
    const root = getDataRoot();
    if (!root) {
      setDataFolderStatus(false, 'Folder: not set');
      return;
    }
    try {
      const ok = await folderIsAvailable(root);
      if (ok) {
        const basename = root.split(/[\\/]/).pop() || root;
        setDataFolderStatus(true, `Folder: ${basename}`);
        log(`Data folder ready: ${root}`, 'success');
      } else {
        setDataFolderStatus(false, 'Folder: missing');
        log(`Data folder not accessible: ${root}`, 'warning');
      }
    } catch (err) {
      setDataFolderStatus(false, 'Folder: error');
      log(`Data folder check failed: ${err.message}`, 'warning');
    }
  }

  // v2.0: Prompt before close if there are unsaved canvas changes.
  // NOTE: do NOT disconnect the pen here — the user may still cancel the close.
  // Pen teardown happens in handlePageHide (fires only on a committed unload).
  function handleBeforeUnload(event) {
    if (get(unsavedChanges) || get(viewerDirty)) {
      // Setting returnValue is what triggers the browser/Electron "are you sure?" dialog.
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Leave anyway?';
      return event.returnValue;
    }
  }

  // Release the BLE GATT link as the page is actually being torn down (reload,
  // window close). Fires only after a beforeunload prompt is confirmed, so it
  // never disconnects a pen the user decided to keep. Synchronous by design —
  // disconnectAllPens() calls gatt.disconnect() directly. Skipping this leaves
  // a stale GATT handle that blocks reconnection on Windows until a restart.
  function handlePageHide() {
    try {
      disconnectAllPens();
    } catch (e) {
      // best-effort during teardown
    }
  }

  // Book View instance + shared state bound from BookViewer, so the global
  // controls (Home, Strokes/Transcript, Single/Spread) can live in the top bar.
  let bookViewer;
  let bookViewerContentMode = 'strokes';
  let bookViewerSpread = true;
  let bookViewerHasSelection = false;

  // Switch the right pane between the Editor (live StrokeCanvas) and Book View.
  // Guards against silently dropping unsaved transcript edits when leaving Book View.
  function switchView(mode) {
    if (mode === 'editor' && get(viewerDirty)) {
      if (!window.confirm('You have unsaved transcript edits. Discard them?')) return;
      clearAllViewerDirty();
    }
    setViewerMode(mode);
  }

  onMount(() => {
    initializePenSDK();
    log('Bridge initialized. Click "Connect Pen" to begin.', 'info');
    log('Make sure LogSeq HTTP API is enabled in Settings > Advanced', 'info');

    // Kick off data-folder availability check (non-blocking)
    checkDataFolder();

    // Unsaved-changes window-close prompt
    window.addEventListener('beforeunload', handleBeforeUnload);
    // Graceful pen teardown on a committed unload (reload / window close)
    window.addEventListener('pagehide', handlePageHide);

    // Set up Electron IPC listeners for Bluetooth device picker
    if (window.electronAPI) {
      // Open dialog when Bluetooth scanning starts
      window.electronAPI.onBluetoothScanStarted(() => {
        openBluetoothPicker();
      });

      // Update device list as devices are discovered
      window.electronAPI.onBluetoothDeviceFound((devices) => {
        updateBluetoothDevices(devices);
      });

      // Main process is quitting (close / Ctrl+Q / Windows log-off): release
      // the BLE GATT link, then tell main it's safe to finish quitting.
      window.electronAPI.onAppBeforeQuit(() => {
        try {
          disconnectAllPens();
        } catch (e) {
          // best-effort during shutdown
        }
        window.electronAPI.notifyDisconnectComplete();
      });
    }
  });

  onDestroy(() => {
    // Release any live BLE link as the app tears down.
    try {
      disconnectAllPens();
    } catch (e) {
      // best-effort
    }
    // Clean up IPC listeners
    if (window.electronAPI) {
      window.electronAPI.removeBluetoothListeners();
    }
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('pagehide', handlePageHide);
  });
</script>

<div class="app">
  <Header />
  
  <main class="main-grid">
    <!-- Left Panel: Data Explorer & Activity Log -->
    <LeftPanel />
    
    <!-- Right: Canvas or Book View -->
    <div class="canvas-section">
      <div class="viewer-topbar">
        <div class="view-switch">
          <button
            class="view-switch-btn"
            class:active={$viewerMode === 'editor'}
            on:click={() => switchView('editor')}
          >Editor</button>
          <button
            class="view-switch-btn"
            class:active={$viewerMode === 'book'}
            on:click={() => switchView('book')}
          >Book View</button>
        </div>

        {#if $viewerMode === 'book' && bookViewerHasSelection}
          <div class="viewer-globals">
            <button class="vg-btn icon" on:click={() => bookViewer?.goHome()} title="Back to all pages">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </button>
            <div class="vg-segment">
              <button
                class:active={bookViewerContentMode === 'strokes'}
                on:click={() => bookViewer?.setContentMode('strokes')}
              >Strokes</button>
              <button
                class:active={bookViewerContentMode === 'transcript'}
                on:click={() => bookViewer?.setContentMode('transcript')}
              >Transcript</button>
            </div>
            <button
              class="vg-btn"
              class:active={bookViewerSpread}
              on:click={() => bookViewer?.toggleSpread()}
              title={bookViewerSpread ? 'Single page' : 'Two-page spread'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#if bookViewerSpread}
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="12" y1="3" x2="12" y2="21"/>
                {:else}
                  <rect x="5" y="3" width="14" height="18" rx="2"/>
                {/if}
              </svg>
              {bookViewerSpread ? 'Spread' : 'Single'}
            </button>
          </div>
        {/if}
      </div>

      {#if $viewerMode === 'book'}
        <BookViewer
          bind:this={bookViewer}
          bind:contentMode={bookViewerContentMode}
          bind:twoPageMode={bookViewerSpread}
          bind:hasSelection={bookViewerHasSelection}
        />
      {:else}
        <StrokeCanvas />
      {/if}
    </div>
  </main>
  
  <!-- Dialogs -->
  <BookSelectionDialog />
  <BluetoothDevicePicker />
</div>

<style>
  :global(:root) {
    --bg-primary: #1a1a2e;
    --bg-secondary: #16213e;
    --bg-tertiary: #0f3460;
    --accent: #e94560;
    --accent-hover: #ff6b6b;
    --text-primary: #eaeaea;
    --text-secondary: #a0a0a0;
    --success: #4ade80;
    --warning: #fbbf24;
    --error: #ef4444;
    --border: #2a2a4a;
  }

  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100vh;
    line-height: 1.6;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 20px;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 450px 1fr;
    gap: 20px;
    flex: 1;
    min-height: 0;
    padding-bottom: 20px;
  }

  .canvas-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .viewer-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .view-switch {
    display: inline-flex;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
  }

  .view-switch-btn {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .view-switch-btn:hover {
    color: var(--text-primary);
  }

  .view-switch-btn.active {
    background: var(--accent);
    color: white;
  }

  /* Book View global controls (shared header for both spread pages) */
  .viewer-globals {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vg-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vg-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .vg-btn.icon {
    padding: 6px 8px;
  }

  .vg-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .vg-segment {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .vg-segment button {
    padding: 6px 14px;
    border: none;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vg-segment button + button {
    border-left: 1px solid var(--border);
  }

  .vg-segment button:hover {
    color: var(--text-primary);
  }

  .vg-segment button.active {
    background: var(--accent);
    color: white;
  }

  /* Responsive adjustments */
  @media (max-width: 1400px) {
    .main-grid {
      grid-template-columns: 380px 1fr;
    }
  }

  @media (max-width: 1000px) {
    .main-grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
  }

  /* Global button styles */
  :global(.btn) {
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  :global(.btn-primary) {
    background: var(--accent);
    color: white;
  }

  :global(.btn-primary:hover:not(:disabled)) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  :global(.btn-secondary) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  :global(.btn-secondary:hover:not(:disabled)) {
    background: var(--border);
  }

  :global(.btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.btn-success) {
    background: var(--success);
    color: var(--bg-primary);
  }

  :global(.btn-success:hover:not(:disabled)) {
    background: #22c55e;
  }

  /* Global panel styles */
  :global(.panel) {
    background: var(--bg-secondary);
    border-radius: 12px;
    padding: 20px;
    border: 1px solid var(--border);
  }

  :global(.panel-header) {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }

  /* Global input styles */
  :global(.input-group) {
    margin-bottom: 15px;
  }

  :global(.input-group label) {
    display: block;
    font-size: 0.85rem;
    margin-bottom: 5px;
    color: var(--text-secondary);
  }

  :global(.input-group input) {
    width: 100%;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  :global(.input-group input:focus) {
    outline: none;
    border-color: var(--accent);
  }
</style>
