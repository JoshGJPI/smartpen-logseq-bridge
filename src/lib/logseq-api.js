/**
 * LogSeq API Integration
 * Communicates with LogSeq via its HTTP API (localhost:12315)
 */

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
  
  try {
    const cleanHost = host.replace(/\/$/, ''); // Remove trailing slash
    const response = await fetch(`${cleanHost}/api`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to LogSeq. Is the HTTP API enabled?');
    }
    throw error;
  }
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
 */
async function getOrCreatePage(host, token, pageName) {
  // First try to get the page
  let page = await makeRequest(host, token, 'logseq.Editor.getPage', [pageName]);
  
  if (!page) {
    // Create it if it doesn't exist
    page = await makeRequest(host, token, 'logseq.Editor.createPage', [
      pageName,
      {},
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
