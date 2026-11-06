/**
 * Book types store (v3.15.0) — each notebook's type ("Work", "Personal", …)
 * and the type filter.
 *
 * Types live in `pages/_book-types.json` (lib/book-types.js has the rules). A
 * change is written at once, optimistic with rollback, like a tag: never a
 * PageDoc, never `markUnsavedChanges()`. The filter is a per-viewer preference
 * (localStorage) shared by the Library home and the date features (Dates tab,
 * Timeline, date loads into the Editor) through `stores/timeline.js`.
 */
import { writable, derived, get } from 'svelte/store';
import { getBookTypes, setBookType as writeBookType } from '$lib/storage/local-store.js';
import {
  normalizeBookTypes, canonicalType, typeNames, parseTypeFilter, TYPE_FILTER_KEY
} from '$lib/book-types.js';
import { readString, write, remove } from '$lib/safe-storage.js';
import { dataFolderReady } from './settings.js';
import { log } from './ui.js';

/** `{ book key: type }`, as stored (volume inheritance is `bookTypeOf`'s). */
export const bookTypes = writable({});

/** Every type in use, sorted. */
export const bookTypeNames = derived(bookTypes, ($t) => typeNames($t));

/** Read the sidecar. Never throws: a failure leaves notebooks untyped. */
export async function loadBookTypes() {
  try {
    bookTypes.set(normalizeBookTypes({ books: await getBookTypes() }));
  } catch (err) {
    log(`Could not read notebook types: ${err.message}`, 'warning');
  }
}

/** Forget the old folder's types (data-folder change). */
export function clearBookTypes() {
  bookTypes.set({});
}

/**
 * Set or clear (null / '') one notebook's own type. A spelling that differs
 * only in case joins the existing type. Returns true when stored.
 */
export async function setNotebookType(bookKey, value) {
  const key = String(bookKey);
  const before = get(bookTypes);
  const type = canonicalType(value, before);
  if ((before[key] || null) === type) return true;

  const next = { ...before };
  if (type) next[key] = type; else delete next[key];
  bookTypes.set(next);

  if (!get(dataFolderReady)) {
    log('Notebook type set in memory. Set a Data Folder to keep it.', 'info');
    return true;
  }
  try {
    await writeBookType(key, type);
    return true;
  } catch (err) {
    bookTypes.update((cur) => {
      const back = { ...cur };
      if (before[key]) back[key] = before[key]; else delete back[key];
      return back;
    });
    log(`Could not save the type for B${key}: ${err.message}`, 'error');
    return false;
  }
}

/** The type filter: a type name, NO_TYPE, or null (all notebooks). */
export const bookTypeFilter = writable(parseTypeFilter(readString(TYPE_FILTER_KEY)));

export function setBookTypeFilter(value) {
  const next = parseTypeFilter(value);
  if (next) write(TYPE_FILTER_KEY, next); else remove(TYPE_FILTER_KEY);
  bookTypeFilter.set(next);
}
