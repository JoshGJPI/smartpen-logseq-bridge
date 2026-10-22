<!--
  RetimeDialog.svelte — Editor → 🕒 Set time… (v3.6.0)

  Moves the earliest selected stroke to a chosen local date and time and shifts
  every other selected stroke by the same amount (lib/retime.js). Applying is an
  unsaved Editor change like any other; nothing touches disk until Save.

  Opening it reads the affected pages from disk, once, for their stroke ids: a
  shifted stroke that lands on an id already taken on its page would be dropped
  by the save's dedupe, so Apply is refused until the time is moved (+1 ms).
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { strokes, selectedIndices, log } from '$stores';
  import { retimeStrokes } from '$stores/strokes.js';
  import { getPage } from '$lib/storage/local-store.js';
  import { dayStart } from '$lib/timeline.js';
  import { planRetime, findRetimeCollisions, formatShift, RETIME_MIN_MS } from '$lib/retime.js';

  export let open = false;

  const dispatch = createEventDispatcher();

  let base = null;          // planRetime() at open, delta 0
  let newStart = null;      // proposed earliest start, ms
  let diskIds = null;       // Map<pageKey, Set<id>>, null while loading
  let dateValue = '';
  let timeValue = '';
  let opened = false;

  $: if (open && !opened) start();
  $: if (!open) opened = false;

  async function start() {
    opened = true;
    base = planRetime(get(strokes), get(selectedIndices));
    newStart = base.earliest;
    setInputs(newStart);
    diskIds = null;
    const map = new Map();
    for (const p of base.pages) {
      try {
        const doc = await getPage(p.book, p.page);
        map.set(p.key, new Set((doc?.strokes || []).map((s) => s.id)));
      } catch {
        map.set(p.key, new Set());   // no data folder / never saved: nothing to collide with
      }
    }
    if (opened) diskIds = map;
  }

  const pad = (n) => String(n).padStart(2, '0');

  function setInputs(ms) {
    if (!Number.isFinite(ms)) return;
    const d = new Date(ms);
    dateValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    timeValue = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /** Inputs → ms, keeping the original earliest stroke's milliseconds. */
  function readInputs() {
    const [y, m, dd] = (dateValue || '').split('-').map(Number);
    const [h, mi, s] = (timeValue || '').split(':').map(Number);
    if (!y || !m || !dd) return NaN;
    return new Date(y, m - 1, dd, h || 0, mi || 0, s || 0, ((base?.earliest ?? 0) % 1000 + 1000) % 1000).getTime();
  }

  function onInput() {
    newStart = readInputs();
  }

  function nudge(ms) {
    if (!Number.isFinite(newStart)) newStart = base.earliest;
    newStart += ms;
    setInputs(newStart);
  }

  function reset() {
    newStart = base.earliest;
    setInputs(newStart);
  }

  const fmt = (ms) => new Date(ms).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const fmtDay = (key) => {
    const d = dayStart(key);
    return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : key;
  };
  const fmtDays = (keys) => (keys.length ? keys.map(fmtDay).join(', ') : '—');

  $: valid = Number.isFinite(newStart) && newStart >= RETIME_MIN_MS;
  $: plan = base && valid ? planRetime($strokes, base.indices, newStart) : base;
  $: delta = plan && valid ? plan.delta : 0;
  $: span = base && base.earliest != null ? base.latest - base.earliest : 0;
  $: collisions = base && diskIds && delta ? findRetimeCollisions($strokes, base.indices, delta, diskIds) : [];
  $: future = valid && delta && newStart + span > Date.now();
  $: canApply = !!base && base.indices.length > 0 && valid && delta !== 0 && !!diskIds && collisions.length === 0;

  function apply() {
    if (!canApply) return;
    const r = retimeStrokes(base.indices, delta);
    if (r.retimed > 0) {
      log(`Retimed ${r.retimed} stroke${r.retimed === 1 ? '' : 's'} by ${formatShift(delta)}. Save to apply.`, 'success');
    }
    dispatch('applied', r);
    close();
  }

  function close() {
    open = false;
    base = null;
    diskIds = null;
    dispatch('close');
  }

  function handleKeyDown(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if open && base}
  <div class="dialog-backdrop" on:click={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="retime-title">
    <div class="dialog-header">
      <h2 id="retime-title">Set time for {base.indices.length} stroke{base.indices.length === 1 ? '' : 's'}</h2>
      <button class="close-btn" on:click={close} aria-label="Close">✕</button>
    </div>

    <div class="dialog-body">
      {#if base.indices.length === 0}
        <p class="note">None of the selected strokes can be retimed (pasted strokes have no real time until placed).</p>
      {:else}
        <p class="note">Moves the earliest stroke to the time you pick. The others keep their spacing.</p>
        <dl class="kv">
          <dt>Earliest stroke</dt><dd>{fmt(base.earliest)}</dd>
          <dt>Latest stroke</dt><dd>{fmt(base.latest)}</dd>
          <dt>Span</dt>
          <dd>{formatShift(span).slice(1)} · {base.pages.length} page{base.pages.length === 1 ? '' : 's'}
            {#if base.skipped}<span class="dim">· {base.skipped} pasted skipped</span>{/if}</dd>
        </dl>

        <div class="field">
          <label for="retime-date">New earliest time</label>
          <input id="retime-date" type="date" bind:value={dateValue} on:input={onInput} />
          <input type="time" step="1" bind:value={timeValue} on:input={onInput} aria-label="Time" />
        </div>
        <div class="nudges">
          <button class="btn-sm" on:click={() => nudge(-86400000)}>−1 day</button>
          <button class="btn-sm" on:click={() => nudge(86400000)}>+1 day</button>
          <button class="btn-sm" on:click={() => nudge(-3600000)}>−1 h</button>
          <button class="btn-sm" on:click={() => nudge(3600000)}>+1 h</button>
          <button class="btn-sm" on:click={() => nudge(-60000)}>−1 min</button>
          <button class="btn-sm" on:click={() => nudge(60000)}>+1 min</button>
          <button class="btn-sm" on:click={reset} disabled={delta === 0}>Reset</button>
        </div>

        <div class="delta">
          {#if !valid}
            Pick a date after 2000.
          {:else if delta === 0}
            No change.
          {:else}
            Shift <b>{formatShift(delta)}</b><br />
            New range: {fmt(newStart)} → {fmt(newStart + span)}
          {/if}
        </div>

        <table class="pages">
          <thead><tr><th>Page</th><th>Strokes</th><th>Capture days now</th><th></th><th>After</th></tr></thead>
          <tbody>
            {#each plan.pages as p (p.key)}
              <tr>
                <td>{p.key.replace('/', ' / ')}</td>
                <td>{p.selected} of {p.total}</td>
                <td>{fmtDays(p.daysBefore)}</td>
                <td class="arrow">→</td>
                <td class:changed={delta !== 0}>{fmtDays(p.daysAfter)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="dim small">Days cover every loaded stroke on the page, selected or not.</p>

        {#if !diskIds}
          <p class="dim small">Checking the saved pages…</p>
        {:else if collisions.length}
          <div class="err">
            {collisions.length} stroke{collisions.length === 1 ? '' : 's'} would land on the same millisecond as another
            stroke on {collisions[0].page} and be lost on save.
            <button class="btn-sm" on:click={() => nudge(1)}>+1 ms</button>
          </div>
        {:else if future}
          <div class="warn">This puts strokes in the future. Allowed, but check the date.</div>
        {/if}
      {/if}
    </div>

    <div class="dialog-footer">
      <span class="footer-note">Unsaved until you Save the page</span>
      <button class="btn btn-secondary" on:click={close}>Cancel</button>
      <button class="btn btn-primary" on:click={apply} disabled={!canApply}>Apply</button>
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
    width: min(600px, calc(100vw - 48px));
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
  }

  .dialog-header, .dialog-footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .dialog-header { justify-content: space-between; border-bottom: 1px solid var(--border); }
  .dialog-footer { justify-content: flex-end; border-top: 1px solid var(--border); }
  .dialog-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .close-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .dialog-body { padding: 14px 20px; overflow-y: auto; color: var(--text-primary); font-size: 0.85rem; }
  .note { margin: 0 0 10px; color: var(--text-secondary); line-height: 1.45; }
  .footer-note { margin-right: auto; color: var(--text-secondary); font-size: 0.78rem; }
  .dim { color: var(--text-secondary); }
  .small { font-size: 0.75rem; margin: 4px 0 0; }

  .kv { display: grid; grid-template-columns: 120px 1fr; gap: 3px 12px; margin: 0 0 12px; }
  .kv dt { color: var(--text-secondary); }
  .kv dd { margin: 0; font-variant-numeric: tabular-nums; }

  .field { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .field label { font-weight: 600; min-width: 112px; }
  .field input {
    font: inherit;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    color-scheme: dark;
  }
  .nudges { display: flex; gap: 4px; flex-wrap: wrap; margin: 6px 0 0 120px; }

  .btn-sm {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .btn-sm:disabled { opacity: 0.45; cursor: default; }

  .delta {
    margin: 12px 0 10px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(45, 212, 191, 0.1);
    color: #5eead4;
    font-variant-numeric: tabular-nums;
  }

  .pages { width: 100%; border-collapse: collapse; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .pages th { text-align: left; font-weight: 600; font-size: 0.7rem; color: var(--text-secondary); padding: 4px 6px; border-bottom: 1px solid var(--border); }
  .pages td { padding: 4px 6px; border-bottom: 1px solid var(--border); }
  .pages .arrow { color: var(--text-secondary); }
  .pages .changed { color: #5eead4; font-weight: 600; }

  .warn, .err { margin-top: 10px; padding: 8px 11px; border-radius: 7px; font-size: 0.8rem; }
  .warn { background: rgba(251, 191, 36, 0.12); color: var(--warning); }
  .err { background: rgba(239, 68, 68, 0.12); color: var(--error); }

  .btn { padding: 8px 16px; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-tertiary); color: var(--text-primary); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-secondary); }
  .btn-primary { background: var(--success); color: var(--bg-primary); }
  .btn-primary:hover:not(:disabled) { background: #16a34a; }
</style>
