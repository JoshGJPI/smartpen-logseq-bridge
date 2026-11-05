<!--
  SettingsSection.svelte — one folding section of the Settings panel (v3.14.0).

  The heading is the summary, with a one-line `status` beside it ("✓ keys set"),
  so a section that is already set can stay folded and still say so. Whether a
  section was left open is remembered per viewer (`storageKey`); until it has
  been touched, `defaultOpen` decides.
-->
<script>
  import { readString, write } from '$lib/safe-storage.js';

  export let title;
  /** Short state shown beside the heading, e.g. "✓ keys set". */
  export let status = '';
  /** Shown as a warning (amber) rather than a quiet note. */
  export let warn = false;
  export let defaultOpen = false;
  /** localStorage key for the open state. */
  export let storageKey;

  const stored = storageKey ? readString(storageKey) : null;
  let open = stored === 'true' ? true : stored === 'false' ? false : defaultOpen;

  function onToggle(e) {
    open = e.currentTarget.open;
    if (storageKey) write(storageKey, String(open));
  }
</script>

<section class="ss">
  <details {open} on:toggle={onToggle}>
    <summary>
      <h4>{title}</h4>
      {#if status}<span class="st" class:warn>{status}</span>{/if}
    </summary>
    <div class="body"><slot /></div>
  </details>
</section>

<style>
  .ss {
    margin-bottom: 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }
  .ss:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
  summary {
    display: flex;
    align-items: center;
    gap: 10px;
    list-style: none;
    cursor: pointer;
    border-radius: 4px;
  }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  h4 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .st {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .st.warn { color: var(--warning); }
  summary::after {
    content: '';
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    margin-left: auto;
    border-right: 2px solid var(--text-secondary);
    border-bottom: 2px solid var(--text-secondary);
    transform: rotate(-45deg);
    transition: transform 0.15s;
  }
  details[open] summary::after { transform: rotate(45deg); }
  summary:hover::after { border-color: var(--text-primary); }
  .body { padding-top: 14px; }
</style>
