<!--
  Header.svelte - One slim bar: name, navigation, search, pen chip, settings.

  The capture controls (Save, Undo, Delete, Clear, Transcribe, Fetch) live in
  ActionBar, which sits under this bar and is shown only when there is capture
  work to do (see lib/capture-bar.js). It stays mounted either way: it owns the
  save dialog and the in-flight save/transcribe/import handlers.

  The unsaved dot is here, not in ActionBar, so it is visible from every view
  even with the capture bar hidden.
-->
<script>
  import {
    penConnected, unsavedChanges, viewerMode, viewerDirty,
    isTranscribing, transferProgress
  } from '$stores';
  import { shouldShowCaptureBar } from '$lib/capture-bar.js';
  import ActionBar from '../header/ActionBar.svelte';
  import PenChip from '../header/PenChip.svelte';
  import SettingsDropdown from '../header/SettingsDropdown.svelte';
  import SearchField from './SearchField.svelte';

  $: hasUnsaved = $unsavedChanges || $viewerDirty;
  $: showCaptureBar = shouldShowCaptureBar({
    viewerMode: $viewerMode,
    penConnected: $penConnected,
    unsavedChanges: $unsavedChanges,
    viewerDirty: $viewerDirty,
    busy: $isTranscribing || $transferProgress.active
  });
</script>

<header class="header">
  <div class="header-row">
    <h1 class="title">smartpen-bridge</h1>

    <!-- Primary navigation, supplied by App.svelte (it owns the guarded switch). -->
    <slot name="nav" />

    <!-- Global search: words, dates, notebooks; Ctrl K from anywhere. -->
    <SearchField />

    <span class="grow"></span>

    {#if hasUnsaved}
      <span
        class="unsaved"
        role="status"
        title={$unsavedChanges && $viewerDirty
          ? 'Unsaved strokes and transcript edits'
          : $viewerDirty ? 'Unsaved transcript edits' : 'Unsaved changes on the canvas'}
      >
        <span class="unsaved-dot" aria-hidden="true"></span>
        Unsaved
      </span>
    {/if}

    <PenChip />
    <SettingsDropdown />
  </div>

  <ActionBar visible={showCaptureBar} />
</header>

<style>
  .header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 44px;
  }

  .grow {
    flex: 1;
  }

  .title {
    font-size: 1.05rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: #fde047;
    white-space: nowrap;
  }

  .unsaved-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fde047;
    box-shadow: 0 0 6px rgba(253, 224, 71, 0.75);
  }

</style>
