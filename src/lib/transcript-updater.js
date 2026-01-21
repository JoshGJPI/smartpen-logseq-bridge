/**
 * Transcript Block Updater (v2.0)
 * Orchestrates incremental updates to LogSeq transcript blocks
 * 
 * Key features:
 * - Checkbox preservation: User edits never lost
 * - Canonical comparison: Detects actual changes vs user edits
 * - Property-based storage: stroke-y-bounds + canonical-transcript
 */

import {
  getTranscriptBlocks,
  createTranscriptBlockWithProperties,
  updateTranscriptBlockWithPreservation,
  getOrCreateSmartpenPage
} from './logseq-api.js';

// Import makeRequest for internal use
import { makeRequest } from './logseq-api.js';

/**
 * Check if two Y-bounds overlap
 */
function boundsOverlap(bounds1, bounds2) {
  return !(bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
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
 * Calculate Y-bounds for a line from strokes
 * @param {Object} line - Line object with strokeIds
 * @param {Array} strokes - Array of all strokes
 * @returns {Object} { minY, maxY }
 */
function calculateLineBounds(line, strokes) {
  if (!line.yBounds) {
    // If yBounds not precomputed, calculate from strokes
    if (!line.strokeIds || line.strokeIds.size === 0) {
      return { minY: 0, maxY: 0 };
    }
    
    let minY = Infinity;
    let maxY = -Infinity;
    
    for (const strokeId of line.strokeIds) {
      const stroke = strokes.find(s => s.strokeId === strokeId);
      if (!stroke || !stroke.dotArray) continue;
      
      for (const dot of stroke.dotArray) {
        if (dot.y < minY) minY = dot.y;
        if (dot.y > maxY) maxY = dot.y;
      }
    }
    
    if (minY === Infinity || maxY === -Infinity) {
      return { minY: 0, maxY: 0 };
    }
    
    return { minY, maxY };
  }
  
  return line.yBounds;
}

/**
 * Determine parent UUID for a line based on indentation
 * @param {Object} line - Line object
 * @param {Array} existingBlocks - Array of existing blocks
 * @param {Map} lineToBlockMap - Map of line index to block UUID
 * @returns {string|null} Parent block UUID or null for top-level
 */
function determineParentUuid(line, existingBlocks, lineToBlockMap) {
  // If line has a parent line reference, use that
  if (line.parent !== null && typeof line.parent === 'number') {
    const parentBlockUuid = lineToBlockMap.get(line.parent);
    if (parentBlockUuid) {
      return parentBlockUuid;
    }
  }
  
  // Otherwise, find parent by indentation level from existing blocks
  // This is a fallback for when we don't have parent references
  const indent = line.indentLevel || 0;
  
  if (indent === 0) {
    // Top-level block - find the "Transcribed Content" section parent
    return null; // Will be handled by the caller
  }
  
  // Find the nearest block with lower indent
  // Existing blocks should be in order, so search backwards
  for (let i = existingBlocks.length - 1; i >= 0; i--) {
    // We would need to track indent levels of existing blocks
    // For now, return null (top-level)
    // TODO: Enhance this logic when hierarchy is needed
  }
  
  return null;
}

/**
 * Handle merge conflict when multiple blocks overlap with new line
 * @param {Object} action - Action object with blocks, line, etc.
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Resolution result
 */
async function handleMergeConflict(action, host, token) {
  // For now, merge into first block
  // Future: show UI dialog for user decision
  const firstBlock = action.blocks[0];
  
  await updateTranscriptBlockWithPreservation(
    firstBlock.uuid,
    action.line,
    firstBlock.content,
    host,
    token
  );
  
  return { blockUuid: firstBlock.uuid, strategy: 'merge-first' };
}

/**
 * Detect what action to take for each transcription line
 * @param {Array} existingBlocks - Existing transcript blocks from LogSeq
 * @param {Array} newLines - New transcription lines
 * @param {Array} strokes - All strokes for Y-bounds calculation
 * @returns {Promise<Array>} Array of action objects
 */
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  
  for (const line of newLines) {
    const lineBounds = calculateLineBounds(line, strokes);
    const newCanonical = line.canonical;
    
    if (!newCanonical) {
      console.warn('Line missing canonical field:', line);
      continue;
    }
    
    // Find overlapping blocks
    const overlapping = existingBlocks.filter(block => {
      const blockBounds = parseYBounds(block.properties['stroke-y-bounds'] || '0-0');
      return boundsOverlap(blockBounds, lineBounds);
    });
    
    if (overlapping.length === 0) {
      // No overlap → new block
      actions.push({
        type: 'CREATE',
        line,
        bounds: lineBounds,
        canonical: newCanonical,
        parentUuid: null // Will be determined later based on line.parent
      });
      
    } else if (overlapping.length === 1) {
      // Single overlap → check if transcript actually changed
      const block = overlapping[0];
      const storedCanonical = block.properties['canonical-transcript'] || '';
      
      if (storedCanonical === newCanonical) {
        // Transcript unchanged → preserve ALL user edits
        actions.push({
          type: 'SKIP',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid,
          line
        });
      } else {
        // Transcript changed → update needed
        actions.push({
          type: 'UPDATE',
          blockUuid: block.uuid,
          line,
          bounds: lineBounds,
          canonical: newCanonical,
          oldContent: block.content
        });
      }
      
    } else {
      // Multiple overlaps → conflict
      actions.push({
        type: 'MERGE_CONFLICT',
        blocks: overlapping,
        line,
        bounds: lineBounds,
        canonical: newCanonical
      });
    }
  }
  
  return actions;
}

/**
 * Get or create the "Transcribed Content" section parent block
 * @param {string} pageName - Page name
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<string>} Parent block UUID
 */
async function getOrCreateTranscriptSection(pageName, host, token) {
  const blocks = await makeRequest(host, token, 'logseq.Editor.getPageBlocksTree', [pageName]);
  
  // Find existing section
  if (blocks && blocks.length > 0) {
    for (const block of blocks) {
      if (block.content && block.content.includes('## Transcribed Content')) {
        return block.uuid;
      }
    }
  }
  
  // Create new section with Display_No_Properties tag to hide properties by default
  const sectionBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
    pageName,
    '## Transcribed Content #Display_No_Properties',
    {}
  ]);
  
  return sectionBlock.uuid;
}

