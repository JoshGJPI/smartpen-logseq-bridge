/**
 * Transcript Block Updater (v2.1 - Stroke → Block Persistence)
 * Orchestrates incremental updates to LogSeq transcript blocks
 * 
 * Key features:
 * - Checkbox preservation: User edits never lost
 * - Canonical comparison: Detects actual changes vs user edits
 * - Property-based storage: stroke-y-bounds + canonical-transcript
 * - Stroke→Block persistence: blockUuid stored on strokes for incremental updates
 */

import {
  getTranscriptBlocks,
  createTranscriptBlockWithProperties,
  updateTranscriptBlockWithPreservation,
  getOrCreateSmartpenPage,
  updatePageStrokes
} from './logseq-api.js';

import {
  updateStrokeBlockUuids,
  getStrokesSnapshot
} from '../stores/strokes.js';

// Import makeRequest for internal use
import { makeRequest } from './logseq-api.js';

/**
 * Check if two Y-bounds overlap
 */
function boundsOverlap(bounds1, bounds2) {
  return !(bounds1.maxY < bounds2.minY || bounds2.maxY < bounds1.minY);
}

/**
 * Estimate which strokes belong to a transcription line
 * Uses Y-bounds overlap between stroke dots and line bounding box
 * 
 * @param {Object} line - Transcription line with yBounds
 * @param {Array} strokes - All strokes from the page
 * @param {number} tolerance - Y-tolerance for overlap detection (default 5 units)
 * @returns {Set<string>} Set of stroke timestamps (as strings)
 */
function estimateLineStrokeIds(line, strokes, tolerance = 5) {
  const strokeIds = new Set();
  
  if (!line.yBounds || !strokes || strokes.length === 0) {
    return strokeIds;
  }
  
  const lineMinY = line.yBounds.minY - tolerance;
  const lineMaxY = line.yBounds.maxY + tolerance;
  
  for (const stroke of strokes) {
    if (!stroke.dotArray || stroke.dotArray.length === 0) continue;
    
    // Check if any dot in the stroke falls within line's Y-bounds
    const strokeIntersects = stroke.dotArray.some(dot => 
      dot.y >= lineMinY && dot.y <= lineMaxY
    );
    
    if (strokeIntersects) {
      strokeIds.add(String(stroke.startTime));
    }
  }
  
  return strokeIds;
}

/**
 * Parse stroke IDs from block property string
 * @param {string} strokeIdsStr - Comma-separated stroke timestamps
 * @returns {Set<string>} Set of stroke ID strings
 */
function parseStrokeIds(strokeIdsStr) {
  if (!strokeIdsStr || typeof strokeIdsStr !== 'string') {
    return new Set();
  }
  return new Set(strokeIdsStr.split(',').map(id => id.trim()).filter(Boolean));
}

/**
 * Check if two stroke ID sets have any overlap
 * @param {Set<string>} set1 
 * @param {Set<string>} set2 
 * @returns {boolean}
 */
function strokeSetsOverlap(set1, set2) {
  if (!set1 || !set2 || set1.size === 0 || set2.size === 0) {
    return false;
  }
  for (const id of set1) {
    if (set2.has(id)) return true;
  }
  return false;
}

/**
 * Merge stroke ID sets (for merged lines)
 * @param {Set<string>} set1 
 * @param {Set<string>} set2 
 * @returns {Set<string>}
 */
