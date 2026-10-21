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
  import TimelineFeed from './components/viewer/TimelineFeed.svelte';
  import PaneToolbar from './components/layout/PaneToolbar.svelte';
  import SpreadToolbar from './components/viewer/SpreadToolbar.svelte';

  // Stores
  import { log } from '$stores';
  import { openBluetoothPicker, updateBluetoothDevices, closeBluetoothPicker } from '$stores/ui.js';
  import { dataRoot, setDataFolderStatus, getDataRoot } from '$stores/settings.js';
  import { graphRoot, setGraphFolderStatus, getGraphRoot } from '$stores/settings.js';
  import { unsavedChanges, viewerDirty, destination, navigateTo, readerSequence, readingList, readingLabel } from '$stores';
  import { DESTINATIONS, DESTINATION_LABELS } from '$lib/navigation.js';
  import { leftPanelCollapsed, toggleLeftPanel } from '$stores';
  import { isPanelToggleKey, modalOpen } from '$lib/left-panel.js';
  import { refreshBackgrounds } from '$stores';
  import { isAvailable as folderIsAvailable } from '$lib/storage/local-store.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import { loadVolumes } from '$stores/volumes.js';

  // Initialize pen SDK on mount
  import { initializePenSDK, disconnectAllPens } from '$lib/pen-sdk.js';

  // v2.0: Check data folder availability at boot. Returns true once the folder
  // is confirmed accessible, so the caller can preload the saved-pages metadata.
  async function checkDataFolder() {
    const root = getDataRoot();
    if (!root) {
      setDataFolderStatus(false, 'Folder: not set');
      return false;
    }
    try {
      const ok = await folderIsAvailable(root);
      if (ok) {
        const basename = root.split(/[\\/]/).pop() || root;
        setDataFolderStatus(true, `Folder: ${basename}`);
        log(`Data folder ready: ${root}`, 'success');
        return true;
      } else {
        setDataFolderStatus(false, 'Folder: missing');
        log(`Data folder not accessible: ${root}`, 'warning');
        return false;
      }
    } catch (err) {
      setDataFolderStatus(false, 'Folder: error');
      log(`Data folder check failed: ${err.message}`, 'warning');
      return false;
    }
  }

  // "Export to LogSeq": check the graph folder at boot so the status dot is
  // accurate before the user reaches for the export button.
  async function checkGraphFolder() {
    const root = getGraphRoot();
    if (!root) {
      setGraphFolderStatus(false, 'Graph: not set');
      return;
    }
    try {
      const ok = await folderIsAvailable(root);
      if (ok) {
        const basename = root.split(/[\\/]/).pop() || root;
        setGraphFolderStatus(true, `Graph: ${basename}`);
        log(`LogSeq graph export target ready: ${root}`, 'info');
      } else {
        setGraphFolderStatus(false, 'Graph: missing');
        log(`Graph folder not accessible: ${root}`, 'warning');
      }
    } catch (err) {
      setGraphFolderStatus(false, 'Graph: error');
      log(`Graph folder check failed: ${err.message}`, 'warning');
    }
  }

  // v2.0: Mirror unsaved-changes state to the Electron main process.
  // Main owns the close/quit confirmation now — a native, visible dialog driven
  // by the window 'close' event (see electron/main.cjs). A renderer beforeunload
  // returnValue does NOT show a prompt in Electron; it silently cancels the
  // close, which is exactly what made the window appear unable to close while
  // leaving the user no warning. Pushing the real dirty state here means the
  // warning appears only when there are genuinely unsaved strokes or transcript
  // edits, and the close can never be silently blocked.
  $: if (typeof window !== 'undefined' && window.electronAPI?.setUnsavedState) {
    window.electronAPI.setUnsavedState($unsavedChanges || $viewerDirty);
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

  // Book View instance + shared state bound from BookViewer, so the pane
  // toolbar's breadcrumb, View menu and the reader's shared controls can drive
  // Home, the content mode, Single/Spread, zoom and Go to page.
  let bookViewer;
  let bookViewerContentMode = 'strokes';
  let bookViewerSpread = true;
  let bookViewerHasSelection = false;
  let bookViewerZoom = '';
  let bookViewerOpenBook = null;

  // `[` folds the left panel to its rail and back. isPanelToggleKey keeps it out
  // of text fields and modifier chords.
  function handleGlobalKeydown(e) {
    if (!isPanelToggleKey(e) || modalOpen()) return;
    e.preventDefault();
    toggleLeftPanel();
  }

  onMount(() => {
    initializePenSDK();
    log('smartpen-bridge ready. Click "Connect" in the header to pair the pen.', 'info');

    // Kick off data-folder availability check (non-blocking). Once the folder is
    // confirmed ready, preload the saved-pages metadata so the Saved Pages tab and
    // Book View are populated the moment they open. The scan is metadata-only
    // (perf #3) — fast and low-residency — so there's no downside to doing it at
    // boot; scanLocalPages() coalesces with any tab-triggered scan.
    checkDataFolder().then((ready) => {
      if (ready) {
        // Volume routing first: it decides which book key incoming strokes get
        // stamped with, so it has to be loaded before the pen can deliver any.
        loadVolumes().then(() => scanLocalPages());
        // Which books have Neo page backgrounds cached (independent of the scan).
        refreshBackgrounds();
      }
    });
    // Same for the LogSeq graph publish target (non-blocking)
    checkGraphFolder();

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
    window.removeEventListener('pagehide', handlePageHide);
  });
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<!-- Full window width in every destination (v3.0.0): the Library, the Timeline
     and the Editor all use a big monitor, and switching between them no longer
     changes the frame's width. The canvas follows its pane (ResizeObserver). -->
<div class="app">
  <Header>
    <!-- Primary navigation: the three destinations. navigateTo (stores/viewer.js)
         asks before dropping unsaved transcript edits, for this and every other
         route between them. -->
    <div slot="nav" class="view-switch" role="group" aria-label="Destination">
      {#each DESTINATIONS as dest (dest)}
        <button
          class="view-switch-btn"
          class:active={$destination === dest}
          aria-pressed={$destination === dest}
          on:click={() => navigateTo(dest)}
        >{DESTINATION_LABELS[dest]}</button>
      {/each}
    </div>
  </Header>
  
  <main class="main-grid" class:panel-collapsed={$leftPanelCollapsed}>
    <!-- Left Panel: Data Explorer & Activity Log -->
    <LeftPanel />
    
    <!-- Right: Canvas or Book View -->
    <div class="canvas-section">
      <!-- Library and Timeline only: no View option applies to the Editor, which
           has its own canvas toolbar. -->
      {#if $destination !== 'editor'}
        <PaneToolbar
          contentMode={bookViewerContentMode}
          spread={bookViewerSpread}
          hasSelection={bookViewerHasSelection}
          openBook={bookViewerOpenBook}
          onHome={() => bookViewer?.goHome()}
          onNotebook={(book) => bookViewer?.openNotebook(book)}
          onSequence={() => bookViewer?.openSequenceOrigin()}
          onContent={(mode) => bookViewer?.setContentMode(mode)}
          onToggleSpread={() => bookViewer?.toggleSpread()}
        >
          <!-- An open page, or a notebook's page grid (Go to page only: no ink, no zoom). -->
          {#if $destination === 'library' && bookViewerOpenBook != null}
            <SpreadToolbar
              zoomLabel={bookViewerHasSelection ? bookViewerZoom : ''}
              onZoom={(op) => bookViewer?.zoomAll(op)}
              onGoTo={(text) => bookViewer?.goToPage(text) ?? false}
              order={bookViewerHasSelection && $readerSequence ? $readingList.order : null}
              orderLabel={$readingLabel}
              onOrder={(order) => bookViewer?.setReadingOrder(order)}
            />
          {/if}
        </PaneToolbar>
      {/if}

      {#if $destination === 'timeline'}
        <TimelineFeed />
      {:else if $destination === 'library'}
        <BookViewer
          bind:this={bookViewer}
          bind:contentMode={bookViewerContentMode}
          bind:twoPageMode={bookViewerSpread}
          bind:hasSelection={bookViewerHasSelection}
          bind:zoomLabel={bookViewerZoom}
          bind:openBook={bookViewerOpenBook}
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

    /* Colour roles. The bright accent is the single primary action on a screen;
       "on" / selected is neutral-raised with a blue underline; dark red is for
       destruction only. */
    --selected-bg: #262650;
    --selected-border: #4a4a8a;
    --selected-line: #5b8def;
    --destructive: #7d2f3b;
    --destructive-hover: #9b3a49;
    --ok-solid: #2f7d4f;
    --ok-solid-hover: #3a9560;
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
    margin: 0 auto;
    padding: 0 20px;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 450px 1fr;
    grid-template-rows: minmax(0, 1fr);
    gap: 20px;
    flex: 1;
    min-height: 0;
    padding-bottom: 20px;
  }

  /* Rail width (LeftPanel). Two classes outrank the ≤1400 px rule below, so the
     rail stays 48 px at every window width. */
  .main-grid.panel-collapsed {
    grid-template-columns: 48px 1fr;
  }

  .canvas-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* A grid item's minimum width is its content's min-content, and a nowrap
       flex row counts its scrolling child at full length even with `min-width: 0`
       on that child. The Editor's canvas toolbar therefore held the `1fr` column
       at ~960 px and widened the whole page at 1280. Letting the column shrink
       makes the toolbar scroll inside the pane, as StrokeCanvas intends. */
    min-width: 0;
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
    padding: 4px 14px;
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
    background: var(--selected-bg);
    color: white;
    box-shadow: inset 0 -2px 0 var(--selected-line);
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
