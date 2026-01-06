/**
 * Formatting Utilities - Format book names, page identifiers, etc.
 */

/**
 * Format book name with alias if available
 * @param {number|string} bookId - Book ID
 * @param {Object} aliases - Map of book aliases
 * @param {string} format - 'full' | 'alias-only' | 'id-only'
 * @returns {string} Formatted book name
 */
export function formatBookName(bookId, aliases = {}, format = 'full') {
  const alias = aliases[bookId];
  
  if (!alias) {
    return `B${bookId}`;
  }
  
  switch (format) {
    case 'alias-only':
      return alias;
    case 'id-only':
      return `B${bookId}`;
    case 'full':
    default:
      return `${alias} (B${bookId})`;
  }
}

/**
 * Format page identifier with book alias
 * @param {Object} pageInfo - Page info object { book, page }
 * @param {Object} aliases - Map of book aliases
 * @returns {string} Formatted page identifier
 */
export function formatPageIdentifier(pageInfo, aliases = {}) {
  const bookName = formatBookName(pageInfo.book, aliases, 'full');
  return `${bookName} / P${pageInfo.page}`;
}

/**
 * Format book and page for display
 * @param {number|string} bookId - Book ID
 * @param {number} pageNum - Page number
 * @param {Object} aliases - Map of book aliases
 * @returns {string} Formatted string
 */
export function formatBookPage(bookId, pageNum, aliases = {}) {
  const bookName = formatBookName(bookId, aliases, 'full');
  return `${bookName} / P${pageNum}`;
}

/**
 * Format just the book part with optional prefix
 * @param {number|string} bookId - Book ID
 * @param {Object} aliases - Map of book aliases
 * @param {boolean} showPrefix - Whether to show "Book" prefix if no alias
 * @returns {string} Formatted book name
 */
export function formatBookDisplay(bookId, aliases = {}, showPrefix = false) {
  const alias = aliases[bookId];
  
  if (alias) {
    return `${alias} (B${bookId})`;
  }
  
  return showPrefix ? `Book ${bookId}` : `B${bookId}`;
}
