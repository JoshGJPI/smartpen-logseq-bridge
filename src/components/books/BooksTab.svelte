<!--
  BooksTab.svelte — notebook identity in one place.

  Replaces the two settings-dropdown sections (BookAliasManager, VolumeSettings)
  that each rebuilt the book list separately. They answer the same question —
  *which physical notebook is this?* — so they belong in one row per notebook.

  Names are per BOOK KEY, not per NCode book: "388" and "388v2" are two physical
  notebooks that happen to share a paper design, and can be called completely
  unrelated things. `formatBookName()` falls back to the parent's name with a
  volume suffix only while a volume has no name of its own.

  Volume rows come from `volumesForBook()`, which includes the *active* volume
  whether or not it has pages yet. That is deliberate: the old alias manager
  listed only books with pages on disk, so a fresh notebook could not be named
  until after it had been written in.
-->
<script>
  import {
    knownBookIds,
    bookAliases,
    setBookAlias,
    removeBookAlias,
    savedPages,
    log
  } from '$stores';
  import { volumeRegistry, setActiveVolume, volumesForBook } from '$stores/volumes.js';
  import { dataFolderReady } from '$stores/settings.js';
  import {
    setAlias as folderSetAlias,
    removeAlias as folderRemoveAlias
  } from '$lib/storage/local-store.js';
  import { makeBookKey, ncodeBookOf, bookDirName } from '$lib/volumes.js';
  import { formatBookName } from '$utils/formatting.js';

  /** Book keys currently being renamed. */
  let editingKeys = new Set();
  let aliasInputs = {};
  let inputEls = {};

  // Pages per book key, from the metadata-only scan — no strokes are read.
  $: pageCounts = $savedPages.reduce((acc, p) => {
    acc[p.book] = (acc[p.book] || 0) + 1;
    return acc;
  }, {});

  // One card per NCode book. Volumes of a book are separate keys in
  // knownBookIds but share a physical-notebook identity here.
  $: ncodeBooks = [...new Set(
      Array.from($knownBookIds)
        .map(ncodeBookOf)
        .filter(b => b != null)
    )].sort((a, b) => a - b);

  // Built as a reactive statement rather than called from the template so it
  // recomputes when the registry changes — a function body referencing the
  // store does not register a dependency.
  $: books = ncodeBooks.map(ncodeBook => {
    const active = activeFrom($volumeRegistry, ncodeBook);
    const volumes = volumesForBook(ncodeBook, [...$knownBookIds]);
    const rows = volumes.map(volume => {
      const key = makeBookKey(ncodeBook, volume);
      return {
        key,
        volume,
        pages: pageCounts[key] || 0,
        ownAlias: $bookAliases[key] || '',
        displayName: formatBookName(key, $bookAliases, 'alias-only'),
        isActive: volume === active
      };
    });
    return {
      ncodeBook,
      active,
      rows,
      nextVolume: Math.max(...volumes) + 1,
      totalPages: rows.reduce((n, r) => n + r.pages, 0)
    };
  });

  function activeFrom(registry, ncodeBook) {
    const v = registry?.active?.[String(ncodeBook)];
    return Number.isInteger(v) && v >= 1 ? v : 1;
  }

  function startEditing(key, current) {
    aliasInputs[key] = current || '';
    editingKeys = new Set(editingKeys).add(key);
    // Focus after the input exists.
    queueMicrotask(() => inputEls[key]?.focus());
  }

  function cancelEditing(key) {
    const next = new Set(editingKeys);
    next.delete(key);
    editingKeys = next;
  }

  async function saveAlias(key) {
    const alias = (aliasInputs[key] || '').trim();
    if (!alias) {
      log('Book name cannot be empty', 'warning');
      return;
    }

    setBookAlias(key, alias);

    if ($dataFolderReady) {
      try {
        await folderSetAlias(key, alias);
        log(`Named B${key}: ${alias}`, 'success');
      } catch (err) {
        log(`Failed to save name for B${key}: ${err.message}`, 'error');
        removeBookAlias(key);   // roll back the in-memory change
        return;
      }
    } else {
      log(`Named B${key} in memory. Set a Data Folder to keep it.`, 'info');
    }

    cancelEditing(key);
  }

  async function clearAlias(key) {
    if (!confirm(`Remove the name for B${key}?`)) return;

    removeBookAlias(key);
    aliasInputs[key] = '';

    if ($dataFolderReady) {
      try {
        await folderRemoveAlias(key);
        log(`Removed name for B${key}`, 'success');
      } catch (err) {
        log(`Failed to remove name for B${key}: ${err.message}`, 'error');
      }
    }
  }

  function handleKeydown(event, key) {
    if (event.key === 'Enter') {
      saveAlias(key);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      cancelEditing(key);
    }
  }

  async function handleVolumeChange(ncodeBook, event) {
    await setActiveVolume(ncodeBook, Number(event.currentTarget.value));
  }
</script>

