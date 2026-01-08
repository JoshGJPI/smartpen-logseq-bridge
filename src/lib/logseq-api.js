/**
 * LogSeq API Integration
 * Communicates with LogSeq via its HTTP API (localhost:12315)
 */

import {
  formatPageName,
  parseJsonBlock,
  formatJsonBlock,
  buildPageStorageObject,
  buildTranscriptionStorageObject,
  convertToStorageFormat,
  deduplicateStrokes,
  formatTranscribedText,
  getPageProperties,
  buildChunkedStorageObjects,
  parseChunkedJsonBlocks
} from './stroke-storage.js';

/**
 * Make an API request to LogSeq with retry logic
 */
async function makeRequest(host, token, method, args = [], retries = 3) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  let lastError;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const cleanHost = host.replace(/\/$/, ''); // Remove trailing slash
      const response = await fetch(`${cleanHost}/api`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method, args }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      lastError = error;
      
      // If it's a connection reset or timeout, retry
      if (error.name === 'AbortError' || error.message.includes('ERR_CONNECTION_RESET')) {
        console.warn(`Request attempt ${attempt + 1} failed, retrying...`, error.message);
        if (attempt < retries - 1) {
          // Exponential backoff: wait 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
      }
      
      // For other errors, don't retry
      break;
    }
  }
  
  // All retries failed
  if (lastError.message.includes('Failed to fetch') || lastError.name === 'TypeError') {
    throw new Error('Cannot connect to LogSeq. Is the HTTP API enabled?');
  }
  if (lastError.name === 'AbortError') {
    throw new Error('Request timed out. The data might be too large.');
  }
  if (lastError.message.includes('ERR_CONNECTION_RESET')) {
    throw new Error('Connection reset by LogSeq. The payload might be too large.');
  }
  
  throw lastError;
}

/**
 * Test connection to LogSeq
 */
