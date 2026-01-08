/**
 * Transcript Search Utilities
 * Bag-of-words search for handwriting transcriptions
 */

/**
 * Tokenize text for search (bag-of-words)
 * Preserves hyphens within words (e.g., "5444-005" stays as one token)
 * @param {string} text - Text to tokenize
 * @returns {Set<string>} Set of lowercase tokens
 */
export function tokenize(text) {
  if (!text) return new Set();
  
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')  // Remove punctuation EXCEPT hyphens
      .split(/\s+/)                 // Split on whitespace
      .filter(word => word.length >= 2) // Include 2+ character words
  );
}

/**
 * Search pages by transcription text (bag-of-words)
 * Uses partial token matching to allow progressive filtering
 * @param {Array} pages - Array of LogSeqPageData objects
 * @param {string} query - Search query
 * @returns {Array} Matching pages with match scores
 */
export function searchPages(pages, query) {
  if (!query || !query.trim()) return pages;
  
  const queryTokens = Array.from(tokenize(query));
  
  if (queryTokens.length === 0) return pages;
  
  return pages
    .filter(page => page.transcriptionText) // Only pages with transcription
    .map(page => {
      const pageTokens = tokenize(page.transcriptionText);
      
      // Count how many query tokens have partial matches
      // Query token matches if ANY page token contains it
      const matchCount = queryTokens.filter(queryToken =>
        Array.from(pageTokens).some(pageToken =>
          pageToken.includes(queryToken)
        )
      ).length;
      
      return {
        ...page,
        matchScore: matchCount
      };
    })
    .filter(page => page.matchScore > 0) // Only pages with at least one match
    .sort((a, b) => b.matchScore - a.matchScore); // Rank by relevance
}

/**
 * Highlight matching terms in text (partial token matching)
 * @param {string} text - Original text
 * @param {string} query - Search query
 * @returns {string} HTML with <mark> tags around matches
 */
export function highlightMatches(text, query) {
  if (!query || !query.trim()) return escapeHtml(text);
  
  const queryTokens = Array.from(tokenize(query));
  if (queryTokens.length === 0) return escapeHtml(text);
  
  let highlighted = escapeHtml(text);
  
  // Create regex for each query token (partial matching, case-insensitive)
  queryTokens.forEach(token => {
    // Match the token anywhere it appears (partial matching)
    const regex = new RegExp(`(${escapeRegex(token)})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark>$1</mark>');
  });
  
  return highlighted;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape regex special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
