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

  // Stores
  import { log } from '$stores';
  import { openBluetoothPicker, updateBluetoothDevices, closeBluetoothPicker } from '$stores/ui.js';

  // Initialize pen SDK on mount
  import { initializePenSDK } from '$lib/pen-sdk.js';

  onMount(() => {
    initializePenSDK();
    log('Bridge initialized. Click "Connect Pen" to begin.', 'info');
    log('Make sure LogSeq HTTP API is enabled in Settings > Advanced', 'info');

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
    }
  });

  onDestroy(() => {
    // Clean up IPC listeners
    if (window.electronAPI) {
      window.electronAPI.removeBluetoothListeners();
    }
  });
</script>

<div class="app">
  <Header />
  
  <main class="main-grid">
    <!-- Left Panel: Data Explorer & Activity Log -->
    <LeftPanel />
    
    <!-- Right: Canvas -->
    <div class="canvas-section">
      <StrokeCanvas />
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
