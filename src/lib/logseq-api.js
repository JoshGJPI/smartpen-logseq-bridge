/**
 * Get or create the "Transcribed Content" section parent block
 * @param {string} pageName - LogSeq page name
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<string>} Parent block UUID
 */
async function getOrCreateTranscriptSection(pageName, host, token = '') {
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
  
  if (blocks && blocks.length > 0) {
    const contentBlock = blocks.find(b => 
      b.content && b.content.includes('## Transcribed Content')
    );
    
    if (contentBlock) {
      return contentBlock.uuid;
    }
  }
  
  // Create the section
  const newBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
    pageName,
    '## Transcribed Content #Display_No_Properties',
    {}
  ]);
  
  return newBlock.uuid;
}

/**
 * Update transcript blocks from editor modal changes
 * This is different from re-transcription - we have block UUIDs already
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Array} editedLines - Edited lines from modal (with blockUuid)
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Update result with stats
 */
export async function updateTranscriptBlocksFromEditor(book, page, editedLines, host, token = '') {
  try {
    // Ensure page exists
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get all existing blocks
    const existingBlocks = await getTranscriptBlocks(book, page, host, token);
    
    console.log(`[updateTranscriptBlocksFromEditor] Processing ${editedLines.length} edited lines against ${existingBlocks.length} existing blocks`);
    
    // Track which block UUIDs are still referenced
    const referencedUuids = new Set();
    const results = [];

    // CRITICAL FIX: Collect explicitly marked blocks for deletion (from merge operations)
    const explicitBlocksToDelete = new Set();
    for (const line of editedLines) {
      if (line.blocksToDelete && Array.isArray(line.blocksToDelete)) {
        line.blocksToDelete.forEach(uuid => {
          if (uuid) explicitBlocksToDelete.add(uuid);
        });
      }
    }

    console.log(`[updateTranscriptBlocksFromEditor] ${explicitBlocksToDelete.size} blocks explicitly marked for deletion from merges`);

    // CRITICAL FIX: Group lines by indent level and process level-by-level
    const linesByLevel = new Map();
    let maxLevel = 0;

    for (let i = 0; i < editedLines.length; i++) {
      const line = editedLines[i];
      const level = line.indentLevel || 0;
      maxLevel = Math.max(maxLevel, level);

      if (!linesByLevel.has(level)) {
        linesByLevel.set(level, []);
      }
      linesByLevel.get(level).push({ line, index: i });
    }

    console.log(`[updateTranscriptBlocksFromEditor] Processing ${editedLines.length} lines across ${maxLevel + 1} levels`);

    // Track parent blocks for hierarchy (used when creating new blocks)
    const blockStack = [];
    const lineIndexToUuid = new Map(); // Track which UUID each line index has

    // Process level by level to ensure parents exist before children
    for (let level = 0; level <= maxLevel; level++) {
      const levelLines = linesByLevel.get(level) || [];

      if (levelLines.length === 0) continue;

      console.log(`[Level ${level}] Processing ${levelLines.length} lines`);

      for (const { line, index: i } of levelLines) {
        const currentIndent = line.indentLevel || 0;
      
      try {
        if (line.blockUuid) {
          // Existing block - update it
          referencedUuids.add(line.blockUuid);
          
          // Find the existing block to get its current content and properties
          const existingBlock = existingBlocks.find(b => b.uuid === line.blockUuid);
          const oldContent = existingBlock?.content || '';
          const existingProperties = existingBlock?.properties || {};

          await updateTranscriptBlockWithPreservation(
            line.blockUuid,
            line,
            oldContent,
            host,
            token,
            existingProperties
          );
          
          // Update block stack for hierarchy tracking
          // Pop blocks with >= indent level
          while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= currentIndent) {
            blockStack.pop();
          }
          blockStack.push({ uuid: line.blockUuid, indent: currentIndent });
          
          results.push({ type: 'updated', uuid: line.blockUuid, lineIndex: i });
        } else {
          // New block - create it with proper hierarchy
          // Find parent block (block with lower indent level)
          let parentUuid;
          
          if (blockStack.length === 0 || currentIndent === 0) {
            // Top level - use Transcribed Content section
            parentUuid = await getOrCreateTranscriptSection(pageName, host, token);
          } else {
            // Pop blocks until we find a parent with lower indent
            while (blockStack.length > 0 && blockStack[blockStack.length - 1].indent >= currentIndent) {
              blockStack.pop();
            }
            
            if (blockStack.length > 0) {
              parentUuid = blockStack[blockStack.length - 1].uuid;
            } else {
              // Fallback to section parent
              parentUuid = await getOrCreateTranscriptSection(pageName, host, token);
            }
          }
          
          const newBlock = await createTranscriptBlockWithProperties(
            parentUuid,
            line,
            host,
            token
          );
          
          if (newBlock) {
            referencedUuids.add(newBlock.uuid);
            blockStack.push({ uuid: newBlock.uuid, indent: currentIndent });
            lineIndexToUuid.set(i, newBlock.uuid);
            results.push({ type: 'created', uuid: newBlock.uuid, lineIndex: i, indentLevel: currentIndent });
          }
        }

        // Track UUID for this line index
        if (line.blockUuid) {
          lineIndexToUuid.set(i, line.blockUuid);
        }

      } catch (error) {
        console.error(`[Level ${level}] Failed to process line ${i}:`, error);
        results.push({ type: 'error', error: error.message, lineIndex: i, indentLevel: level });
      }
    } // End of levelLines loop
  } // End of level-by-level loop
    
    // Delete blocks that are no longer referenced (were merged or deleted)
    // Combine explicitly marked blocks with unreferenced blocks
    const blocksToDelete = existingBlocks.filter(b =>
      !referencedUuids.has(b.uuid) || explicitBlocksToDelete.has(b.uuid)
    );

    console.log(`[updateTranscriptBlocksFromEditor] Deleting ${blocksToDelete.length} blocks (${explicitBlocksToDelete.size} from merges)`);

    for (const block of blocksToDelete) {
      try {
        await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
        const reason = explicitBlocksToDelete.has(block.uuid) ? 'merged' : 'no-longer-referenced';
        results.push({ type: 'deleted', uuid: block.uuid, reason });
        console.log(`Deleted block ${block.uuid} (reason: ${reason})`);
      } catch (error) {
        console.error(`Failed to delete block ${block.uuid}:`, error);
        results.push({ type: 'delete-error', uuid: block.uuid, error: error.message });
      }
    }
    
    return {
      success: true,
      page: pageName,
      results,
      stats: {
        created: results.filter(r => r.type === 'created').length,
        updated: results.filter(r => r.type === 'updated').length,
        deleted: results.filter(r => r.type === 'deleted').length,
        errors: results.filter(r => r.type === 'error' || r.type === 'delete-error').length
      }
    };
    
  } catch (error) {
    console.error('Failed to update transcript blocks from editor:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 0
      }
    };
  }
}

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
  convertFromStorageFormat,
  deduplicateStrokes,
  formatTranscribedText,
  getPageProperties,
  buildChunkedStorageObjects,
  parseChunkedJsonBlocks
} from './stroke-storage.js';

