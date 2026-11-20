<!--
  RelinkRows.svelte — the Relink dialog's table (v3.21.0, spec B.4): stored text
  on the left (kept), MyScript's reading beside it in grey, a match column.

    matched   ✓ and the similarity; MyScript's differing words in amber, each
              with Use (decision 2: nothing changes unless clicked)
    confirm   Link / Don't link (word fixes as for matched, while linked); "moved" when the
              reading is elsewhere on the page (stored out of place; linking keeps its place)
    no ink    the stored line is kept, with no ink ("not in this selection" on a
              selection pass over a page already linked: it keeps its ink)
    leftover  ink MyScript read that no stored line matches: Leave unlinked
              (default), Add to #N (the linked line above takes its ink, text
              unchanged), Add as new line, Not text, Make sketch (v3.24.0: every row
              marked so becomes one sketch line, in the same write).
  A stored line merged by hand from several written rows takes several MyScript
  lines; its reading shows them joined, a ⏎ where the next one starts.

  `decisions` is lib/relink.js defaultDecisions()' shape and is changed in place
  (bind:decisions). Pure presentation; the dialog saves.
-->
<script>
  import { applyWordFixes, rowLinked, LEFTOVER_LEAVE, LEFTOVER_ADD, LEFTOVER_TEXTLESS, LEFTOVER_JOIN, LEFTOVER_SKETCH } from '$lib/relink.js';
  import { stripTaskMarker } from '$lib/task-markers.js';

  /** classifyRelink() result */
  export let model;
  export let decisions;
  export let disabled = false;
  /** What a stored line with no MyScript partner reads as */
  export let noinkLabel = 'no ink';

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
        return { w, k, taken: k !== null && fixesTaken.includes(k), br: r.breaks.includes(i) };
      })
    };
  }

  $: fixesFor = (r) => decisions.fixes[r.lineId] || [];
  // "Add to #N" only while that line is linked; a choice made before Don't link reads as Leave unlinked.
  $: canJoin = (r) => !!r.joinTo && rowLinked(model, decisions, r.joinTo);
  $: leftoverValue = (r) => {
    const v = decisions.leftover[r.ms] || LEFTOVER_LEAVE;
    return v === LEFTOVER_JOIN && !canJoin(r) ? LEFTOVER_LEAVE : v;
  };
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
              {#if p.br}<span class="br" title="The next line MyScript read: this stored line covers both">⏎</span>{' '}{/if}
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
            {#if r.moved}<span class="moved" title="Written elsewhere on the page than where it is stored; linking keeps its place in the transcript">moved</span>{/if}
            <span class="seg" role="group" aria-label="Link this line">
              <button class:on={linked(r)} {disabled} on:click={() => setLink(r, true)} title="Similarity {pct(r.sim)}">Link</button>
              <button class:on={!linked(r)} {disabled} on:click={() => setLink(r, false)}>Don't link</button>
            </span>
          {:else if r.type === 'noink'}
            <span class="dim">{noinkLabel}</span>
          {:else}
            <select value={leftoverValue(r)} {disabled}
              on:change={(e) => setLeftover(r, e.currentTarget.value)} aria-label="Ink left over">
              <option value={LEFTOVER_LEAVE}>Leave unlinked</option>
              {#if canJoin(r)}<option value={LEFTOVER_JOIN}>Add to #{r.joinToN}</option>{/if}
              <option value={LEFTOVER_ADD}>Add as new line</option>
              <option value={LEFTOVER_TEXTLESS}>Not text</option>
              <option value={LEFTOVER_SKETCH} title="A drawing: every row marked so becomes one sketch line, labelled Sketch (rename it in the reader)">Make sketch</option>
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
  .moved { font-size: 0.68rem; margin-right: 4px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-secondary); }
  .task {
    font-size: 0.68rem; font-weight: 600; padding: 0 4px; margin-right: 6px; border-radius: 4px;
    background: var(--bg-secondary); color: var(--warning);
  }
  .task.closed { color: var(--success); }
  .box { opacity: 0.7; }
  .br { color: var(--text-secondary); opacity: 0.8; }
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
