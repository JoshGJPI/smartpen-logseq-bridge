<!--
  RelinkDialog.svelte — Relink one page (v3.21.0, spec B.4). Mounted once in
  App; opens on `relinkTarget` (stores/relink.js: the reader's Relink…, or a
  page the bulk run queued for review).

  Opened with `again` (the page's ⋯ → Relink again… on a page already linked) it
  asks first; every other guard still applies. Opened with `ids` (the Editor's
  selection ⋯ → Relink selection…) it sends only those strokes, never from the
  cache; on a page already linked, lines this pass doesn't link read "not in this
  selection" (they keep their ink).
  Decorative ink the run held back (underlines, boxes, circles) is listed with
  "Mark them Not text", ticked by default; either way it is saved unlinked. Opening it reads the page and the
  cached MyScript run. Without one it asks
  before sending (one request of the free tier's 2,000 a month). The review
  shows the counts and RelinkRows; Save writes yBounds, stroke links, the word
  fixes taken and any leftover ink's choice in one save
  (stores/relink.js saveRelink → savePageToFolder({ relink })). Text, order,
  indent and task state are never changed. While open it holds the page like a
  transcript editor (`transcriptEditorHold()`), so Claude's edits and other
  writers stand down, and a page written since its run is sent again.
-->
<script>
  import { onDestroy } from 'svelte';
  import { relinkTarget, closeRelink, getRelinkRun, trySaveRelink } from '$stores/relink.js';
  import { transcriptEditorHold } from '$stores/viewer.js';
  import { classifyRelink, defaultDecisions, buildRelinkSpec, linkedCount, NO_LINKS, afterRelinkSave, heldBackLabel } from '$lib/relink.js';
  import { isTrustworthyTranscript } from '$lib/viewer/ink-text.js';
  import RelinkRows from './RelinkRows.svelte';

  /** 'again' | 'loading' | 'ask' | 'sending' | 'review' | 'saving' | 'done' | 'error' */
  let phase = 'loading';
  let error = '';
  let target = null;
  let run = null;
  let model = null;
  let decisions = null;
  let cached = false;
  let opened = null;
  let staleNote = '';
  /** The page was already linked (a selection pass then keeps the ink it doesn't send). */
  let trusted = false;

  // Opening the dialog must not count as an editor on the page for its own guards,
  // so the hold is taken only once the run is loaded (relinkRefusal ran by then).
  const hold = transcriptEditorHold();
  onDestroy(() => hold.release());

  $: target = $relinkTarget;
  $: key = target ? `${target.book}:${target.pageId}` : null;
  $: if (key !== opened) start(key);

  async function start(k) {
    opened = k;
    hold.set(null, false);
    run = model = decisions = null;
    trusted = false;
    error = staleNote = '';
    if (!k) return;
    // A page already linked: ask first (the reader's "Relink again…").
    if (target.again) { phase = 'again'; return; }
    phase = 'loading';
    await load(false);
  }

  async function load(send) {
    const { book, pageId } = target;
    const k = opened;
    phase = send ? 'sending' : 'loading';
    let got;
    try {
      got = await getRelinkRun(book, pageId, { send, again: !!target.again, ids: target.ids || null });
    } catch (e) {
      got = { ok: false, error: `MyScript failed: ${e.message}` };
    }
    if (k !== opened) return;
    if (!got.ok) {
      phase = got.needsSend ? 'ask' : 'error';
      error = got.needsSend ? '' : got.error;
      return;
    }
    run = got.run;
    cached = got.cached;
    trusted = isTrustworthyTranscript(got.doc);
    model = classifyRelink(got.doc.transcript.lines, run.lines);
    decisions = defaultDecisions(model);
    hold.set(k, true);
    phase = 'review';
  }

  async function save() {
    const { book, pageId } = target;
    phase = 'saving';
    // Our own hold would refuse the save; nothing else can take the page while we're saving.
    hold.set(null, false);
    let next = afterRelinkSave(null);
    try {
      next = afterRelinkSave(await trySaveRelink(book, pageId, buildRelinkSpec(run, model, decisions), { again: !!target.again, ids: target.ids || null }));
    } finally {
      // Never left on 'saving' (close() refuses while saving): done, ask again, or back to review.
      phase = next.phase;
      error = next.error;
      staleNote = next.staleNote;
    }
    if (next.close) { close(); return; }
    if (next.phase === 'review') hold.set(opened, true);
  }

  function close() {
    if (phase === 'sending' || phase === 'saving') return;
    hold.set(null, false);
    closeRelink();
  }

  function onKey(e) {
    if (target && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  $: c = model ? model.counts : null;
  $: changes = decisions && model ? summarize(model, decisions) : '';
  // Save links nothing to ink → refused (it would mark the page linked with all ink unlinked).
  $: nLinked = decisions && model ? linkedCount(model, decisions) : 0;
  $: selection = !!(target && target.ids);
  // On a page already linked, a selection pass leaves the other lines (and their ink) as they are.
  $: noinkLabel = selection && trusted ? 'not in this selection' : 'no ink';
  $: held = run && run.heldBack ? run.heldBack.length : 0;

  function summarize(m, d) {
    const fixes = Object.values(d.fixes).reduce((n, list) => n + list.length, 0);
    const add = Object.values(d.leftover).filter((v) => v === 'add').length;
    const tl = Object.values(d.leftover).filter((v) => v === 'textless').length;
    return [fixes && `${fixes} word fix${fixes === 1 ? '' : 'es'}`, add && `${add} new line${add === 1 ? '' : 's'}`,
      tl && `${tl} left out as Not text`].filter(Boolean).join(', ');
  }
</script>

<svelte:window on:keydown={onKey} />

{#if target}
  <div class="backdrop" on:click={close} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="relink-title">
    <div class="head">
      <h2 id="relink-title">Relink {selection ? 'selection on ' : ''}B{target.book}/P{target.pageId}</h2>
      <button class="x" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="body">
      {#if phase === 'again'}
        <p class="note">This page's ink is already linked. Relink it again? Lines and task state are kept.</p>
      {:else if phase === 'loading'}
        <p class="note">Reading the page…</p>
      {:else if phase === 'ask' || phase === 'sending'}
        {#if staleNote}<p class="note warn">{staleNote}</p>{/if}
        {#if selection}
          <p class="note">
            Relink sends the {target.ids.length} selected stroke{target.ids.length === 1 ? '' : 's'} to MyScript and uses the
            reading only to find which stored line each belongs to. The stored text, order, indents and task states are
            kept; you review the result before anything is saved. Only the selected ink gets new links{trusted
              ? '; the rest of the page keeps its links' : '; the rest of this page\'s ink is unlinked, since its old links are wrong'}.
          </p>
        {:else}
        <p class="note">
          This page's transcript was saved before lines were matched to ink reliably, so its lines can't light their ink.
          Relink sends the page's ink to MyScript once and uses the reading only to find which ink belongs to each
          stored line. The stored text, order, indents and task states are kept; you review the result before anything
          is saved. Underlines, boxes and circles are held back, so they don't garble the reading.
        </p>
        {/if}
        <p class="note">It uses one MyScript request (the free tier allows 2,000 a month).</p>
      {:else if phase === 'error'}
        <p class="note warn">{error}</p>
      {:else if model}
        <p class="counts">
          <span class="ok">{c.matched} matched</span> ·
          <span class:attn={c.confirm}>{c.confirm} to confirm{c.moved ? ` (${c.moved} moved)` : ''}</span> ·
          <span>{c.noink} {noinkLabel} (kept)</span> ·
          <span class:attn={c.leftover}>{c.leftover} ink left over</span> ·
          <span>{c.tasks} task{c.tasks === 1 ? '' : 's'} unchanged</span>
          {#if cached}<span class="dim"> · MyScript result from the cache</span>{/if}
        </p>
        {#if held}
          <label class="held">
            <span>{heldBackLabel(run.heldBackStats, held)} not sent.</span>
            <input type="checkbox" bind:checked={decisions.heldBackTextless} disabled={phase === 'saving'} />
            Mark them Not text
            <span class="dim">(otherwise left unlinked)</span>
          </label>
        {/if}
        {#if error}<p class="note warn">{error}</p>{/if}
        <div class="table"><RelinkRows {model} {noinkLabel} bind:decisions disabled={phase === 'saving'} /></div>
      {/if}
    </div>

    <div class="foot">
      {#if phase === 'review' || phase === 'saving'}
        <span class="sum" class:warn={!nLinked}>{!nLinked ? NO_LINKS + '.' : changes ? `Also: ${changes}.` : 'Only links change.'}</span>
        <button class="btn sec" on:click={close} disabled={phase === 'saving'}>Cancel</button>
        <button class="btn pri" on:click={save} disabled={phase === 'saving' || !nLinked}>{phase === 'saving' ? 'Saving…' : 'Save links'}</button>
      {:else if phase === 'again'}
        <button class="btn sec" on:click={close}>Cancel</button>
        <button class="btn pri" on:click={() => load(false)}>Relink again</button>
      {:else if phase === 'ask' || phase === 'sending'}
        <button class="btn sec" on:click={close} disabled={phase === 'sending'}>Cancel</button>
        <button class="btn pri" on:click={() => load(true)} disabled={phase === 'sending'}>{phase === 'sending' ? 'Sending…' : 'Send to MyScript'}</button>
      {:else}
        <button class="btn sec" on:click={close}>Close</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 1000; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1001;
    width: min(1040px, calc(100vw - 48px)); max-height: 86vh; display: flex; flex-direction: column;
    background: var(--bg-primary); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .head, .foot { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .head { justify-content: space-between; border-bottom: 1px solid var(--border); }
  .head h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .foot { justify-content: flex-end; border-top: 1px solid var(--border); }
  .x { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .body { padding: 14px 20px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .table { overflow-y: auto; min-height: 0; border: 1px solid var(--border); border-radius: 8px; }
  .note { margin: 0 0 10px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.45; }
  .warn { color: var(--warning); }
  .counts { margin: 0 0 10px; font-size: 0.85rem; color: var(--text-secondary); }
  .counts .ok { color: var(--success); }
  .counts .attn { color: var(--warning); }
  .dim { opacity: 0.7; }
  .held { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 0.82rem; color: var(--text-secondary); }
  .held span:first-child { color: var(--text-primary); margin-right: 6px; }
  .sum { margin-right: auto; color: var(--text-secondary); font-size: 0.8rem; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sec { background: var(--bg-tertiary); color: var(--text-primary); }
  .pri { background: var(--accent); color: #fff; }
  .pri:hover:not(:disabled) { background: var(--accent-hover); }
</style>
