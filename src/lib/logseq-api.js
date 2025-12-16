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
  getPageProperties
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
        // JSON should be in a child block
        if (block.children && block.children.length > 0) {
          const jsonBlock = block.children[0];
          return parseJsonBlock(jsonBlock.content);
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
  const BATCH_SIZE = 300; // Process 300 strokes at a time
  
  try {
    // If we have a lot of strokes, batch them
    if (newStrokes.length > BATCH_SIZE) {
      console.log(`Large stroke set detected (${newStrokes.length} strokes). Processing in batches...`);
      
      let totalAdded = 0;
      let currentTotal = 0;
      
      // Process in batches
      for (let i = 0; i < newStrokes.length; i += BATCH_SIZE) {
        const batch = newStrokes.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(newStrokes.length / BATCH_SIZE);
        
        console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} strokes)...`);
        
        const result = await updatePageStrokesSingle(book, page, batch, host, token);
        
        if (!result.success) {
          return result; // Return error immediately
        }
        
        totalAdded += result.added;
        currentTotal = result.total;
      }
      
      return {
        success: true,
        added: totalAdded,
        total: currentTotal,
        page: formatPageName(book, page),
        batched: true
      };
    }
    
    // Normal path for small stroke sets
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
  try {
    // Get or create the page
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get existing strokes
    const existingData = await getPageStrokes(book, page, host, token);
    
    // Convert new strokes to storage format
    const pageInfo = newStrokes[0]?.pageInfo || { section: 0, owner: 0, book, page };
    const simplifiedStrokes = convertToStorageFormat(newStrokes);
    
    let allStrokes;
    let isUpdate = false;
    
    if (existingData && existingData.strokes) {
      // Deduplicate and merge
      const uniqueStrokes = deduplicateStrokes(existingData.strokes, simplifiedStrokes);
      
      if (uniqueStrokes.length === 0) {
        console.log('No new strokes to add');
        return {
          success: true,
          added: 0,
          total: existingData.strokes.length,
          page: pageName
        };
      }
      
      allStrokes = [...existingData.strokes, ...uniqueStrokes]
        .sort((a, b) => a.startTime - b.startTime);
      isUpdate = true;
    } else {
      // First time - use all strokes
      allStrokes = simplifiedStrokes;
    }
    
    // Build storage object
    const storageData = buildPageStorageObject(pageInfo, allStrokes);
    
    // Get page blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    if (!blocks || blocks.length === 0) {
      // New page - properties were already set during creation
      // Create "Raw Stroke Data" parent block with collapsed property
      const parentBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
        pageName,
        '## Raw Stroke Data',
        { properties: { collapsed: true } }
      ]);
      
      if (!parentBlock) {
        throw new Error('Failed to create parent block');
      }
      
      // Add JSON as child block
      await makeRequest(host, token, 'logseq.Editor.insertBlock', [
        parentBlock.uuid,
        formatJsonBlock(storageData),
        { sibling: false } // Insert as child
      ]);
    } else {
      // Update existing page - don't touch properties
      // Find and remove old "Raw Stroke Data" block
      let rawDataBlock = null;
      for (const block of blocks) {
        if (block.content && block.content.includes('## Raw Stroke Data')) {
          rawDataBlock = block;
          break;
        }
      }
      
      if (rawDataBlock) {
        await makeRequest(host, token, 'logseq.Editor.removeBlock', [rawDataBlock.uuid]);
      }
      
      // Create new "Raw Stroke Data" block
      const parentBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
        pageName,
        '## Raw Stroke Data',
        { properties: { collapsed: true } }
      ]);
      
      if (!parentBlock) {
        throw new Error('Failed to create parent block');
      }
      
      // Add JSON as child block
      await makeRequest(host, token, 'logseq.Editor.insertBlock', [
        parentBlock.uuid,
        formatJsonBlock(storageData),
        { sibling: false }
      ]);
    }
    
    const addedCount = isUpdate ? (allStrokes.length - (existingData?.strokes?.length || 0)) : allStrokes.length;
    
    console.log(`Updated ${pageName}: ${addedCount} new strokes, ${allStrokes.length} total`);
    
    return {
      success: true,
      added: addedCount,
      total: allStrokes.length,
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
