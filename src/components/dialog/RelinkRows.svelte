<!--
  RelinkRows.svelte — the Relink dialog's table (v3.21.0, spec B.4): stored text
  on the left (kept), MyScript's reading beside it in grey, a match column.

    matched   ✓ and the similarity; MyScript's differing words in amber, each
              with Use (decision 2: nothing changes unless clicked)
    confirm   Link / Don't link (word fixes as for matched, while linked)
    no ink    the stored line is kept, with no ink
    leftover  ink MyScript read that no stored line matches: Leave unlinked
              (default), Add as new line, Not text. Make sketch joins in Phase E.

  `decisions` is lib/relink.js defaultDecisions()' shape and is changed in place
  (bind:decisions). Pure presentation; the dialog saves.
-->
<script>
  import { applyWordFixes, LEFTOVER_LEAVE, LEFTOVER_ADD, LEFTOVER_TEXTLESS } from '$lib/relink.js';
  import { stripTaskMarker } from '$lib/task-markers.js';

  /** classifyRelink() result */
  export let model;
  export let decisions;
  export let disabled = false;

  const pct = (s) => `${Math.round((s || 0) * 100)}%`;

  function linked(r) {
    return r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false);
  }

  function setLink(r, on) {
    decisions.link[r.lineId] = on;
    decisions = decisions;
  }

  function toggleFix(r, k) {
    const taken = new Set(decisions.fixes[r.lineId] || []);
    if (taken.has(k)) taken.delete(k);
    else taken.add(k);
    decisions.fixes[r.lineId] = [...taken].sort((a, b) => a - b);
    decisions = decisions;
  }

  function setLeftover(r, value) {
    decisions.leftover[r.ms] = value;
    decisions = decisions;
  }

  /**
   * MyScript's reading: a task box it read in front (grey, not one of the line's
   * words), then its words, each marked when it is a fix (wordFixes indexes the
   * words after the box) and whether taken.
   */
  function readingParts(r, fixesTaken) {
    const raw = r.reading.trim();
    const body = stripTaskMarker(raw);
    const at = body ? raw.lastIndexOf(body) : raw.length;
    const byMs = new Map(r.fixes.map((f, k) => [f.msAt, k]));
    return {
      box: raw.slice(0, Math.max(0, at)).trim(),
      words: body.split(/\s+/).filter(Boolean).map((w, i) => {
        const k = byMs.has(i) ? byMs.get(i) : null;
        return { w, k, taken: k !== null && fixesTaken.includes(k) };
      })
    };
  }

  $: fixesFor = (r) => decisions.fixes[r.lineId] || [];
</script>

<table class="rr">
  <thead>
    <tr><th class="n">#</th><th>Stored text (kept)</th><th>MyScript read</th><th class="m">Match</th></tr>
  </thead>
  <tbody>
    {#each model.rows as r (r.lineId || `ms${r.ms}`)}
      <tr class={r.type} class:off={r.type === 'confirm' && !linked(r)}>
        <td class="n">{r.n ?? ''}</td>
        <td class="stored" style="padding-left: {8 + r.indentLevel * 14}px">
          {#if r.type === 'leftover'}
            <span class="none">ink left over</span>
          {:else}
            {#if r.task}<span class="task" class:closed={r.task === 'DONE' || r.task === 'CANCELLED'}>{r.task}</span>{/if}
            {linked(r) && fixesFor(r).length ? applyWordFixes(r.text, fixesFor(r).map((k) => r.fixes[k])) : r.text}
          {/if}
        </td>
        <td class="reading">
          {#if r.reading}
            {@const parts = readingParts(r, fixesFor(r))}
            {#if parts.box}<span class="box">{parts.box}</span>{' '}{/if}
            {#each parts.words as p}
              {#if p.k !== null && linked(r)}
                <span class="fix" class:taken={p.taken}>{p.w}</span><button class="use" {disabled}
                  title={p.taken ? 'Keep the stored word' : `Use “${r.fixes[p.k].to}” instead of “${r.fixes[p.k].from}”`}
                  on:click={() => toggleFix(r, p.k)}>{p.taken ? 'Undo' : 'Use'}</button>{' '}
              {:else}
                {p.w}{' '}
              {/if}
            {/each}
          {:else}
            <span class="none">—</span>
          {/if}
        </td>
        <td class="m">
          {#if r.type === 'matched'}
            <span class="ok" title="Similarity {pct(r.sim)}">✓ {pct(r.sim)}</span>
          {:else if r.type === 'confirm'}
            <span class="seg" role="group" aria-label="Link this line">
              <button class:on={linked(r)} {disabled} on:click={() => setLink(r, true)} title="Similarity {pct(r.sim)}">Link</button>
              <button class:on={!linked(r)} {disabled} on:click={() => setLink(r, false)}>Don't link</button>
            </span>
          {:else if r.type === 'noink'}
            <span class="dim">no ink</span>
          {:else}
            <select value={decisions.leftover[r.ms] || LEFTOVER_LEAVE} {disabled}
              on:change={(e) => setLeftover(r, e.currentTarget.value)} aria-label="Ink left over">
              <option value={LEFTOVER_LEAVE}>Leave unlinked</option>
              <option value={LEFTOVER_ADD}>Add as new line</option>
              <option value={LEFTOVER_TEXTLESS}>Not text</option>
            </select>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .rr { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; font-weight: 500; color: var(--text-secondary); padding: 4px 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg-primary); }
  td { padding: 5px 8px; border-top: 1px solid var(--border); vertical-align: baseline; }
  .n { width: 28px; color: var(--text-secondary); font-variant-numeric: tabular-nums; text-align: right; }
  .m { width: 170px; white-space: nowrap; }
  .stored { color: var(--text-primary); }
  .reading { color: var(--text-secondary); }
  tr.noink .stored, tr.off .stored { color: var(--text-secondary); }
  tr.leftover { background: rgba(251, 191, 36, 0.04); }
  .none, .dim { color: var(--text-secondary); font-style: italic; }
  .ok { color: var(--success); }
  .task {
    font-size: 0.68rem; font-weight: 600; padding: 0 4px; margin-right: 6px; border-radius: 4px;
    background: var(--bg-secondary); color: var(--warning);
  }
  .task.closed { color: var(--success); }
  .box { opacity: 0.7; }
  .fix { color: var(--warning); font-weight: 600; }
  .fix.taken { text-decoration: underline; }
  .use {
    margin-left: 3px; padding: 0 5px; font-size: 0.7rem; line-height: 1.4; border-radius: 4px; cursor: pointer;
    border: 1px solid var(--warning); background: transparent; color: var(--warning);
  }
  .use:disabled { opacity: 0.5; cursor: default; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg button { padding: 2px 8px; font-size: 0.75rem; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
  .seg button.on { background: var(--selected-bg); color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--selected-line); }
  select {
    font-size: 0.75rem; padding: 2px 4px; border-radius: 6px;
    background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border);
  }
</style>