<div class="books-tab">
  {#if books.length === 0}
    <div class="empty-state">
      <p class="empty-title">No notebooks yet</p>
      <p>
        Import strokes from your pen, or scan your data folder, and your notebooks
        will appear here to be named.
      </p>
    </div>
  {:else}
    <p class="intro">
      Name your notebooks and choose which volume new strokes are saved to.
      {#if !$dataFolderReady}
        <span class="warning">⚠️ Set a Data Folder to keep these settings between sessions.</span>
      {/if}
    </p>

    <div class="book-list">
      {#each books as book (book.ncodeBook)}
        <div class="book-card" class:has-volumes={book.rows.length > 1}>
          <div class="book-head">
            <span class="book-id">B{book.ncodeBook}</span>
            <span class="book-summary">
              {book.rows.length} volume{book.rows.length !== 1 ? 's' : ''}
              · {book.totalPages} page{book.totalPages !== 1 ? 's' : ''}
            </span>
          </div>

          <div class="capture-row">
            <span class="capture-label">Capturing to</span>
            <select
              class="volume-select"
              value={book.active}
              disabled={!$dataFolderReady}
              on:change={(e) => handleVolumeChange(book.ncodeBook, e)}
              title={$dataFolderReady
                ? 'Which physical notebook new strokes from this paper belong to'
                : 'Volume routing needs a Data Folder to persist'}
            >
              {#each book.rows as row (row.key)}
                <option value={row.volume}>Volume {row.volume}</option>
              {/each}
              <option value={book.nextVolume}>➕ Start Volume {book.nextVolume}</option>
            </select>
            <code class="dest-path">pages/{bookDirName(makeBookKey(book.ncodeBook, book.active))}/</code>
          </div>

          <div class="volume-rows">
            {#each book.rows as row (row.key)}
              {@const isEditing = editingKeys.has(row.key)}
              <div class="volume-row" class:active={row.isActive}>
                <span class="vol-tag">v{row.volume}</span>

                {#if isEditing}
                  <input
                    type="text"
                    class="alias-input"
                    bind:this={inputEls[row.key]}
                    bind:value={aliasInputs[row.key]}
                    on:keydown={(e) => handleKeydown(e, row.key)}
                    placeholder="Name this notebook…"
                    maxlength="50"
                  />
                  <button class="icon-btn confirm" on:click={() => saveAlias(row.key)} title="Save name">✓</button>
                  <button class="icon-btn" on:click={() => cancelEditing(row.key)} title="Cancel">✕</button>
                {:else}
                  <span class="vol-name" class:unnamed={!row.ownAlias} title={row.displayName}>
                    {row.displayName}
                  </span>

                  {#if row.isActive}
                    <span class="capturing-chip">capturing</span>
                  {/if}

                  <span class="page-count">
                    {row.pages} pp
                  </span>

                  <button
                    class="icon-btn"
                    on:click={() => startEditing(row.key, row.ownAlias)}
                    title={row.ownAlias ? `Rename B${row.key}` : `Name B${row.key}`}
                  >
                    ✎
                  </button>

                  {#if row.ownAlias}
                    <button
                      class="icon-btn remove"
                      on:click={() => clearAlias(row.key)}
                      title="Remove this name"
                    >
                      ✕
                    </button>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <p class="footnote">
      Changing the capture volume only affects strokes written <em>after</em> the change.
      To move strokes already on the canvas, select them and use the
      <strong>Volume</strong> menu above the canvas — that moves them properly rather
      than leaving a copy behind.
    </p>
  {/if}
</div>

<style>
  .books-tab {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    flex: 1;
    gap: 12px;
  }

  .intro {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .warning {
    display: block;
    margin-top: 4px;
    color: var(--warning);
  }

  .empty-state {
    padding: 30px 20px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .empty-title {
    margin: 0 0 6px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state p:last-child {
    margin: 0;
  }

  .book-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .book-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg-secondary);
  }

  /* A book with more than one volume is the case this screen exists for. */
  .book-card.has-volumes {
    border-color: rgba(139, 92, 246, 0.4);
  }

  .book-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }

  .book-id {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .book-summary {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .capture-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-bottom: 9px;
    margin-bottom: 9px;
    border-bottom: 1px solid var(--border);
  }

  .capture-label {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .volume-select {
    padding: 3px 6px;
    font-size: 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
  }

  .volume-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* The destination folder is the thing that makes routing unambiguous — the
     failure volumes exist to prevent is writing into the wrong notebook. */
  .dest-path {
    font-size: 0.68rem;
    font-family: 'Consolas', 'Monaco', monospace;
    color: var(--text-secondary);
  }

  .volume-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .volume-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 6px;
    border-radius: 4px;
    min-height: 30px;
  }

  .volume-row.active {
    background: rgba(139, 92, 246, 0.08);
  }

  .vol-tag {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-family: 'Consolas', 'Monaco', monospace;
    color: var(--text-secondary);
    min-width: 18px;
  }

  .vol-name {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* An inherited or absent name reads as provisional, so it is visibly not a
     name the user chose. */
  .vol-name.unnamed {
    color: var(--text-secondary);
    font-style: italic;
  }

  .capturing-chip {
    flex-shrink: 0;
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 8px;
    background: rgba(139, 92, 246, 0.2);
    color: #c4b5fd;
  }

  .page-count {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-family: 'Consolas', 'Monaco', monospace;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .alias-input {
    flex: 1;
    min-width: 0;
    padding: 3px 7px;
    font-size: 0.78rem;
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text-primary);
  }

  .icon-btn {
    flex-shrink: 0;
    padding: 2px 6px;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .icon-btn.confirm:hover {
    color: var(--success);
    border-color: var(--success);
  }

  .icon-btn.remove:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .footnote {
    margin: 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 0.7rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }
</style>
