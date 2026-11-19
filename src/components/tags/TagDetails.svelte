<!--
  TagDetails.svelte — Manage tags → a tag's Details (v3.22.0, spec Phase C.3):
  its type, display name, aliases, company or client, and a note.

  A project number's type is fixed (Job or Proposal, by its pattern) and it has
  a name, client, Active and, for a proposal, the job it became. A keyword
  switches between Person and Topic; a person has a company. Display names and
  aliases keep their capitals (Phase D matches people case-sensitively); the
  tag itself stays lowercase.

  Save writes the one record at once through stores/tags.js setTagInfo (the
  `info` section of pages/_tags.json, same lock as page tags; rolled back with
  an Activity Log entry if the write fails). The form is rebuilt from the store
  whenever the tag or its stored record changes. lib/tag-details.js maps the
  form to the record.
-->
<script>
  import { tagInfo, setTagInfo } from '$stores/tags.js';
  import { dataFolderReady } from '$stores/settings.js';
  import { detailsDraft, detailsRecord, detailsChanged } from '$lib/tag-details.js';
  import { infoOf } from '$lib/tags.js';
  import TagChip from './TagChip.svelte';

  export let tag;
  export let onClose = () => {};

  let draft = detailsDraft(tag, $tagInfo);
  let saving = false;
  let shownFor = null;

  // Rebuild the form when another tag is chosen or its stored record changes.
  $: stored = JSON.stringify(infoOf($tagInfo, tag));
  $: if (`${tag}|${stored}` !== shownFor) {
    shownFor = `${tag}|${stored}`;
    draft = detailsDraft(tag, $tagInfo);
  }
  $: project = draft.type === 'project';
  $: changed = detailsChanged(tag, $tagInfo, draft);
  $: disabled = !$dataFolderReady || saving;

  async function save() {
    if (!changed) return;
    saving = true;
    try {
      await setTagInfo(tag, detailsRecord(tag, draft));
    } finally {
      saving = false;
    }
  }

  function revert() {
    draft = detailsDraft(tag, $tagInfo);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<section class="td" aria-label="Details of {tag}" on:keydown={onKey}>
  <header>
    <TagChip {tag} />
    <button type="button" class="x" aria-label="Close details" title="Close" on:click={onClose}>×</button>
  </header>

  <form on:submit|preventDefault={save}>
    <div class="row">
      <span class="lab">Type</span>
      {#if project}
        <span class="fixed">Project · {draft.kind === 'proposal' ? 'proposal' : 'job'} <small>(set by the number)</small></span>
      {:else}
        <div class="seg" role="radiogroup" aria-label="Type">
          <label class:on={draft.type === 'topic'}><input type="radio" bind:group={draft.type} value="topic" {disabled} />Topic</label>
          <label class:on={draft.type === 'person'}><input type="radio" bind:group={draft.type} value="person" {disabled} />Person</label>
        </div>
      {/if}
    </div>

    {#if project}
      <label class="row"><span class="lab">Name</span><input bind:value={draft.name} {disabled} placeholder="Project name" /></label>
      <label class="row"><span class="lab">Client</span><input bind:value={draft.client} {disabled} /></label>
      <label class="row"><span class="lab">Active</span>
        <select bind:value={draft.active} {disabled}>
          <option value={null}>Not set</option>
          <option value={true}>Active</option>
          <option value={false}>Closed</option>
        </select>
      </label>
      {#if draft.kind === 'proposal'}
        <label class="row"><span class="lab">Became job</span><input bind:value={draft.job} {disabled} placeholder="2327-018" /></label>
      {/if}
    {:else}
      <label class="row"><span class="lab">Display name</span><input bind:value={draft.label} {disabled} placeholder={tag} /></label>
      {#if draft.type === 'person'}
        <label class="row"><span class="lab">Company</span><input bind:value={draft.company} {disabled} /></label>
      {/if}
    {/if}
    <label class="row"><span class="lab">Aliases</span><input bind:value={draft.aliases} {disabled} placeholder="Comma-separated" /></label>
    <label class="row top"><span class="lab">Note</span><textarea rows="3" bind:value={draft.note} {disabled}></textarea></label>

    {#if draft.type === 'person'}
      <p class="help">Names and aliases keep their capitals: “Rich” is a person, “rich” is a word.</p>
    {/if}

    <div class="acts">
      <button type="submit" class="save" disabled={disabled || !changed}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={disabled || !changed} on:click={revert}>Revert</button>
    </div>
  </form>
</section>

<style>
  .td { padding: 12px 14px; border: 1px solid #e6e6e6; border-radius: 8px; background: #fff; font-size: 13px; color: #333; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  header :global(.tg) { font-size: 13px; padding: 2px 10px; }
  .x { border: none; background: none; color: #888; font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; }
  .x:hover { color: #222; }
  form { display: flex; flex-direction: column; gap: 8px; }
  .row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 8px; }
  .row.top { align-items: start; }
  .lab { font-size: 12px; color: #777; }
  .fixed { color: #0f766e; font-weight: 600; }
  .fixed small { color: #999; font-weight: 400; }
  input, select, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    color: #222;
    font: inherit;
    font-size: 12.5px;
  }
  textarea { resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #4a7cf7; }
  .seg { display: inline-flex; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; width: max-content; }
  .seg label { padding: 3px 12px; cursor: pointer; color: #555; font-size: 12px; }
  .seg label + label { border-left: 1px solid #ddd; }
  .seg label.on { background: #eef3ff; color: #2c56c4; font-weight: 600; }
  .seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .help { margin: 0; font-size: 11.5px; color: #888; }
  .acts { display: flex; gap: 6px; margin-top: 4px; }
  .acts button { padding: 4px 12px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #555; font-size: 12px; cursor: pointer; }
  .acts button:hover:not(:disabled) { background: #f0f0f0; color: #222; }
  .acts .save { border-color: #4a7cf7; color: #2c56c4; font-weight: 600; }
  button:disabled { opacity: 0.45; cursor: default; }
</style>