/**
 * Main orchestrator for transcript block updates
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {Array} strokes - All strokes (for Y-bounds calculation)
 * @param {Object} newTranscription - New transcription result from MyScript
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Update result with stats
 */
export async function updateTranscriptBlocks(book, page, strokes, newTranscription, host, token = '') {
  try {
    // Ensure page exists
    const pageObj = await getOrCreateSmartpenPage(book, page, host, token);
    const pageName = pageObj.name || pageObj.originalName;
    
    // Get existing transcript blocks
    const existingBlocks = await getTranscriptBlocks(book, page, host, token);
    
    console.log(`Found ${existingBlocks.length} existing transcript blocks`);
    
    // Detect actions for each new line
    const actions = await detectBlockActions(existingBlocks, newTranscription.lines, strokes);
    
    console.log('Detected actions:', {
      create: actions.filter(a => a.type === 'CREATE').length,
      update: actions.filter(a => a.type === 'UPDATE').length,
      skip: actions.filter(a => a.type === 'SKIP').length,
      conflict: actions.filter(a => a.type === 'MERGE_CONFLICT').length
    });
    
    // Execute actions
    const results = [];
    const lineToBlockMap = new Map(); // Track line index to block UUID mapping
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      
      try {
        switch (action.type) {
          case 'CREATE': {
            // Determine parent UUID
            let parentUuid = action.parentUuid;
            if (!parentUuid) {
              parentUuid = determineParentUuid(action.line, existingBlocks, lineToBlockMap);
            }
            
            // If still no parent, this is top-level - use "Transcribed Content" section
            if (!parentUuid) {
              parentUuid = await getOrCreateTranscriptSection(pageName, host, token);
            }
            
            const newBlock = await createTranscriptBlockWithProperties(
              parentUuid,
              action.line,
              host,
              token
            );
            
            lineToBlockMap.set(i, newBlock.uuid);
            results.push({ type: 'created', uuid: newBlock.uuid, lineIndex: i });
            break;
          }
          
          case 'UPDATE': {
            await updateTranscriptBlockWithPreservation(
              action.blockUuid,
              action.line,
              action.oldContent,
              host,
              token
            );
            
            lineToBlockMap.set(i, action.blockUuid);
            results.push({ type: 'updated', uuid: action.blockUuid, lineIndex: i });
            break;
          }
          
          case 'SKIP': {
            lineToBlockMap.set(i, action.blockUuid);
            results.push({ 
              type: 'skipped', 
              uuid: action.blockUuid, 
              reason: action.reason,
              lineIndex: i 
            });
            break;
          }
          
          case 'MERGE_CONFLICT': {
            const resolution = await handleMergeConflict(action, host, token);
            lineToBlockMap.set(i, resolution.blockUuid);
            results.push({ 
              type: 'merged', 
              uuid: resolution.blockUuid,
              strategy: resolution.strategy,
              lineIndex: i
            });
            break;
          }
        }
      } catch (error) {
        console.error(`Failed to execute action for line ${i}:`, error);
        results.push({ 
          type: 'error', 
          action: action.type, 
          error: error.message,
          lineIndex: i
        });
      }
    }
    
    return {
      success: true,
      page: pageName,
      results,
      stats: {
        created: results.filter(r => r.type === 'created').length,
        updated: results.filter(r => r.type === 'updated').length,
        skipped: results.filter(r => r.type === 'skipped').length,
        merged: results.filter(r => r.type === 'merged').length,
        errors: results.filter(r => r.type === 'error').length
      }
    };
    
  } catch (error) {
    console.error('Failed to update transcript blocks:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        created: 0,
        updated: 0,
        skipped: 0,
        merged: 0,
        errors: 0
      }
    };
  }
}
