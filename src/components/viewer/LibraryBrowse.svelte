<!--
  LibraryBrowse.svelte — the Library when no page is open: the home
  (LibraryHome), one notebook's page grid (NotebookPages, `libraryNotebook`),
  or, from v3.1.0, a tag's pages / the Untagged pages (TagPages) and the
  suggestions queue (TagSuggestionQueue), and from v3.2.0 the tag manager
  (TagManagerView), and from v3.4.0 the Tasks view (TasksView), from `libraryView`. BookViewer owns
  the reader and the guarded routes; this only picks what to show.
-->
<script>
  import { libraryView } from '$stores';
  import LibraryHome from './LibraryHome.svelte';
  import NotebookPages from './NotebookPages.svelte';
  import TagPages from '../tags/TagPages.svelte';
  import TagSuggestionQueue from '../tags/TagSuggestionQueue.svelte';
  import TagManagerView from '../tags/TagManagerView.svelte';
  import TasksView from '../tasks/TasksView.svelte';

  /** Book key of the notebook grid to show, or null. */
  export let gridBook = null;
  /** (record, sequence?) => void: sequence = the grid's pages, for Tag order */
  export let onOpen = () => {};
  /** (book) => void */
  export let onOpenNotebook = () => {};
</script>

{#if gridBook}
  <NotebookPages book={gridBook} {onOpen} />
{:else if $libraryView && ($libraryView.kind === 'tag' || $libraryView.kind === 'untagged')}
  <TagPages view={$libraryView} {onOpen} />
{:else if $libraryView && $libraryView.kind === 'suggestions'}
  <TagSuggestionQueue onOpen={(r) => onOpen(r)} />
{:else if $libraryView && $libraryView.kind === 'tags'}
  <TagManagerView />
{:else if $libraryView && $libraryView.kind === 'tasks'}
  <TasksView />
{:else}
  <LibraryHome {onOpen} {onOpenNotebook} />
{/if}
