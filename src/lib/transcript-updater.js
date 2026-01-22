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
 * @param {Object} action - Action object with block, overlappingLines, etc.
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Promise<Object>} Resolution result
 */
async function handleMergeConflict(action, host, token) {
  // The new structure has: { type, block, overlappingLines, blockBounds }
  // For now, update the existing block with combined text from overlapping lines
  
  if (!action.overlappingLines || action.overlappingLines.length === 0) {
    console.error('Merge conflict with no overlapping lines:', action);
    throw new Error('Invalid merge conflict: no overlapping lines');
  }
  
  // Combine all overlapping lines
  const combinedText = action.overlappingLines.map(ol => ol.line.text).join(' ');
  const combinedCanonical = action.overlappingLines.map(ol => ol.line.canonical).join(' ');
  const newMinY = Math.min(...action.overlappingLines.map(ol => ol.bounds.minY));
  const newMaxY = Math.max(...action.overlappingLines.map(ol => ol.bounds.maxY));
  
  const combinedLine = {
    text: combinedText,
    canonical: combinedCanonical,
    yBounds: { minY: newMinY, maxY: newMaxY },
    mergedLineCount: action.overlappingLines.length,
    indentLevel: action.overlappingLines[0].line.indentLevel || 0
  };
  
  await updateTranscriptBlockWithPreservation(
    action.block.uuid,
    combinedLine,
    action.block.content,
    host,
    token
  );
  
  return { blockUuid: action.block.uuid, strategy: 'merge-all-to-existing' };
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
  const consumedLineIndices = new Set(); // Track which lines have been processed
  
  // First pass: Handle merged blocks
  for (const block of existingBlocks) {
    const blockBounds = parseYBounds(block.properties['stroke-y-bounds'] || '0-0');
    const mergedCount = parseInt(block.properties['merged-lines']) || 1;
    
    // Find all new lines that overlap with this block
    const overlappingLines = [];
    newLines.forEach((line, index) => {
      if (consumedLineIndices.has(index)) return; // Already processed
      
      const lineBounds = calculateLineBounds(line, strokes);
      if (boundsOverlap(blockBounds, lineBounds)) {
        overlappingLines.push({ line, index, bounds: lineBounds });
      }
    });
    
    if (overlappingLines.length === 0) {
      // No overlapping lines - block was deleted (strokes removed)
      // For now, we'll leave it (don't delete blocks automatically)
      continue;
    }
    
    if (mergedCount > 1 && overlappingLines.length > 0) {
      // This is a merged block - combine overlapping lines and compare
      const combinedText = overlappingLines.map(ol => ol.line.text).join(' ');
      const combinedCanonical = overlappingLines.map(ol => ol.line.canonical).join(' ');
      const storedCanonical = block.properties['canonical-transcript'] || '';
      
      // Validate: expected count should roughly match actual count
      if (Math.abs(mergedCount - overlappingLines.length) > 1) {
        console.warn(`Merged block count mismatch: expected ${mergedCount}, found ${overlappingLines.length}`);
      }
      
      if (combinedCanonical === storedCanonical) {
        // Canonical match - preserve merged block with all user edits
        actions.push({
          type: 'SKIP_MERGED',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid,
          mergedCount,
          consumedLines: overlappingLines.map(ol => ol.index)
        });
        
        // Mark these lines as consumed
        overlappingLines.forEach(ol => consumedLineIndices.add(ol.index));
      } else {
        // Canonical changed - update the merged block
        const newMinY = Math.min(...overlappingLines.map(ol => ol.bounds.minY));
        const newMaxY = Math.max(...overlappingLines.map(ol => ol.bounds.maxY));
        
        actions.push({
          type: 'UPDATE_MERGED',
          blockUuid: block.uuid,
          line: {
            text: combinedText,
            canonical: combinedCanonical,
            yBounds: { minY: newMinY, maxY: newMaxY },
            mergedLineCount: overlappingLines.length,
            indentLevel: overlappingLines[0].line.indentLevel || 0
          },
          oldContent: block.content,
          consumedLines: overlappingLines.map(ol => ol.index)
        });
        
        // Mark these lines as consumed
        overlappingLines.forEach(ol => consumedLineIndices.add(ol.index));
      }
    } else if (overlappingLines.length === 1) {
      // Single line block - standard handling
      const { line, index, bounds } = overlappingLines[0];
      const storedCanonical = block.properties['canonical-transcript'] || '';
      
      if (line.canonical === storedCanonical) {
        actions.push({
          type: 'SKIP',
          reason: 'canonical-unchanged',
          blockUuid: block.uuid,
          line
        });
      } else {
        actions.push({
          type: 'UPDATE',
          blockUuid: block.uuid,
          line,
          bounds,
          canonical: line.canonical,
          oldContent: block.content
        });
      }
      
      consumedLineIndices.add(index);
    } else {
      // Multiple overlaps but not marked as merged - conflict
      actions.push({
        type: 'MERGE_CONFLICT',
        block,
        overlappingLines,
        blockBounds
      });
      
      // Mark these lines as consumed
      overlappingLines.forEach(ol => consumedLineIndices.add(ol.index));
    }
  }
  
  // Second pass: Create blocks for unconsumed lines (new content)
  newLines.forEach((line, index) => {
    if (consumedLineIndices.has(index)) return;
    
    const lineBounds = calculateLineBounds(line, strokes);
    actions.push({
      type: 'CREATE',
      line,
      bounds: lineBounds,
      canonical: line.canonical,
      parentUuid: null // Will be determined later based on line.parent
    });
  });
  
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
    
    // Track which existing blocks were matched/used
    const usedBlockUuids = new Set();
    
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
            
            usedBlockUuids.add(action.blockUuid);
            lineToBlockMap.set(i, action.blockUuid);
            results.push({ type: 'updated', uuid: action.blockUuid, lineIndex: i });
            break;
          }
          
          case 'UPDATE_MERGED': {
            await updateTranscriptBlockWithPreservation(
              action.blockUuid,
              action.line,
              action.oldContent,
              host,
              token
            );
            
            usedBlockUuids.add(action.blockUuid);
            // Update mapping for all consumed lines
            action.consumedLines.forEach(lineIdx => {
              lineToBlockMap.set(lineIdx, action.blockUuid);
            });
            
            results.push({ 
              type: 'updated-merged', 
              uuid: action.blockUuid, 
              mergedCount: action.line.mergedLineCount,
              consumedLines: action.consumedLines
            });
            break;
          }
          
          case 'SKIP': {
            usedBlockUuids.add(action.blockUuid);
            lineToBlockMap.set(i, action.blockUuid);
            results.push({ 
              type: 'skipped', 
              uuid: action.blockUuid, 
              reason: action.reason,
              lineIndex: i 
            });
            break;
          }
          
          case 'SKIP_MERGED': {
            usedBlockUuids.add(action.blockUuid);
            // Update mapping for all consumed lines
            action.consumedLines.forEach(lineIdx => {
              lineToBlockMap.set(lineIdx, action.blockUuid);
            });
            
            results.push({ 
              type: 'skipped-merged', 
              uuid: action.blockUuid, 
              reason: action.reason,
              mergedCount: action.mergedCount,
              consumedLines: action.consumedLines
            });
            break;
          }
          
          case 'MERGE_CONFLICT': {
            const resolution = await handleMergeConflict(action, host, token);
            usedBlockUuids.add(resolution.blockUuid);
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
    
    // Delete orphaned blocks (blocks that weren't used/matched)
    const orphanedBlocks = existingBlocks.filter(b => !usedBlockUuids.has(b.uuid));
    
    if (orphanedBlocks.length > 0) {
      console.log(`Deleting ${orphanedBlocks.length} orphaned blocks (no longer have matching strokes)`);
      
      for (const block of orphanedBlocks) {
        try {
          await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
          results.push({ 
            type: 'deleted', 
            uuid: block.uuid, 
            reason: 'orphaned'
          });
        } catch (error) {
          console.error(`Failed to delete orphaned block ${block.uuid}:`, error);
          results.push({ 
            type: 'error', 
            action: 'DELETE', 
            error: error.message,
            uuid: block.uuid
          });
        }
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
        deleted: results.filter(r => r.type === 'deleted').length,
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
        deleted: 0,
        errors: 0
      }
    };
  }
}
