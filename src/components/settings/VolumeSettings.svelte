<!--
  VolumeSettings.svelte — which physical notebook new strokes belong to.

  NCode identifies a paper design, not an object: two identical notebooks report
  the same book id and the same page numbers, so without this their pages merge
  into one file. Picking a volume routes new strokes to `pages/B{book}v{n}/`
  instead, where they are a separate book to the rest of the app.

  Volume 1 is the default and is never written to _volumes.json, so a book you
  never touch here behaves exactly as it did before volumes existed.
-->
<script>
  import { knownBookIds, bookAliases } from '$stores';
  import { volumeRegistry, setActiveVolume, activeVolumeFor, volumesForBook } from '$stores/volumes.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { compareBookKeys, ncodeBookOf, parseBookKey } from '$lib/volumes.js';
  import { formatBookName } from '$utils/formatting.js';

  // One row per NCode book — volumes of a book are separate book keys in
  // knownBookIds, but they share a physical-notebook identity here.
  $: ncodeBooks = [...new Set(
      Array.from($knownBookIds)
        .map(ncodeBookOf)
        .filter(b => b != null)
    )].sort((a, b) => a - b);

  $: registry = $volumeRegistry;   // re-evaluate the rows when routing changes

  function volumesFor(ncodeBook) {
    return volumesForBook(ncodeBook, [...$knownBookIds]);
  }

  function currentVolume(ncodeBook) {
    // eslint-disable-next-line no-unused-expressions
    registry;
    return activeVolumeFor(ncodeBook);
  }

  function labelFor(ncodeBook, volume) {
    const key = volume === 1 ? String(ncodeBook) : `${ncodeBook}v${volume}`;
    return formatBookName(key, $bookAliases, 'alias-only');
  }

  async function handleChange(ncodeBook, event) {
    await setActiveVolume(ncodeBook, Number(event.currentTarget.value));
  }
</script>

<div class="settings-section">
  <h3>📚 Notebook Volumes</h3>

  {#if ncodeBooks.length === 0}
    <p class="empty-state">No books found yet. Import strokes to get started.</p>
  {:else}
    <p class="help-text">
      Using a second physical notebook with the same NCode paper? Give it a volume so
      its pages don't merge into the first one's.
      {#if !$dataFolderReady}
        <span class="warning">⚠️ Volume routing needs a Data Folder to persist.</span>
      {/if}
    </p>

    <div class="volume-list">
      {#each ncodeBooks as ncodeBook}
        {@const active = currentVolume(ncodeBook)}
        {@const choices = volumesFor(ncodeBook)}
        {@const nextVolume = Math.max(...choices) + 1}
        <div class="volume-row" class:non-default={active > 1}>
          <div class="book-label" title="NCode book {ncodeBook}">
            {formatBookName(String(ncodeBook), $bookAliases, 'alias-only')}
            <span class="book-id">B{ncodeBook}</span>
          </div>

          <select
            class="volume-select"
            value={active}
            disabled={!$dataFolderReady}
            on:change={(e) => handleChange(ncodeBook, e)}
          >
            {#each choices as v}
              <option value={v}>Volume {v} — {labelFor(ncodeBook, v)}</option>
            {/each}
            <option value={nextVolume}>➕ Start Volume {nextVolume}</option>
          </select>
        </div>
      {/each}
    </div>

    <p class="note">
      Only affects strokes captured <em>after</em> the change. To fix ones already on the
      canvas, select them and use the <strong>Volume</strong> menu above the canvas —
      that moves them properly, rather than leaving a copy behind.
    </p>
  {/if}
</div>

<style>
  .settings-section {
    padding: 12px 0;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 0.85rem;
    color: var(--text-primary);
  }

  .help-text,
  .note,
  .empty-state {
    margin: 0 0 10px;
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .note {
    margin: 10px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .warning {
    display: block;
    margin-top: 4px;
    color: var(--warning, #f59e0b);
  }

  .volume-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .volume-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .volume-row.non-default {
    border-color: rgba(139, 92, 246, 0.45);
    background: rgba(139, 92, 246, 0.06);
  }

  .book-label {
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .book-id {
    margin-left: 6px;
    font-size: 0.68rem;
    color: var(--text-secondary);
  }

  .volume-select {
    flex-shrink: 0;
    padding: 3px 6px;
    font-size: 0.72rem;
    background: var(--bg-secondary, transparent);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
  }

  .volume-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
