<!--
  EditorEmptyState.svelte — what the Editor shows over an empty canvas (v3.14.0).

  The tool rows are hidden while nothing is loaded (StrokeCanvas), so this is
  the one thing on screen: the ways ink gets onto the canvas, as buttons.
  Live ink replaces it with the first stroke.
-->
<script>
  import { navigateTo, revealLeftPanel, penConnected, log } from '$stores';
  import { connectPen } from '$lib/pen-sdk.js';

  let connecting = false;

  async function connect() {
    connecting = true;
    try {
      await connectPen();
    } catch (error) {
      log(`Connection failed: ${error.message}`, 'error');
    } finally {
      connecting = false;
    }
  }
</script>

<div class="ees" role="note">
  <h3>Nothing on the canvas</h3>
  <p>{$penConnected ? 'Write with the pen, or bring saved pages in.' : 'Connect the pen and write, or bring saved pages in.'}</p>
  <div class="acts">
    <button type="button" class="primary" on:click={() => navigateTo('timeline')}
      title="Pick a session, day or range on the Timeline and load it here">Load a day from the Timeline</button>
    <button type="button" on:click={() => revealLeftPanel('saved-pages')}
      title="Choose saved pages to load (left panel, Pages)">Pick pages…</button>
    {#if !$penConnected}
      <button type="button" on:click={connect} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect pen'}</button>
    {/if}
  </div>
  <p class="hint">In the Library, a page's ✎ button loads it here too.</p>
</div>

<style>
  .ees {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    color: #555;
    pointer-events: none;
  }
  h3 { margin: 0; font-size: 17px; font-weight: 600; color: #333; }
  p { margin: 0; font-size: 13px; }
  .hint { margin-top: 6px; font-size: 12px; color: #999; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 10px; pointer-events: auto; }
  button {
    padding: 6px 14px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fff;
    color: #333;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: #4a7cf7; color: #2c56c4; }
  button:disabled { opacity: 0.6; cursor: default; }
  button.primary { background: #4a7cf7; border-color: #4a7cf7; color: #fff; }
  button.primary:hover { background: #3d6be0; color: #fff; }
</style>