export async function testLogseqConnection(host, token = '') {
  try {
    const result = await makeRequest(host, token, 'logseq.App.getCurrentGraph');
    
    // Extract graph name if available
    const graphName = result?.name || result?.path?.split('/').pop() || 'Connected';
    
    return { 
      success: true, 
      graphName,
      raw: result 
    };
  } catch (error) {
    console.error('LogSeq connection test failed:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Get or create a page by name
 * @param {string} pageName - Page name
 * @param {Object} properties - Optional page properties
 */
async function getOrCreatePage(host, token, pageName, properties = {}) {
  // First try to get the page
  let page = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
  
  if (!page) {
    // Create it with properties if it doesn't exist
    page = await makeRequest(host, token, 'logseq.Editor.createPage', [
      pageName,
      properties,
      { redirect: false, createFirstBlock: true }
    ]);
  }
  
  return page;
}

/**
 * Get today's journal page name
 */
function getTodayPageName() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  
  // LogSeq default date format
  return `${year}-${month}-${day}`;
}

/**
 * Send transcribed lines to LogSeq with proper hierarchy
 * @param {Array} lines - Array of line objects with text, indentLevel, parent, children
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 */
export async function sendToLogseq(lines, host, token = '') {
  try {
    if (!lines || lines.length === 0) {
      throw new Error('No lines to send');
    }
    
    // Use today's journal page
    const pageName = getTodayPageName();
    
    // Ensure the page exists
    await getOrCreatePage(host, token, pageName);
    
    // Create header block for this import
    const timestamp = new Date().toLocaleTimeString();
    const headerContent = `Transcribed from SmartPen - ${timestamp}`;
    const headerBlock = await makeRequest(
      host, 
      token,
      'logseq.Editor.appendBlockInPage', 
      [pageName, headerContent, { properties: { source: 'smartpen' } }]
    );
    
    if (!headerBlock) {
      throw new Error('Failed to create header block');
    }
    
    // Build hierarchy by maintaining a stack of parent blocks
    const blockStack = [{ uuid: headerBlock.uuid, indent: -1 }];
    let blockCount = 0;
    
    for (const line of lines) {
      const indent = line.indentLevel || 0;
      
      // Pop stack until we find a parent with lower indent
      while (blockStack.length > 1 && blockStack[blockStack.length - 1].indent >= indent) {
        blockStack.pop();
      }
      
      const parentBlock = blockStack[blockStack.length - 1];
      
      // Insert as child of parent
      const newBlock = await makeRequest(
        host,
        token,
        'logseq.Editor.insertBlock',
        [
          parentBlock.uuid,
          line.text,
          { sibling: false } // Insert as child, not sibling
        ]
      );
      
      if (newBlock) {
        blockStack.push({ uuid: newBlock.uuid, indent });
        blockCount++;
      }
    }
    
    console.log(`Sent ${blockCount} blocks to LogSeq page: ${pageName}`);
    return { 
      success: true, 
      blockCount,
      page: pageName 
    };
    
  } catch (error) {
    console.error('Failed to send to LogSeq:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Send handwritten note data to LogSeq
 * Legacy function for raw stroke data
 */
export async function sendHandwrittenNote(data, host, token = '') {
  const { strokes, svg, pages, timestamp } = data;
  
  const pageName = `Smartpen/${getTodayPageName()}`;
  
  try {
    await getOrCreatePage(host, token, pageName);
    
    const entryContent = `## Smartpen Import - ${new Date(timestamp).toLocaleTimeString()}`;
    const entryBlock = await makeRequest(
      host,
      token,
      'logseq.Editor.appendBlockInPage',
      [pageName, entryContent, {
        properties: {
          'imported-at': timestamp,
          'stroke-count': strokes.length,
          'pages': pages.join(', ')
        }
      }]
    );
    
    if (!entryBlock) {
      throw new Error('Failed to create entry block');
    }
    
    // Add stroke summary
    const summaryContent = `- **Strokes:** ${strokes.length}\n- **Pages:** ${pages.join(', ')}`;
    await makeRequest(
      host,
      token,
      'logseq.Editor.insertBlock',
      [entryBlock.uuid, summaryContent, { sibling: false }]
    );
    
    console.log('Note sent to LogSeq:', pageName);
    return { success: true, page: pageName };
    
  } catch (error) {
    console.error('Failed to send to LogSeq:', error);
    throw error;
  }
}

/**
 * Get or create a Smartpen Data storage page
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Page object
 */
export async function getOrCreateSmartpenPage(book, page, host, token = '') {
  const pageName = formatPageName(book, page);
  const properties = getPageProperties({ book, page });
  return await getOrCreatePage(host, token, pageName, properties);
}

/**
 * Get page blocks and find specific section
 * @param {Object} page - LogSeq page object
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @param {string} heading - Heading to find (e.g., "Raw Stroke Data")
 * @returns {Promise<Object|null>} Block object or null
 */
async function findBlockByHeading(page, host, token, heading) {
  // Get all blocks in the page
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [page.name]);
  
  if (!blocks || blocks.length === 0) return null;
  
  // Find block with matching heading
  for (const block of blocks) {
    if (block.content && block.content.includes(`## ${heading}`)) {
      return block;
    }
  }
  
  return null;
}

/**
 * Get strokes from a Smartpen Data page
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object|null>} Stroke data object or null
 */
export async function getPageStrokes(book, page, host, token = '') {
  try {
    const pageName = formatPageName(book, page);
    const pageObj = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
    
    if (!pageObj) return null;
    
    // Get page blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    if (!blocks || blocks.length === 0) return null;
    
    // Find "Raw Stroke Data" section
    for (const block of blocks) {
      if (block.content && block.content.includes('## Raw Stroke Data')) {
        // Check if we have child blocks
        if (!block.children || block.children.length === 0) {
          return null;
        }
        
        // Check if this is chunked format (first child has metadata.chunks)
        const firstChild = parseJsonBlock(block.children[0].content);
        if (firstChild && firstChild.metadata && firstChild.metadata.chunks !== undefined) {
          // New chunked format
          console.log(`Reading chunked format: ${firstChild.metadata.chunks} chunks, ${firstChild.metadata.totalStrokes} total strokes`);
          return parseChunkedJsonBlocks(block.children);
        } else {
          // Old single-block format (backward compatible)
          console.log('Reading legacy single-block format');
          return firstChild;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get page strokes:', error);
    return null;
  }
}

/**
 * Update page strokes with incremental deduplication
 * Automatically batches large stroke sets to avoid payload size limits
 * @param {number} book - Book ID
 * @param {number} page - Page number  
 * @param {Array} newStrokes - New raw strokes from pen
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Result with success status and stats
 */
export async function updatePageStrokes(book, page, newStrokes, host, token = '') {
  try {
    // No size limits anymore - chunked storage can handle unlimited strokes
    // Process all strokes in a single operation
    return await updatePageStrokesSingle(book, page, newStrokes, host, token);
    
  } catch (error) {
    console.error('Failed to update page strokes:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Internal function to update page strokes (single batch)
 * @private
 */
async function updatePageStrokesSingle(book, page, newStrokes, host, token = '') {
  const CHUNK_SIZE = 200; // Strokes per chunk (reduced to avoid payload size errors)
  
  try {
    // Get or create the page
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get existing strokes (handles both old and new format)
    const existingData = await getPageStrokes(book, page, host, token);
    
    // Convert new strokes to storage format
    const pageInfo = newStrokes[0]?.pageInfo || { section: 0, owner: 0, book, page };
    const simplifiedStrokes = convertToStorageFormat(newStrokes);
    
    let allStrokes;
    let isUpdate = false;
    let addedCount = 0;
    let deletedCount = 0;
    
    if (existingData && existingData.strokes) {
      // Check what changed
      const uniqueStrokes = deduplicateStrokes(existingData.strokes, simplifiedStrokes);
      addedCount = uniqueStrokes.length;
      deletedCount = Math.max(0, existingData.strokes.length - simplifiedStrokes.length);
      
      if (addedCount === 0 && deletedCount === 0) {
        console.log('No changes to strokes');
        return {
          success: true,
          added: 0,
          deleted: 0,
          total: existingData.strokes.length,
          page: pageName
        };
      }
      
      // Use simplifiedStrokes as the source of truth
      // This handles both additions and deletions correctly
      // simplifiedStrokes contains ALL active strokes (both existing and new)
      allStrokes = simplifiedStrokes.sort((a, b) => a.startTime - b.startTime);
      isUpdate = true;
      
      console.log(`Changes detected: ${addedCount} added, ${deletedCount} deleted`);
    } else {
      // First time - use all strokes
      allStrokes = simplifiedStrokes;
    }
    
    // Build chunked storage objects
    const { metadata, strokeChunks } = buildChunkedStorageObjects(pageInfo, allStrokes, CHUNK_SIZE);
    
    console.log(`Writing ${allStrokes.length} strokes in ${strokeChunks.length} chunks`);
    
    // Get page blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    // Remove old "Raw Stroke Data" block if it exists
    if (blocks && blocks.length > 0) {
      for (const block of blocks) {
        if (block.content && block.content.includes('## Raw Stroke Data')) {
          await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
          break;
        }
      }
    }
    
    // Create new "Raw Stroke Data" parent block
    const parentBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
      pageName,
      '## Raw Stroke Data',
      { properties: { collapsed: true } }
    ]);
    
    if (!parentBlock) {
      throw new Error('Failed to create parent block');
    }
    
    // Write metadata block as first child
    await makeRequest(host, token, 'logseq.Editor.insertBlock', [
      parentBlock.uuid,
      formatJsonBlock(metadata),
      { sibling: false }
    ]);
    
    // Write stroke chunks as subsequent children
    // Note: We append them to the parent, not to each other
    let previousBlockUuid = null;
    for (let i = 0; i < strokeChunks.length; i++) {
      const chunk = strokeChunks[i];
      
      const chunkBlock = await makeRequest(host, token, 'logseq.Editor.insertBlock', [
        previousBlockUuid || parentBlock.uuid,
        formatJsonBlock(chunk),
        { sibling: previousBlockUuid !== null } // First chunk is child, rest are siblings
      ]);
      
      if (!chunkBlock) {
        throw new Error(`Failed to create chunk block ${chunk.chunkIndex}`);
      }
      
      previousBlockUuid = chunkBlock.uuid;
      
      // Add delay between chunks to avoid overwhelming LogSeq (except after last chunk)
      if (i < strokeChunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      }
    }
    
    const finalAddedCount = isUpdate ? addedCount : allStrokes.length;
    
    console.log(`Updated ${pageName}: ${finalAddedCount} new, ${deletedCount} deleted, ${allStrokes.length} total (${strokeChunks.length} chunks)`);
    
    return {
      success: true,
      added: finalAddedCount,
      deleted: deletedCount,
      total: allStrokes.length,
      chunks: strokeChunks.length,
      page: pageName
    };
    
  } catch (error) {
    console.error('Failed to update page strokes:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get or create a book page (root page for a book)
 * @param {number} book - Book ID
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Page object
 */
export async function getOrCreateBookPage(book, host, token = '') {
  const pageName = `Smartpen Data/B${book}`;
  return await getOrCreatePage(host, token, pageName, { book });
}

/**
 * Get book page properties including bookname
 * @param {number} book - Book ID
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object|null>} Page properties or null
 */
export async function getBookPageProperties(book, host, token = '') {
  try {
    const pageName = `Smartpen Data/B${book}`;
    const page = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
    
    if (!page) return null;
    
    return page.properties || {};
  } catch (error) {
    console.error(`Failed to get book page properties for B${book}:`, error);
    return null;
  }
}

/**
 * Update book page property (e.g., bookname)
 * @param {number} book - Book ID
 * @param {string} propertyName - Property name (e.g., 'bookname')
 * @param {string} value - Property value
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<boolean>} Success status
 */
export async function updateBookPageProperty(book, propertyName, value, host, token = '') {
  try {
    // Get or create the book page
    const pageObj = await getOrCreateBookPage(book, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get the page's block tree
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    let firstBlockUuid;
    
    if (!blocks || blocks.length === 0) {
      // No blocks exist yet - create the first block (properties block)
      const firstBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
        pageName,
        '', // Empty content - properties only
        { properties: {} }
      ]);
      
      if (!firstBlock) {
        throw new Error('Failed to create properties block');
      }
      
      firstBlockUuid = firstBlock.uuid;
    } else {
      // Use the first block's UUID
      firstBlockUuid = blocks[0].uuid;
    }
    
    // Update the property on the first block
    await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
      firstBlockUuid,
      propertyName,
      value
    ]);
    
    console.log(`Updated ${propertyName} for B${book}: ${value}`);
    return true;
    
  } catch (error) {
    console.error(`Failed to update book page property for B${book}:`, error);
    return false;
  }
}

/**
 * Scan all book pages and extract bookname properties
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Map of bookId to bookname
 */
export async function scanBookAliases(host, token = '') {
  try {
    // Query for all pages under "Smartpen Data" namespace
    const response = await makeRequest(host, token, 'logseq.DB.datascriptQuery', [
      `[:find (pull ?p [:block/name :block/original-name :block/properties])
        :where [?p :block/name ?name]
               [(clojure.string/starts-with? ?name "smartpen data/")]]`
    ]);
    
    // LogSeq returns the query result directly (may be array or object)
    // Check if response is valid and iterable
    if (!response) {
      console.log('No response from book alias query');
      return {};
    }
    
    // Handle different response formats
    let allPages;
    if (Array.isArray(response)) {
      allPages = response;
    } else if (response.result && Array.isArray(response.result)) {
      allPages = response.result;
    } else {
      console.warn('Unexpected response format from scanBookAliases:', response);
      return {};
    }
    
    if (allPages.length === 0) {
      return {};
    }
    
    const aliases = {};
    
    for (const pageEntry of allPages) {
      // Handle both array format [pageData] and direct pageData
      const pageData = Array.isArray(pageEntry) ? pageEntry[0] : pageEntry;
      
      if (!pageData) continue;
      
      const pageName = pageData['original-name'] || pageData.name;
      const properties = pageData.properties || {};
      
      if (!pageName) continue;
      
      // Extract book ID from page name (e.g., "Smartpen Data/B3017" -> "3017")
      const match = pageName.match(/B(\d+)$/i);
      if (match && properties.bookname) {
        const bookId = match[1];
        aliases[bookId] = properties.bookname;
      }
    }
    
    console.log(`Found ${Object.keys(aliases).length} book aliases in LogSeq`);
    return aliases;
    
  } catch (error) {
    console.error('Failed to scan book aliases:', error);
    return {};
  }
}

/**
 * Update page transcription data
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Object} transcription - Transcription result from MyScript
 * @param {number} strokeCount - Number of strokes transcribed
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Result with success status
 */
export async function updatePageTranscription(book, page, transcription, strokeCount, host, token = '') {
  try {
    // Ensure page exists
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Format transcribed text
    const plainText = formatTranscribedText(transcription.lines || []);
    
    // Get existing blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    if (!blocks || blocks.length === 0) {
      throw new Error('Page has no content. Save strokes first.');
    }
    
    // Find and remove existing "Transcribed Text" block if it exists
    const blocksToRemove = [];
    for (const block of blocks) {
      if (block.content && block.content.includes('## Transcribed Text')) {
        blocksToRemove.push(block);
      }
    }
    
    for (const block of blocksToRemove) {
      await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
    }
    
    // Create "Transcribed Text" parent block
    const textBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
      pageName,
      '## Transcribed Text',
      {}
    ]);
    
    if (!textBlock) {
      throw new Error('Failed to create text block');
    }
    
    // Add plain text as child block in code block
    await makeRequest(host, token, 'logseq.Editor.insertBlock', [
      textBlock.uuid,
      '```\n' + plainText + '\n```',
      { sibling: false }
    ]);
    
    console.log(`Updated transcription for ${pageName}`);
    
    return {
      success: true,
      page: pageName,
      lineCount: transcription.lines?.length || 0
    };
    
  } catch (error) {
    console.error('Failed to update transcription:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Compute actual changes for a page (for confirmation dialog)
 * Compares active strokes against what's in LogSeq
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Array} activeStrokes - Current active strokes (excluding deleted)
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} { additions, deletions, total }
 */
export async function computePageChanges(book, page, activeStrokes, host, token = '') {
  try {
    const existingData = await getPageStrokes(book, page, host, token);
    
    if (!existingData || !existingData.strokes) {
      // No existing data - all strokes are additions
      return {
        additions: activeStrokes.length,
        deletions: 0,
        total: activeStrokes.length
      };
    }
    
    // Convert to storage format for comparison
    const simplifiedStrokes = convertToStorageFormat(activeStrokes);
    
    // Find new strokes
    const uniqueStrokes = deduplicateStrokes(existingData.strokes, simplifiedStrokes);
    
    // Calculate deletions
    const deletedCount = Math.max(0, existingData.strokes.length - simplifiedStrokes.length);
    
    return {
      additions: uniqueStrokes.length,
      deletions: deletedCount,
      total: simplifiedStrokes.length
    };
  } catch (error) {
    console.error(`Failed to compute changes for B${book}/P${page}:`, error);
    // Return conservative estimate
    return {
      additions: activeStrokes.length,
      deletions: 0,
      total: activeStrokes.length
    };
  }
}
