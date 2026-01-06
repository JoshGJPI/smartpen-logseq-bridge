/**
 * Book Aliases Store - Track user-friendly names for books
 * Aliases are stored in LogSeq as a 'bookName' property on book pages
 */
import { writable, derived } from 'svelte/store';

/**
 * Book aliases map: { bookId: alias }
 * e.g., { "3017": "Work Notes", "387": "Site Visits" }
 */
export const bookAliases = writable({});

/**
 * List of known book IDs (from current session + LogSeq)
 */
export const knownBookIds = writable(new Set());

/**
 * Derived store: Books without aliases
 */
export const booksWithoutAliases = derived(
  [knownBookIds, bookAliases],
  ([$known, $aliases]) => {
    return Array.from($known).filter(bookId => !$aliases[bookId]);
  }
);

/**
 * Set book aliases (typically loaded from LogSeq)
 * @param {Object} aliases - Map of bookId to alias
 */
export function setBookAliases(aliases) {
  bookAliases.set(aliases);
}

/**
 * Set a single book alias
 * @param {number|string} bookId - Book ID
 * @param {string} alias - Alias name
 */
export function setBookAlias(bookId, alias) {
  bookAliases.update(aliases => ({
    ...aliases,
    [bookId]: alias
  }));
}

/**
 * Remove a book alias
 * @param {number|string} bookId - Book ID
 */
export function removeBookAlias(bookId) {
  bookAliases.update(aliases => {
    const { [bookId]: removed, ...rest } = aliases;
    return rest;
  });
}

/**
 * Get alias for a book
 * @param {number|string} bookId - Book ID
 * @returns {string|null} Alias or null
 */
export function getBookAlias(bookId) {
  let alias = null;
  bookAliases.subscribe(aliases => {
    alias = aliases[bookId] || null;
  })();
  return alias;
}

/**
 * Register a book ID as known (from strokes or LogSeq)
 * @param {number|string} bookId - Book ID
 */
export function registerBookId(bookId) {
  knownBookIds.update(ids => {
    const newIds = new Set(ids);
    newIds.add(String(bookId));
    return newIds;
  });
}

/**
 * Register multiple book IDs
 * @param {Array<number|string>} bookIds - Array of book IDs
 */
export function registerBookIds(bookIds) {
  knownBookIds.update(ids => {
    const newIds = new Set(ids);
    bookIds.forEach(id => newIds.add(String(id)));
    return newIds;
  });
}

/**
 * Clear all book aliases
 */
export function clearBookAliases() {
  bookAliases.set({});
}