import { filterTranscriptionProperties } from '../utils/formatting.js';
import { loadStrokesFromStorage } from '../stores/strokes.js';
import { generateBridgeUUID } from './uuid/bridge-uuid.js';

/**
 * Make an API request to LogSeq with retry logic
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @param {string} method - API method name
 * @param {Array} args - Method arguments
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<any>} API response
 */
export async function makeRequest(host, token, method, args = [], retries = 3) {
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
 * Load strokes from LogSeq storage into the strokes store
 * Restores blockUuid associations from previous sessions
 * 
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} { success, strokeCount, hasBlockUuids, transcribedCount, untranscribedCount }
 */
export async function loadPageStrokesIntoStore(book, page, host, token = '') {
  try {
    const data = await getPageStrokes(book, page, host, token);
    
    if (!data || !data.strokes || data.strokes.length === 0) {
      return { success: true, strokeCount: 0, hasBlockUuids: false };
    }
    
    const pageInfo = data.pageInfo || { section: 0, owner: 0, book, page };
    
    // Load into store (converts from storage format, restores blockUuid)
    loadStrokesFromStorage(data.strokes, pageInfo);
    
    // Check how many have blockUuid
    const withBlockUuid = data.strokes.filter(s => s.blockUuid).length;
    
    console.log(`Loaded ${data.strokes.length} strokes for B${book}/P${page}, ${withBlockUuid} with blockUuid`);
    
    return {
      success: true,
      strokeCount: data.strokes.length,
      hasBlockUuids: withBlockUuid > 0,
      transcribedCount: withBlockUuid,
      untranscribedCount: data.strokes.length - withBlockUuid
    };
    
  } catch (error) {
    console.error(`Failed to load strokes for B${book}/P${page}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Update page strokes with incremental deduplication
 * Automatically batches large stroke sets to avoid payload size limits
 *
 * CRITICAL (v3.1): Uses append-only strategy with explicit deletions.
 * LogSeq strokes are the base; new strokes are appended; only explicitly
 * deleted strokes (via deletedStrokeIds) are removed. This prevents
 * data loss when only a partial set of strokes is loaded in the canvas.
 *
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Array} newStrokes - New raw strokes from pen (canvas strokes)
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @param {Set<string>} deletedStrokeIds - Stroke IDs explicitly marked for deletion (format: "s{startTime}")
 * @returns {Promise<Object>} Result with success status and stats
 */
export async function updatePageStrokes(book, page, newStrokes, host, token = '', deletedStrokeIds = new Set()) {
  try {
    // No size limits anymore - chunked storage can handle unlimited strokes
    // Process all strokes in a single operation
    return await updatePageStrokesSingle(book, page, newStrokes, host, token, deletedStrokeIds);

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
 *
 * CRITICAL (v3.1): Append-only with explicit deletions.
 * - Starts from existing LogSeq strokes as the base
 * - Removes ONLY strokes in deletedStrokeIds
 * - Appends new strokes (deduplicated)
 * - Updates blockUuid on existing strokes if changed
 * - Never infers deletions from count differences
 *
 * @private
 */
async function updatePageStrokesSingle(book, page, newStrokes, host, token = '', deletedStrokeIds = new Set()) {
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
      // v3.1 APPEND-ONLY: Start from existing LogSeq strokes as base

      // Step 1: Remove explicitly deleted strokes
      let mergedStrokes;
      if (deletedStrokeIds.size > 0) {
        mergedStrokes = existingData.strokes.filter(s => !deletedStrokeIds.has(s.id));
        deletedCount = existingData.strokes.length - mergedStrokes.length;
        console.log(`Explicit deletions: removed ${deletedCount} strokes from ${existingData.strokes.length} existing`);
      } else {
        mergedStrokes = [...existingData.strokes];
      }

      // Step 2: Append new strokes (deduplicated against remaining existing)
      const uniqueNew = deduplicateStrokes(mergedStrokes, simplifiedStrokes);
      addedCount = uniqueNew.length;

      // Step 3: Update blockUuid on existing strokes if canvas version has changes
      const canvasById = new Map(simplifiedStrokes.map(s => [s.id, s]));
      let blockUuidChangedCount = 0;

      mergedStrokes = mergedStrokes.map(s => {
        const canvasVersion = canvasById.get(s.id);
        if (canvasVersion && canvasVersion.blockUuid !== s.blockUuid) {
          blockUuidChangedCount++;
          return { ...s, blockUuid: canvasVersion.blockUuid };
        }
        return s;
      });

      // Check if there are any actual changes
      if (addedCount === 0 && deletedCount === 0 && blockUuidChangedCount === 0) {
        console.log('No changes to strokes');
        return {
          success: true,
          added: 0,
          deleted: 0,
          total: mergedStrokes.length,
          page: pageName
        };
      }

      // Combine: existing (minus deletions, with updated blockUuids) + new unique strokes
      allStrokes = [...mergedStrokes, ...uniqueNew].sort((a, b) => a.startTime - b.startTime);
      isUpdate = true;

      console.log(`Changes detected: ${addedCount} added, ${deletedCount} deleted, ${blockUuidChangedCount} blockUuid updated`);
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
 * Normalize transcript for canonical comparison
 * Converts checkbox symbols to standard format
 */
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')     // Empty checkbox
    .replace(/☑/g, '[x]')     // Checked (variant 1)
    .replace(/☒/g, '[x]')     // Checked (variant 2)
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

/**
 * Convert checkbox symbols to LogSeq TODO/DONE markers
 */
function convertCheckboxToMarker(text) {
  const canonical = normalizeTranscript(text);
  
  if (canonical.match(/^\s*\[\s*\]/)) {
    // Empty checkbox → TODO
    return text.replace(/^[\s☐\[\s\]]+/, 'TODO ');
  } else if (canonical.match(/^\s*\[x\]/i)) {
    // Checked box → DONE
    return text.replace(/^[\s☑☒\[x\]]+/i, 'DONE ');
  }
  
  return text;
}

/**
 * Format Y-bounds for property storage
 */
function formatBounds(yBounds) {
  if (!yBounds || typeof yBounds.minY !== 'number' || typeof yBounds.maxY !== 'number') {
    return '0-0';
  }
  return `${yBounds.minY.toFixed(1)}-${yBounds.maxY.toFixed(1)}`;
}

/**
 * Parse Y-bounds from property string
 */
function parseYBounds(boundsString) {
  if (!boundsString || typeof boundsString !== 'string') {
    return { minY: 0, maxY: 0 };
  }
  const [minY, maxY] = boundsString.split('-').map(parseFloat);
  return { minY: minY || 0, maxY: maxY || 0 };
}

/**
 * Preserve TODO/DONE markers during updates
 */
function updateBlockWithPreservation(oldContent, newTranscript) {
  // Extract current marker
  let marker = null;
  if (oldContent.match(/^\s*TODO\s/)) marker = 'TODO';
  if (oldContent.match(/^\s*DONE\s/)) marker = 'DONE';
  
  // Convert new transcript
  let newContent = convertCheckboxToMarker(newTranscript);
  
  // If user had TODO/DONE and new content also starts with TODO, preserve user's choice
  if (marker && newContent.match(/^\s*TODO\s/)) {
    newContent = newContent.replace(/^\s*TODO\s/, `${marker} `);
  }
  
  return newContent;
}

/**
 * Create a transcript block with properties (v3.0 format)
 * Uses custom Bridge UUIDs to prevent collisions during batch creation
 * Only stores Y-bounds - blockUUID stored in stroke data, not as block property
 * @param {string} parentUuid - Parent block UUID
 * @param {Object} line - Line object with text, yBounds, etc.
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} Created block object
 */
export async function createTranscriptBlockWithProperties(parentUuid, line, host, token = '') {
  const content = convertCheckboxToMarker(line.text);
  const bounds = formatBounds(line.yBounds);
  
  const properties = {
    'stroke-y-bounds': bounds
  };
  
  // Generate custom Bridge UUID to prevent collisions
  const customUUID = generateBridgeUUID();
  
  console.log(`Creating block with Bridge UUID: ${customUUID.substring(0, 40)}...`);
  
  return await makeRequest(host, token, 'logseq.Editor.insertBlock', [
    parentUuid,
    content,
    {
      sibling: false,
      properties,
      customUUID  // Use custom UUID to prevent collisions
    }
  ]);
}

/**
 * Update a transcript block with preservation (v3.0 format)
 * Updates content while preserving TODO/DONE markers.
 * After content update, re-applies all existing block properties
 * (stroke-y-bounds, id, etc.) since logseq.Editor.updateBlock strips them.
 * @param {string} blockUuid - Block UUID to update
 * @param {Object} line - New line object with text and yBounds
 * @param {string} oldContent - Existing block content
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @param {Object} existingProperties - Existing block properties to preserve after content update
 */
export async function updateTranscriptBlockWithPreservation(blockUuid, line, oldContent, host, token = '', existingProperties = {}) {
  const newContent = updateBlockWithPreservation(oldContent, line.text);

  // Update content - NOTE: this strips all block properties
  await makeRequest(host, token, 'logseq.Editor.updateBlock', [
    blockUuid,
    newContent
  ]);

  // Re-apply all existing properties that were stripped by updateBlock
  for (const [key, value] of Object.entries(existingProperties)) {
    if (value != null && value !== '') {
      await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
        blockUuid,
        key,
        String(value)
      ]);
    }
  }
}

/**
 * Get existing transcript blocks from a page (new v2.0 format)
 * Recursively collects all blocks including nested children
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Array>} Array of block objects with properties
 */
export async function getTranscriptBlocks(book, page, host, token = '') {
  const pageName = formatPageName(book, page);
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
  
  if (!blocks || blocks.length === 0) {
    return [];
  }
  
  // Find "Transcribed Content" section (with or without #Display_No_Properties tag)
  const contentBlock = blocks.find(b => 
    b.content && b.content.includes('## Transcribed Content')
  );
  
  if (!contentBlock || !contentBlock.children) {
    return [];
  }
  
  // Recursively collect all blocks from the tree
  function collectBlocks(block, depth = 0) {
    const result = [];
    
    // Add current block
    result.push({
      uuid: block.uuid,
      content: block.content,
      properties: block.properties || {},
      children: block.children || [],
      depth // Track depth for debugging
    });
    
    // Recursively add children
    if (block.children && block.children.length > 0) {
      for (const child of block.children) {
        result.push(...collectBlocks(child, depth + 1));
      }
    }
    
    return result;
  }
  
  // Collect all blocks from all top-level children
  const allBlocks = [];
  for (const child of contentBlock.children) {
    allBlocks.push(...collectBlocks(child));
  }
  
  return allBlocks;
}

/**
 * Reconstruct line objects from LogSeq transcript blocks
 * Used by the transcription editor modal
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<Array>} Array of line objects compatible with editor
 */
export async function getTranscriptLines(book, page, host, token = '') {
  const blocks = await getTranscriptBlocks(book, page, host, token);
  
  console.log(`[getTranscriptLines] Found ${blocks.length} transcript blocks for B${book}/P${page}`);
  blocks.forEach((b, i) => {
    if (i < 5) { // Log first 5 blocks
      console.log(`  Block ${i}: depth=${b.depth}, content=${b.content?.substring(0, 40)}...`);
    }
  });
  if (blocks.length > 5) {
    console.log(`  ... and ${blocks.length - 5} more blocks`);
  }
  
  if (blocks.length === 0) {
    // Check if page has old v1.0 format (code block)
    const pageName = formatPageName(book, page);
    const allBlocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    console.log(`[getTranscriptLines] Checking for old format, found ${allBlocks?.length || 0} total blocks`);
    
    if (allBlocks && allBlocks.length > 0) {
      // Check for old "Transcribed Text" section
      const oldSection = allBlocks.find(b => 
        b.content && b.content.includes('## Transcribed Text')
      );
      
      if (oldSection) {
        throw new Error(
          'This page uses the old transcription format (v1.0 code block). ' +
          'Please re-transcribe the page to use the new format, then you can edit the structure.'
        );
      }
    }
    
    return [];
  }
  
  // Convert blocks back to line format
  const lines = blocks.map((block, index) => {
    const yBounds = parseYBounds(block.properties['stroke-y-bounds'] || '0-0');
    
    console.log(`[getTranscriptLines] Block ${index}:`, {
      rawContent: block.content?.substring(0, 50) + '...',
      hasProperties: !!block.properties,
      propertyKeys: Object.keys(block.properties || {}),
      depth: block.depth || 0 // Show nesting level
    });
    
    // Extract text from block content
    let text = block.content || '';
    
    // Remove leading dash (LogSeq block marker)
    text = text.replace(/^-\s*/, '');
    
    // Filter out property lines (stroke-y-bounds::, etc.)
    text = filterTranscriptionProperties(text);
    
    // Remove TODO/DONE markers
    text = text.replace(/^(TODO|DONE|LATER|NOW|DOING|WAITING)\s+/, '');
    
    // Use the block's depth from LogSeq tree structure for indentation
    // This preserves the actual hierarchy from LogSeq
    const indentLevel = block.depth || 0;
    
    return {
      text: text.trim(),
      canonical: normalizeTranscript(text.trim()),  // Generate canonical on the fly
      yBounds,
      indentLevel,
      blockUuid: block.uuid,
      syncStatus: 'synced'
    };
  });
  
  console.log(`[getTranscriptLines] Returning ${lines.length} lines`);
  return lines;
}

/**
 * Merge existing LogSeq transcript lines with new MyScript transcription lines
 * Deduplicates by canonical text + Y-bounds overlap to avoid showing the same
 * content twice when a page has both existing blocks and fresh transcription.
 *
 * @param {Array} existingLines - Lines from LogSeq (with blockUuid, syncStatus='synced')
 * @param {Array} newLines - Lines from MyScript (no blockUuid, syncStatus undefined)
 * @returns {Array} Merged lines sorted by Y position (top-to-bottom)
 */
export function mergeExistingAndNewLines(existingLines, newLines) {
  if (!existingLines || existingLines.length === 0) {
    // No existing lines — return new lines as-is with syncStatus
    return (newLines || []).map(line => ({
      ...line,
      syncStatus: line.syncStatus || 'new'
    }));
  }

  if (!newLines || newLines.length === 0) {
    // No new lines — return existing as-is
    return existingLines;
  }

  // Mark new lines with syncStatus
  const markedNewLines = newLines.map(line => ({
    ...line,
    syncStatus: line.syncStatus || 'new'
  }));

  // Deduplicate: skip new lines that match an existing line
  // Match criteria: similar canonical text AND overlapping Y-bounds
  const filteredNewLines = markedNewLines.filter(newLine => {
    const newCanonical = (newLine.canonical || newLine.text || '').trim().toLowerCase();
    const newBounds = newLine.yBounds || { minY: 0, maxY: 0 };

    for (const existingLine of existingLines) {
      const existingCanonical = (existingLine.canonical || existingLine.text || '').trim().toLowerCase();

      // Check canonical text similarity
      if (existingCanonical === newCanonical) {
        // Exact match — skip this new line
        console.log(`[mergeLines] Skipping duplicate: "${newCanonical.substring(0, 30)}..."`);
        return false;
      }

      // Check Y-bounds overlap for lines with similar content
      const existingBounds = existingLine.yBounds || { minY: 0, maxY: 0 };
      const yOverlap = !(newBounds.maxY < existingBounds.minY || existingBounds.maxY < newBounds.minY);

      if (yOverlap && existingCanonical.includes(newCanonical)) {
        // Existing line contains the new line's text and overlaps in Y — skip
        console.log(`[mergeLines] Skipping subset line: "${newCanonical.substring(0, 30)}..."`);
        return false;
      }
    }

    return true; // Keep this new line
  });

  console.log(`[mergeLines] ${existingLines.length} existing + ${filteredNewLines.length} new (${markedNewLines.length - filteredNewLines.length} duplicates removed)`);

  // Combine and sort by Y position (top to bottom on the page)
  const combined = [...existingLines, ...filteredNewLines];
  combined.sort((a, b) => {
    const aY = a.yBounds?.minY || 0;
    const bY = b.yBounds?.minY || 0;
    return aY - bY;
  });

  return combined;
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
 * Get existing transcription text from LogSeq page
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @returns {Promise<string|null>} Existing transcription text or null
 */
async function getExistingTranscription(book, page, host, token = '') {
  try {
    const pageName = formatPageName(book, page);
    const pageObj = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
    
    if (!pageObj) return null;
    
    // Get page blocks
    const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
    
    if (!blocks || blocks.length === 0) return null;
    
    // Find "Transcribed Text" section
    for (const block of blocks) {
      if (block.content && block.content.includes('## Transcribed Text')) {
        // Check if we have child blocks
        if (!block.children || block.children.length === 0) {
          return null;
        }
        
        // Extract text from code block
        let childContent = block.children[0].content;
        if (childContent) {
          // LogSeq may include the block dash prefix in content - strip it
          childContent = childContent.replace(/^-\s+/, '');
          
          // Remove code block markers
          const match = childContent.match(/```\n([\s\S]*)\n```/);
          if (match) {
            return match[1].trim();
          }
          return childContent.trim();
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get existing transcription:', error);
    return null;
  }
}

/**
 * Compute actual changes for a page (for confirmation dialog)
 * Compares active strokes and transcription against what's in LogSeq
 *
 * CRITICAL (v3.1): Deletions are counted from explicit deletedStrokeIds only,
 * not inferred from count differences. This prevents phantom deletion warnings
 * when only a partial set of strokes is loaded.
 *
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Array} activeStrokes - Current active strokes (excluding deleted)
 * @param {Object|null} transcription - Current transcription result (optional)
 * @param {string} host - LogSeq API host
 * @param {string} token - Optional auth token
 * @param {Set<string>} deletedStrokeIds - Stroke IDs explicitly marked for deletion
 * @returns {Promise<Object>} { strokeAdditions, strokeDeletions, strokeTotal, hasNewTranscription, transcriptionChanged }
 */
export async function computePageChanges(book, page, activeStrokes, transcription, host, token = '', deletedStrokeIds = new Set()) {
  try {
    const existingData = await getPageStrokes(book, page, host, token);

    let strokeAdditions = 0;
    let strokeDeletions = 0;
    // Total is existing strokes + new additions - explicit deletions
    let strokeTotal = activeStrokes.length;

    if (!existingData || !existingData.strokes) {
      // No existing data - all strokes are additions
      strokeAdditions = activeStrokes.length;
      strokeDeletions = 0;
    } else {
      // Convert to storage format for comparison
      const simplifiedStrokes = convertToStorageFormat(activeStrokes);

      // Find new strokes (ones in canvas but not in LogSeq)
      const uniqueStrokes = deduplicateStrokes(existingData.strokes, simplifiedStrokes);
      strokeAdditions = uniqueStrokes.length;

      // v3.1: Count only explicitly deleted strokes that actually exist in LogSeq
      if (deletedStrokeIds.size > 0) {
        const existingIds = new Set(existingData.strokes.map(s => s.id));
        strokeDeletions = [...deletedStrokeIds].filter(id => existingIds.has(id)).length;
      }

      // Total after save = existing - deletions + additions
      strokeTotal = existingData.strokes.length - strokeDeletions + strokeAdditions;
    }
    
    // Check transcription changes
    let hasNewTranscription = false;
    let transcriptionChanged = false;
    
    if (transcription && transcription.text) {
      // Format the new transcription
      const newTranscriptionText = formatTranscribedText(transcription.lines || []);
      
      // Get existing transcription
      const existingTranscription = await getExistingTranscription(book, page, host, token);
      
      if (!existingTranscription) {
        // No existing transcription - this is new
        hasNewTranscription = true;
      } else if (existingTranscription !== newTranscriptionText) {
        // Transcription exists but has changed
        transcriptionChanged = true;
      }
    }
    
    return {
      strokeAdditions,
      strokeDeletions,
      strokeTotal,
      hasNewTranscription,
      transcriptionChanged
    };
  } catch (error) {
    console.error(`Failed to compute changes for B${book}/P${page}:`, error);
    // Return conservative estimate
    return {
      strokeAdditions: activeStrokes.length,
      strokeDeletions: 0,
      strokeTotal: activeStrokes.length,
      hasNewTranscription: transcription && transcription.text ? true : false,
      transcriptionChanged: false
    };
  }
}
