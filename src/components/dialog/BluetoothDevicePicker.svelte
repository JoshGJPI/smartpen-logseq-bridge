<!--
  BluetoothDevicePicker.svelte - Custom styled Bluetooth device selection dialog
  Replaces native Electron dialogs with a styled Svelte component
-->
<script>
  import { onDestroy } from 'svelte';
  import { bluetoothPicker, closeBluetoothPicker, setBluetoothStatus } from '$stores/ui.js';
  import { penConnected } from '$stores/pen.js';

  $: ({ isOpen, devices, status, error } = $bluetoothPicker);

  let selectedDeviceId = null;

  // Watch for successful connection to auto-close
  $: if ($penConnected && isOpen && status === 'connecting') {
    setBluetoothStatus('connected');
    // Brief delay to show success, then close
    setTimeout(() => {
      handleClose(true);
    }, 1000);
  }

  function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
  }

  function handleConnect() {
    if (!selectedDeviceId) return;

    setBluetoothStatus('connecting');

    // Send selection to Electron main process
    if (window.electronAPI) {
      window.electronAPI.selectBluetoothDevice(selectedDeviceId);
    }
  }

  function handleCancel() {
    // Signal cancellation to Electron main process
    if (window.electronAPI) {
      window.electronAPI.cancelBluetoothScan();
    }
    handleClose(false);
  }

  function handleClose(success = false) {
    // Notify main process that connection flow is complete
    if (window.electronAPI && success) {
      window.electronAPI.notifyBluetoothConnectionComplete();
    }
    closeBluetoothPicker();
    selectedDeviceId = null;
  }

  // Handle Escape key
  function handleKeyDown(event) {
    if (event.key === 'Escape' && isOpen && status !== 'connecting') {
      handleCancel();
    }
  }

  // Add/remove keyboard listener
  $: if (isOpen) {
    window.addEventListener('keydown', handleKeyDown);
  } else {
    window.removeEventListener('keydown', handleKeyDown);
  }

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // Get selected device name for display
  $: selectedDeviceName = devices.find(d => d.deviceId === selectedDeviceId)?.deviceName || 'device';
</script>

{#if isOpen}
  <div
    class="modal-overlay"
    on:click={status !== 'connecting' ? handleCancel : null}
    on:keydown={handleKeyDown}
    role="presentation"
  >
    <div
      class="modal-content"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div class="modal-header">
        <h2 id="dialog-title">
          {#if status === 'connected'}
            Connected
          {:else if status === 'connecting'}
            Connecting...
          {:else}
            Connect Smartpen
          {/if}
        </h2>
        {#if status !== 'connecting'}
          <button class="close-btn" on:click={handleCancel} aria-label="Close">×</button>
        {/if}
      </div>

      <div class="modal-body">
        {#if status === 'scanning' || (status === 'scanning' && devices.length === 0)}
          <div class="status-section">
            <div class="spinner"></div>
            <p class="status-text">Scanning for Bluetooth devices...</p>
            <p class="hint-text">Make sure your pen is awake (tap on paper or press button)</p>
          </div>
        {/if}

        {#if devices.length > 0 && status !== 'connected'}
          <div class="device-list">
            <p class="list-label">Available Devices ({devices.length})</p>
            {#each devices as device}
              <label
                class="device-item"
                class:selected={selectedDeviceId === device.deviceId}
                class:disabled={status === 'connecting'}
              >
                <input
                  type="radio"
                  name="bluetooth-device"
                  value={device.deviceId}
                  checked={selectedDeviceId === device.deviceId}
                  disabled={status === 'connecting'}
                  on:change={() => selectDevice(device.deviceId)}
                />
                <div class="device-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11"/>
                  </svg>
                </div>
                <div class="device-info">
                  <div class="device-name">{device.deviceName}</div>
                  <div class="device-id">{device.deviceId.slice(0, 17)}...</div>
                </div>
              </label>
            {/each}
          </div>
        {/if}

        {#if status === 'connecting'}
          <div class="status-section connecting">
            <div class="spinner"></div>
            <p class="status-text">Connecting to {selectedDeviceName}...</p>
            <p class="hint-text">Please wait while the connection is established</p>
          </div>
        {/if}

        {#if status === 'connected'}
          <div class="status-section success">
            <div class="success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <p class="status-text">Connected successfully!</p>
          </div>
        {/if}

        {#if status === 'error'}
          <div class="status-section error">
            <p class="error-text">{error || 'Connection failed'}</p>
          </div>
        {/if}
      </div>

      {#if status !== 'connected'}
        <div class="modal-footer">
          <button
            class="btn btn-secondary"
            on:click={handleCancel}
            disabled={status === 'connecting'}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            on:click={handleConnect}
            disabled={!selectedDeviceId || status === 'connecting'}
          >
            {#if status === 'connecting'}
              Connecting...
            {:else}
              Connect
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 450px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
  }

  .status-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 0;
    text-align: center;
  }

  .status-section.connecting {
    padding-top: 16px;
  }

  .status-section.success {
    padding: 32px 0;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .status-text {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 500;
    margin: 0 0 8px 0;
  }

  .hint-text {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin: 0;
  }

  .success-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(74, 222, 128, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  .success-icon svg {
    color: var(--success);
  }

  .error-text {
    color: var(--error);
    font-size: 0.9rem;
    margin: 0;
  }

  .list-label {
    color: var(--text-secondary);
    font-size: 0.85rem;
    font-weight: 500;
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .device-item:hover:not(.disabled) {
    background: var(--bg-primary);
    border-color: var(--accent);
  }

  .device-item.selected {
    border-color: var(--accent);
    background: rgba(233, 69, 96, 0.1);
  }

  .device-item.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .device-item input[type="radio"] {
    cursor: pointer;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .device-item.disabled input[type="radio"] {
    cursor: not-allowed;
  }

  .device-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    flex-shrink: 0;
  }

  .device-info {
    flex: 1;
    min-width: 0;
  }

  .device-name {
    font-weight: 500;
    color: var(--text-primary);
    font-size: 0.95rem;
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .device-id {
    font-size: 0.75rem;
    color: var(--text-secondary);
    font-family: monospace;
  }

  .modal-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }

  .btn {
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    min-width: 100px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-primary);
    border-color: var(--text-secondary);
  }

  .btn-primary {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
