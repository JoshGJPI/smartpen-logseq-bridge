<!--
  MyScriptSettings.svelte - MyScript API configuration and transcription controls
-->
<script>
  import { myscriptAppKey, myscriptHmacKey, hasMyScriptCredentials, log, getMyScriptCredentials } from '$stores';
  import { selectedStrokes, selectionCount, hasSelection } from '$stores';
  import { setTranscription, setIsTranscribing, isTranscribing } from '$stores';
  import { setActiveTab } from '$stores';
  import { transcribeStrokes, testMyScriptCredentials } from '$lib/myscript-api.js';
  
  let showKeys = false;
  let isTesting = false;
  
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
  
  async function handleTranscribe() {
    if (!$hasMyScriptCredentials) {
      log('Please enter MyScript API credentials', 'warning');
      return;
    }
    
    if (!$hasSelection) {
      log('No strokes selected for transcription', 'warning');
      return;
    }
    
    setIsTranscribing(true);
    log(`Transcribing ${$selectionCount} strokes...`, 'info');
    
    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      const result = await transcribeStrokes($selectedStrokes, appKey, hmacKey);
      
      setTranscription(result);
      setActiveTab('transcription');
      log(`Transcription complete: ${result.text?.length || 0} characters`, 'success');
    } catch (error) {
      log(`Transcription failed: ${error.message}`, 'error');
    } finally {
      setIsTranscribing(false);
    }
  }
  
  // Reactive check for valid credentials
  $: canTranscribe = $hasMyScriptCredentials && $hasSelection && !$isTranscribing;
</script>

<div class="myscript-settings">
  <div class="input-group">
    <label for="myscriptAppKey">Application Key</label>
    <!-- Svelte 4 doesn't allow dynamic type with bind:value, so we use two inputs -->
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
  
  <div class="button-group">
    <button 
      class="btn btn-secondary" 
      on:click={handleTestMyScript}
      disabled={isTesting || !$hasMyScriptCredentials}
    >
      {isTesting ? 'Testing...' : '🔑 Test Keys'}
    </button>
    
    <button 
      class="btn btn-primary" 
      on:click={handleTranscribe}
      disabled={!canTranscribe}
    >
      {#if $isTranscribing}
        Transcribing...
      {:else}
        ✍️ Transcribe Selected
        {#if $hasSelection}
          ({$selectionCount})
        {/if}
      {/if}
    </button>
  </div>
  
  <p class="help-text">
    <a href="https://developer.myscript.com/" target="_blank" rel="noopener">
      Get MyScript API keys (free: 2,000 requests/month)
    </a>
  </p>
</div>

<style>
  .myscript-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .show-keys {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .show-keys input {
    width: auto;
  }

  .button-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .help-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
    margin-top: 5px;
  }

  .help-text a {
    color: var(--accent);
    text-decoration: none;
  }

  .help-text a:hover {
    text-decoration: underline;
  }
</style>