function mergeStrokeSets(set1, set2) {
  const merged = new Set(set1 || []);
  if (set2) {
    set2.forEach(id => merged.add(id));
  }
  return merged;
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
/**
 * Determine parent UUID for a line based on indentation and lineToBlockMap
 * CRITICAL: This uses lineToBlockMap which is built level-by-level,
 * ensuring parent blocks exist before children are created
 * @param {Object} line - Line object with indentLevel
 * @param {Array} existingBlocks - Array of existing blocks (not used anymore)
 * @param {Map} lineToBlockMap - Map of line index to block UUID (built progressively)
 * @param {number} currentLineIndex - Current line index in the lines array
 * @returns {string|null} Parent block UUID or null for top-level
 */
function determineParentUuid(line, existingBlocks, lineToBlockMap, currentLineIndex) {
  const indent = line.indentLevel || 0;

  // Top-level block (indent 0) - no parent needed
  if (indent === 0) {
    return null; // Will use "Transcribed Content" section
  }

  // If line has explicit parent line reference from MyScript, use that
  if (line.parent !== null && typeof line.parent === 'number') {
    const parentBlockUuid = lineToBlockMap.get(line.parent);
    if (parentBlockUuid) {
      console.log(`Line ${currentLineIndex} (indent ${indent}): Using explicit parent line ${line.parent} → ${parentBlockUuid.substring(0, 8)}...`);
      return parentBlockUuid;
    }
  }

  // Find nearest preceding line with lower indent level
  // Search backwards through lineToBlockMap for a suitable parent
  for (let i = currentLineIndex - 1; i >= 0; i--) {
    const potentialParentUuid = lineToBlockMap.get(i);
    if (!potentialParentUuid) continue;

    // Need to check indent level of this line
    // We'll need to pass the full lines array to do this properly
    // For now, assume any previously created block at lower level is suitable
    // This is a simplification - ideally we'd track indent levels
    console.log(`Line ${currentLineIndex} (indent ${indent}): Using preceding block at line ${i} → ${potentialParentUuid.substring(0, 8)}...`);
    return potentialParentUuid;
  }

  // Fallback: if no suitable parent found, this is top-level
  console.log(`Line ${currentLineIndex} (indent ${indent}): No parent found, using top-level`);
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
 * Uses STROKE ID MATCHING as primary strategy, Y-bounds as fallback
 * 
 * @param {Array} existingBlocks - Existing transcript blocks from LogSeq
 * @param {Array} newLines - New transcription lines (with strokeIds)
 * @param {Array} strokes - All strokes for reference
 * @returns {Promise<Array>} Array of action objects
 */
async function detectBlockActions(existingBlocks, newLines, strokes) {
  const actions = [];
  const consumedLineIndices = new Set();
  const usedBlockUuids = new Set();
  
  // Build stroke timestamp set for existence checks
  const currentStrokeTimestamps = new Set(strokes.map(s => String(s.startTime)));
  
  console.log('=== Block Matching Debug ===');
  console.log(`Existing blocks: ${existingBlocks.length}`);
  console.log(`New lines: ${newLines.length}`);
  console.log(`Current strokes: ${currentStrokeTimestamps.size}`);
  
  // STRATEGY 1: Match blocks by stroke ID overlap (preferred)
  for (const block of existingBlocks) {
    const blockStrokeIds = parseStrokeIds(block.properties?.['stroke-ids']);
    const blockBounds = parseYBounds(block.properties?.['stroke-y-bounds'] || '0-0');
    const mergedCount = parseInt(block.properties?.['merged-lines']) || 1;
    const storedCanonical = block.properties?.['canonical-transcript'] || '';
    
    console.log(`\nChecking block ${block.uuid.substring(0, 8)}...`);
    console.log(`  Stroke IDs: ${blockStrokeIds.size}, Y-bounds: ${block.properties?.['stroke-y-bounds']}`);
    
    // Find lines with overlapping stroke IDs
    let overlappingLines = [];
    
    if (blockStrokeIds.size > 0) {
      // Primary: Match by stroke IDs
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        if (line.strokeIds && strokeSetsOverlap(blockStrokeIds, line.strokeIds)) {
          const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
          overlappingLines.push({ line, index, bounds: lineBounds });
          console.log(`  → Matched line ${index} by stroke IDs: "${line.text.substring(0, 30)}..."`);
        }
      });
    }
    
    // Fallback: If no stroke ID matches AND block has no stroke IDs, try Y-bounds
    if (overlappingLines.length === 0 && blockStrokeIds.size === 0) {
      console.log(`  No stroke IDs - falling back to Y-bounds matching`);
      newLines.forEach((line, index) => {
        if (consumedLineIndices.has(index)) return;
        
        const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
        if (boundsOverlap(blockBounds, lineBounds)) {
          overlappingLines.push({ line, index, bounds: lineBounds });
          console.log(`  → Matched line ${index} by Y-bounds: "${line.text.substring(0, 30)}..."`);
        }
      });
    }
    
    // Process matches
    if (overlappingLines.length === 0) {
      // No matches - check if block's strokes still exist on canvas
      const strokesExist = blockStrokeIds.size > 0 && 
        [...blockStrokeIds].some(id => currentStrokeTimestamps.has(id));
      
      if (strokesExist || blockStrokeIds.size === 0) {
        // Strokes exist OR no stroke IDs to verify - PRESERVE
        console.log(`  → PRESERVE (${strokesExist ? 'strokes exist' : 'no stroke IDs'})`);
        actions.push({
          type: 'PRESERVE',
          reason: strokesExist ? 'strokes-exist-no-new-lines' : 'no-stroke-ids',
          blockUuid: block.uuid
        });
        usedBlockUuids.add(block.uuid);
      } else {
        console.log(`  → Will be deleted (strokes removed from canvas)`);
      }
      continue;
    }
    
    // Handle matched lines
    // Combine all overlapping lines for comparison
    const combinedCanonical = overlappingLines.map(ol => ol.line.canonical).join(' ');
    const combinedStrokeIds = new Set();
    overlappingLines.forEach(ol => {
      if (ol.line.strokeIds) {
        ol.line.strokeIds.forEach(id => combinedStrokeIds.add(id));
      }
    });
    
    // Check if canonical text matches
    if (combinedCanonical === storedCanonical) {
      // No change - skip
      console.log(`  → SKIP (canonical unchanged)`);
      actions.push({
        type: overlappingLines.length > 1 ? 'SKIP_MERGED' : 'SKIP',
        reason: 'canonical-unchanged',
        blockUuid: block.uuid,
        mergedCount: overlappingLines.length,
        consumedLines: overlappingLines.map(ol => ol.index)
      });
    } else {
      // Text changed - update
      console.log(`  → UPDATE (canonical changed)`);
      const combinedText = overlappingLines.map(ol => ol.line.text).join(' ');
      const newMinY = Math.min(...overlappingLines.map(ol => ol.bounds.minY));
      const newMaxY = Math.max(...overlappingLines.map(ol => ol.bounds.maxY));
      
      actions.push({
        type: overlappingLines.length > 1 ? 'UPDATE_MERGED' : 'UPDATE',
        blockUuid: block.uuid,
        line: {
          text: combinedText,
          canonical: combinedCanonical,
          yBounds: { minY: newMinY, maxY: newMaxY },
          strokeIds: combinedStrokeIds,
          mergedLineCount: overlappingLines.length,
          indentLevel: overlappingLines[0].line.indentLevel || 0
        },
        oldContent: block.content,
        consumedLines: overlappingLines.map(ol => ol.index)
      });
    }
    
    // Mark lines and block as used
    overlappingLines.forEach(ol => consumedLineIndices.add(ol.index));
    usedBlockUuids.add(block.uuid);
  }
  
  // STRATEGY 2: Create blocks for unconsumed lines (new content)
  newLines.forEach((line, index) => {
    if (consumedLineIndices.has(index)) return;
    
    console.log(`\nNew line ${index}: "${line.text.substring(0, 30)}..." → CREATE`);
    
    const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
    actions.push({
      type: 'CREATE',
      lineIndex: index,  // CRITICAL: Track which line this action corresponds to
      line: {
        ...line,
        yBounds: lineBounds,
        strokeIds: line.strokeIds || new Set()
      },
      bounds: lineBounds,
      canonical: line.canonical,
      parentUuid: null
    });
  });
  
  console.log('\n=== Action Summary ===');
  console.log(`SKIP: ${actions.filter(a => a.type === 'SKIP' || a.type === 'SKIP_MERGED').length}`);
  console.log(`UPDATE: ${actions.filter(a => a.type === 'UPDATE' || a.type === 'UPDATE_MERGED').length}`);
  console.log(`CREATE: ${actions.filter(a => a.type === 'CREATE').length}`);
  console.log(`PRESERVE: ${actions.filter(a => a.type === 'PRESERVE').length}`);
  
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
 * Match strokes to transcription lines using Y-bounds overlap
 * Returns map of stroke startTime → blockUuid
 * @param {Array} strokes - All strokes from the page
 * @param {Array} linesWithBlocks - Lines with yBounds and blockUuid
 * @param {number} tolerance - Y-tolerance for overlap (default 5)
 * @returns {Map<string, string>} Map of stroke startTime → blockUuid
 */
function matchStrokesToLines(strokes, linesWithBlocks, tolerance = 5) {
  const strokeToBlockMap = new Map();

  for (const stroke of strokes) {
    if (!stroke.dotArray || stroke.dotArray.length === 0) continue;

    // CRITICAL FIX: Preserve existing blockUuid associations
    // Only match strokes that don't already have a blockUuid
    if (stroke.blockUuid) {
      strokeToBlockMap.set(String(stroke.startTime), stroke.blockUuid);
      continue; // Skip re-matching - preserve existing association
    }

    // Get stroke's Y range
    const strokeYs = stroke.dotArray.map(d => d.y);
    const strokeMinY = Math.min(...strokeYs);
    const strokeMaxY = Math.max(...strokeYs);

    // Find the line with best Y-bounds overlap
    let bestMatch = null;
    let bestOverlap = 0;

    for (const line of linesWithBlocks) {
      if (!line.yBounds || !line.blockUuid) continue;

      const lineMinY = line.yBounds.minY - tolerance;
      const lineMaxY = line.yBounds.maxY + tolerance;

      // Calculate overlap
      const overlapMin = Math.max(strokeMinY, lineMinY);
      const overlapMax = Math.min(strokeMaxY, lineMaxY);
      const overlap = Math.max(0, overlapMax - overlapMin);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = line;
      }
    }

    if (bestMatch) {
      strokeToBlockMap.set(String(stroke.startTime), bestMatch.blockUuid);
    }
  }

  return strokeToBlockMap;
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

    // CRITICAL FIX: Partition strokes into those with and without blockUuid
    const strokesWithBlockUuid = strokes.filter(s => s.blockUuid);
    const strokesWithoutBlockUuid = strokes.filter(s => !s.blockUuid);

    console.log(`Strokes: ${strokesWithBlockUuid.length} with blockUuid, ${strokesWithoutBlockUuid.length} without`);

    // Estimate stroke IDs for each transcription line
    const linesWithStrokeIds = newTranscription.lines.map(line => {
      const lineBounds = line.yBounds || calculateLineBounds(line, strokes);
      const strokeIds = estimateLineStrokeIds({ yBounds: lineBounds }, strokes);

      return {
        ...line,
        yBounds: lineBounds,
        strokeIds: strokeIds
      };
    });

    // CRITICAL FIX: Filter to only lines containing NEW strokes (without blockUuid)
    // A line is "new" if it contains at least one stroke without blockUuid
    const newLines = linesWithStrokeIds.filter(line => {
      // Check if any stroke in this line lacks blockUuid
      const hasNewStrokes = Array.from(line.strokeIds).some(strokeId => {
        const stroke = strokes.find(s => String(s.startTime) === strokeId);
        return stroke && !stroke.blockUuid;
      });
      return hasNewStrokes;
    });

    console.log(`Filtered to ${newLines.length} lines containing new strokes (out of ${linesWithStrokeIds.length} total lines)`);
    
    console.log('New lines with stroke IDs:', newLines.map(l => ({
      text: l.text.substring(0, 30),
      strokeCount: l.strokeIds.size
    })));

    // If no new lines, nothing to do
    if (newLines.length === 0) {
      console.log('No new strokes to transcribe - all strokes already have blockUuid');
      return {
        success: true,
        message: 'No new strokes to save',
        created: 0,
        updated: 0,
        skipped: existingBlocks.length
      };
    }

    // Detect actions using ONLY NEW lines (those with strokes lacking blockUuid)
    // This ensures existing blocks are never modified
    const actions = await detectBlockActions(existingBlocks, newLines, strokes);
    
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
    const lineIndentLevels = new Map(); // Track line index to indent level

    // Store indent levels for all lines for parent lookups
    for (const action of actions) {
      if (action.lineIndex !== undefined) {
        lineIndentLevels.set(action.lineIndex, action.line?.indentLevel || 0);
      }
    }

    // CRITICAL FIX: Process actions level by level to ensure parents exist before children
    // Group actions by indent level
    const actionsByLevel = new Map();
    let maxLevel = 0;

    for (const action of actions) {
      const level = action.line?.indentLevel || 0;
      maxLevel = Math.max(maxLevel, level);

      if (!actionsByLevel.has(level)) {
        actionsByLevel.set(level, []);
      }
      actionsByLevel.get(level).push(action);
    }

    console.log(`Processing ${actions.length} actions across ${maxLevel + 1} indent levels`);

    // Helper function to find parent UUID by searching for nearest lower indent
    function findParentUuid(currentLineIndex, currentIndent) {
      if (currentIndent === 0) return null;

      // Search backwards for a line with lower indent that has been created
      for (let i = currentLineIndex - 1; i >= 0; i--) {
        const lineIndent = lineIndentLevels.get(i);
        const lineUuid = lineToBlockMap.get(i);

        if (lineIndent !== undefined && lineIndent < currentIndent && lineUuid) {
          console.log(`  → Found parent: line ${i} (indent ${lineIndent}) → ${lineUuid.substring(0, 8)}...`);
          return lineUuid;
        }
      }

      return null;
    }

    // Process level by level, starting from level 0 (top-level)
    for (let level = 0; level <= maxLevel; level++) {
      const levelActions = actionsByLevel.get(level) || [];

      if (levelActions.length === 0) {
        console.log(`Level ${level}: No actions`);
        continue;
      }

      console.log(`Level ${level}: Processing ${levelActions.length} actions`);

      for (const action of levelActions) {
      
      try {
        switch (action.type) {
          case 'CREATE': {
            const lineIdx = action.lineIndex;
            const indent = action.line?.indentLevel || 0;

            console.log(`  Creating line ${lineIdx} (indent ${indent}): "${action.line?.text?.substring(0, 30)}..."`);

            // Determine parent UUID using the new helper function
            let parentUuid = action.parentUuid;

            if (!parentUuid && indent > 0) {
              // Find parent by searching backwards for lower indent
              parentUuid = findParentUuid(lineIdx, indent);
            }

            // If still no parent, this is top-level - use "Transcribed Content" section
            if (!parentUuid) {
              parentUuid = await getOrCreateTranscriptSection(pageName, host, token);
              console.log(`  → Using section parent: ${parentUuid.substring(0, 8)}...`);
            }

            const newBlock = await createTranscriptBlockWithProperties(
              parentUuid,
              action.line,
              host,
              token
            );

            console.log(`  ✓ Created block: ${newBlock.uuid.substring(0, 8)}...`);

            // Track this block in lineToBlockMap for future children
            lineToBlockMap.set(lineIdx, newBlock.uuid);
            results.push({ type: 'created', uuid: newBlock.uuid, lineIndex: lineIdx, indentLevel: indent });
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
            // Use consumedLines to map line indices to block UUID
            if (action.consumedLines && action.consumedLines.length > 0) {
              action.consumedLines.forEach(lineIdx => {
                lineToBlockMap.set(lineIdx, action.blockUuid);
              });
            }
            results.push({ 
              type: 'updated', 
              uuid: action.blockUuid, 
              lineIndex: action.consumedLines?.[0]
            });
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
            // Use consumedLines to map line indices to block UUID
            if (action.consumedLines && action.consumedLines.length > 0) {
              action.consumedLines.forEach(lineIdx => {
                lineToBlockMap.set(lineIdx, action.blockUuid);
              });
            }
            results.push({ 
              type: 'skipped', 
              uuid: action.blockUuid, 
              reason: action.reason,
              lineIndex: action.consumedLines?.[0]
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
          
          case 'PRESERVE': {
            usedBlockUuids.add(action.blockUuid);
            results.push({ 
              type: 'preserved', 
              uuid: action.blockUuid, 
              reason: action.reason
            });
            break;
          }
          
          case 'MERGE_CONFLICT': {
            const resolution = await handleMergeConflict(action, host, token);
            usedBlockUuids.add(resolution.blockUuid);
            // Use the first line from the conflict
            const lineIdx = action.overlappingLines?.[0]?.index;
            if (lineIdx !== undefined) {
              lineToBlockMap.set(lineIdx, resolution.blockUuid);
            }
            results.push({ 
              type: 'merged', 
              uuid: resolution.blockUuid,
              strategy: resolution.strategy,
              lineIndex: lineIdx
            });
            break;
          }
        }
      } catch (error) {
        console.error(`Failed to execute action at level ${level}:`, error);
        results.push({
          type: 'error',
          action: action.type,
          error: error.message,
          lineIndex: action.lineIndex,
          indentLevel: level
        });
      }
    } // End of levelActions loop

    console.log(`Completed level ${level}`);
  } // End of level-by-level loop
    
    // Build set of all current stroke timestamps for existence check
    const currentStrokeTimestamps = new Set(
      strokes.map(s => String(s.startTime))
    );
    
    // Check orphaned blocks - only delete if strokes no longer exist
    const orphanedBlocks = existingBlocks.filter(b => !usedBlockUuids.has(b.uuid));
    
    for (const block of orphanedBlocks) {
      // Parse stroke IDs from block (if available)
      const strokeIdsStr = block.properties?.['stroke-ids'];
      
      if (strokeIdsStr) {
        // Block has stroke IDs - check if any strokes still exist
        const blockStrokeIds = strokeIdsStr.split(',').map(id => id.trim());
        const strokesStillExist = blockStrokeIds.some(id => 
          currentStrokeTimestamps.has(id)
        );
        
        if (strokesStillExist) {
          // Strokes exist but block wasn't matched - PRESERVE IT
          console.log(`Preserving unmatched block ${block.uuid} - strokes still exist`);
          results.push({ 
            type: 'preserved', 
            uuid: block.uuid, 
            reason: 'strokes-exist-unmatched'
          });
          continue; // Don't delete
        }
      } else {
        // Block without stroke IDs - DON'T delete (safe default)
        console.log(`Preserving block ${block.uuid} - no stroke IDs to verify`);
        results.push({ 
          type: 'preserved', 
          uuid: block.uuid, 
          reason: 'no-stroke-ids'
        });
        continue;
      }
      
      // Only reach here if block has stroke IDs AND none of those strokes exist
      try {
        await makeRequest(host, token, 'logseq.Editor.removeBlock', [block.uuid]);
        results.push({ 
          type: 'deleted', 
          uuid: block.uuid, 
          reason: 'strokes-deleted'
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
    
    // CRITICAL: Match strokes to blocks and persist blockUuid
    // This enables incremental updates in future sessions
    try {
      // Build linesWithBlocks from results (using newLines)
      const linesWithBlocks = results
        .filter(r => r.type === 'created' || r.type === 'updated' || r.type === 'updated-merged')
        .map(r => {
          const lineIdx = r.lineIndex ?? r.consumedLines?.[0] ?? -1;
          if (lineIdx === -1) return null;

          const line = newLines[lineIdx];
          if (!line) return null;

          return {
            blockUuid: r.uuid,
            yBounds: line.yBounds
          };
        })
        .filter(Boolean);

      console.log(`Matching ${strokesWithoutBlockUuid.length} NEW strokes to ${linesWithBlocks.length} blocks`);

      // CRITICAL FIX: Only match NEW strokes (without blockUuid) to blocks
      // Existing strokes already preserve their blockUuid via matchStrokesToLines
      const strokeToBlockMap = matchStrokesToLines(strokes, linesWithBlocks);
      
      console.log(`Assigning ${strokeToBlockMap.size} strokes to blocks`);
      
      // Update in-memory strokes with block references
      updateStrokeBlockUuids(strokeToBlockMap);
      
      // Persist updated strokes (with blockUuid) to LogSeq
      const allStrokes = getStrokesSnapshot();
      const pageStrokes = allStrokes.filter(s => 
        s.pageInfo?.book === book && s.pageInfo?.page === page
      );
      
      if (pageStrokes.length > 0) {
        console.log(`Persisting ${pageStrokes.length} strokes with updated blockUuids`);
        await updatePageStrokes(book, page, pageStrokes, host, token);
      }
    } catch (error) {
      console.error('Failed to persist stroke→block associations:', error);
      // Don't fail the whole operation - blocks are still created
    }
    
    return {
      success: true,
      page: pageName,
      results,
      strokesAssigned: results.filter(r => r.type === 'created' || r.type === 'updated').length,
      stats: {
        created: results.filter(r => r.type === 'created').length,
        updated: results.filter(r => r.type === 'updated' || r.type === 'updated-merged').length,
        skipped: results.filter(r => r.type === 'skipped' || r.type === 'skipped-merged').length,
        preserved: results.filter(r => r.type === 'preserved').length,
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
        preserved: 0,
        merged: 0,
        deleted: 0,
        errors: 0
      }
    };
  }
}
