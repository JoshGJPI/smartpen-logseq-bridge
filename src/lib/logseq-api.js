/**
 * LogSeq API Wrapper for Svelte
 * Provides simple functions to interact with LogSeq HTTP API
 */

import { LogSeqAPI } from '../logseq-api.js';

// Singleton instance
let apiInstance = null;

/**
 * Get or create API instance
 */
function getAPI(host, token) {
  if (!apiInstance || apiInstance.host !== host || apiInstance.token !== token) {
    apiInstance = new LogSeqAPI(host, token);
  }
  return apiInstance;
}

/**
 * Test connection to LogSeq
 * @param {string} host - API host URL
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} { success, graphName?, error? }
 */
export async function testLogseqConnection(host, token = '') {
  try {
    const api = getAPI(host, token);
    const connected = await api.testConnection();
    
    if (connected) {
      // Get graph name for display
      const graph = await api.request('logseq.App.getCurrentGraph');
      return {
        success: true,
        graphName: graph?.name || 'Connected'
      };
    } else {
      return {
        success: false,
        error: 'Connection test failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send transcribed lines to LogSeq
 * @param {Array} lines - Transcribed lines with text and indentation
 * @param {string} host - API host URL
 * @param {string} token - Optional auth token
 * @returns {Promise<Object>} { success, blockCount?, error? }
 */
export async function sendToLogseq(lines, host, token = '') {
  try {
    const api = getAPI(host, token);
    
    // Get or create today's journal page
    const todayPage = api.getTodayPageName();
    
    // Create header block
    const headerContent = `## Smartpen Note - ${new Date().toLocaleTimeString()}`;
    const headerBlock = await api.appendBlockInPage(todayPage, headerContent, {
      source: 'smartpen',
      'imported-at': Date.now()
    });
    
    if (!headerBlock) {
      throw new Error('Failed to create header block');
    }
    
    let blockCount = 1;
    
    // Insert lines as nested blocks based on indentation
    const blockStack = [{ uuid: headerBlock.uuid, indent: -1 }];
    
    for (const line of lines) {
      const indent = line.indent || line.indentLevel || 0;
      const text = line.text || line.content || '';
      
      if (!text.trim()) continue;
      
      // Find parent block based on indentation
      while (blockStack.length > 1 && blockStack[blockStack.length - 1].indent >= indent) {
        blockStack.pop();
      }
      
      const parentBlock = blockStack[blockStack.length - 1];
      
      // Format content for LogSeq
      let blockContent = text;
      if (line.isCommand && line.commandType === 'TODO') {
        blockContent = `TODO ${text}`;
      } else if (line.isCommand && line.commandType === 'DONE') {
        blockContent = `DONE ${text}`;
      }
      
      // Insert block
      const newBlock = await api.request('logseq.Editor.insertBlock', [
        parentBlock.uuid,
        blockContent,
        { sibling: false }
      ]);
      
      if (newBlock) {
        blockStack.push({ uuid: newBlock.uuid, indent });
        blockCount++;
      }
    }
    
    return {
      success: true,
      blockCount,
      page: todayPage
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Re-export the class for advanced usage
export { LogSeqAPI };
