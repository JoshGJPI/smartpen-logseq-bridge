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
              (default), Add as new line, Not text, Make sketch (v3.24.0: every row
              marked so becomes one sketch line, in the same write), or Add to #N,
              any stored line, listed in page order under "Add to line" (v3.28.0;
              none pulled to the top). The line takes the ink beside its own (a no-ink
              line becomes linked), its text kept; its reading then shows the
              leftover's words too, each fix offered with Use.
  A stored line merged by hand from several written rows takes several MyScript
  lines; its reading shows them joined, a ⏎ where the next one starts.

  v3.30.0: a + at the end of a leftover's reading adds it as a new line in one
  click; a new line's row then edits it (RelinkNewLine: text, indent, merge into
  the new line above), shown at the indent the save will give it (`newPlaces`).

  `decisions` is lib/relink.js defaultDecisions()' shape, replaced on each change
  (bind:decisions). The rows shown are reviewRows(model, decisions). Pure presentation; the dialog saves. Hovering a row (or
  focusing inside it) calls `onHover(row)`, and `onHover(null)` on leaving, so
  the dialog can light that row's ink (v3.27.0).
-->
<script>
  import RelinkNewLine from './RelinkNewLine.svelte';
  import { addedGroups, applyWordFixes, reviewRows, leftoverTarget, setLeftoverChoice, LEFTOVER_LEAVE, LEFTOVER_ADD, LEFTOVER_TEXTLESS, LEFTOVER_JOIN, LEFTOVER_SKETCH } from '$lib/relink.js';
  import { stripTaskMarker } from '$lib/task-markers.js';

  /** classifyRelink() result */
  export let model;
  export let decisions;
  export let disabled = false;
  /** What a stored line with no MyScript partner reads as */
  export let noinkLabel = 'no ink';
  /** (row | null) => void: the row under the pointer, for the dialog's ink preview */
  export let onHover = () => {};
  /** The row lit in the preview (its key), for the row's own highlight */
  export let hot = null;
  /** lib/relink-plan.js newLinePreview(): first MyScript index of a new line → { indentLevel, max } */
  export let newPlaces = new Map();

  const rowKey = (r) => r.lineId || `ms${r.ms}`;

  const pct = (s) => `${Math.round((s || 0) * 100)}%`;

  // Its own reading counts (matched, or confirm on Link), or it was given leftover ink.
  function linked(r) {
    return r.type === 'matched' || (r.type === 'confirm' && decisions.link[r.lineId] !== false) || !!r.added;
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

  /** The select's value: a choice, or `join:<lineId>` for "Add to #N". */
  function setLeftover(r, value) {
    const join = value.startsWith(`${LEFTOVER_JOIN}:`);
    decisions = setLeftoverChoice(model, decisions, r.ms, join ? LEFTOVER_JOIN : value, join ? value.slice(LEFTOVER_JOIN.length + 1) : null);
  }

  const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

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

  $: rows = reviewRows(model, decisions);
  // New lines (v3.30.0): the group each Add-as-new-line row belongs to.
  $: groupOf = new Map(addedGroups(model, decisions).flatMap((g) => g.ms.map((ms) => [ms, g])));
  $: fixesFor = (r) => decisions.fixes[r.lineId] || [];
  // Every stored text line, for "Add to" another line than the suggested one.
  $: lineChoices = model.rows.filter((r) => r.lineId).map((r) => ({ id: r.lineId, label: `#${r.n} ${clip(r.text || '', 44)}` }));
  $: leftoverValue = (r) => {
    const v = decisions.leftover[r.ms] || LEFTOVER_LEAVE;
    if (v !== LEFTOVER_JOIN) return v;
    const id = leftoverTarget(model, decisions, r);
    return id ? `${LEFTOVER_JOIN}:${id}` : LEFTOVER_LEAVE;
  };
</script>

<table class="rr">
  <thead>
    <tr><th class="n">#</th><th>Stored text (kept)</th><th>MyScript read</th><th class="m">Match</th></tr>
  </thead>
  <tbody>
    {#each rows as r (rowKey(r))}
      <tr class={r.type} class:off={r.type === 'confirm' && !linked(r)} class:hot={hot === rowKey(r)}
        on:mouseenter={() => onHover(r)} on:mouseleave={() => onHover(null)} on:focusin={() => onHover(r)}>
        <td class="n">{r.n ?? ''}</td>
        <td class="stored" style="padding-left: {8 + r.indentLevel * 14}px">
          {#if r.type === 'leftover' && groupOf.has(r.ms)}
            <RelinkNewLine {model} bind:decisions row={r} group={groupOf.get(r.ms)} place={newPlaces.get(groupOf.get(r.ms).head)} {disabled} />
          {:else if r.type === 'leftover'}
            <span class="none">ink left over</span>{#if r.addedTo}<span class="to"> → added to #{r.addedTo}</span>{/if}
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
          {#if r.type === 'leftover' && !r.addedTo && (decisions.leftover[r.ms] || LEFTOVER_LEAVE) !== LEFTOVER_ADD}
            <button class="plus" {disabled} on:click={() => setLeftover(r, LEFTOVER_ADD)}
              title="Add as a new line (then correct its text, indent or merge it in the Stored text column)">+</button>
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
          {:else if r.type === 'noink' && r.added}
            <span class="ok" title="Ink left over added to this line">✓ ink added</span>
          {:else if r.type === 'noink'}
            <span class="dim">{noinkLabel}</span>
          {:else}
            <select value={leftoverValue(r)} {disabled}
              on:change={(e) => setLeftover(r, e.currentTarget.value)} aria-label="Ink left over">
              <option value={LEFTOVER_LEAVE}>Leave unlinked</option>
              <option value={LEFTOVER_ADD}>Add as new line</option>
              <option value={LEFTOVER_TEXTLESS}>Not text</option>
              <option value={LEFTOVER_SKETCH} title="A drawing: every row marked so becomes one sketch line, labelled Sketch (rename it in the reader)">Make sketch</option>
              <optgroup label="Add to line">
                <!-- Every line in page order, the suggested one in its place (Josh, 2026-11-25: pulled to the top it confused). -->
                {#each lineChoices as c (c.id)}
                  <option value="{LEFTOVER_JOIN}:{c.id}">Add to {c.label}</option>
                {/each}
              </optgroup>
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
  tr.hot { background: var(--selected-bg); }
  .none, .dim { color: var(--text-secondary); font-style: italic; }
  .to { color: var(--success); font-size: 0.78rem; }
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
  .plus {
    float: right; margin-left: 6px; width: 20px; height: 20px; padding: 0; line-height: 18px; font-size: 0.95rem;
    border-radius: 5px; cursor: pointer; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-primary);
  }
  .plus:hover:not(:disabled) { border-color: var(--success); color: var(--success); }
  .plus:disabled { opacity: 0.5; cursor: default; }
  tr.leftover:has(.nl) { background: rgba(74, 222, 128, 0.05); }
  .use:disabled { opacity: 0.5; cursor: default; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .seg button { padding: 2px 8px; font-size: 0.75rem; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; }
  .seg button.on { background: var(--selected-bg); color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--selected-line); }
  select {
    max-width: 165px; font-size: 0.75rem; padding: 2px 4px; border-radius: 6px;
    background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border);
  }
</style>
