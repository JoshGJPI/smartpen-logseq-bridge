<!--
  DuplicateStrokesDialog.svelte — Settings → Maintenance → Clean up duplicate strokes… (v3.18.0)

  Strokes on one page that share an id (`s{startTime}`). Opening it only reads:
  the pages the capture-date index flags (`pagesWithDuplicateStrokes`) are read
  and planned (`lib/storage/duplicate-strokes.js`), and the preview lists every
  extra copy. An exact copy is removed; a different stroke is kept under the next
  free millisecond, or removed if its box is ticked. Nothing is written until
  Clean up. Each page is then read again, cleaned from what is on disk now (a page
  that changed since the preview is skipped) and written through savePage(); the
  reading views are refreshed once at the end.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { log } from '$stores';
  import { timelineIndex, loadTimeline } from '$stores/timeline.js';
  import { pagesWithDuplicateStrokes } from '$stores/duplicate-strokes.js';
  import { getPage, savePage } from '$lib/storage/local-store.js';
  import { refreshAfterSave } from '$lib/storage/refresh.js';
  import { planDuplicateCleanup, cleanPageDoc } from '$lib/storage/duplicate-strokes.js';

  export let open = false;

  const dispatch = createEventDispatcher();

  /** 'idle' | 'planning' | 'ready' | 'writing' | 'done' */
  let phase = 'idle';
  /** @type {Array<{book:string, pageId:string, copies:Array}>} */
  let plans = [];
  /** `${book}/${pageId}/${index}` of different strokes the user chose to remove */
  let removeChosen = new Set();
  let result = null;

  $: if (open && phase === 'idle') plan();

  async function plan() {
    phase = 'planning';
    if (!get(timelineIndex)) await loadTimeline({ silent: true });
    const next = [];
    for (const r of get(pagesWithDuplicateStrokes)) {
      try {
        const doc = await getPage(r.book, r.pageId);
        const copies = planDuplicateCleanup(doc && doc.strokes);
        if (copies.length) {
          const times = new Map((doc.strokes || []).map((s, i) => [i, s.startTime]));
          next.push({ book: r.book, pageId: r.pageId,
            copies: copies.map((c) => ({ ...c, startTime: times.get(c.index) })) });
        }
      } catch (err) {
        log(`Duplicate strokes: could not read B${r.book}/P${r.pageId}: ${err.message}`, 'error');
      }
    }
    plans = next;
    removeChosen = new Set();
    phase = 'ready';
  }

  const rowKey = (p, c) => `${p.book}/${p.pageId}/${c.index}`;

  function toggleRemove(key, on) {
    const next = new Set(removeChosen);
    if (on) next.add(key); else next.delete(key);
    removeChosen = next;
  }

  async function clean() {
    phase = 'writing';
    const written = [];
    let removed = 0, reIded = 0, skipped = 0, failed = 0;
    for (const p of plans) {
      try {
        const doc = await getPage(p.book, p.pageId);
        if (!doc) throw new Error('page not found');
        const copies = p.copies.map((c) => (removeChosen.has(rowKey(p, c)) ? { ...c, action: 'remove' } : c));
        const r = cleanPageDoc(doc, copies);
        skipped += r.skipped;
        if (!r.removed && !r.reIded) continue;
        await savePage(p.book, p.pageId, r.doc);
        removed += r.removed;
        reIded += r.reIded;
        written.push({ book: p.book, pageId: p.pageId });
      } catch (err) {
        failed++;
        log(`Duplicate strokes: B${p.book}/P${p.pageId} failed: ${err.message}`, 'error');
      }
    }
    if (written.length) await refreshAfterSave(written);
    result = { removed, reIded, pages: written.length, skipped, failed };
    log(`Duplicate strokes: removed ${removed}, kept ${reIded} under a new id, on ${written.length} page${written.length === 1 ? '' : 's'}`
      + (skipped ? `, ${skipped} skipped (changed since the preview)` : '')
      + (failed ? `, ${failed} page${failed === 1 ? '' : 's'} failed` : ''), failed ? 'warning' : 'success');
    phase = 'done';
  }

  function close() {
    if (phase === 'planning' || phase === 'writing') return;
    open = false;
    phase = 'idle';
    plans = [];
    result = null;
    dispatch('close');
  }

  function handleKeyDown(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function clock(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' '
      + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  $: total = plans.reduce((n, p) => n + p.copies.length, 0);
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dup-strokes-title">
    <div class="dialog-header">
      <h2 id="dup-strokes-title">Clean up duplicate strokes</h2>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="dialog-body">
      {#if phase === 'planning'}
        <p class="note">Reading pages…</p>
      {:else if phase === 'done' && result}
        <p class="note">
          Removed {result.removed} and kept {result.reIded} under a new id, on {result.pages} page{result.pages === 1 ? '' : 's'}.
          {#if result.skipped}{result.skipped} skipped because the page changed since the preview.{/if}
          {#if result.failed}{result.failed} page{result.failed === 1 ? '' : 's'} failed; see the Activity Log.{/if}
        </p>
      {:else if total === 0}
        <p class="note">No page has two strokes with the same id.</p>
      {:else}
        <p class="note">
          {total} stroke{total === 1 ? '' : 's'} on {plans.length} page{plans.length === 1 ? '' : 's'} share an id with an
          earlier stroke. A delete or edit by id would hit both, and the Editor shows only the first. The first stroke
          keeps the id. An exact copy is removed. A different stroke is real ink: it is kept 1 ms later under its own id,
          unless you tick Remove.
        </p>
        <ul class="rows">
          {#each plans as p (p.book + '/' + p.pageId)}
            {#each p.copies as c (rowKey(p, c))}
              <li>
                <span class="where">B{p.book}/{p.pageId}</span>
                <span class="when" title={c.id}>{clock(c.startTime)}</span>
                {#if c.exact}
                  <span class="what">Exact copy ({c.pointCount} points)</span>
                  <span class="action">Remove</span>
                {:else}
                  <span class="what">Different stroke ({c.pointCount} points; the first has {c.keptPointCount})</span>
                  <label class="action">
                    <input type="checkbox" checked={removeChosen.has(rowKey(p, c))}
                      on:change={(e) => toggleRemove(rowKey(p, c), e.currentTarget.checked)} />
                    Remove
                  </label>
                {/if}
              </li>
            {/each}
          {/each}
        </ul>
      {/if}
    </div>

    <div class="dialog-footer">
      {#if phase === 'done' || phase === 'planning' || total === 0}
        <button class="btn btn-secondary" on:click={close} disabled={phase === 'planning'}>Close</button>
      {:else}
        <button class="btn btn-secondary" on:click={close} disabled={phase === 'writing'}>Cancel</button>
        <button class="btn btn-primary" on:click={clean} disabled={phase !== 'ready'}>
          {phase === 'writing' ? 'Cleaning…' : `Clean up ${total} stroke${total === 1 ? '' : 's'}`}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 1000; }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    width: min(760px, calc(100vw - 48px));
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
  }

  .dialog-header, .dialog-footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .dialog-header { justify-content: space-between; border-bottom: 1px solid var(--border); }
  .dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
  .dialog-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .close-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }

  .dialog-body { padding: 14px 20px; overflow-y: auto; }
  .note { margin: 0 0 10px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.45; }

  .rows {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    font-size: 0.82rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .rows li {
    display: grid;
    grid-template-columns: 82px 150px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: baseline;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
  }

  .rows li:first-child { border-top: none; }
  .where, .when { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .what { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .action { color: var(--text-primary); display: flex; align-items: center; gap: 4px; }

  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-secondary); }
  .btn-primary { background: var(--success); color: var(--bg-primary); }
  .btn-primary:hover:not(:disabled) { background: #16a34a; }
</style>
