<!--
  LibraryNav.svelte — the Library's left-panel tab (id 'contents'), which
  follows the Library view on the right (v3.14.0): the Tasks view's groups
  beside Tasks, every tag beside a tag's page, Untagged, the tag manager or the
  suggestions queue, and the notebook contents everywhere else (home, a
  notebook's pages, the reader). `libraryNavKind()` decides; LeftPanel uses the
  same answer for the tab's label.
-->
<script>
  import { libraryView, viewerSelection } from '$stores';
  import { libraryNavKind } from '$lib/left-panel.js';
  import LibraryContents from '../saved-pages/LibraryContents.svelte';
  import TaskGroupNav from './TaskGroupNav.svelte';
  import TagNav from './TagNav.svelte';

  $: kind = libraryNavKind($libraryView, !!$viewerSelection);
</script>

{#if kind === 'tasks'}
  <TaskGroupNav />
{:else if kind === 'tags'}
  <TagNav view={$libraryView} />
{:else}
  <LibraryContents />
{/if}
