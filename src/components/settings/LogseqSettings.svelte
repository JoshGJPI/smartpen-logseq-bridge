<!--
  LogseqSettings.svelte - LogSeq API configuration and send controls
-->
<script>
  import { logseqHost, logseqToken, logseqConnected, setLogseqStatus, log, getLogseqSettings } from '$stores';
  import { hasTranscription, transcribedLines } from '$stores';
  import { testLogseqConnection, sendToLogseq, scanBookAliases } from '$lib/logseq-api.js';
  import { setBookAliases } from '$stores/book-aliases.js';
  
  let isTesting = false;
  let isSending = false;
  
  async function handleTestConnection() {
    isTesting = true;
    
    try {
      const { host, token } = getLogseqSettings();
      const result = await testLogseqConnection(host, token);
      
      if (result.success) {
        setLogseqStatus(true, `LogSeq: ${result.graphName || 'Connected'}`);
        log(`Connected to LogSeq graph: ${result.graphName}`, 'success');
        
        // Load book aliases when connection succeeds
        try {
          const aliases = await scanBookAliases(host, token);
          if (Object.keys(aliases).length > 0) {
            setBookAliases(aliases);
            log(`Loaded ${Object.keys(aliases).length} book aliases`, 'info');
          }
        } catch (aliasError) {
          console.warn('Failed to load book aliases:', aliasError);
          // Don't fail connection test if aliases can't be loaded
        }
      } else {
        setLogseqStatus(false, 'LogSeq: Failed');
        log(`LogSeq connection failed: ${result.error}`, 'error');
      }
    } catch (error) {
      setLogseqStatus(false, 'LogSeq: Error');
      log(`LogSeq test error: ${error.message}`, 'error');
    } finally {
      isTesting = false;
    }
  }
  
  async function handleSendToLogseq() {
    if (!$hasTranscription) {
      log('No transcription to send. Transcribe strokes first.', 'warning');
      return;
    }
    
    isSending = true;
    log('Sending transcription to LogSeq...', 'info');
    
    try {
      const { host, token } = getLogseqSettings();
      const result = await sendToLogseq($transcribedLines, host, token);
      
      if (result.success) {
        log(`Sent ${result.blockCount} blocks to LogSeq`, 'success');
      } else {
        log(`Failed to send to LogSeq: ${result.error}`, 'error');
      }
    } catch (error) {
      log(`Send error: ${error.message}`, 'error');
    } finally {
      isSending = false;
    }
  }
</script>

<div class="logseq-settings">
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
    <label for="logseqToken">API Token (if required)</label>
    <input 
      type="password"
      id="logseqToken"
      bind:value={$logseqToken}
      placeholder="Optional"
    />
  </div>
  
  <div class="button-group">
    <button 
      class="btn btn-secondary" 
      on:click={handleTestConnection}
      disabled={isTesting}
    >
      {isTesting ? 'Testing...' : '🔗 Test Connection'}
    </button>
    
    <button 
      class="btn btn-success" 
      on:click={handleSendToLogseq}
      disabled={isSending || !$logseqConnected || !$hasTranscription}
    >
      {isSending ? 'Sending...' : '📤 Send to LogSeq'}
    </button>
  </div>
</div>

<style>
  .logseq-settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .button-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
