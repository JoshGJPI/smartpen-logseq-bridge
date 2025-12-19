/**
 * LogSeq Scanner - Discover smartpen pages stored in LogSeq
 */
import { get } from 'svelte/store';
import { getLogseqSettings, logseqConnected, setLogseqPages, setScanning, log } from '$stores';
import { parseJsonBlock, parseChunkedJsonBlocks } from './stroke-storage.js';

/**
 * Make an API request to LogSeq
 */
async function makeRequest(host, token, method, args = []) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const cleanHost = host.replace(/\/$/, '');
  const response = await fetch(`${cleanHost}/api`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args }),
    signal: AbortSignal.timeout(30000)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * Extract book and page numbers from page name
 * Format: "Smartpen Data/B3017/P42"
 * @param {string} pageName - Full page name
 * @returns {Object|null} { book: number, page: number } or null
 */
function extractBookPage(pageName) {
  const match = pageName.match(/B(\d+)\/P(\d+)/i);
  if (match) {
    return {
      book: parseInt(match[1], 10),
      page: parseInt(match[2], 10)
    };
  }
  return null;
}

/**
 * Recursively search block tree for matching content
 * @param {Array} blocks - Block tree
 * @param {Function} predicate - Test function for content
 * @returns {Object|null} Matching block or null
 */
function findBlockByContent(blocks, predicate) {
  for (const block of blocks) {
    if (predicate(block.content || '')) {
      return block;
    }
    if (block.children?.length) {
      const found = findBlockByContent(block.children, predicate);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extract JSON from code fence in block content
 * @param {string} content - Block content
 * @returns {Object|null} Parsed JSON or null
 */
function extractJsonFromBlock(content) {
  // Try with language specifier
  let jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!jsonMatch) {
    // Try without language specifier
    jsonMatch = content.match(/```\s*\n([\s\S]*?)\n```/);
  }
  
  if (!jsonMatch) return null;
  
  try {
    return JSON.parse(jsonMatch[1]);
  } catch (e) {
    console.error('Failed to parse JSON from block:', e);
    return null;
  }
}

/**
 * Extract transcription text from block content
 * @param {Array} blocks - Block tree
 * @returns {string|null} Transcription text or null
 */
function extractTranscriptionText(blocks) {
  const textBlock = findBlockByContent(blocks, content => 
    content.includes('## Transcribed Text')
  );
  
  if (!textBlock || !textBlock.children?.length) {
    return null;
  }
  
  // Get first child (the code block with text)
  const contentBlock = textBlock.children[0];
  const content = contentBlock.content || '';
  
  // Extract text from code fence
  const match = content.match(/```\s*\n([\s\S]*?)\n```/);
  if (match) {
    return match[1];
  }
  
  return null;
}

/**
 * Get detailed information about a single smartpen page
 * @param {string} pageName - Page name
 * @param {string} host - LogSeq host
 * @param {string} token - Auth token
 * @returns {Promise<Object|null>} Page data or null
 */
async function getPageDetails(pageName, host, token) {
  try {
    // Get page properties
    const properties = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
    
    if (!properties) return null;
    
    // Extract book and page numbers
    const bookPage = extractBookPage(pageName);
    if (!bookPage) return null;
    
    // Get page blocks for transcription
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    // Extract transcription text
    const transcriptionText = extractTranscriptionText(blocks || []);
    
    // Get properties from page
    const pageProps = properties.properties || {};
    
    return {
      pageName,
      book: bookPage.book,
      page: bookPage.page,
      strokeCount: parseInt(pageProps['stroke-count'] || pageProps.strokeCount || 0, 10),
      lastUpdated: parseInt(pageProps['last-updated'] || pageProps.lastUpdated || 0, 10),
      transcribed: pageProps.transcribed === 'true' || pageProps.transcribed === true,
      transcriptionText,
      strokeData: null, // Lazy-loaded on import
      syncStatus: 'clean' // Updated later when comparing with local cache
    };
  } catch (error) {
    console.error(`Failed to get details for ${pageName}:`, error);
    return null;
  }
}

/**
 * Scan LogSeq for all smartpen data pages
 * @returns {Promise<boolean>} Success status
 */
export async function scanLogSeqPages() {
  const connected = get(logseqConnected);
  
  if (!connected) {
    log('Not connected to LogSeq', 'warning');
    return false;
  }
  
  setScanning(true);
  
  try {
    const { host, token } = getLogseqSettings();
    
    log('Scanning LogSeq for smartpen pages...', 'info');
    
    // Get all pages in the graph
    const allPages = await makeRequest(host, token, 'logseq.DB.datascriptQuery', [
      `[:find (pull ?p [:block/name :block/original-name])
        :where [?p :block/name]]`
    ]);
    
    if (!allPages || allPages.length === 0) {
      log('No pages found in LogSeq', 'warning');
      setLogseqPages([]);
      return true;
    }
    
    // Filter to smartpen pages
    const smartpenPageNames = allPages
      .map(([pageData]) => pageData['original-name'] || pageData.name)
      .filter(name => name && name.toLowerCase().startsWith('smartpen data/'));
    
    if (smartpenPageNames.length === 0) {
      log('No smartpen data found in LogSeq', 'info');
      setLogseqPages([]);
      return true;
    }
    
    log(`Found ${smartpenPageNames.length} smartpen pages. Loading details...`, 'info');
    
    // Get details for each page
    const pageDetailsPromises = smartpenPageNames.map(pageName => 
      getPageDetails(pageName, host, token)
    );
    
    const pageDetails = await Promise.all(pageDetailsPromises);
    
    // Filter out any failed fetches
    const validPages = pageDetails.filter(p => p !== null);
    
    log(`Loaded ${validPages.length} smartpen pages from LogSeq`, 'success');
    
    setLogseqPages(validPages);
    
    return true;
    
  } catch (error) {
    console.error('Failed to scan LogSeq pages:', error);
    log(`Failed to scan LogSeq: ${error.message}`, 'error');
    return false;
  } finally {
    setScanning(false);
  }
}

/**
 * Fetch stroke data for a specific page (lazy loading)
 * Handles both legacy single-block and new chunked formats
 * @param {string} pageName - Page name
 * @returns {Promise<Object|null>} Stroke data or null
 */
export async function fetchStrokeData(pageName) {
  try {
    const { host, token } = getLogseqSettings();
    
    // Get page blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    if (!blocks || blocks.length === 0) return null;
    
    // Find "Raw Stroke Data" section
    const strokeBlock = findBlockByContent(blocks, content => 
      content.includes('## Raw Stroke Data')
    );
    
    if (!strokeBlock || !strokeBlock.children?.length) {
      return null;
    }
    
    // Check if this is chunked format (first child has metadata.chunks)
    const firstChild = parseJsonBlock(strokeBlock.children[0].content);
    if (firstChild && firstChild.metadata && firstChild.metadata.chunks !== undefined) {
      // New chunked format - parse all child blocks
      console.log(`Reading chunked format: ${firstChild.metadata.chunks} chunks, ${firstChild.metadata.totalStrokes} total strokes`);
      return parseChunkedJsonBlocks(strokeBlock.children);
    } else {
      // Old single-block format - just parse first child
      console.log('Reading legacy single-block format');
      return firstChild;
    }
    
  } catch (error) {
    console.error(`Failed to fetch stroke data for ${pageName}:`, error);
    return null;
  }
}
