<!--
  MyScriptSettings.svelte — the handwriting-recognition keys (MyScript Cloud),
  with Show keys and Test. Moved out of SettingsDropdown in v3.14.0, where it
  now sits under "Handwriting recognition", folded once the keys are set.
  The keys are never logged, not even in part.
-->
<script>
  import { myscriptAppKey, myscriptHmacKey, hasMyScriptCredentials, getMyScriptCredentials, log } from '$stores';
  import { testMyScriptCredentials } from '$lib/myscript-api.js';

  let showKeys = false;
  let isTesting = false;

  async function test() {
    if (!$hasMyScriptCredentials) {
      log('Please enter MyScript API credentials', 'warning');
      return;
    }
    isTesting = true;
    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      const result = await testMyScriptCredentials(appKey, hmacKey);
      if (result.success) log('MyScript credentials valid!', 'success');
      else log(`MyScript test failed: ${result.error}`, 'error');
    } catch (error) {
      log(`MyScript test error: ${error.message}`, 'error');
    } finally {
      isTesting = false;
    }
  }
</script>

<div class="input-group">
  <label for="myscriptAppKey">Application Key</label>
  {#if showKeys}
    <input type="text" id="myscriptAppKey" bind:value={$myscriptAppKey} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
  {:else}
    <input type="password" id="myscriptAppKey" bind:value={$myscriptAppKey} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
  {/if}
</div>

<div class="input-group">
  <label for="myscriptHmacKey">HMAC Key</label>
  {#if showKeys}
    <input type="text" id="myscriptHmacKey" bind:value={$myscriptHmacKey} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
  {:else}
    <input type="password" id="myscriptHmacKey" bind:value={$myscriptHmacKey} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
  {/if}
</div>

<label class="show-keys">
  <input type="checkbox" bind:checked={showKeys} />
  Show keys
</label>

<button class="btn" on:click={test} disabled={isTesting || !$hasMyScriptCredentials}>
  {isTesting ? 'Testing…' : 'Test keys'}
</button>

<p class="help-text">
  <a href="https://developer.myscript.com/" target="_blank" rel="noopener">
    Get MyScript API keys (free: 2,000 requests/month)
  </a>
</p>

<style>
  .input-group { margin-bottom: 15px; }
  .input-group label { display: block; font-size: 0.85rem; margin-bottom: 5px; color: var(--text-secondary); }
  .input-group input {
    width: 100%;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }
  .input-group input:focus { outline: none; border-color: var(--accent); }
  .show-keys {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
    margin-bottom: 12px;
  }
  .show-keys input { width: auto; }
  .btn {
    width: 100%;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  .btn:hover:not(:disabled) { background: var(--border); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .help-text { font-size: 0.75rem; color: var(--text-secondary); text-align: center; margin-top: 10px; }
  .help-text a { color: var(--accent); text-decoration: none; }
  .help-text a:hover { text-decoration: underline; }
</style>
