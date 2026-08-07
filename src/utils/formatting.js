/**
 * Formatting Utilities - Format book names, page identifiers, etc.
 *
 * `bookId` here is a **book key** — "388" for volume 1, "388v2" for volume 2 of
 * the same physical NCode book. Volume 1 formats exactly as a bare id always did,
 * so single-volume books read unchanged.
 */

import { volumeBadge, volumeSuffix, ncodeBookOf, parseBookKey } from '../lib/volumes.js';

// Book colors matching canvas renderer
const BOOK_COLORS = [
  'rgba(233, 69, 96, 0.8)',   // Red
  'rgba(75, 192, 192, 0.8)',  // Teal
  'rgba(255, 205, 86, 0.8)',  // Yellow
  'rgba(153, 102, 255, 0.8)', // Purple
  'rgba(255, 159, 64, 0.8)',  // Orange
  'rgba(54, 162, 235, 0.8)',  // Blue
  'rgba(255, 99, 132, 0.8)',  // Pink
  'rgba(76, 175, 80, 0.8)',   // Green
  'rgba(121, 85, 72, 0.8)',   // Brown
  'rgba(158, 158, 158, 0.8)', // Gray
];

/**
 * Get color index for a book ID (consistent across pages)
 * Uses same algorithm as canvas renderer
 * @param {number|string} bookId - Book ID
 * @returns {number} Color index
 */
function getBookColorIndex(bookId) {
  let hash = 0;
  // Hash the NCode book, not the full key, so every volume of one notebook
  // shares a colour and reads as a sibling rather than an unrelated book.
  const parsed = parseBookKey(bookId);
  const str = parsed ? String(parsed.ncodeBook) : String(bookId);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % BOOK_COLORS.length;
}

/**
 * `"388v2"` → `"B388 v2"`. The id half of every label, volume included.
 * Volume 1 → `"B388"`, unchanged.
 */
function bookIdLabel(bookId) {
  const badge = volumeBadge(bookId);
  return badge ? `B${ncodeBookOf(bookId)} ${badge}` : `B${bookId}`;
}

/**
 * Get RGBA color string for a book ID
 * @param {number|string} bookId - Book ID
 * @param {number} alpha - Optional alpha value (0-1), defaults to 0.8
 * @returns {string} RGBA color string
 */
export function getBookColor(bookId, alpha = 0.8) {
  const colorIndex = getBookColorIndex(bookId);
  const baseColor = BOOK_COLORS[colorIndex];
  
  // Parse RGB from rgba string and apply custom alpha
  const match = baseColor.match(/rgba\(([^,]+),([^,]+),([^,]+),/);
  if (match) {
    const r = match[1].trim();
    const g = match[2].trim();
    const b = match[3].trim();
    return `rgba(${r},${g},${b},${alpha})`;
  }
  
  return baseColor;
}

/**
 * Format book name with alias if available
 * @param {number|string} bookId - Book ID
 * @param {Object} aliases - Map of book aliases
 * @param {string} format - 'full' | 'alias-only' | 'id-only'
 * @returns {string} Formatted book name
 */
export function formatBookName(bookId, aliases = {}, format = 'full') {
  // Aliases are keyed by book key, so each volume can carry its own name.
  // Fall back to the NCode book's alias with a volume suffix appended, so a
  // freshly-created volume 2 reads as "Field Notes · Vol 2" rather than "B388v2"
  // until the user names it.
  const alias = aliases[bookId] ?? aliases[String(bookId)];
  const inherited = alias
    ? null
    : (aliases[ncodeBookOf(bookId)] ?? aliases[String(ncodeBookOf(bookId))]);
  const name = alias || (inherited ? `${inherited}${volumeSuffix(bookId)}` : null);
  const idLabel = bookIdLabel(bookId);

  if (!name) {
    return idLabel;
  }

  switch (format) {
    case 'alias-only':
      return name;
    case 'id-only':
      return idLabel;
    case 'full':
    default:
      return `${name} (${idLabel})`;
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
  const named = formatBookName(bookId, aliases, 'full');
  const idLabel = bookIdLabel(bookId);

  if (named !== idLabel) return named;

  return showPrefix ? `Book ${idLabel.slice(1)}` : idLabel;
}

/**
 * Filter out property lines from transcription text
 * Removes property lines like "stroke-y-bounds::" and "canonical-transcript::"
 * @param {string} text - Transcription text that may contain properties
 * @returns {string} Filtered text without property lines
 */
export function filterTranscriptionProperties(text) {
  if (!text) return '';
  
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Filter out property lines (format: "property-name:: value")
      return !trimmed.match(/^[a-z-]+::/i);
    })
    .join('\n');
}
