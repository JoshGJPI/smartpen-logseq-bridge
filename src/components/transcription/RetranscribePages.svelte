<!--
  RetranscribePages.svelte — the Editor's Transcripts tab: re-transcribe a page
  that already has a saved transcript (v3.17.0, stores/transcript-reset.js).

  Lists the pages on the canvas that have saved ink links. Re-transcribe unlinks
  a page's loaded strokes so Transcribe sends them again; that run then replaces
  the page's saved transcript on Save (save-page.js, `replace`), with task state
  carried over by text. Undo puts the links back until then.

  Refused while only part of a page is loaded (a by-date load): the replacing
  transcript would have no lines for the ink that isn't on the canvas.
-->
<script>
  import { derived } from 'svelte/store';
  import { strokes, savedPages, bookAliases, log } from '$stores';
  import { resetPages, resetKey, resetPageTranscript, undoResetPageTranscript, strokesOnDisk, resetRefusalText } from '$stores/transcript-reset.js';
  import { compareBookKeys } from '$lib/volumes.js';
  import { formatBookName } from '$utils/formatting.js';

  /** Pages on the canvas: loaded and linked stroke counts, page-number order. */
  const canvasPages = derived(strokes, ($strokes) => {
    const by = new Map();
    for (const s of $strokes) {
      if (!s || s.deleted || !s.pageInfo) continue;
      const book = String(s.pageInfo.book), page = s.pageInfo.page;
      const key = resetKey(book, page);
      let p = by.get(key);
      if (!p) by.set(key, (p = { key, book, page, loaded: 0, linked: 0 }));
      p.loaded++;
      if (s.blockUuid) p.linked++;
    }
    return [...by.values()].sort((a, b) => compareBookKeys(a.book, b.book) || Number(a.page) - Number(b.page));
  });

  // $savedPages is read so a rescan updates the loaded / on-disk counts.
  $: rows = ($savedPages, $canvasPages)
    .map((p) => ({ ...p, total: strokesOnDisk(p.book, p.page), reset: $resetPages.get(p.key) || null }))
    .filter((p) => p.reset || p.linked > 0);

  const label = (p) => `${formatBookName(p.book, $bookAliases, 'full')} / P${p.page}`;

  async function reset(p) {
    const n = await resetPageTranscript(p.book, p.page);
    if (n < 0) return log(resetRefusalText(n, p.book, p.page), 'warning');
    log(`Re-transcribe B${p.book}/P${p.page}: ${n} stroke(s) unlinked. Select its text, Transcribe, then Save to replace the saved transcript.`, 'info');
  }

  function undo(p) {
    undoResetPageTranscript(p.book, p.page);
    log(`B${p.book}/P${p.page}: ink links restored; the saved transcript stays as it was`, 'info');
  }
</script>

{#if rows.length}
  <section class="retranscribe">
    <h4>Re-transcribe a saved page</h4>
    <p class="hint">Unlinks the page's ink so Transcribe sends it again. Saving the new run replaces the page's saved transcript (task states carry over where the text matches). Fix the links first, then edit the text.</p>
    <ul>
      {#each rows as p (p.key)}
        {@const partial = p.total != null && p.loaded < p.total}
        <li class:reset={p.reset}>
          <span class="name">{label(p)}</span>
          {#if p.reset}
            <span class="state">Unlinked — select its text (leave drawings out), Transcribe, Save</span>
            <button class="btn-small" on:click={() => undo(p)} title="Put the ink links back; the saved transcript is unchanged">Undo</button>
          {:else}
            <span class="state">{p.linked} of {p.loaded} strokes linked{partial ? ` · ${p.loaded} of ${p.total} loaded` : ''}</span>
            <button
              class="btn-small"
              on:click={() => reset(p)}
              disabled={partial}
              title={partial
                ? 'Only part of this page is loaded (a load by date?). Load the whole page from the Pages tab first: the new transcript would have no lines for the rest.'
                : 'Unlink this page\'s ink so it can be transcribed again; the new transcript replaces the saved one on Save'}
            >↺ Re-transcribe</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .retranscribe {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px 14px;
    text-align: left;
  }
  h4 { margin: 0 0 4px; font-size: 0.85rem; color: var(--text-primary); }
  .hint { margin: 0 0 8px; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.4; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-secondary);
  }
  li.reset { outline: 1px solid var(--warning, #e6a23c); }
  .name { font-size: 0.85rem; color: var(--text-primary); }
  .state { grid-column: 1; font-size: 0.72rem; color: var(--text-secondary); }
  li .btn-small { grid-column: 2; grid-row: 1 / span 2; }
  .btn-small {
    padding: 4px 10px;
    font-size: 0.75rem;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-small:hover:not(:disabled) { border-color: var(--accent); }
  .btn-small:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
