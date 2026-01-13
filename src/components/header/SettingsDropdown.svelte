<!--
  SettingsDropdown.svelte - Settings panel dropdown for header
-->
<script>
  import { 
    myscriptAppKey, 
    myscriptHmacKey, 
    logseqHost, 
    logseqToken,
    hasMyScriptCredentials,
    logseqConnected,
    setLogseqStatus,
    log,
    getMyScriptCredentials,
    getLogseqSettings
  } from '$stores';
  import { testMyScriptCredentials } from '$lib/myscript-api.js';
  import { testLogseqConnection } from '$lib/logseq-api.js';
  import BookAliasManager from '../settings/BookAliasManager.svelte';
  import PenMemoryDialog from '../dialog/PenMemoryDialog.svelte';
  import { penConnected } from '$stores/pen.js';
  
  let isOpen = false;
  let showKeys = false;
  let isTesting = false;
  let isTestingLogseq = false;
  let showPenMemoryDialog = false;
  
  function toggleDropdown() {
    isOpen = !isOpen;
  }
  
  function closeDropdown() {
    isOpen = false;
  }
  
  async function handleTestMyScript() {
    if (!$hasMyScriptCredentials) {
      log('Please enter MyScript API credentials', 'warning');
      return;
    }
    
    isTesting = true;
    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      const result = await testMyScriptCredentials(appKey, hmacKey);
      
      if (result.success) {
        log('MyScript credentials valid!', 'success');
      } else {
        log(`MyScript test failed: ${result.error}`, 'error');
      }
    } catch (error) {
      log(`MyScript test error: ${error.message}`, 'error');
    } finally {
      isTesting = false;
    }
  }
  
  async function handleTestLogseq() {
    isTestingLogseq = true;
    
    try {
      const { host, token } = getLogseqSettings();
      const result = await testLogseqConnection(host, token);
      
      if (result.success) {
        setLogseqStatus(true, `LogSeq: ${result.graphName || 'Connected'}`);
        log(`Connected to LogSeq graph: ${result.graphName}`, 'success');
      } else {
        setLogseqStatus(false, 'LogSeq: Failed');
        log(`LogSeq connection failed: ${result.error}`, 'error');
      }
    } catch (error) {
      setLogseqStatus(false, 'LogSeq: Error');
      log(`LogSeq test error: ${error.message}`, 'error');
    } finally {
      isTestingLogseq = false;
    }
  }
  
  function handleManagePenMemory() {
    if (!$penConnected) {
      log('Please connect your pen first', 'warning');
      return;
    }
    showPenMemoryDialog = true;
    isOpen = false;  // Close settings dropdown
  }
  
  function handlePenMemoryClose() {
    showPenMemoryDialog = false;
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
  <button class="settings-btn" on:click|stopPropagation={toggleDropdown} title="Settings">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M23 12h-6m-6 0H1m13.2 5.2l-4.2-4.2m0-6l-4.2-4.2"/>
    </svg>
    Settings
  </button>
  
  {#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="dropdown-panel" on:click|stopPropagation>
      <div class="panel-header">
        <h3>Settings</h3>
        <button class="close-btn" on:click={closeDropdown}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      
      <!-- MyScript Settings -->
      <section class="settings-section">
        <h4>MyScript Configuration</h4>
        
        <div class="input-group">
          <label for="myscriptAppKey">Application Key</label>
          {#if showKeys}
            <input 
              type="text"
              id="myscriptAppKey"
              bind:value={$myscriptAppKey}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          {:else}
            <input 
              type="password"
              id="myscriptAppKey"
              bind:value={$myscriptAppKey}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          {/if}
        </div>
        
        <div class="input-group">
          <label for="myscriptHmacKey">HMAC Key</label>
          {#if showKeys}
            <input 
              type="text"
              id="myscriptHmacKey"
              bind:value={$myscriptHmacKey}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          {:else}
            <input 
              type="password"
              id="myscriptHmacKey"
              bind:value={$myscriptHmacKey}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          {/if}
        </div>
        
        <label class="show-keys">
          <input type="checkbox" bind:checked={showKeys} />
          Show keys
        </label>
        
        <button 
          class="btn btn-secondary" 
          on:click={handleTestMyScript}
          disabled={isTesting || !$hasMyScriptCredentials}
        >
          {isTesting ? 'Testing...' : '🔑 Test MyScript Keys'}
        </button>
        
        <p class="help-text">
          <a href="https://developer.myscript.com/" target="_blank" rel="noopener">
            Get MyScript API keys (free: 2,000 requests/month)
          </a>
        </p>
      </section>
      
      <!-- LogSeq Settings -->
      <section class="settings-section">
        <h4>LogSeq Configuration</h4>
        
        <div class="input-group">
          <label for="logseqHost">API Host</label>
          <input 
            type="text"
            id="logseqHost"
            bind:value={$logseqHost}
            placeholder="http://127.0.0.1:12315"
          />
        </div>
        
        <div class="input-group">
          <label for="logseqToken">API Token (optional)</label>
          <input 
            type="password"
            id="logseqToken"
            bind:value={$logseqToken}
            placeholder="Optional"
          />
        </div>
        
        <button 
          class="btn btn-secondary" 
          on:click={handleTestLogseq}
          disabled={isTestingLogseq}
        >
          {isTestingLogseq ? 'Testing...' : '🔗 Test LogSeq Connection'}
        </button>
      </section>
      
      <!-- Book Aliases -->
      <section class="settings-section">
        <BookAliasManager />
      </section>
      
      <!-- Pen Memory Management -->
      <section class="settings-section">
        <h4>Pen Memory</h4>
        
        <button 
          class="btn btn-secondary manage-memory-btn"
          class:disabled={!$penConnected}
          on:click={handleManagePenMemory}
          disabled={!$penConnected}
        >
          <span class="button-icon">🗑️</span>
          <span class="button-text">Manage Pen Memory</span>
          {#if !$penConnected}
            <span class="badge disabled">Pen Disconnected</span>
          {/if}
        </button>
        
        <p class="help-text">
          Delete books from pen memory to free up storage space.
        </p>
      </section>
    </div>
  {/if}
</div>

<!-- Pen Memory Dialog -->
<PenMemoryDialog 
  bind:visible={showPenMemoryDialog} 
  onClose={handlePenMemoryClose}
/>

<style>
  .settings-dropdown {
    position: relative;
  }

  .settings-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .settings-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-1px);
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

  .settings-section {
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border);
  }

  .settings-section:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .settings-section h4 {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 15px;
    color: var(--text-primary);
  }

  .input-group {
    margin-bottom: 15px;
  }

  .input-group label {
    display: block;
    font-size: 0.85rem;
    margin-bottom: 5px;
    color: var(--text-secondary);
  }

  .input-group input {
    width: 100%;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .show-keys {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
    margin-bottom: 12px;
  }

  .show-keys input {
    width: auto;
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

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--border);
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

  .help-text a {
    color: var(--accent);
    text-decoration: none;
  }

  .help-text a:hover {
    text-decoration: underline;
  }
  
  .manage-memory-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  
  .manage-memory-btn .button-icon {
    font-size: 1.1rem;
    line-height: 1;
  }
  
  .manage-memory-btn .button-text {
    flex: 1;
    text-align: left;
  }
  
  .manage-memory-btn .badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--bg-primary);
    color: var(--text-secondary);
  }
  
  .manage-memory-btn .badge.disabled {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
  
  .manage-memory-btn.disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
