<!--
  RelinkOldDialog.svelte — Settings → Maintenance → Relink old transcripts…
  (v3.21.0, spec B.5). Preview first, like Convert task boxes.

  Opening it only reads: every transcribed page is read and the ones whose
  links fail `isTrustworthyTranscript()` are listed per notebook with line and
  task counts (lib/relink.js relinkCandidates). Nothing is sent or written
  until Run. Run goes page by page, newest first (stores/relink.js
  runBulkRelink): one MyScript request per page whose run isn't cached, pages
  that need no review saved at once, the rest queued for the per-page Relink
  dialog (Review). Stop finishes the page in hand. Runs are cached in
  <userData>/relink-cache/, so stopping or closing the app costs nothing twice.
-->
<script>
  import { get } from 'svelte/store';
  import { savedPages, log } from '$stores';
  import { bookAliases } from '$stores/book-aliases.js';
  import { hasMyScriptCredentials } from '$stores/settings.js';
  import { relinkQueue, runBulkRelink, openRelink, relinkTarget } from '$stores/relink.js';
  import { getPage } from '$lib/storage/local-store.js';
  import { relinkCandidates, groupCandidates } from '$lib/relink.js';
  import { compareBookKeys } from '$lib/volumes.js';

  export let open = false;

  /** 'idle' | 'planning' | 'ready' | 'running' | 'done' */
  let phase = 'idle';
  let candidates = [];
  let groups = [];
  let progress = null;
  let result = null;
  let stop = false;

  $: if (open && phase === 'idle') plan();

  async function plan() {
    phase = 'planning';
    const docs = [];
    for (const r of get(savedPages).filter((p) => p.transcriptLineCount > 0 || p.transcriptionText)) {
      try {
        docs.push({ book: String(r.book), pageId: String(r.pageId ?? r.page), doc: await getPage(r.book, r.pageId ?? r.page) });
      } catch (e) {
        log(`Relink: could not read B${r.book}/P${r.pageId}: ${e.message}`, 'error');
      }
    }
    candidates = relinkCandidates(docs);
    groups = groupCandidates(candidates, compareBookKeys);
    phase = 'ready';
  }

  async function run() {
    phase = 'running';
    stop = false;
    result = await runBulkRelink(candidates, { onProgress: (p) => (progress = p), stopped: () => stop });
    log(`Relink: ${result.saved} saved, ${result.queued} to review, ${result.skipped.length} skipped`
      + (result.failed ? `, ${result.failed} failed` : '') + ` (${result.requests} MyScript request${result.requests === 1 ? '' : 's'})`,
    result.failed ? 'warning' : 'success');
    phase = 'done';
  }

  function close() {
    if (phase === 'planning' || phase === 'running') return;
    open = false;
    phase = 'idle';
    candidates = groups = [];
    progress = result = null;
  }

  function onKey(e) {
    if (!open || e.key !== 'Escape' || e.defaultPrevented || get(relinkTarget)) return;
    e.preventDefault();
    close();
  }

  const name = (book) => ($bookAliases && $bookAliases[book]) || `B${book}`;
  $: total = groups.reduce((a, g) => ({ pages: a.pages + g.pages, lines: a.lines + g.lines, tasks: a.tasks + g.tasks }), { pages: 0, lines: 0, tasks: 0 });
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="backdrop" on:click={close} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="relink-old-title">
    <div class="head">
      <h2 id="relink-old-title">Relink old transcripts</h2>
      <button class="x" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="body">
      {#if phase === 'planning'}
        <p class="note">Reading transcripts…</p>
      {:else if phase === 'ready' && !candidates.length && !$relinkQueue.length}
        <p class="note">Every saved transcript is already linked to its ink.</p>
      {:else if phase === 'ready' || phase === 'running' || phase === 'done'}
        {#if candidates.length && !result}
          <p class="note">
            {total.pages} page{total.pages === 1 ? '' : 's'} were transcribed before lines were matched to ink reliably
            ({total.lines} lines, {total.tasks} tasks). Run sends them to MyScript one by one, newest first (about
            {total.pages} request{total.pages === 1 ? '' : 's'}; results already cached cost none), and links each stored line
            to its ink. Text and task states are kept. A page where every line matched and no ink is left over is saved at
            once; the rest wait below for you to review.
          </p>
          <ul class="rows">
            {#each groups as g (g.book)}
              <li><span class="nb">{name(g.book)}</span><span>{g.pages} page{g.pages === 1 ? '' : 's'}</span>
                <span>{g.lines} lines</span><span>{g.tasks} task{g.tasks === 1 ? '' : 's'}</span></li>
            {/each}
          </ul>
        {/if}
        {#if phase === 'running' && progress}
          <p class="note">Page {Math.min(progress.index + 1, progress.total)} of {progress.total} {progress.label}: {progress.saved} saved,
            {progress.queued} to review, {progress.requests} request{progress.requests === 1 ? '' : 's'} so far.</p>
        {/if}
        {#if result}
          <p class="note">{result.saved} saved, {result.queued} queued for review, {result.skipped.length} skipped{result.failed ? `, ${result.failed} failed (see the Activity Log)` : ''}.
            {result.requests} MyScript request{result.requests === 1 ? '' : 's'}.</p>
          {#if result.skipped.length}
            <ul class="rows skipped">{#each result.skipped as s}<li><span class="nb">{s.label}</span><span class="why">{s.why}</span></li>{/each}</ul>
          {/if}
        {/if}
        {#if $relinkQueue.length}
          <p class="note">To review, newest first:</p>
          <ul class="rows">
            {#each $relinkQueue as q (q.book + '/' + q.pageId)}
              <li>
                <span class="nb">{name(q.book)} P{q.pageId}</span>
                <span>{q.counts.matched} matched</span>
                <span class:attn={q.counts.confirm}>{q.counts.confirm} to confirm</span>
                <span class:attn={q.counts.noink || q.counts.leftover}>{q.counts.noink} no ink · {q.counts.leftover} left over</span>
                <button class="btn sec small" on:click={() => openRelink(q.book, q.pageId)} disabled={phase === 'running'}>Review</button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <div class="foot">
      {#if phase === 'ready' && candidates.length && !$hasMyScriptCredentials}
        <span class="fnote">Add your MyScript keys first (Settings → Handwriting recognition).</span>
      {/if}
      {#if phase === 'running'}
        <button class="btn sec" on:click={() => (stop = true)} disabled={stop}>{stop ? 'Stopping…' : 'Stop'}</button>
      {:else}
        <button class="btn sec" on:click={close} disabled={phase === 'planning'}>Close</button>
        {#if phase === 'ready' && candidates.length}
          <button class="btn pri" on:click={run} disabled={!$hasMyScriptCredentials}>Run on {total.pages} page{total.pages === 1 ? '' : 's'}</button>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 1000; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1001;
    width: min(760px, calc(100vw - 48px)); max-height: 80vh; display: flex; flex-direction: column;
    background: var(--bg-primary); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .head, .foot { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .head { justify-content: space-between; border-bottom: 1px solid var(--border); }
  .head h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .foot { justify-content: flex-end; border-top: 1px solid var(--border); }
  .x { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .body { padding: 14px 20px; overflow-y: auto; }
  .note { margin: 0 0 10px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.45; }
  .fnote { margin-right: auto; color: var(--warning); font-size: 0.8rem; }
  .rows { list-style: none; margin: 0 0 14px; padding: 0; font-size: 0.82rem; border: 1px solid var(--border); border-radius: 8px; }
  .rows li { display: flex; gap: 14px; align-items: center; padding: 5px 10px; border-top: 1px solid var(--border); color: var(--text-secondary); }
  .rows li:first-child { border-top: none; }
  .nb { color: var(--text-primary); min-width: 140px; }
  .why { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attn { color: var(--warning); }
  .rows li .btn { margin-left: auto; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn.small { padding: 3px 10px; font-size: 0.78rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sec { background: var(--bg-tertiary); color: var(--text-primary); }
  .pri { background: var(--accent); color: #fff; }
  .pri:hover:not(:disabled) { background: var(--accent-hover); }
</style>
