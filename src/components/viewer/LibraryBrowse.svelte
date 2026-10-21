<!--
  LibraryBrowse.svelte — the Library when no page is open: the home
  (LibraryHome), one notebook's page grid (NotebookPages, `libraryNotebook`),
  or, from v3.1.0, a tag's pages / the Untagged pages (TagPages) and the
  suggestions queue (TagSuggestionQueue), from `libraryView`. BookViewer owns
  the reader and the guarded routes; this only picks what to show.
-->
<script>
  import { libraryView } from '$stores';
  import LibraryHome from './LibraryHome.svelte';
  import NotebookPages from './NotebookPages.svelte';
  import TagPages from '../tags/TagPages.svelte';

  /** Book key of the notebook grid to show, or null. */
  export let gridBook = null;
  /** (record) => void */
  export let onOpen = () => {};
  /** (book) => void */
  export let onOpenNotebook = () => {};
</script>

{#if gridBook}
  <NotebookPages book={gridBook} {onOpen} />
{:else if $libraryView && ($libraryView.kind === 'tag' || $libraryView.kind === 'untagged')}
  <TagPages view={$libraryView} {onOpen} />
{:else}
  <LibraryHome {onOpen} {onOpenNotebook} />
{/if}
